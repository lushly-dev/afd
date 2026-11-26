/**
 * P5-A3 on the desktop (phase 5 specification, 4.2 and 18): the model transport through the Rust host. A scripted
 * local provider (`kind = "openai-compatible"` at `http://127.0.0.1:<port>/v1`) records each request it is sent, and
 * answers in Chat Completions' stream: with text, with more than 16 MiB, or not at all until it is cancelled.
 *
 * - `model_send` from the main frame streams it, as `loam:model` events; the request goes to the configured endpoint
 *   with the configured model, whatever the body named, and the key from an owner-only file as its one key header.
 * - An id not in `models.json`, a body the allow-list refuses and a key that is not there are refused before anything
 *   is sent; a stream past 16 MiB ends with `MODEL_STREAM_LIMIT`; `model_cancel` drops the request.
 * - A turn through the production copilot (the lazy chunk, the frame, the desktop's transport) reaches the provider
 *   and settles with its text.
 * - The key appears in no DOM, store, journal entry, log line (the app's stderr) or error.
 * - On Windows, a key set in the Credential Manager by `loam copilot key set`'s own writer is read by the Rust host.
 *
 * From the sandbox proxy and a view `model_send` is refused by the origin check (`src-tauri/tests/origin.rs`). From a
 * frame made as the copilot's runtime frame is (`sandbox="allow-scripts"`, on the copilot's path), `model_send` posted
 * through `invoke` with the shell's `Origin` forged, `window.ipc.postMessage`, `chrome.webview.postMessage` and
 * `webkit.messageHandlers.ipc` reaches no provider: the scripted provider is the counter (D153, as P5-A2 shows for
 * `mount_open` in `copilot.test.ts`).
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemKeychain } from '@lushly-dev/loam-cli/copilot-key';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restrict, system } from './fixtures/owner-only';
import {
	type Desktop,
	desktopDeployment,
	ORIGINS,
	openDesktop,
	pageText,
	redactInvokeKey,
	storedText,
} from './harness';

const windows = process.platform === 'win32';
const FILE_KEY = `sk-local-file-${randomBytes(12).toString('hex')}`;
const KEYCHAIN_KEY = `sk-local-keychain-${randomBytes(12).toString('hex')}`;
const SERVICE = 'loam-copilot-test';
const ACCOUNT = `run-${randomBytes(6).toString('hex')}`;
const MODEL = 'scripted-model';

interface Received {
	path: string;
	headers: IncomingHttpHeaders;
	body: Record<string, unknown>;
	closed: boolean;
}

let desktop: Desktop;
let server: Server;
let port = 0;
const received: Received[] = [];

/** The frame's script: `model_send` through every path a frame has, with a body the allow-list admits. */
const PROBE = `(() => {
	const shell = decodeURIComponent(location.hash.slice(1));
	const payload = { provider: 'local', stream: 77, body: { max_tokens: 8, stream: true, messages: [{ role: 'user', content: 'from the frame' }] } };
	const headers = { Origin: shell };
	const message = JSON.stringify({ cmd: 'model_send', callback: 1, error: 2, payload, options: { headers }, __TAURI_INVOKE_KEY__: 'forged' });
	const tried = [];
	try { window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke('model_send', payload, { headers }).catch(() => {}); tried.push('invoke'); } catch {}
	for (const [name, post] of [['window.ipc', window.ipc], ['chrome.webview', window.chrome && window.chrome.webview], ['webkit.messageHandlers.ipc', window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ipc]]) {
		try { if (post && post.postMessage) { post.postMessage(message); tried.push(name); } } catch {}
	}
	// That it ran, and what it posted through: the test's own listener reads it, the shell does not.
	window.parent.postMessage({ loamModelProbe: tried }, '*');
})();
`;

const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

