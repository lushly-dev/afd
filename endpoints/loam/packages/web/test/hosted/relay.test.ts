/**
 * P6-H6 and P6-H7 (phase 6 specification, sections 8 and 19; step 6): the hosted relay on the development profile at
 * `/loam/`, with the built shell in Chromium and a person's raw requests beside it. Its instances log every request as
 * it arrived (`relay-fixtures.ts`): two real AFD servers (`hybrid`, and the default `grouped`), one of them scripted to
 * misbehave where a case needs it, and a stateful, legacy-only server on the MCP SDK's own server transport.
 *
 * Proved here: the scope reaches an instance in `_meta`, rebuilt, with the pin and the deployer's bearer and none of the
 * page's headers; the server's records decide, so a project closed to a person after her copy settled is refused before
 * forwarding and her kernel shows `PROJECT_NOT_FOUND`; the meta-tools, the `grouped` strategy, other methods and a bare
 * response reach nothing; discovery and a legacy session pass for a member of a listed project; an instance's own
 * refusal, words and headers stay its own; sessions are bound to their person; cancellation aborts upstream; a restart
 * gives `MOUNT_SESSION_UNKNOWN` and the shell reconnects; no secret is anywhere (P6-H7).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StreamableHttpTransport } from '@lushly-dev/afd-client/streamable-http';
import {
	agentToken,
	type DevHost,
	type HostSend,
	scanSecrets,
	startDevHost,
	trustingFetch,
} from '@lushly-dev/loam-host/testing';
import { TEST_RATE_LIMIT } from '@lushly-dev/loam-identity/testing';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	hostedProviderDeployment,
	kernelCall,
	launchForDevHost,
	openShell,
	type ShellPage,
} from '../browser/harness';
import { createMountRelay } from '../mounted/mount-relay';
import { type ScopeServer, startScopeServer } from '../mounted/scope-server';
import { untilInstance } from '../mounted/support';
import { type Fixture, type Logged, startAfdFixture, startLegacyFixture } from './relay-fixtures';
import {
	bodyOf,
	codeOf,
	cookieOf,
	fixtureEntry,
	modern,
	type Result,
	relayAs,
	rpc,
	scoped,
	toolCall,
	WORKSPACE,
} from './relay-support';
import { type Answer, hosted } from './support';

const BASE = '/loam/';
const REDIRECT = 'http://127.0.0.1:9/callback';
const CLIENT = 'P6 relay agent';
const PASSWORD = 'correct horse battery staple';
const TOKENS = {
	team: 'team-bearer-0123456789abcdef',
	grouped: 'grouped-bearer-0123456789abcdef',
	hostile: 'hostile-bearer-0123456789abcdef',
	legacy: 'legacy-bearer-0123456789abcdef',
	scopes: 'scopes-bearer-0123456789abcdef',
};

let host: DevHost;
let browser: Browser;
let directory: string;
let team: Fixture;
let grouped: Fixture;
let hostile: Fixture;
let legacy: Awaited<ReturnType<typeof startLegacyFixture>>;
/** Phase 2's Node fixture server (P2-E6), stateless, mounted over `http` as the row names it. */
let scopes: ScopeServer;
let olu: ShellPage;
let bea: ShellPage;
const ids = { atlas: '', vault: '', bea: '' };
const opened: ShellPage[] = [];
/** Every cookie value a page held, for the scan (P6-H7). */
const seenSecrets = new Set<string>();

/** A deployment table for a fixture mounted as `umbel`, with its bearer in a file only the owner reads. */
const entry = (instance: string, fixture: { url: string }, token: string, extra: string[] = []) =>
	fixtureEntry(directory, instance, fixture.url, token, extra);

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'loam-relay-'));
	team = await startAfdFixture('hybrid');
	grouped = await startAfdFixture('grouped');
	hostile = await startAfdFixture('hybrid');
	legacy = await startLegacyFixture();
	scopes = await startScopeServer();
	host = await startDevHost({
		config: hostedProviderDeployment(
			['passkey', 'password'],
			await entry('team', team, TOKENS.team, [
				'audience = "team"',
				'projects = ["atlas", "vault"]',
				'space = { atlas = "main" }',
			]),
			await entry('vaulted', team, TOKENS.team, ['audience = "team"', 'projects = ["vault"]']),
			await entry('grouped', grouped, TOKENS.grouped, ['audience = "team"']),
			await entry('hostile', hostile, TOKENS.hostile, ['audience = "team"']),
			await entry('legacy', legacy, TOKENS.legacy, ['audience = "team"', 'projects = ["atlas"]']),
			await entry('scopes', scopes, TOKENS.scopes, ['audience = "team"'])
		),
		basePath: BASE,
		clients: [{ name: CLIENT, redirect: REDIRECT }],
		organization: { slug: 'acme', name: 'Acme' },
		people: [
			{
				email: 'olu@acme.example',
				name: 'Olu',
				role: 'owner',
				methods: ['password'],
				password: PASSWORD,
			},
			{
				email: 'bea@acme.example',
				name: 'Bea',
				role: 'member',
				methods: ['password'],
				password: PASSWORD,
			},
		],
		rateLimit: TEST_RATE_LIMIT,
	});
	browser = await launchForDevHost(host);
	olu = await signedIn('olu@acme.example');
	const account = await call<{ id: string }>(olu, 'account-get');
	const oluId = account.data?.id as string;
	ids.atlas = (await call<{ id: string }>(olu, 'project-create', { name: 'Atlas' })).data
		?.id as string;
	ids.vault = (
		await call<{ id: string }>(olu, 'project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: [oluId] },
		})
	).data?.id as string;
	bea = await signedIn('bea@acme.example');
	ids.bea = (await call<{ id: string }>(bea, 'account-get')).data?.id as string;
}, 240_000);

