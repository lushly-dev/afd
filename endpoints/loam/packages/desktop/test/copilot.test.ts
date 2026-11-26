/**
 * P5-A2 on the desktop (phase 5 specification, 3.2 and 18, as amended by D153): the copilot runtime's frame in this
 * platform's webview, on 3.2's design. The frame is the production one: `web`'s `dist/sandbox/copilot/`, built from
 * `@lushly-dev/loam-copilot`'s `dist/frame/` and written into the desktop's site by `deployment write`, served on
 * `loam-sandbox` with the path-scoped policy (`site.rs`), and opened by `web`'s own launcher over the kernel's port
 * halves (`test/pages/copilot.ts`).
 *
 * - S1: a turn whose text is `Hello` settles `done` with the test provider's `No script`, so the frame started its
 *   `blob:` worker, TanStack's `chat()` ran there, and every model byte crossed the model port.
 * - S2, rerun on the `importScripts` design: from the frame and its worker, none of the shell's storage is reachable,
 *   no connection opens, and the worker has no `RTCPeerConnection`; the bootstrap holds no third-party module; and a
 *   script on the sandbox origin outside the copilot's path loads in neither, so the path form is in force. The
 *   probes run in a frame made as the launcher makes its own, loading the production bootstrap and a test-only
 *   `probe-frame.js` from the copilot's path, whose worker loads `probe-worker.js` as the bootstrap loads a runtime
 *   chunk. Both are written into the site's `sandbox/copilot/` before the app starts; the production files carry no
 *   hook.
 * - D153: no message the frame posts through `invoke` with the shell's `Origin` forged, `window.ipc.postMessage`,
 *   `chrome.webview.postMessage` or `webkit.messageHandlers.ipc` runs a Rust command, by the main frame's handle
 *   counter; a keyed message with a forged `Origin` from the main frame does run, so a still counter is not a broken
 *   path. A message the invoke key drops at the host does not fail the gate.
 * - A `window` message from the frame is ignored by the main frame, and `reset()` removes the frame and stops its turn.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OUTSIDE_SCRIPT } from '../../copilot/test/probes.ts';
import { bundlePage } from './bundle';
import { fixtureTable, viewDeployment } from './frames';
import { type Desktop, ORIGINS, openDesktop, storedText, untilInstance } from './harness';

const COPILOT = fileURLToPath(new URL('../../copilot/', import.meta.url));
/** Two sessions: the `Hello` turn's, and the held turn's that the `window` message and `reset()` meet. */
const SESSION_HELLO = 'cps_00000000000000a2';
const SESSION_HELD = 'cps_00000000000000b2';
/** What `__TAURI_INTERNALS__.invoke` answered: `ok` and its value, or the rejection's text. */
type Invoked = { ok: boolean; value: string };
interface TurnView {
	outcomes: Array<{ state: string; reply: string; stoppedBy?: string; failure?: { code: string } }>;
	calls: string[];
	events: string[];
}

let desktop: Desktop;
/** The S1 turn's run id. */
let helloRun = '';
let listener: Server;
let listenerPort = 0;
/** Every request the watched listener received, from anywhere. */
const hits: string[] = [];

/**
 * Before the page's module runs: the sandbox origin its launcher takes, and a watch on `window`'s `message`
 * listeners and on the messages delivered to it, so the launcher's adding none can be read.
 */
const WATCH = `
	window.loamSandboxOrigin = arguments[0];
	const held = { listeners: [], delivered: 0, fromProbe: 0, onmessage: window.onmessage === null };
	window.loamMessageWatch = held;
	const add = window.addEventListener;
	window.addEventListener = function (type, listener, options) {
		if (type === 'message') held.listeners.push(String(listener).slice(0, 160));
		return add.call(this, type, listener, options);
	};
	add.call(window, 'message', (event) => {
		held.delivered++;
		const probe = window.loamCopilotTest && window.loamCopilotTest.probeWindow();
		if (probe && event.source === probe) held.fromProbe++;
	}, true);
`;

function targets() {
	return {
		shell: ORIGINS.shell,
		sandbox: ORIGINS.sandbox,
		listener: `http://127.0.0.1:${listenerPort}`,
		listenerWs: `ws://127.0.0.1:${listenerPort}`,
		extra: ['http://ipc.localhost/mount_open', 'ipc://localhost/mount_open'],
	};
}