/** The provider's answer: text, a stream past 16 MiB, or one that waits until it is cancelled. */
function answer(text: string, response: import('node:http').ServerResponse, held: Received): void {
	response.writeHead(200, { 'content-type': 'text/event-stream' });
	if (text.includes('big')) {
		const line = `: ${'x'.repeat(1024 * 1024 - 3)}\n`;
		let sent = 0;
		const more = (): void => {
			while (sent < 18 && !held.closed) {
				sent += 1;
				if (!response.write(line)) {
					response.once('drain', more);
					return;
				}
			}
			response.end();
		};
		more();
		return;
	}
	if (text.includes('hang')) {
		response.write(
			chunk({ id: 'c', object: 'chat.completion.chunk', created: 1, model: MODEL, choices: [] })
		);
		return;
	}
	response.write(
		chunk({
			id: 'c1',
			object: 'chat.completion.chunk',
			created: 1,
			model: MODEL,
			choices: [
				{ index: 0, delta: { role: 'assistant', content: 'Hi from local' }, finish_reason: null },
			],
		})
	);
	response.write(
		chunk({
			id: 'c1',
			object: 'chat.completion.chunk',
			created: 1,
			model: MODEL,
			choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
		})
	);
	response.write(
		chunk({
			id: 'c1',
			object: 'chat.completion.chunk',
			created: 1,
			model: MODEL,
			choices: [],
			usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 },
		})
	);
	response.end('data: [DONE]\n\n');
}

function copilotTable(keyFile: string): string {
	const provider = (id: string, key: string) =>
		[
			'[[copilot.providers]]',
			`id = "${id}"`,
			'kind = "openai-compatible"',
			`model = "${MODEL}"`,
			`endpoint = "http://127.0.0.1:${port}/v1"`,
			`key = ${key}`,
			'',
		].join('\n');
	return [
		'[copilot]',
		'default = "local"',
		'',
		provider('local', `{ file = ${JSON.stringify(keyFile)} }`),
		provider('nokey', `{ keychain = "${SERVICE}", account = "absent-${ACCOUNT}" }`),
		...(windows
			? [provider('keychain', `{ keychain = "${SERVICE}", account = "${ACCOUNT}" }`)]
			: []),
	].join('\n');
}