afterAll(async () => {
	await Promise.all(opened.splice(0).map((page) => page.context.close()));
	await browser?.close();
	await host?.close();
	await Promise.all([team, grouped, hostile, legacy, scopes].map((fixture) => fixture?.close()));
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
	})) as { success: boolean; error?: unknown };
	expect(answer.success, JSON.stringify(answer.error)).toBe(true);
	for (const cookie of await page.context.cookies(host.origin))
		if (cookie.value.length >= 16) seenSecrets.add(decodeURIComponent(cookie.value));
	// The shell's first discovery ran signed out, after first paint, and the kernel refused it before any request; a
	// sign-in in the page does not discover again (a follow-up), so the person's discovery is the console's refresh.
	for (const instance of INSTANCES)
		await kernelCall(page.page, 'app-instance-refresh', { instance });
	return page;
}

const INSTANCES = ['team', 'vaulted', 'grouped', 'hostile', 'legacy', 'scopes'] as const;

const call = async <T = unknown>(page: ShellPage, name: string, input: unknown = {}) =>
	(await kernelCall(page.page, name, input)) as Result<T>;

/** A call at `project`, or at workspace level, on the person's interface. */
const callIn = (page: Page, name: string, input: unknown, project?: string) =>
	page.evaluate(
		async ({ name, input, scope }) => {
			const { kernel } = document.querySelector('loam-shell') as unknown as {
				kernel: { call(name: string, input: unknown, options: unknown): Promise<unknown> };
			};
			return kernel.call(name, input, { scope }) as Promise<never>;
		},
		{ name, input, scope: project ? { workspace: WORKSPACE, project } : { workspace: WORKSPACE } }
	) as Promise<Result>;

/** A person's raw request to the relay, as the shell's transport sends it: same origin, JSON, the session cookie. */
const relay = (
	page: ShellPage | undefined,
	instance: string,
	body: unknown,
	options: { method?: string; headers?: Record<string, string> } = {}
): Promise<Answer> => relayAs(host, page?.context, instance, body, options);

const posts = (fixture: Fixture) => fixture.log.filter((request) => request.method === 'POST');

