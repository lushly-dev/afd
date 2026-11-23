/**
 * P6-H6 (phase 6 specification, 8.1 steps 15 to 17, and section 19), under small `[limits]`: the hosted relay's idle
 * expiry, eviction, slots, deadlines and stream cuts, which the default limits (15 minutes, 16 slots, 60 s) put out of a
 * test's reach, and the server's records against the browser's copy. `startDevHost`'s test-only `limits` sets them in
 * the development profile's server configuration, as `loam.server.toml`'s `[limits]` would.
 *
 * Proved here, each by what an instance received (`relay-fixtures.ts`'s logs) and what the page or its kernel was
 * answered: an idle binding `DELETE`d upstream at `relay_session_idle_ms`; a fifth binding evicting the least recently
 * used idle one; an upstream `404` dropping its binding; the `429` when every slot is busy, an aborted page request and a
 * cancelled call each freeing theirs; the `504` before the status; a stream cut after its status, past
 * `relay_response_bytes` or `relay_timeout_ms`, failing the shell's call at once and journaled with its code; a response
 * with another `id` cutting a stream, and a server request dropped from one; 3.5's headers on forwarded answers; and
 * `MOUNT_SPACE_PINNED`, `MOUNT_PROJECT_NOT_LISTED` and `WORKSPACE_NOT_MEMBER` reaching the shell's kernel as themselves
 * where the server's records refuse what the browser's copy let through, by the relay's journal; and `scanSecrets` clean.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type DevHost, scanSecrets, startDevHost } from '@lushly-dev/loam-host/testing';
import { TEST_RATE_LIMIT } from '@lushly-dev/loam-identity/testing';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	hostedProviderDeployment,
	kernelCall,
	launchForDevHost,
	openShell,
	type ShellPage,
} from '../browser/harness';
import { untilInstance } from '../mounted/support';
import { type Fixture, type Logged, startAfdFixture, startLegacyFixture } from './relay-fixtures';
import {
	bodyOf,
	codeOf,
	fixtureEntry,
	legacyInitialize,
	modern,
	posts,
	type Result,
	relayAs,
	rpc,
	scoped,
	streamAs,
	toolCall,
	WORKSPACE,
} from './relay-support';

const BASE = '/loam/';
const PASSWORD = 'correct horse battery staple';
const TOKENS = { team: 'team-bearer-limits-0123456789', legacy: 'legacy-bearer-limits-0123456789' };
/** Small enough to pass in a test, large enough for every ordinary answer and discovery. */
const LIMITS = {
	// Long enough that the eviction case's five TLS `initialize`s finish well before it on a loaded host.
	relay_session_idle_ms: 8_000,
	relay_timeout_ms: 5_000,
	relay_response_bytes: 65_536,
	relay_concurrency_per_person: 2,
} as const;
const TEAM = ['audience = "team"', 'projects = ["atlas", "vault"]', 'space = { atlas = "main" }'];

let host: DevHost;
let browser: Browser;
let directory: string;
let team: Fixture;
let legacy: Awaited<ReturnType<typeof startLegacyFixture>>;
/** Bea's shell, which discovers `team`; Olu and Cai make raw requests only, so neither holds a binding of the shell's. */
let bea: ShellPage;
let olu: ShellPage;
let cai: ShellPage;
const ids = { atlas: '', vault: '', bea: '' };
const opened: ShellPage[] = [];

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'loam-relay-limits-'));
	team = await startAfdFixture('hybrid');
	legacy = await startLegacyFixture();
	host = await startDevHost({
		config: hostedProviderDeployment(
			['passkey', 'password'],
			await fixtureEntry(directory, 'team', team.url, TOKENS.team, TEAM),
			await fixtureEntry(directory, 'legacy', legacy.url, TOKENS.legacy, ['audience = "team"'])
		),
		basePath: BASE,
		organization: { slug: 'acme', name: 'Acme' },
		people: ['olu', 'bea', 'cai'].map((name, index) => ({
			email: `${name}@acme.example`,
			name,
			role: index === 0 ? ('owner' as const) : ('member' as const),
			methods: ['password' as const],
			password: PASSWORD,
		})),
		rateLimit: TEST_RATE_LIMIT,
		limits: LIMITS,
	});
	browser = await launchForDevHost(host);
	olu = await signedIn('olu@acme.example');
	const oluId = (await call<{ id: string }>(olu, 'account-get')).data?.id as string;
	ids.atlas = (await call<{ id: string }>(olu, 'project-create', { name: 'Atlas' })).data
		?.id as string;
	ids.vault = (
		await call<{ id: string }>(olu, 'project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: [oluId] },
		})
	).data?.id as string;
	cai = await signedIn('cai@acme.example');
	bea = await signedIn('bea@acme.example');
	ids.bea = (await call<{ id: string }>(bea, 'account-get')).data?.id as string;
	// Bea's discovery, as the console's refresh runs it (`relay.test.ts`'s deviation 8): her shell's calls go to `team`.
	await kernelCall(bea.page, 'app-instance-refresh', { instance: 'team' });
	await untilInstance(bea.page, 'team', 'ready', 30_000);
}, 240_000);