beforeAll(async () => {
	listener = createServer((request, response) => {
		hits.push(`${request.method} ${request.url}`);
		response.end('self.loamTestImported = "listener";');
	});
	listener.on('upgrade', (request, socket) => {
		hits.push(`UPGRADE ${request.url}`);
		socket.destroy();
	});
	await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', () => resolve()));
	listenerPort = (listener.address() as { port: number }).port;
	const [frame, worker] = await Promise.all([
		bundlePage('copilot-frame'),
		bundlePage('copilot-worker'),
	]);
	desktop = await openDesktop({
		deployment: await viewDeployment(await fixtureTable()),
		async prepare(data) {
			const copilot = join(data, 'site/sandbox/copilot');
			writeFileSync(
				join(copilot, 'index-probe.html'),
				[
					'<!doctype html>',
					'<html lang="en">',
					'\t<head>',
					'\t\t<meta charset="utf-8" />',
					'\t\t<title>P5-A2 probe</title>',
					'\t\t<script src="bootstrap.js"></script>',
					'\t\t<script src="probe-frame.js"></script>',
					'\t</head>',
					'</html>',
					'',
				].join('\n')
			);
			writeFileSync(join(copilot, 'probe-frame.js'), frame);
			writeFileSync(join(copilot, 'probe-worker.js'), worker);
			// The worker's own-path import, which its policy admits, and one on the shell's origin, which it refuses.
			writeFileSync(join(copilot, 'probe-import.js'), 'self.loamTestImported = "sandbox";\n');
			writeFileSync(join(data, 'site/assets/test-import.js'), 'self.loamTestImported = "shell";\n');
			// A script on the sandbox origin outside the copilot's path, which the path-scoped policy refuses.
			writeFileSync(join(data, 'site', OUTSIDE_SCRIPT), 'self.loamTestImported = "outside";\n');
		},
	});
	await untilInstance(desktop, 'fixture', 'ready');
	// The probes wait on refused connections, a few seconds each.
	await desktop.browser.setTimeout({ script: 180_000 });
	await desktop.browser.execute(WATCH, ORIGINS.sandbox);
	await desktop.browser.execute(await bundlePage('copilot'));
}, 240_000);

afterAll(async () => {
	await desktop?.close();
	listener?.close();
});

/** Runs `script`, the body of an async function with the page's API as `test` and its arguments as `args`. */
async function inPage<T>(script: string, ...args: unknown[]): Promise<T> {
	const text = await desktop.browser.execute(
		`const test = window.loamCopilotTest; const args = arguments; return (async () => JSON.stringify(await (async () => { ${script} })() ?? null))();`,
		...args
	);
	return JSON.parse(text as string) as T;
}

function watch() {
	return desktop.browser.execute(
		() =>
			(
				window as unknown as {
					loamMessageWatch: {
						listeners: string[];
						delivered: number;
						fromProbe: number;
						onmessage: boolean;
					};
				}
			).loamMessageWatch
	);
}

/** `invoke` in the main frame, answered within `timeoutMs` or reported as unanswered. */
function invoke(
	command: string,
	args: Record<string, unknown> = {},
	timeoutMs = 10_000
): Promise<Invoked> {
	return desktop.browser.execute(
		async (command, args, timeoutMs) => {
			const internals = (
				window as unknown as {
					__TAURI_INTERNALS__?: { invoke?(command: string, args: unknown): Promise<unknown> };
				}
			).__TAURI_INTERNALS__;
			if (typeof internals?.invoke !== 'function') return { ok: false, value: 'no invoke' };
			try {
				const answer = await Promise.race([
					internals.invoke(command, args),
					new Promise((_, reject) => setTimeout(() => reject(new Error('unanswered')), timeoutMs)),
				]);
				return { ok: true, value: JSON.stringify(answer ?? null) };
			} catch (error) {
				return { ok: false, value: String(error) };
			}
		},
		command,
		args,
		timeoutMs
	) as Promise<Invoked>;
}

function report(label: string, value: unknown): void {
	process.stderr.write(`P5-A2 ${process.platform} ${label}: ${JSON.stringify(value)}\n`);
}