describe('P6-H6: the hosted relay', () => {
	it("P6-H6: a member's call reaches the instance with its scope in `_meta`, the pinned space, the deployer's bearer and only the relay's headers", async () => {
		await untilInstance(bea.page, 'team', 'ready', 30_000);
		const from = team.log.length;
		const answered = await callIn(bea.page, 'team-notes-get', { text: 'hi' }, ids.atlas);
		expect(answered.success, JSON.stringify(answered.error)).toBe(true);
		// The marks phase 5's labels read (5.1): the instance's own answer, its structured data intact through the relay,
		// so its result is content whole for this `whole` entry and taints a copilot session from `team` (5.3).
		expect(answered.metadata).toMatchObject({
			'dev.loam/trust': 'untrusted',
			'dev.loam/instance': 'team',
			'dev.loam/structured': true,
		});
		expect(team.ran.at(-1)).toEqual({
			command: 'notes-get',
			scope: { workspace: WORKSPACE, project: ids.atlas },
			input: { text: 'hi', space: 'main' },
		});
		const sent = team.log.slice(from).filter((request) => request.method === 'POST');
		expect(sent).toHaveLength(1);
		const [request] = sent;
		expect(request?.headers.authorization).toBe(`Bearer ${TOKENS.team}`);
		// The HTTP client adds its own framing (`host`, `content-length`, `user-agent`); nothing of the page's passes.
		for (const name of [
			'cookie',
			'origin',
			'referer',
			'sec-fetch-site',
			'loam-person',
			'x-loam-client-ip',
		])
			expect(request?.headers[name], name).toBeUndefined();
		expect(request?.headers['accept-encoding']).toBe('identity');
		const message = bodyOf(request);
		expect(Object.keys(message.params).sort()).toEqual(['_meta', 'arguments', 'name']);
		expect(Object.keys(message.params._meta).sort()).toEqual([
			'dev.loam/scope',
			'io.modelcontextprotocol/clientCapabilities',
			'io.modelcontextprotocol/clientInfo',
			'io.modelcontextprotocol/protocolVersion',
		]);
		expect(message.params._meta['io.modelcontextprotocol/clientCapabilities']).toEqual({});
	});

	it("P6-H6: against phase 2's Node fixture server (`scope-server.ts`, stateless, over `http`), a member's call reaches it with the scope in `_meta`, and a non-member of the project is refused before forwarding, her kernel showing PROJECT_NOT_FOUND", async () => {
		await untilInstance(bea.page, 'scopes', 'ready', 30_000);
		const from = scopes.seen.length;
		const reached = scopes.ingress.length;
		for (const command of ['scope-echo', 'scope-whisper']) {
			const answered = await callIn(bea.page, `scopes-${command}`, {}, ids.atlas);
			expect(answered.success, JSON.stringify(answered.error)).toBe(true);
		}
		// What its handlers read from `_meta` (the field it declares), and the two requests that carried it.
		expect(scopes.seen.slice(from)).toEqual([
			{ tool: 'scope-echo', scope: { workspace: WORKSPACE, project: ids.atlas } },
			{ tool: 'scope-whisper', scope: { workspace: WORKSPACE, project: ids.atlas } },
		]);
		expect(scopes.ingress.slice(reached)).toEqual([
			{ method: 'POST', mcpMethod: 'tools/call', mcpName: 'afd-call' },
			{ method: 'POST', mcpMethod: 'tools/call', mcpName: 'afd-call' },
		]);
		// A project closed to Bea on the server after her copy settled: her kernel lets the call through, and the relay
		// refuses it, by its journal, with nothing reaching the server.
		const annex = (await call<{ id: string }>(olu, 'project-create', { name: 'Annex' })).data
			?.id as string;
		await bea.page.evaluate(() => window.dispatchEvent(new Event('online')));
		await expect
			.poll(async () =>
				(
					(await call<{ projects: Array<{ id: string }> }>(bea, 'project-list')).data?.projects ??
					[]
				).map((project) => project.id)
			)
			.toContain(annex);
		const oluId = (await call<{ id: string }>(olu, 'account-get')).data?.id as string;
		const closed = await call(olu, 'project-update', {
			project: annex,
			access: { mode: 'restricted', members: [oluId] },
		});
		expect(closed.success, JSON.stringify(closed.error)).toBe(true);
		const before = scopes.ingress.length;
		const journaled = (await host.journal()).length;
		const refused = await callIn(bea.page, 'scopes-scope-echo', {}, annex);
		expect(refused.error?.code).toBe('PROJECT_NOT_FOUND');
		await expect
			.poll(async () =>
				(await host.journal())
					.slice(journaled)
					.filter(
						(entry) =>
							entry.command === 'mount-relay' &&
							(entry.input as { command?: string }).command === 'scope-echo'
					)
					.map((entry) => (entry.result as { error?: { code?: string } }).error?.code)
			)
			.toEqual(['PROJECT_NOT_FOUND']);
		// And Bea's raw requests in the restricted Vault: refused, marked, and no request reaches the server.
		expect(
			codeOf(
				await relay(bea, 'scopes', toolCall('scope-echo', {}, { ...modern, ...scoped(ids.vault) }))
			)
		).toEqual({ status: 403, code: 'PROJECT_NOT_FOUND', marked: '1' });
		expect(
			codeOf(
				await relay(
					bea,
					'scopes',
					toolCall('afd-call', { command: 'scope-whisper' }, { ...modern, ...scoped(ids.vault) })
				)
			).code
		).toBe('PROJECT_NOT_FOUND');
		expect(scopes.ingress.length).toBe(before);
		expect(scopes.seen.length).toBe(from + 2);
	});

	it('P6-H6: a member of a listed project discovers a project-listed instance: `server/discover`, `afd-help` and `afd-detail` pass on the modern era, with no scope', async () => {
		const methods = posts(team).map((request) => {
			const message = bodyOf(request);
			return message.method === 'tools/call' ? message.params.name : message.method;
		});
		expect(methods).toEqual(expect.arrayContaining(['server/discover', 'afd-help', 'afd-detail']));
		for (const request of posts(team)) {
			const message = bodyOf(request);
			if (message.params?.name === 'afd-help' || message.method === 'server/discover')
				expect(message.params?._meta?.['dev.loam/scope']).toBeUndefined();
		}
		const listed = await call<{ instances: Array<{ instance: string; protocolVersion?: string }> }>(
			bea,
			'app-instance-list'
		);
		expect(listed.data?.instances.find((row) => row.instance === 'team')?.protocolVersion).toBe(
			'2026-07-28'
		);
	});

	it("P6-H6: on the legacy fixture, the SDK falls back from `server/discover`'s JSON-RPC error to `initialize`, through the relay", async () => {
		await untilInstance(bea.page, 'legacy', 'ready', 30_000);
		const methods = posts(legacy).map((request) => bodyOf(request).method);
		expect(methods.slice(0, 2)).toEqual(['server/discover', 'initialize']);
		const listed = await call<{ instances: Array<{ instance: string; protocolVersion?: string }> }>(
			bea,
			'app-instance-list'
		);
		expect(
			listed.data?.instances.find((row) => row.instance === 'legacy')?.protocolVersion
		).not.toBe('2026-07-28');
		const echoed = await callIn(bea.page, 'legacy-legacy-echo', { text: 'x' }, ids.atlas);
		expect(echoed.success, JSON.stringify(echoed.error)).toBe(true);
	});

	it('P6-H6: a project closed to the person after her copy settled is refused before forwarding, and her kernel shows PROJECT_NOT_FOUND', async () => {
		const restricted = await call(olu, 'project-create', { name: 'Atrium' });
		const atrium = (restricted.data as { id: string }).id;
		await bea.page.evaluate(() => window.dispatchEvent(new Event('online')));
		await expect
			.poll(async () =>
				(
					(await call<{ projects: Array<{ id: string }> }>(bea, 'project-list')).data?.projects ??
					[]
				).map((project) => project.id)
			)
			.toContain(atrium);
		// Closed on the server only: Bea's copy still shows it open until her next refresh.
		const oluId = (await call<{ id: string }>(olu, 'account-get')).data?.id as string;
		const closed = await call(olu, 'project-update', {
			project: atrium,
			access: { mode: 'restricted', members: [oluId] },
		});
		expect(closed.success, JSON.stringify(closed.error)).toBe(true);
		await untilInstance(bea.page, 'grouped', 'ready', 30_000);
		const before = grouped.log.length;
		const refused = await callIn(bea.page, 'grouped-notes-list', {}, atrium);
		expect(refused.error?.code).toBe('PROJECT_NOT_FOUND');
		expect(refused.error?.message).not.toContain('relay');
		expect(grouped.log.length).toBe(before);
		const from = team.log.length;
		// The raw request, for the relay's own answer: marked, nothing forwarded.
		expect(codeOf(await relay(bea, 'team', toolCall('notes-get', {}, scoped(ids.vault))))).toEqual({
			status: 403,
			code: 'PROJECT_NOT_FOUND',
			marked: '1',
		});
		expect(team.log.length).toBe(from);
	});

	it('P6-H6: `afd-call` with `meta` scope in a restricted project, `afd-call` naming a hidden mutation, `afd-batch`, `resources/read` and a bare JSON-RPC response are refused and never reach the instance', async () => {
		const from = team.log.length;
		const cases: Array<[unknown, string]> = [
			[
				toolCall('afd-call', { command: 'notes-get', meta: scoped(ids.vault) }),
				'PROJECT_NOT_FOUND',
			],
			[
				toolCall('afd-call', { command: 'notes-delete' }, scoped(ids.atlas)),
				'MOUNT_COMMAND_NOT_EXPOSED',
			],
			[toolCall('afd-batch', { calls: [] }, scoped(ids.atlas)), 'MOUNT_COMMAND_NOT_EXPOSED'],
			[rpc('resources/read', { uri: 'file:///etc/passwd' }), 'MOUNT_METHOD_REFUSED'],
			[{ jsonrpc: '2.0', id: 1, result: {} }, 'MOUNT_METHOD_REFUSED'],
			[[toolCall('notes-get')], 'MOUNT_BATCH_REFUSED'],
		];
		for (const [body, code] of cases)
			expect(codeOf(await relay(bea, 'team', body)).code).toBe(code);
		expect(team.log.length).toBe(from);
	});

	it('P6-H6: against a `grouped` fixture, `tools/call notes { action: "delete" }` is refused and never reaches it', async () => {
		const from = grouped.log.length;
		expect(codeOf(await relay(bea, 'grouped', toolCall('notes', { action: 'delete' })))).toEqual({
			status: 403,
			code: 'MOUNT_COMMAND_NOT_EXPOSED',
			marked: '1',
		});
		// No such tool in the catalog: the relay discovers again once (8.2), and the call itself never leaves.
		const reached = grouped.log.slice(from).filter((request) => {
			const message = bodyOf(request);
			return (
				message.params?.name === 'notes' || message.params?.arguments?.command === 'notes-delete'
			);
		});
		expect(reached).toEqual([]);
		expect(grouped.ran.map((ran) => ran.command)).not.toContain('notes-delete');
	});

	it("P6-H6: a member of project A's first-class call with `arguments.meta` set to A and no `_meta` reaches the instance at workspace level, with no scope", async () => {
		await untilInstance(bea.page, 'hostile', 'ready', 30_000);
		const answer = await relay(
			bea,
			'hostile',
			toolCall('notes-get', { meta: scoped(ids.atlas) }, modern)
		);
		expect(answer.status).toBe(200);
		expect(hostile.ran.at(-1)).toMatchObject({ command: 'notes-get', scope: null });
		expect(bodyOf(posts(hostile).at(-1)).params._meta['dev.loam/scope']).toBeUndefined();
	});

	it('P6-H6: a member of no listed project sending a scope-less `tools/call` to a project-listed instance is refused MOUNT_PROJECT_NOT_LISTED, and it never reaches it', async () => {
		const from = team.log.length;
		expect(codeOf(await relay(bea, 'vaulted', toolCall('notes-get', {}, modern)))).toEqual({
			status: 403,
			code: 'MOUNT_PROJECT_NOT_LISTED',
			marked: '1',
		});
		expect(codeOf(await relay(bea, 'vaulted', toolCall('afd-help', {}, modern))).code).toBe(
			'MOUNT_PROJECT_NOT_LISTED'
		);
		expect(team.log.length).toBe(from);
	});

	it('P6-H6: an instance\'s own `403 {"code":"MOUNT_SPACE_PINNED"}` with `Loam-Relay-Refusal: 1`, `Set-Cookie` and `Retry-After` gives MOUNT_UNAUTHORIZED, and none of those headers reaches the page', async () => {
		hostile.answer = (request, response) => {
			if (!request.body.includes('"notes-get"')) return undefined;
			response
				.writeHead(403, {
					'content-type': 'application/json',
					'loam-relay-refusal': '1',
					'set-cookie': 'planted=1; Path=/',
					'retry-after': '120',
				})
				.end('{"code":"MOUNT_SPACE_PINNED","message":"instance words"}');
			return true;
		};
		try {
			const raw = await relay(bea, 'hostile', toolCall('notes-get', {}, modern));
			expect(raw.status).toBe(403);
			for (const name of ['loam-relay-refusal', 'set-cookie', 'retry-after'])
				expect(raw.headers[name], name).toBeUndefined();
			expect(raw.body).toBe('');
			const result = await callIn(bea.page, 'hostile-notes-get', {});
			expect(result.error?.code).toBe('MOUNT_UNAUTHORIZED');
			expect(JSON.stringify(result)).not.toContain('instance words');
		} finally {
			hostile.answer = undefined;
		}
	});

	it('P6-H6: an instance\'s `401 {"code":"UNAUTHORIZED"}` gives MOUNT_UNAUTHORIZED with no session refresh; its `403 PROJECT_NOT_FOUND` none of its words', async () => {
		const whoami: string[] = [];
		const listen = (request: { url(): string }) => {
			if (request.url().includes('/loam/whoami')) whoami.push(request.url());
		};
		bea.page.on('request', listen);
		try {
			hostile.answer = (request, response) => {
				if (!request.body.includes('"notes-get"')) return undefined;
				response
					.writeHead(401, { 'content-type': 'application/json' })
					.end('{"code":"UNAUTHORIZED"}');
				return true;
			};
			expect((await callIn(bea.page, 'hostile-notes-get', {})).error?.code).toBe(
				'MOUNT_UNAUTHORIZED'
			);
			hostile.answer = (request, response) => {
				if (!request.body.includes('"notes-get"')) return undefined;
				response
					.writeHead(403, { 'content-type': 'application/json' })
					.end('{"code":"PROJECT_NOT_FOUND","message":"the vault holds secret plans"}');
				return true;
			};
			const result = await callIn(bea.page, 'hostile-notes-get', {});
			expect(result.error?.code).toBe('MOUNT_UNAUTHORIZED');
			expect(JSON.stringify(result)).not.toContain('secret plans');
			await bea.page.waitForTimeout(300);
			expect(whoami).toEqual([]);
		} finally {
			hostile.answer = undefined;
			bea.page.off('request', listen);
		}
	});

	it("P6-H6: a redirect, a `text/html` answer and a JSON body holding two responses are each 502; a notification's `202` passes back empty", async () => {
		const scripted: Array<(response: import('node:http').ServerResponse) => void> = [
			(response) => response.writeHead(302, { location: 'https://elsewhere.example/' }).end(),
			(response) => response.writeHead(200, { 'content-type': 'text/html' }).end('<p>hi</p>'),
			(response) =>
				response
					.writeHead(200, { 'content-type': 'application/json' })
					.end('[{"jsonrpc":"2.0","id":1,"result":{}},{"jsonrpc":"2.0","id":1,"result":{}}]'),
		];
		try {
			for (const write of scripted) {
				hostile.answer = (request, response) => {
					if (!request.body.includes('"notes-get"')) return undefined;
					write(response);
					return true;
				};
				expect(codeOf(await relay(bea, 'hostile', toolCall('notes-get', {}, modern)))).toEqual({
					status: 502,
					code: 'MOUNT_RESULT_INVALID',
					marked: '1',
				});
			}
		} finally {
			hostile.answer = undefined;
		}
		const notified = await relay(bea, 'hostile', rpc('notifications/initialized', undefined, null));
		expect(notified.status).toBe(202);
		expect(notified.body).toBe('');
		expect(notified.headers['content-type']).toBeUndefined();
	});

	it("P6-H6: on the stateful fixture, `Mcp-Session-Id` passes back only on `initialize`'s answer, a session `DELETE` is forwarded for its person and answered 204 for another, with nothing forwarded", async () => {
		const init = rpc('initialize', {
			protocolVersion: '2025-11-25',
			clientInfo: { name: 'test', version: '1' },
			capabilities: {},
		});
		const opened = await relay(bea, 'legacy', init, {
			headers: { accept: 'application/json, text/event-stream' },
		});
		expect(opened.status).toBe(200);
		const session = opened.headers['mcp-session-id'] as string;
		expect(session).toEqual(expect.any(String));
		const used = await relay(
			bea,
			'legacy',
			toolCall('afd-call', { command: 'legacy-echo', input: {} }, scoped(ids.atlas), 2),
			{
				headers: { 'mcp-session-id': session },
			}
		);
		expect(used.status).toBe(200);
		expect(used.headers['mcp-session-id']).toBeUndefined();
		const from = legacy.log.length;
		// Olu's request with Bea's session id: unknown to him, and his DELETE of it is 204 with nothing forwarded.
		expect(
			codeOf(
				await relay(
					olu,
					'legacy',
					toolCall('afd-call', { command: 'legacy-echo' }, scoped(ids.atlas), 3),
					{ headers: { 'mcp-session-id': session } }
				)
			).code
		).toBe('MOUNT_SESSION_UNKNOWN');
		const foreign = await relay(olu, 'legacy', undefined, {
			method: 'DELETE',
			headers: { 'mcp-session-id': session },
		});
		const unknown = await relay(bea, 'legacy', undefined, {
			method: 'DELETE',
			headers: { 'mcp-session-id': 'never-issued' },
		});
		expect(foreign.status).toBe(204);
		expect([unknown.status, unknown.body]).toEqual([foreign.status, foreign.body]);
		expect(legacy.log.length).toBe(from);
		// Bea's own DELETE is forwarded, and the instance's empty answer passes back empty.
		const own = await relay(bea, 'legacy', undefined, {
			method: 'DELETE',
			headers: { 'mcp-session-id': session },
		});
		expect(own.status).toBeGreaterThanOrEqual(200);
		expect(own.status).toBeLessThan(300);
		expect(own.body).toBe('');
		expect(legacy.log.at(-1)).toMatchObject({
			method: 'DELETE',
			headers: { 'mcp-session-id': session },
		});
		expect(
			codeOf(
				await relay(
					bea,
					'legacy',
					toolCall('afd-call', { command: 'legacy-echo' }, scoped(ids.atlas), 4),
					{ headers: { 'mcp-session-id': session } }
				)
			).code
		).toBe('MOUNT_SESSION_UNKNOWN');
	});

	it("P6-H6: on the stateful fixture, a `notifications/cancelled` for an in-flight call aborts it upstream, by the fixture's log", async () => {
		const opened = await relay(
			bea,
			'legacy',
			rpc('initialize', {
				protocolVersion: '2025-11-25',
				clientInfo: { name: 'test', version: '1' },
				capabilities: {},
			})
		);
		const session = opened.headers['mcp-session-id'] as string;
		await relay(bea, 'legacy', rpc('notifications/initialized', undefined, null), {
			headers: { 'mcp-session-id': session },
		});
		const slow = relay(
			bea,
			'legacy',
			toolCall('afd-call', { command: 'legacy-slow' }, scoped(ids.atlas), 'slow-1'),
			{
				headers: { 'mcp-session-id': session },
			}
		);
		await expect.poll(() => legacy.ran.some((ran) => ran.command === 'legacy-slow')).toBe(true);
		const posted = posts(legacy).length;
		const cancelled = await relay(
			bea,
			'legacy',
			rpc('notifications/cancelled', { requestId: 'slow-1' }, null),
			{
				headers: { 'mcp-session-id': session },
			}
		);
		expect(cancelled.status).toBe(202);
		expect(cancelled.body).toBe('');
		// The relay ended its own upstream request: the instance's connection for that call closed unanswered.
		await expect
			.poll(() => legacy.log.find((request) => request.body.includes('slow-1'))?.closedEarly)
			.toBe(true);
		// Never forwarded: the relay aborted its own upstream request instead.
		expect(
			posts(legacy)
				.slice(posted)
				.map((request) => bodyOf(request).method)
		).not.toContain('notifications/cancelled');
		legacy.release();
		await slow;
	});

	it("P6-H6: `GET` is 405, and every relay answer carries 3.5's headers and `no-store`", async () => {
		const get = await relay(bea, 'team', undefined, { method: 'GET' });
		expect(get.status).toBe(405);
		expect(get.headers.allow).toBe('POST, DELETE');
		const refused = await relay(bea, 'team', [toolCall('notes-get')]);
		for (const answer of [get, refused]) {
			expect(answer.headers['cache-control']).toBe('no-store');
			expect(answer.headers['content-security-policy']).toContain("default-src 'none'");
			expect(answer.headers['x-content-type-options']).toBe('nosniff');
			expect(answer.headers['access-control-allow-origin']).toBeUndefined();
		}
		expect(codeOf(await relay(undefined, 'team', toolCall('notes-get'))).code).toBe('UNAUTHORIZED');
		expect(
			codeOf(
				await relay(bea, 'team', toolCall('notes-get'), {
					headers: { origin: 'https://evil.example' },
				})
			).code
		).toBe('REQUEST_NOT_SAME_ORIGIN');
		expect(
			codeOf(await relay(bea, 'team', toolCall('notes-get', { text: 'x'.repeat(1_100_000) })))
				.status
		).toBe(413);
	});

	it("P6-H6: the relay's own discovery ends each legacy session it opens, with an upstream DELETE carrying the bearer", async () => {
		// The relay discovered it at start and on each refresh (`clientInfo.name` `loam-host`); none of those stays open,
		// where the shell's own session (`loam`) does until the relay ends it.
		const discovered = posts(legacy).filter(
			(request) => bodyOf(request).params?.clientInfo?.name === 'loam-host'
		);
		expect(discovered.length).toBeGreaterThan(0);
		await expect
			.poll(() => legacy.openSessions().filter((name) => name === 'loam-host'))
			.toEqual([]);
		expect(
			legacy.log.some(
				(request) =>
					request.method === 'DELETE' && request.headers.authorization === `Bearer ${TOKENS.legacy}`
			)
		).toBe(true);
	});

	it("P6-H6: the relay's added latency over a direct request, p95 (section 14's row, 20 ms)", async () => {
		const samples = 30;
		const time = async (send: () => Promise<unknown>) => {
			const taken: number[] = [];
			for (let index = 0; index < samples; index++) {
				const started = performance.now();
				await send();
				taken.push(performance.now() - started);
			}
			return taken.sort((a, b) => a - b)[Math.floor(samples * 0.95) - 1] as number;
		};
		const body = JSON.stringify(toolCall('notes-get', {}, modern));
		// Each sample must be a call that ran: a fast refusal is no measure of the relay's cost.
		// The direct request is the one the relay sent for the same call, replayed as it arrived: the same request.
		expect((await relay(bea, 'hostile', body)).status).toBe(200);
		const sent = posts(hostile).at(-1) as Logged;
		const replay: Record<string, string> = {};
		for (const [name, value] of Object.entries(sent.headers))
			if (typeof value === 'string' && !['host', 'content-length', 'connection'].includes(name))
				replay[name] = value;
		const ranFrom = hostile.ran.length;
		const direct = await time(async () => {
			const response = await fetch(hostile.url, {
				method: 'POST',
				headers: replay,
				body: sent.body,
			});
			expect(response.status).toBe(200);
			await response.text();
		});
		const relayed = await time(async () => {
			const answer = await relay(bea, 'hostile', body);
			expect(answer.status).toBe(200);
			expect(answer.headers['loam-relay-refusal']).toBeUndefined();
		});
		expect(hostile.ran.length - ranFrom).toBe(2 * samples);
		const added = relayed - direct;
		console.log(
			`P6-H6 latency: relayed p95 ${relayed.toFixed(1)} ms, direct ${direct.toFixed(1)} ms, added ${added.toFixed(1)} ms`
		);
		// Enforced in the `Hosted development profile` job; elsewhere a shared machine's load decides it, so it is logged.
		if (process.env.CI === 'true') expect(added).toBeLessThan(20);
	});

	it("P6-H6: the era negotiated through the hosted relay equals the test-only relay's, with `server/discover` answered", async () => {
		// Phase 1's test-only relay (`mounted/mount-relay.ts`), in front of the same two instances, beside the hosted one.
		const testOnly = createMountRelay([
			{ instance: 'scopes', url: scopes.url },
			{ instance: 'legacy', url: legacy.url, bearer: TOKENS.legacy },
		]);
		const server: Server = createServer((incoming, outgoing) => {
			if (!testOnly.handle(incoming, outgoing)) outgoing.writeHead(404).end();
		});
		await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
		const testOnlyUrl = (instance: string) =>
			`http://127.0.0.1:${(server.address() as AddressInfo).port}/mounts/${instance}/mcp`;
		const cookie = await cookieOf(host, bea.context);
		/** The page's transport (`mount.ts` connects in `mode: 'auto'`), and what its handshake negotiated. */
		const negotiate = async (url: string, hosted: boolean) => {
			const transport = new StreamableHttpTransport(url, {
				clientName: 'loam',
				clientVersion: '1',
				mode: 'auto',
				...(hosted
					? {
							headers: { origin: host.origin, cookie },
							fetch: trustingFetch(readFileSync(host.certificate)),
						}
					: {}),
			});
			await transport.connect();
			try {
				const initialized = await transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
				return {
					version: transport.protocolVersion,
					era: transport.protocolEra,
					result: initialized.result,
				};
			} finally {
				transport.disconnect();
			}
		};
		try {
			for (const [instance, era, server] of [
				['scopes', 'modern', 'loam-scope-fixture'],
				['legacy', 'legacy', 'relay-legacy-fixture'],
			] as const) {
				const through = await negotiate(`${host.root}mounts/${instance}/mcp`, true);
				expect(through.era, instance).toBe(era);
				expect(through.result, instance).toMatchObject({ serverInfo: { name: server } });
				expect(through, instance).toEqual(await negotiate(testOnlyUrl(instance), false));
			}
			// `server/discover` answered through both: the same result, which the modern era was negotiated from.
			// As the SDK sends it: the test-only relay passes it unchanged, and the hosted relay rebuilds it.
			const discover = rpc('server/discover', {
				_meta: { ...modern, 'io.modelcontextprotocol/clientCapabilities': {} },
			});
			const accept = 'application/json, text/event-stream';
			const hostedDiscover = await relay(bea, 'scopes', discover, { headers: { accept } });
			// The test-only relay forwards the page's headers as they are, so they are the SDK's, as the hosted relay sets them.
			const direct = await fetch(testOnlyUrl('scopes'), {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept,
					'mcp-protocol-version': '2026-07-28',
					'mcp-method': 'server/discover',
				},
				body: JSON.stringify(discover),
			});
			expect(hostedDiscover.status).toBe(200);
			expect(direct.status, await direct.clone().text()).toBe(200);
			const resultOf = (text: string) =>
				(JSON.parse(text.startsWith('data:') ? text.slice(5).trim() : text) as { result?: unknown })
					.result;
			const hostedResult = resultOf(hostedDiscover.body.trim());
			expect(hostedResult).toMatchObject({ supportedVersions: expect.any(Array) });
			expect(hostedResult).toEqual(resultOf((await direct.text()).trim()));
			expect(
				testOnly.log.some(
					(entry) => entry.rpc?.method === 'server/discover' && entry.status === 200
				)
			).toBe(true);
		} finally {
			testOnly.abort();
			await new Promise<void>((done) => {
				server.closeAllConnections();
				server.close(() => done());
			});
		}
	});

	it('P6-H6: after a restart no binding exists: the next call is MOUNT_SESSION_UNKNOWN, retryable, and the shell reconnects to a working new session', async () => {
		expect(
			(await callIn(bea.page, 'legacy-legacy-echo', { text: 'before' }, ids.atlas)).success
		).toBe(true);
		await host.restart();
		const failed = await callIn(bea.page, 'legacy-legacy-echo', { text: 'after' }, ids.atlas);
		expect(failed.error?.code).toBe('MOUNT_SESSION_UNKNOWN');
		expect(failed.error?.retryable).toBe(true);
		const inits = posts(legacy).filter((request) => bodyOf(request).method === 'initialize').length;
		const again = await callIn(bea.page, 'legacy-legacy-echo', { text: 'again' }, ids.atlas);
		expect(again.success, JSON.stringify(again.error)).toBe(true);
		expect(posts(legacy).filter((request) => bodyOf(request).method === 'initialize').length).toBe(
			inits + 1
		);
	});

	it("P6-H6: the server's journal holds each forwarded call as `mount-relay`, with no argument, result or token", async () => {
		const lines = readFileSync(join(host.data, 'journal.jsonl'), 'utf8')
			.split('\n')
			.filter((line) => line.trim());
		const relayed = lines
			.map(
				(line) =>
					JSON.parse(line) as {
						command: string;
						input: Record<string, unknown>;
						actor?: { id?: string };
					}
			)
			.filter((entry) => entry.command === 'mount-relay');
		expect(
			relayed.some((entry) => entry.input.command === 'notes-get' && entry.actor?.id === ids.bea)
		).toBe(true);
		expect(JSON.stringify(relayed)).not.toMatch(/"text"|team-bearer|instance words/);
	});
});