afterAll(async () => {
	await Promise.all(opened.splice(0).map((page) => page.context.close()));
	await browser?.close();
	await host?.close();
	await Promise.all([team, legacy].map((fixture) => fixture?.close()));
	if (directory) await rm(directory, { recursive: true, force: true });
});

async function signedIn(email: string): Promise<ShellPage> {
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const page = await openShell(browser, host.root, {}, context);
	opened.push(page);
	const answer = (await kernelCall(page.page, 'auth-sign-in', {
		method: 'credentials',
		email,
		password: PASSWORD,
	})) as Result;
	expect(answer.success, JSON.stringify(answer.error)).toBe(true);
	return page;
}

const call = async <T = unknown>(page: ShellPage, name: string, input: unknown = {}) =>
	(await kernelCall(page.page, name, input)) as Result<T>;

/** A call at `project` on the person's interface, as the shell makes it. */
const callIn = (page: ShellPage, name: string, input: unknown, project: string) =>
	page.page.evaluate(
		async ({ name, input, scope }) => {
			const { kernel } = document.querySelector('loam-shell') as unknown as {
				kernel: { call(name: string, input: unknown, options: unknown): Promise<unknown> };
			};
			return kernel.call(name, input, { scope }) as Promise<never>;
		},
		{ name, input, scope: { workspace: WORKSPACE, project } }
	) as Promise<Result>;

const relay = (
	page: ShellPage,
	instance: string,
	body: unknown,
	headers?: Record<string, string>
) => relayAs(host, page.context, instance, body, headers ? { headers } : {});

/** Opens a legacy session for the person through the relay, as the SDK's handshake does, and returns its id. */
async function openSession(page: ShellPage): Promise<string> {
	const opened = await relay(page, 'legacy', legacyInitialize(), {
		accept: 'application/json, text/event-stream',
	});
	expect(opened.status, opened.body).toBe(200);
	const session = opened.headers['mcp-session-id'];
	expect(session).toEqual(expect.any(String));
	await relay(page, 'legacy', rpc('notifications/initialized', undefined, null), {
		'mcp-session-id': session as string,
	});
	return session as string;
}

const deletesOf = (session: string) =>
	legacy.log.filter(
		(request) => request.method === 'DELETE' && request.headers['mcp-session-id'] === session
	);

/** The relay's journal entries for `command`, from `from` on, with the code each was recorded with. */
async function relayRecords(from: number, command: string) {
	return (await host.journal())
		.slice(from)
		.filter(
			(entry) =>
				entry.command === 'mount-relay' &&
				(entry.input as { command?: string } | undefined)?.command === command
		)
		.map((entry) => (entry.result as { error?: { code?: string } }).error?.code ?? 'ok');
}

/** Scripts `team` for the requests whose body holds `marker`; the rest it answers itself. */
function script(marker: string, write: (request: Logged, response: ServerResponse) => void) {
	team.answer = (request, response) => {
		if (!request.body.includes(marker)) return undefined;
		write(request, response);
		return true;
	};
}

/** A modern-era call's `_meta` in Atlas: `team` lists its projects, so a call with no scope never reaches it. */
const atlas = () => ({ ...modern, ...scoped(ids.atlas) });
/** The rest of a scripted answer, once what came before it has reached the page. */
const later = (write: () => void) => void setTimeout(write, 300);
const event = (message: unknown) => `data: ${JSON.stringify(message)}\n\n`;
const streamHead = { 'content-type': 'text/event-stream' };
const progress = { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } };

describe('P6-H6: the hosted relay under small limits', () => {
	it("P6-H6: an idle binding is `DELETE`d upstream at `relay_session_idle_ms`, with the deployer's bearer, by the fixture's log", async () => {
		const session = await openSession(cai);
		const used = await relay(
			cai,
			'legacy',
			toolCall('afd-call', { command: 'legacy-echo', input: {} }, undefined, 2),
			{ 'mcp-session-id': session }
		);
		expect(used.status).toBe(200);
		// The binding's last use ended when its answer did: the idle limit runs from here.
		const idleFrom = Date.now();
		await expect
			.poll(() => deletesOf(session).length, { timeout: LIMITS.relay_session_idle_ms + 5_000 })
			.toBe(1);
		const [ended] = deletesOf(session);
		// When the fixture received it: at the configured limit, not before it and not long after.
		const waited = (ended as Logged).at - idleFrom;
		expect(waited).toBeGreaterThanOrEqual(LIMITS.relay_session_idle_ms - 250);
		expect(waited).toBeLessThan(LIMITS.relay_session_idle_ms + 1_500);
		expect(ended?.headers.authorization).toBe(`Bearer ${TOKENS.legacy}`);
		// The binding is gone: its id is unknown now, and nothing is forwarded for it.
		const from = legacy.log.length;
		expect(
			codeOf(
				await relay(cai, 'legacy', toolCall('afd-call', { command: 'legacy-echo' }, undefined, 3), {
					'mcp-session-id': session,
				})
			)
		).toEqual({ status: 404, code: 'MOUNT_SESSION_UNKNOWN', marked: '1' });
		expect(legacy.log.length).toBe(from);
	});

	it('P6-H6: a fifth binding evicts the least recently used idle one, with an upstream DELETE before it could expire, and never one with a request in flight', async () => {
		const started = Date.now();
		const busy = await openSession(olu);
		// A call held on the oldest binding: the least recently used of all four, but busy.
		const ran = legacy.ran.length;
		const held = relay(
			olu,
			'legacy',
			toolCall('afd-call', { command: 'legacy-slow' }, undefined, 'held'),
			{ 'mcp-session-id': busy }
		);
		await expect
			.poll(() => legacy.ran.slice(ran).some((entry) => entry.command === 'legacy-slow'))
			.toBe(true);
		const [second, third, fourth] = [
			await openSession(olu),
			await openSession(olu),
			await openSession(olu),
		];
		// The second is used again, so the third is the least recently used of the idle ones.
		const echoed = await relay(
			olu,
			'legacy',
			toolCall('afd-call', { command: 'legacy-echo' }, undefined, 'again'),
			{ 'mcp-session-id': second }
		);
		expect(echoed.status).toBe(200);
		const fifth = await openSession(olu);
		// Sooner than the idle limit, so an eviction, and of the third alone.
		await expect.poll(() => deletesOf(third).length).toBe(1);
		expect(Date.now() - started).toBeLessThan(LIMITS.relay_session_idle_ms);
		for (const session of [busy, second, fourth, fifth])
			expect(deletesOf(session), session).toEqual([]);
		expect(deletesOf(third)[0]?.headers.authorization).toBe(`Bearer ${TOKENS.legacy}`);
		expect(
			codeOf(
				await relay(olu, 'legacy', toolCall('afd-call', { command: 'legacy-echo' }), {
					'mcp-session-id': third,
				})
			).code
		).toBe('MOUNT_SESSION_UNKNOWN');
		// The busy one is still bound: its call is still in flight, and ends by its own cancellation.
		expect(
			legacy.log.find((request) => request.body.includes('"held"'))?.closedEarly
		).toBeUndefined();
		const cancelled = await relay(
			olu,
			'legacy',
			rpc('notifications/cancelled', { requestId: 'held' }, null),
			{ 'mcp-session-id': busy }
		);
		expect(cancelled.status).toBe(202);
		await expect
			.poll(() => legacy.log.find((request) => request.body.includes('"held"'))?.closedEarly)
			.toBe(true);
		await held;
	});

	it('P6-H6: an upstream `404` on a bound id drops the binding: the next request is MOUNT_SESSION_UNKNOWN, with nothing forwarded', async () => {
		const session = await openSession(cai);
		await legacy.endSession(session);
		const ended = await relay(
			cai,
			'legacy',
			toolCall('afd-call', { command: 'legacy-echo' }, undefined, 2),
			{ 'mcp-session-id': session }
		);
		// The instance's own 404 passes back by status, with no body and none of the relay's mark.
		expect(ended.status).toBe(404);
		expect(ended.headers['loam-relay-refusal']).toBeUndefined();
		const from = legacy.log.length;
		expect(
			codeOf(
				await relay(cai, 'legacy', toolCall('afd-call', { command: 'legacy-echo' }, undefined, 3), {
					'mcp-session-id': session,
				})
			)
		).toEqual({ status: 404, code: 'MOUNT_SESSION_UNKNOWN', marked: '1' });
		expect(legacy.log.length).toBe(from);
		// Dropped, not ended: the relay sent no DELETE for a session the instance had already ended.
		expect(deletesOf(session)).toEqual([]);
	});

	it('P6-H6: with every slot busy the next request is 429 MOUNT_LIMIT; an aborted page request frees its slot, and the next call gets through', async () => {
		script('"hold"', () => {
			// Held open, unanswered, until the relay ends it.
		});
		const pages = [new AbortController(), new AbortController()];
		const held = posts(team.log).length;
		const holdFrom = Date.now();
		const holding = pages.map((controller, index) =>
			streamAs(host, olu.context, 'team', toolCall('notes-get', { text: 'hold' }, atlas(), index), {
				signal: controller.signal,
			}).catch((cause: unknown) => cause)
		);
		try {
			await expect
				.poll(() =>
					posts(team.log)
						.slice(held)
						.filter((request) => request.body.includes('"hold"'))
				)
				.toHaveLength(2);
			const refused = await relay(olu, 'team', toolCall('notes-get', {}, atlas(), 9));
			expect(codeOf(refused)).toEqual({ status: 429, code: 'MOUNT_LIMIT', marked: '1' });
			expect(refused.headers['retry-after']).toBe('1');
			(pages[0] as AbortController).abort();
			// The relay ended its own upstream request for the page that went away.
			await expect
				.poll(
					() =>
						posts(team.log)
							.slice(held)
							.find((request) => bodyOf(request).id === 0)?.closedEarly
				)
				.toBe(true);
			const next = await relay(olu, 'team', toolCall('notes-get', {}, atlas(), 10));
			expect(next.status, next.body).toBe(200);
			// The slot was the aborted request's: the other hold is still open, and no deadline has passed.
			expect(
				posts(team.log)
					.slice(held)
					.find((request) => bodyOf(request).id === 1)?.closedEarly
			).toBeUndefined();
			expect(Date.now() - holdFrom).toBeLessThan(LIMITS.relay_timeout_ms);
		} finally {
			for (const controller of pages) controller.abort();
			await Promise.all(holding);
			team.answer = undefined;
		}
	});

	it('P6-H6: a `notifications/cancelled` holds no slot, and the call it cancels frees its own: the next call gets through', async () => {
		const session = await openSession(cai);
		const headers = { 'mcp-session-id': session };
		const ran = legacy.ran.length;
		const slowFrom = Date.now();
		const slow = ['slow-a', 'slow-b'].map((id) =>
			relay(cai, 'legacy', toolCall('afd-call', { command: 'legacy-slow' }, undefined, id), headers)
		);
		await expect
			.poll(() => legacy.ran.slice(ran).filter((entry) => entry.command === 'legacy-slow'))
			.toHaveLength(2);
		// Both slots are held, and the cancellation is still answered: it takes none.
		expect(
			codeOf(
				await relay(
					cai,
					'legacy',
					toolCall('afd-call', { command: 'legacy-echo' }, undefined, 5),
					headers
				)
			).code
		).toBe('MOUNT_LIMIT');
		const cancelled = await relay(
			cai,
			'legacy',
			rpc('notifications/cancelled', { requestId: 'slow-a' }, null),
			headers
		);
		expect([cancelled.status, cancelled.body]).toEqual([202, '']);
		await expect
			.poll(() => legacy.log.find((request) => request.body.includes('"slow-a"'))?.closedEarly)
			.toBe(true);
		const next = await relay(
			cai,
			'legacy',
			toolCall('afd-call', { command: 'legacy-echo' }, undefined, 6),
			headers
		);
		expect(next.status, next.body).toBe(200);
		// The slot was the cancelled call's: the other is still in flight, and no deadline has passed.
		expect(
			legacy.log.find((request) => request.body.includes('"slow-b"'))?.closedEarly
		).toBeUndefined();
		expect(Date.now() - slowFrom).toBeLessThan(LIMITS.relay_timeout_ms);
		await relay(
			cai,
			'legacy',
			rpc('notifications/cancelled', { requestId: 'slow-b' }, null),
			headers
		);
		await Promise.all(slow);
	});

	it('P6-H6: an instance that sends no status within `relay_timeout_ms` is 504 MOUNT_TIMEOUT, marked, before any status of its own', async () => {
		script('"mute"', () => {
			// No status, ever.
		});
		try {
			const started = Date.now();
			const answer = await relay(olu, 'team', toolCall('notes-get', { text: 'mute' }, atlas()));
			expect(codeOf(answer)).toEqual({ status: 504, code: 'MOUNT_TIMEOUT', marked: '1' });
			expect(Date.now() - started).toBeGreaterThanOrEqual(LIMITS.relay_timeout_ms - 250);
		} finally {
			team.answer = undefined;
		}
	});

	it('P6-H6: a JSON body past `relay_response_bytes` is 502 MOUNT_RESULT_INVALID, marked, before any status of its own', async () => {
		// One JSON-RPC response for the request's own id, so only its size can refuse it: one under the limit passes.
		const answer = (id: unknown, size: number) =>
			JSON.stringify({
				jsonrpc: '2.0',
				id,
				result: { content: [{ type: 'text', text: 'x'.repeat(size) }] },
			});
		script('"bulky"', (request, response) => {
			const { id } = JSON.parse(request.body) as { id: unknown };
			const text = request.body.includes('"under"') ? 1_000 : LIMITS.relay_response_bytes;
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end(answer(id, text));
		});
		try {
			const from = (await host.journal()).length;
			const under = await relay(
				olu,
				'team',
				toolCall('notes-get', { text: 'bulky', size: 'under' }, atlas(), 'small')
			);
			expect(under.status).toBe(200);
			expect(JSON.parse(under.body)).toMatchObject({
				id: 'small',
				result: { content: [{ type: 'text' }] },
			});
			const over = await relay(
				olu,
				'team',
				toolCall('notes-get', { text: 'bulky' }, atlas(), 'big')
			);
			expect(codeOf(over)).toEqual({ status: 502, code: 'MOUNT_RESULT_INVALID', marked: '1' });
			// None of the instance's body reached the page.
			expect(over.body).not.toContain('xxxx');
			await expect
				.poll(() => relayRecords(from, 'notes-get'))
				.toEqual(['ok', 'MOUNT_RESULT_INVALID']);
		} finally {
			team.answer = undefined;
		}
	});

	it.each([
		[
			'past `relay_response_bytes`',
			'flood',
			'notes-get',
			'MOUNT_RESULT_INVALID',
			(response: ServerResponse) => {
				// A notification first, which the relay passes on, so its status has left before the cut.
				response.writeHead(200, streamHead);
				response.write(event(progress));
				later(() =>
					response.write(
						event({
							...progress,
							params: { progress: 1, message: 'x'.repeat(LIMITS.relay_response_bytes) },
						})
					)
				);
			},
		],
		[
			'past `relay_timeout_ms`',
			'stall',
			'notes-list',
			'MOUNT_TIMEOUT',
			(response: ServerResponse) => {
				response.writeHead(200, streamHead);
				response.write(event(progress));
			},
		],
	])(
		"P6-H6: a stream cut after its status %s fails the shell's call at once as MOUNT_UNREACHABLE, and the relay journals it",
		async (_what, marker, command, recorded, write) => {
			script(`"${marker}"`, (_request, response) => write(response));
			try {
				const from = (await host.journal()).length;
				// The raw answer: the status, then the cut, with no response.
				const raw = await streamAs(
					host,
					olu.context,
					'team',
					toolCall('afd-call', { command, input: { text: marker } }, scoped(ids.atlas), 'raw')
				);
				expect([raw.status, raw.cut]).toEqual([200, true]);
				expect(raw.body).toBe(event(progress));
				const started = Date.now();
				const result = await callIn(bea, `team-${command}`, { text: marker }, ids.atlas);
				// Not the call's 60 s deadline (`MOUNT_TIMEOUT`): the page reads the cut as it happens.
				expect(result.error?.code).toBe('MOUNT_UNREACHABLE');
				expect(Date.now() - started).toBeLessThan(LIMITS.relay_timeout_ms + 5_000);
				await expect.poll(() => relayRecords(from, command)).toEqual([recorded, recorded]);
			} finally {
				team.answer = undefined;
			}
		}
	);

	it('P6-H6: a response with another `id` cuts the stream, after the notifications before it', async () => {
		script('"other-id"', (_request, response) => {
			response.writeHead(200, streamHead);
			response.write(event(progress));
			later(() => {
				response.write(event({ jsonrpc: '2.0', id: 'not-this-one', result: { planted: true } }));
				response.end(event({ jsonrpc: '2.0', id: 'mine', result: { late: true } }));
			});
		});
		try {
			const from = (await host.journal()).length;
			const answer = await streamAs(
				host,
				olu.context,
				'team',
				toolCall('notes-get', { text: 'other-id' }, atlas(), 'mine')
			);
			expect([answer.status, answer.cut]).toEqual([200, true]);
			expect(answer.body).toBe(event(progress));
			await expect.poll(() => relayRecords(from, 'notes-get')).toEqual(['MOUNT_RESULT_INVALID']);
		} finally {
			team.answer = undefined;
		}
	});

	it("P6-H6: an event holding a server request is dropped and the rest of the stream arrives; a forwarded answer carries 3.5's headers", async () => {
		script('"server-request"', (_request, response) => {
			response.writeHead(200, { ...streamHead, 'set-cookie': 'planted=1' });
			response.write(
				event({ jsonrpc: '2.0', id: 'ask', method: 'sampling/createMessage', params: {} })
			);
			response.write(`data: ${JSON.stringify([progress])}\n\n`);
			response.write(event(progress));
			response.end(event({ jsonrpc: '2.0', id: 'mine', result: { content: [] } }));
		});
		try {
			const answer = await streamAs(
				host,
				olu.context,
				'team',
				toolCall('notes-get', { text: 'server-request' }, atlas(), 'mine')
			);
			expect([answer.status, answer.cut]).toEqual([200, false]);
			expect(answer.body).toBe(
				event(progress) + event({ jsonrpc: '2.0', id: 'mine', result: { content: [] } })
			);
			expect(answer.headers.get('content-type')).toBe('text/event-stream');
			const json = await relay(olu, 'team', toolCall('notes-get', {}, atlas()));
			expect(json.status).toBe(200);
			expect(json.headers['loam-relay-refusal']).toBeUndefined();
			for (const headers of [
				Object.fromEntries(answer.headers),
				json.headers as Record<string, string>,
			]) {
				expect(headers['x-content-type-options']).toBe('nosniff');
				expect(headers['referrer-policy']).toBe('no-referrer');
				expect(headers['cross-origin-opener-policy']).toBe('same-origin');
				expect(headers['cache-control']).toBe('no-store');
				expect(headers['set-cookie']).toBeUndefined();
				expect(headers['access-control-allow-origin']).toBeUndefined();
			}
		} finally {
			team.answer = undefined;
		}
	});
});