describe('P5-A2: the runtime’s frame on the desktop', () => {
	it('P5-A2: the site serves the production frame, whose bootstrap holds no third-party module', () => {
		const served = join(desktop.data, 'site/sandbox/copilot');
		const built = join(COPILOT, 'dist/frame');
		for (const file of ['index.html', 'bootstrap.js', 'runtime-anthropic.js', 'runtime-openai.js'])
			expect(readFileSync(join(served, file)).equals(readFileSync(join(built, file))), file).toBe(
				true
			);
		const html = readFileSync(join(served, 'index.html'), 'utf8');
		expect(
			[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => [m[0], m[1]])
		).toEqual([['<script src="bootstrap.js"></script>', '']]);
		// First-party and small: no import, no connection, no peer connection, no evaluation of text.
		expect(readFileSync(join(COPILOT, 'src/frame/bootstrap.ts'), 'utf8')).not.toMatch(
			/^\s*(import|export)\s/m
		);
		const bootstrap = readFileSync(join(served, 'bootstrap.js'), 'utf8');
		expect(bootstrap.length).toBeLessThan(2_048);
		expect(bootstrap).not.toMatch(
			/tanstack|ag-ui|zod|\bfetch\(|XMLHttpRequest|WebSocket|RTCPeerConnection|\beval\(|new Function|\bimport\(/i
		);
		// The one script it writes is the worker's line, `importScripts` of a chunk on its own path.
		expect(bootstrap.match(/importScripts/g)).toHaveLength(1);
	});

	it('P5-A2: S1 a Hello turn in the production frame settles done with No script, every model byte through the model port', async () => {
		helloRun = await inPage<string>('return test.turn(args[0], args[1]);', SESSION_HELLO, 'Hello');
		const settled = await inPage<TurnView>('return test.settled(args[0], 60000);', helloRun);
		const transport = await inPage<{ sends: number; bytes: number; providers: string[] }>(
			'return test.transport();'
		);
		const frame = await inPage<Record<string, unknown>>('return test.frame();');
		const refusals = await inPage<string[]>('return test.refusals();');
		report('S1', { settled, transport, frame, refusals });
		expect(settled.outcomes).toHaveLength(1);
		expect(settled.outcomes[0]).toMatchObject({ state: 'done', reply: 'No script' });
		// The worker ran: its runtime listed the tools through the agent port, and the reply streamed back.
		expect(settled.calls).toEqual(['listCommands']);
		expect(settled.events).toContain('TEXT_MESSAGE_CONTENT');
		expect(transport.sends).toBeGreaterThanOrEqual(1);
		expect(transport.bytes).toBeGreaterThan(0);
		expect(new Set(transport.providers)).toEqual(new Set(['test']));
		expect(frame).toEqual({
			inDocument: 1,
			held: true,
			connected: true,
			sandbox: 'allow-scripts',
			src: `${ORIGINS.sandbox}/sandbox/copilot/index.html`,
		});
		expect(refusals).toEqual([]);
	});

	it('P5-A2: S2 from the frame and its worker none of the shell’s storage is reachable and no connection opens', async () => {
		const state = await inPage<Record<string, string>>('return test.setupShellState();');
		expect(state).toEqual({
			indexedDB: 'written',
			localStorage: 'written',
			caches: 'opened',
			locks: 'held',
			broadcastChannel: 'posting',
		});
		const ready = await inPage<{ origin: string; resources: string[]; scripts: string[] }>(
			'return test.probeReady(args[0]);',
			targets()
		);
		const before = hits.length;
		const probes = await inPage<{
			frame: Record<string, string>;
			worker: Record<string, string>;
			violations: string[];
		}>("return test.ask(args[0], 'probes');", targets());
		const heard = await inPage<string[]>('return test.shellHeard();');
		const received = hits.slice(before);
		report('S2 ready', ready);
		report('S2 probes', probes);
		report('S2 shell heard', heard);
		report('S2 listener', received);
		// The frame runs under the copilot path's policy: an opaque origin, and only the bootstrap and the probe loaded.
		expect(ready.origin).toBe('null');
		const copilotPath = `${ORIGINS.sandbox}/sandbox/copilot/`;
		expect(ready.scripts).toEqual([`${copilotPath}bootstrap.js`, `${copilotPath}probe-frame.js`]);
		for (const resource of ready.resources)
			expect(resource).toMatch(/\/sandbox\/copilot\/(bootstrap|probe-frame)\.js$/);
		const { frame, worker } = probes;
		expect(worker.started).toBe('yes');
		for (const [where, found] of Object.entries({ frame, worker })) {
			expect(found.origin, where).toBe('null');
			expect(found.indexedDB, where).not.toMatch(/shell-records|databases=\[[^\]]*loam-test-shell/);
			expect(found.caches, where).not.toMatch(/loam-test-shell/);
			expect(found.localStorage, where).not.toMatch(/shell-value/);
			expect(found.cookie, where).not.toMatch(/loam-test-shell/);
			expect(found.locks, where).not.toMatch(/SHELL LOCK SEEN|held=\[[^\]]*loam-test-shell/);
			expect(found.broadcastChannel, where).not.toMatch(/from-shell/);
			for (const [probe, answer] of Object.entries(found)) {
				if (probe.startsWith('fetch ') || probe.startsWith('xhr '))
					expect(answer, `${where} ${probe}`).not.toMatch(/^ANSWERED/);
				if (probe.startsWith('websocket ')) expect(answer, `${where} ${probe}`).not.toBe('OPENED');
			}
			expect(found.tauri, where).not.toMatch(/COMMAND RAN|INVOKE ANSWERED/);
		}
		expect(worker.RTCPeerConnection).toBe('undefined');
		// The worker loads scripts from the copilot's path alone: the path-scoped policy admits its own, and refuses
		// the shell's origin and the listener.
		expect(worker['importScripts own sandbox origin']).toBe('LOADED sandbox');
		expect(worker['importScripts shell origin']).toMatch(/^refused/);
		expect(worker['importScripts listener']).toMatch(/^refused/);
		// The path form in force, not the origin's: a script on the sandbox origin outside the copilot's path loads in
		// neither the frame nor its worker.
		expect(frame['script outside the copilot path']).toMatch(/^refused/);
		expect(worker['importScripts outside the copilot path']).toMatch(/^refused/);
		expect(heard.filter((message) => message !== 'from-shell')).toEqual([]);
		expect(received).toEqual([]);
	});

	it('P5-A2: D153, no message the frame posts through invoke with a forged Origin or a raw IPC message runs a command', async () => {
		const first = await invoke('mount_open', { instance: 'fixture' });
		expect(first.ok).toBe(true);
		const posted = await inPage<{ found: Record<string, string> }>(
			"return test.ask(args[0], 'ipc');",
			targets()
		);
		report('D153 frame posts', posted);
		// The frame's own answers prove nothing; the handle counter is the oracle: nothing it posted ran `mount_open`.
		const second = await invoke('mount_open', { instance: 'fixture' });
		try {
			expect(second.ok).toBe(true);
			expect(Number(second.value)).toBe(Number(first.value) + 1);
		} finally {
			for (const handle of [first, second])
				if (handle.ok) await invoke('mount_close', { handle: Number(handle.value) });
		}
		expect(posted.found.invoke).not.toBe('answered');
	});

	it("P5-A2 (D153): from the main frame, Tauri's postMessage fallback runs a keyed command whose Origin is forged", async () => {
		// The control for the test above, whose still counter means something only if a delivered keyed message would
		// move it. The main frame, whose posts every engine delivers, sends what a frame holding the key could.
		const answers = (await desktop.browser.execute(
			async (shell, timeoutMs) => {
				const page = window as unknown as {
					__TAURI_INTERNALS__: {
						invoke(command: string, args: unknown): Promise<unknown>;
						transformCallback(callback: (value: unknown) => void, once: boolean): number;
					};
					ipc: { postMessage(message: string): void };
				};
				const internals = page.__TAURI_INTERNALS__;
				// The key, from the shell's own IPC fetch, as a frame on WebView2 can read it from its own.
				const fetched = window.fetch;
				let key = '';
				window.fetch = (input, init) => {
					const found = new Headers(init?.headers).get('Tauri-Invoke-Key');
					if (found) key = found;
					return fetched.call(window, input, init);
				};
				let first: unknown;
				try {
					first = await internals.invoke('mount_open', { instance: 'fixture' });
				} finally {
					window.fetch = fetched;
				}
				await internals.invoke('mount_close', { handle: first });
				const post = (headers: Record<string, string>, invokeKey: string) =>
					new Promise<string>((resolve) => {
						const timer = setTimeout(() => resolve('unanswered'), timeoutMs);
						const settle = (outcome: string) => async (value: unknown) => {
							clearTimeout(timer);
							const answer = `${outcome} ${JSON.stringify(value)}`;
							if (outcome === 'ok') {
								try {
									await internals.invoke('mount_close', { handle: value });
								} catch (cause) {
									resolve(`${answer}, not closed: ${String(cause)}`);
									return;
								}
							}
							resolve(answer);
						};
						page.ipc.postMessage(
							JSON.stringify({
								cmd: 'mount_open',
								callback: internals.transformCallback(settle('ok'), true),
								error: internals.transformCallback(settle('error'), true),
								payload: { instance: 'fixture' },
								options: { headers },
								__TAURI_INVOKE_KEY__: invokeKey,
							})
						);
					});
				return {
					first: String(first),
					keyed: key !== '',
					forged: await post({ Origin: shell }, key),
				};
			},
			ORIGINS.shell,
			2_000
		)) as { first: string; keyed: boolean; forged: string };
		report('D153 main-frame control', answers);
		expect(answers.keyed).toBe(true);
		expect(answers.forged).toBe(`ok ${Number(answers.first) + 1}`);
		const last = await invoke('mount_open', { instance: 'fixture' });
		try {
			expect(last.ok).toBe(true);
			expect(Number(last.value)).toBe(Number(answers.first) + 2);
		} finally {
			if (last.ok) await invoke('mount_close', { handle: Number(last.value) });
		}
	});

	it('P5-A2: a window message from the frame to the main frame is ignored', async () => {
		const sends = (await inPage<{ sends: number }>('return test.transport();')).sends;
		const runId = await inPage<string>(
			'return test.turn(args[0], args[1]);',
			SESSION_HELD,
			'script:hang'
		);
		// The turn is running: its model stream is open and held, and its own start drawn, which comes a round trip after
		// the request (the provider's first chunk reaching the runtime), on the panel's port: the snapshot waits for it, so
		// any later event is the window message's.
		await inPage('return test.sent(args[0], 30000);', sends + 1);
		const held = await inPage<TurnView>(
			'return test.drawn(args[0], args[1], 30000);',
			runId,
			'RUN_STARTED'
		);
		expect(held.events).toContain('RUN_STARTED');
		const watched = await watch();
		const stored = await storedText(desktop.browser);
		const first = await invoke('mount_open', { instance: 'fixture' });
		expect(first.ok).toBe(true);
		const posted = await inPage<{ sent: string[] }>(
			"return test.ask(args[0], 'post-parent', { runId: args[1] });",
			targets(),
			runId
		);
		await new Promise((resolve) => setTimeout(resolve, 1_000));
		const after = await watch();
		const second = await invoke('mount_open', { instance: 'fixture' });
		try {
			expect(second.ok).toBe(true);
			expect(Number(second.value)).toBe(Number(first.value) + 1);
		} finally {
			for (const handle of [first, second])
				if (handle.ok) await invoke('mount_close', { handle: Number(handle.value) });
		}
		const view = await inPage<TurnView>('return test.view(args[0]);', runId);
		report('window message', { posted, watched, after, held, view });
		expect(posted.sent).toEqual(['call', 'end', 'event', 'ports']);
		// The messages reached the main frame's window, and nothing heard them: no listener was added since the
		// page's copilot was made, its turn neither ended nor drew, its agent capability was not called, and no record
		// or journal entry was written.
		expect(after.fromProbe - watched.fromProbe).toBe(4);
		expect(after.listeners).toEqual([]);
		expect(after.onmessage).toBe(true);
		expect(view).toEqual(held);
		expect(view.outcomes).toEqual([]);
		expect(await storedText(desktop.browser)).toBe(stored);
	});

	it('P5-A2: reset() removes the frame and stops its running turn as session-changed', async () => {
		const sends = (await inPage<{ sends: number }>('return test.transport();')).sends;
		const runId = await inPage<string>(
			'return test.turn(args[0], args[1]);',
			SESSION_HELD,
			'script:hang'
		);
		await inPage('return test.sent(args[0], 30000);', sends + 1);
		const hello = await inPage<TurnView>('return test.view(args[0]);', helloRun);
		expect((await inPage<TurnView>('return test.view(args[0]);', runId)).outcomes).toEqual([]);
		expect((await inPage<{ inDocument: number }>('return test.frame();')).inDocument).toBe(1);
		await inPage('test.reset();');
		const stopped = await inPage<TurnView>('return test.settled(args[0], 5000);', runId);
		const frame = await inPage<Record<string, unknown>>('return test.frame();');
		report('reset', { stopped, frame });
		expect(stopped.outcomes).toHaveLength(1);
		expect(stopped.outcomes[0]).toMatchObject({ state: 'stopped', stoppedBy: 'session-changed' });
		expect(frame).toMatchObject({ inDocument: 0, held: false });
		// A turn that had settled keeps its one outcome.
		expect((await inPage<TurnView>('return test.view(args[0]);', helloRun)).outcomes).toEqual(
			hello.outcomes
		);
	});
});