beforeAll(async () => {
	server = createServer((request, response) => {
		let text = '';
		request.setEncoding('utf8');
		request.on('data', (part: string) => {
			text += part;
		});
		request.on('end', () => {
			const body = JSON.parse(text) as Record<string, unknown>;
			const held: Received = {
				path: request.url ?? '',
				headers: request.headers,
				body,
				closed: false,
			};
			received.push(held);
			response.on('close', () => {
				held.closed = true;
			});
			answer(JSON.stringify(body.messages ?? []), response, held);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
	port = (server.address() as { port: number }).port;
	const keys = await mkdtemp(join(tmpdir(), 'loam-desktop-keys-'));
	const keyFile = join(keys, 'local.key');
	await writeFile(keyFile, `${FILE_KEY}\n`);
	restrict(keyFile);
	if (windows) await systemKeychain('win32').set(SERVICE, ACCOUNT, KEYCHAIN_KEY);
	const deployment = `${desktopDeployment()}\n${copilotTable(keyFile)}`;
	desktop = await openDesktop({
		deployment,
		async prepare(data) {
			// A frame on the copilot's path, under its policy, that posts `model_send` every way a frame can (D153).
			const copilot = join(data, 'site/sandbox/copilot');
			await writeFile(
				join(copilot, 'probe-models.html'),
				'<!doctype html>\n<html lang="en"><head><meta charset="utf-8" /><title>D153 model_send probe</title><script src="probe-models.js"></script></head></html>\n'
			);
			await writeFile(join(copilot, 'probe-models.js'), PROBE);
		},
	});
	await desktop.browser.setTimeout({ script: 120_000 });
	// Every `loam:model` event the page hears, from the start.
	await desktop.browser.execute(() => {
		const held = window as unknown as { loamModelEvents: unknown[] };
		held.loamModelEvents = [];
		window.addEventListener('loam:model', (event) =>
			held.loamModelEvents.push((event as CustomEvent).detail)
		);
	});
}, 240_000);

afterAll(async () => {
	await desktop?.close();
	server?.close();
	if (windows) spawnSync(join(system(), 'cmdkey.exe'), [`/delete:${SERVICE}/${ACCOUNT}`]);
});

const BODY = (text: string) => ({
	model: 'a-model-the-body-names',
	max_tokens: 64,
	stream: true,
	stream_options: { include_usage: true },
	messages: [{ role: 'user', content: text }],
});

interface ModelEventView {
	stream: number;
	status?: number;
	chunk?: string;
	done?: true;
	code?: string;
}

/** Stream ids this suite names, as a page names its own (4.2). */
let nextStream = 1000;

/** `model_send` in the main frame, on a stream id of its own: that id, or the refusal's code. */
function send(provider: string, body: unknown): Promise<{ ok: boolean; value: string }> {
	nextStream += 1;
	return desktop.browser.execute(
		async (provider, body, stream) => {
			const internals = (
				window as unknown as {
					__TAURI_INTERNALS__: { invoke(command: string, args: unknown): Promise<unknown> };
				}
			).__TAURI_INTERNALS__;
			try {
				return {
					ok: true,
					value: String(await internals.invoke('model_send', { provider, body, stream })),
				};
			} catch (error) {
				return { ok: false, value: String(error) };
			}
		},
		provider,
		body,
		nextStream
	) as Promise<{ ok: boolean; value: string }>;
}

function eventsOf(stream: number): Promise<ModelEventView[]> {
	return desktop.browser.execute(
		(stream) =>
			(window as unknown as { loamModelEvents: Array<{ stream: number }> }).loamModelEvents.filter(
				(event) => event.stream === stream
			),
		stream
	) as Promise<ModelEventView[]>;
}

async function untilDone(stream: number, timeoutMs = 60_000): Promise<ModelEventView[]> {
	const until = Date.now() + timeoutMs;
	for (;;) {
		const events = await eventsOf(stream);
		if (events.some((event) => event.done)) return events;
		if (Date.now() > until) throw new Error(`stream ${stream} did not end`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

describe('P5-A3: the model transport on the desktop', () => {
	it('P5-A3: model_send streams the scripted local provider, with the configured endpoint, model and key header', async () => {
		const sent = await send('local', BODY('Hello'));
		expect(sent.ok, sent.value).toBe(true);
		const events = await untilDone(Number(sent.value));
		expect(events[0]).toEqual({ stream: Number(sent.value), status: 200 });
		expect(events.at(-1)).toEqual({ stream: Number(sent.value), done: true, status: 200 });
		const text = events.map((event) => event.chunk ?? '').join('');
		expect(text).toContain('Hi from local');
		expect(text).toContain('data: [DONE]');
		const request = received.at(-1) as Received;
		expect(request.path).toBe('/v1/chat/completions');
		expect(request.body.model).toBe(MODEL);
		expect(request.body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
		expect(request.headers.authorization).toBe(`Bearer ${FILE_KEY}`);
		// The kind's key header and nothing of the page's: no origin, cookie, referrer or agent string.
		const names = Object.keys(request.headers).sort();
		for (const name of names)
			expect(['accept', 'authorization', 'content-length', 'content-type', 'host'], name).toContain(
				name
			);
	});

	it('P5-A3: an unknown id, a refused body and a missing key are refused before anything is sent', async () => {
		const before = received.length;
		expect(await send('nobody', BODY('Hello'))).toEqual({
			ok: false,
			value: 'COPILOT_PROVIDER_UNKNOWN',
		});
		for (const body of [
			{ ...BODY('Hello'), web_search_options: {} },
			{ ...BODY('Hello'), tools: [{ type: 'web_search_preview' }] },
			{ ...BODY('Hello'), unlisted: true },
			{
				...BODY('Hello'),
				messages: [
					{
						role: 'user',
						content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }],
					},
				],
			},
			{ ...BODY('Hello'), max_tokens: 1_000_000 },
		])
			expect(await send('local', body), JSON.stringify(body)).toEqual({
				ok: false,
				value: 'MODEL_BODY_REFUSED',
			});
		expect(await send('nokey', BODY('Hello'))).toEqual({ ok: false, value: 'COPILOT_KEY_MISSING' });
		expect(received.length).toBe(before);
	});

	it('P5-A3: a stream past 16 MiB ends with MODEL_STREAM_LIMIT', async () => {
		const sent = await send('local', BODY('big'));
		expect(sent.ok, sent.value).toBe(true);
		const events = await untilDone(Number(sent.value), 120_000);
		expect(events.at(-1)).toMatchObject({ done: true, code: 'MODEL_STREAM_LIMIT' });
		const bytes = events.reduce((total, event) => total + (event.chunk?.length ?? 0), 0);
		expect(bytes).toBeLessThanOrEqual(16 * 1024 * 1024);
		// The page keeps no more of a stream than it read: drop the held events.
		await desktop.browser.execute(() => {
			(window as unknown as { loamModelEvents: unknown[] }).loamModelEvents = [];
		});
	});

	it('P5-A3: model_cancel drops the request', async () => {
		const sent = await send('local', BODY('hang'));
		expect(sent.ok, sent.value).toBe(true);
		const request = await (async () => {
			for (let tries = 0; tries < 100; tries += 1) {
				const found = received.find((held) => JSON.stringify(held.body).includes('hang'));
				if (found) return found;
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			throw new Error('the provider was never asked');
		})();
		expect(request.closed).toBe(false);
		await desktop.browser.execute(
			async (stream) =>
				(
					window as unknown as {
						__TAURI_INTERNALS__: { invoke(command: string, args: unknown): Promise<unknown> };
					}
				).__TAURI_INTERNALS__.invoke('model_cancel', { stream }),
			Number(sent.value)
		);
		const until = Date.now() + 5_000;
		while (!request.closed && Date.now() < until)
			await new Promise((resolve) => setTimeout(resolve, 50));
		expect(request.closed).toBe(true);
	});

	it('P5-A3: a turn through the production copilot reaches the provider through the Rust host and settles', async () => {
		const listed = await desktop.call('copilot-provider-list');
		expect(listed.data).toMatchObject({
			providers: expect.arrayContaining([
				{ id: 'local', kind: 'openai-compatible', model: MODEL, default: true },
			]),
		});
		const started = await desktop.call('copilot-session-start', {});
		const session = (started.data as { session: { id: string } }).session.id;
		const sent = await desktop.call('copilot-message-send', { session, text: 'Hello', wait: true });
		expect(sent.success, JSON.stringify(sent.error)).toBe(true);
		expect((sent.data as { turn: { state: string; reply: string } }).turn).toMatchObject({
			state: 'done',
			reply: 'Hi from local',
		});
		const request = received.at(-1) as Received;
		expect(request.body.model).toBe(MODEL);
		// The kernel's half bounded `max_tokens` to the turn's output limit.
		expect(Number(request.body.max_tokens)).toBeLessThanOrEqual(16_384);
		expect(request.headers.authorization).toBe(`Bearer ${FILE_KEY}`);
	});

	it('P5-A3: a keychain key is read per request: on Windows, the one loam copilot key set’s writer stored', async () => {
		if (windows) {
			// The Credential Manager entry `systemKeychain` wrote before the app started.
			const sent = await send('keychain', BODY('Hello'));
			expect(sent.ok, sent.value).toBe(true);
			await untilDone(Number(sent.value));
			expect((received.at(-1) as Received).headers.authorization).toBe(`Bearer ${KEYCHAIN_KEY}`);
			return;
		}
		// Elsewhere the suite's runner holds no keychain to write (the Linux job has no Secret Service): the keychain
		// path is still taken, and an entry that is not there is refused before anything is sent.
		const before = received.length;
		expect(await send('nokey', BODY('Hello'))).toEqual({ ok: false, value: 'COPILOT_KEY_MISSING' });
		expect(received.length).toBe(before);
	});

	it("P5-A3: D153, no message a frame like the runtime's posts runs model_send: the provider hears nothing", async () => {
		const before = received.length;
		const refusals = desktop.stderr.keyRefusals;
		// The probe says it ran, and through which paths it posted, so a frame that never ran cannot pass for one refused.
		const tried = (await desktop.browser.execute(
			(sandbox, shell) =>
				new Promise<string[]>((resolve, reject) => {
					const frame = document.createElement('iframe');
					frame.setAttribute('sandbox', 'allow-scripts');
					frame.dataset.probe = 'models';
					const heard = (event: MessageEvent) => {
						const ran = (event.data as { loamModelProbe?: string[] } | null)?.loamModelProbe;
						if (event.source !== frame.contentWindow || !Array.isArray(ran)) return;
						window.removeEventListener('message', heard);
						resolve(ran);
					};
					window.addEventListener('message', heard);
					setTimeout(() => reject(new Error('the probe never ran')), 20_000);
					frame.src = `${sandbox}/sandbox/copilot/probe-models.html#${encodeURIComponent(shell)}`;
					document.body.append(frame);
				}),
			ORIGINS.sandbox,
			ORIGINS.shell
		)) as string[];
		// WebView2 gives the frame Tauri's script; WebKitGTK gives it wry's handler. Each path it had, it used.
		expect(tried.length).toBeGreaterThan(0);
		if (windows)
			expect(tried).toEqual(expect.arrayContaining(['invoke', 'window.ipc', 'chrome.webview']));
		else expect(tried).toContain('webkit.messageHandlers.ipc');
		// Time for a delivered message to run, and for a request to reach the provider.
		await new Promise((resolve) => setTimeout(resolve, 4_000));
		expect(received.length).toBe(before);
		// The control: the same command from the main frame reaches it.
		const sent = await send('local', BODY('control'));
		expect(sent.ok, sent.value).toBe(true);
		await untilDone(Number(sent.value));
		expect(received.length).toBe(before + 1);
		// WebView2 hears no frame's message at all; WebKitGTK hears it and the invoke key drops it (D153).
		if (windows) expect(desktop.stderr.keyRefusals).toBe(refusals);
		else expect(desktop.stderr.keyRefusals).toBeGreaterThan(refusals);
	});

	it("#1448: the harness shows Tauri's refusal line with the expected key replaced", () => {
		const line = '__TAURI_INVOKE_KEY__ expected 0123456789abcdef but received forged';
		expect(redactInvokeKey(line)).toBe('__TAURI_INVOKE_KEY__ expected <key> but received <other>');
		expect(redactInvokeKey('__TAURI_INVOKE_KEY__ expected 0123456789abcdef but received ')).toBe(
			'__TAURI_INVOKE_KEY__ expected <key> but received <empty>'
		);
		expect(desktop.stderr.lines.join('\n')).not.toMatch(/__TAURI_INVOKE_KEY__ expected (?!<key>)/);
	});

	it('P5-A3: the key appears in no DOM, store, journal entry, log line or error', async () => {
		const seen = [
			await pageText(desktop.browser),
			await storedText(desktop.browser),
			desktop.stderr.lines.join('\n'),
			JSON.stringify(await desktop.call('copilot-provider-list')),
		].join('\n');
		for (const key of [FILE_KEY, KEYCHAIN_KEY]) expect(seen).not.toContain(key);
		// Nor its file's path, nor the endpoint: the webview names a provider id alone.
		expect(await pageText(desktop.browser)).not.toContain('local.key');
	});
});