describe("P6-H6: the server's records decide where the browser's copy would let a call through", () => {
	it("P6-H6: a nested `space` the browser's pin passes reaches the shell's kernel as MOUNT_SPACE_PINNED, and never the instance", async () => {
		const from = posts(team.log).length;
		const journaled = (await host.journal()).length;
		const result = await callIn(
			bea,
			'team-notes-get',
			{ text: 'pinned', target: { space: 'elsewhere' } },
			ids.atlas
		);
		expect(result.error?.code).toBe('MOUNT_SPACE_PINNED');
		// The relay's refusal, not the kernel's own of the same code: its journal holds it.
		await expect.poll(() => relayRecords(journaled, 'notes-get')).toEqual(['MOUNT_SPACE_PINNED']);
		expect(
			posts(team.log)
				.slice(from)
				.filter((request) => request.body.includes('pinned'))
		).toEqual([]);
	});

	it("P6-H6: an instance no longer serving the project on the server reaches the shell's kernel as MOUNT_PROJECT_NOT_LISTED, and never the instance", async () => {
		// The deployment changed on the server and the host restarted; Bea's page still holds the entry it loaded.
		const deployment = join(dirname(host.data), 'loam.deployment.toml');
		const before = await readFile(deployment, 'utf8');
		const listed = TEAM.slice(1).join('\n');
		expect(before).toContain(listed);
		await writeFile(deployment, before.replace(listed, 'projects = ["vault"]'));
		try {
			await host.restart();
			const from = posts(team.log).length;
			const journaled = (await host.journal()).length;
			const result = await callIn(bea, 'team-notes-get', { text: 'unlisted' }, ids.atlas);
			expect(result.error?.code).toBe('MOUNT_PROJECT_NOT_LISTED');
			await expect
				.poll(() => relayRecords(journaled, 'notes-get'))
				.toEqual(['MOUNT_PROJECT_NOT_LISTED']);
			expect(
				posts(team.log)
					.slice(from)
					.filter((request) => request.body.includes('unlisted'))
			).toEqual([]);
		} finally {
			// The deployment as it was, so no later case depends on this one.
			await writeFile(deployment, before);
			await host.restart();
		}
	});

	it("P6-H6: a person whose membership ended on the server after her copy settled reaches the shell's kernel as WORKSPACE_NOT_MEMBER, and never the instance", async () => {
		// Her member row removed at the provider with her session kept, as no Loam command does (`member-remove` ends
		// her sessions too): the server's records say she is no member, while her copy still says she is.
		const auth = new DatabaseSync(join(host.data, 'auth.sqlite'), { timeout: 5_000 });
		const row = auth.prepare('SELECT * FROM member WHERE userId = ?').get(ids.bea) as
			| Record<string, string | number | null>
			| undefined;
		expect(row).toBeDefined();
		const removed = auth.prepare('DELETE FROM member WHERE userId = ?').run(ids.bea);
		expect(removed.changes).toBe(1);
		try {
			const from = posts(team.log).length;
			const journaled = (await host.journal()).length;
			const result = await callIn(bea, 'team-notes-get', { text: 'not-member' }, ids.atlas);
			expect(result.error?.code).toBe('WORKSPACE_NOT_MEMBER');
			await expect
				.poll(() => relayRecords(journaled, 'notes-get'))
				.toEqual(['WORKSPACE_NOT_MEMBER']);
			expect(
				posts(team.log)
					.slice(from)
					.filter((request) => request.body.includes('not-member'))
			).toEqual([]);
		} finally {
			// Her member row as it was, so no later case depends on this one.
			const columns = Object.keys(row as object);
			auth
				.prepare(
					`INSERT INTO member (${columns.map((name) => `"${name}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
				)
				.run(
					...columns.map((name) => (row as Record<string, string | number | null>)[name] ?? null)
				);
			auth.close();
		}
		// She is a member again: the same call reaches the instance.
		const again = await callIn(bea, 'team-notes-get', { text: 'member-again' }, ids.atlas);
		expect(again.success, JSON.stringify(again.error)).toBe(true);
	});
});