describe('P6-H7: no secret anywhere', () => {
	it('P6-H6: P6-H7: no bearer, cookie value, MCP token or session id in the served files, the projection, either journal, the logs, any store row or `localStorage`; no `mounts.json` under the data directory', async () => {
		// This host's own MCP token, issued and used here, beside its sign-ins, transport and relay calls.
		const send: HostSend = (path, options) =>
			hosted(host, path, {
				method: options.method,
				headers: options.headers,
				...(options.body !== undefined ? { body: options.body } : {}),
			}) as never;
		const token = await agentToken(send, {
			origin: host.origin,
			providerPath: `${BASE}api/auth`,
			email: 'bea@acme.example',
			password: PASSWORD,
			clientId: host.clients[CLIENT] as string,
			redirect: REDIRECT,
			resource: `${host.root}mcp`,
		});
		expect(token.access, JSON.stringify(token.refused)).toEqual(expect.any(String));
		const client = new StreamableHttpTransport(`${host.root}mcp`, {
			clientName: 'p6-h7',
			clientVersion: '0',
			headers: { authorization: `Bearer ${token.access}` },
			fetch: trustingFetch(readFileSync(host.certificate)),
		});
		await client.connect();
		try {
			const listed = await client.send({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'project-list', arguments: {} },
			});
			expect(listed.error).toBeUndefined();
		} finally {
			client.disconnect();
		}
		// Every session id an instance issued through the relay, and every page's cookie.
		const sessionIds = [team, grouped, hostile, legacy].flatMap((fixture) =>
			fixture.log.flatMap((request) => {
				const id = request.headers['mcp-session-id'];
				return typeof id === 'string' ? [id] : [];
			})
		);
		expect(sessionIds.length).toBeGreaterThan(0);
		const cookies = (
			await Promise.all(opened.map((page) => page.context.cookies(host.origin)))
		).flat();
		const known = [
			token.access as string,
			...new Set(sessionIds),
			...Object.values(TOKENS),
			...new Set([
				...seenSecrets,
				...cookies
					.map((cookie) => decodeURIComponent(cookie.value))
					.filter((value) => value.length >= 16),
			]),
		];
		const scan = await scanSecrets(
			host,
			opened.map((page) => page.page),
			known
		);
		expect(scan.found).toEqual([]);
		const files = (dir: string): string[] =>
			readdirSync(dir).flatMap((name) => {
				const path = join(dir, name);
				return statSync(path).isDirectory() ? files(path) : [path];
			});
		expect(files(host.data).filter((file) => file.endsWith('mounts.json'))).toEqual([]);
		expect(existsSync(join(host.data, 'public', 'site', 'mounts.json'))).toBe(false);
		// The bearers reached their instances, and only them.
		expect(
			team.log.some((request) => request.headers.authorization === `Bearer ${TOKENS.team}`)
		).toBe(true);
		expect(
			legacy.log.some((request) => request.headers.authorization === `Bearer ${TOKENS.legacy}`)
		).toBe(true);
		expect(
			team.log.some((request) => String(request.headers.authorization).includes(TOKENS.legacy))
		).toBe(false);
	});
});