describe('P6-H6: no secret of the relay anywhere on this host (5.2)', () => {
	it("P6-H6: `scanSecrets` finds none of the deployer's bearers, the sessions the instance issued or a page's cookie in the served files, the projection, either journal, the logs, any store row or `localStorage`", async () => {
		const sessions = legacy.log.flatMap((request) => {
			const id = request.headers['mcp-session-id'];
			return typeof id === 'string' ? [id] : [];
		});
		expect(sessions.length).toBeGreaterThan(0);
		const cookies = (await Promise.all(opened.map((page) => page.context.cookies(host.origin))))
			.flat()
			.map((cookie) => decodeURIComponent(cookie.value))
			.filter((value) => value.length >= 16);
		expect(cookies.length).toBeGreaterThan(0);
		const scan = await scanSecrets(
			host,
			opened.map((page) => page.page),
			[...Object.values(TOKENS), ...new Set(sessions), ...new Set(cookies)]
		);
		expect(scan.found).toEqual([]);
		// The bearers reached their instances, and only theirs.
		expect(
			legacy.log.some((request) => request.headers.authorization === `Bearer ${TOKENS.legacy}`)
		).toBe(true);
		expect(
			team.log.some((request) => request.headers.authorization === `Bearer ${TOKENS.team}`)
		).toBe(true);
		expect(
			team.log.some((request) => String(request.headers.authorization).includes(TOKENS.legacy))
		).toBe(false);
	});
});
