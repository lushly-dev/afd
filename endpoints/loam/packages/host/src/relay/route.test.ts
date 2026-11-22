/**
 * The relay's route (phase 6 specification, 8.1 to 8.4) over a real AFD fixture server, as a unit: the page's requests
 * over HTTP to the relay, the relay's own discovery and forwarding through a recording `fetch`, and scripted answers
 * where a case needs an instance that misbehaves. The hosted suite (`web/test/hosted/relay.test.ts`) proves the same
 * route on the development profile, with the shell in Chromium.
 */

import { createServer, type IncomingHttpHeaders, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type JournalRecord, success } from '@lushly-dev/afd-core';
import { createMcpHandler, defineCommand } from '@lushly-dev/afd-server';
import type { LoamKernelErrorCode } from '@lushly-dev/loam-kernel';
import type { MountFailureCode, ProjectV1, WorkspaceAppV1 } from '@lushly-dev/loam-kernel/mounted';
import type { ProjectionAppV1 } from '@lushly-dev/loam-manifest';
import { SERVER_LIMITS_V1, type ServerLimitsV1 } from '@lushly-dev/loam-manifest/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { RelayCode } from './refusals.js';
import { createRelay, drained, type Relay, type RelayOptions } from './route.js';

const ORIGIN = 'https://loam.test';
const WORKSPACE = 'acme';
const BEARER = 'bearer-secret-0123456789';
const ATLAS: ProjectV1 = {
	id: 'prj_atlas0000',
	workspace: WORKSPACE,
	slug: 'atlas',
	name: 'Atlas',
	icon: 'folder',
	status: 'active',
	access: { mode: 'workspace' },
	memberEpoch: 0,
	createdAt: 0,
	updatedAt: 0,
	createdBy: 'usr_olu',
	updatedBy: 'usr_olu',
};
const VAULT: ProjectV1 = {
	...ATLAS,
	id: 'prj_vault0000',
	slug: 'vault',
	access: { mode: 'restricted', members: ['usr_olu'] },
};

/** What the fixture's handlers saw: each command's name and the scope its context held. */
const ran: Array<{ command: string; scope: unknown; input: unknown }> = [];
const fixtureCommand = (name: string, mutation = false) =>
	defineCommand({
		name,
		description: name,
		mutation,
		expose: { mcp: true, palette: true, agent: true },
		input: z.object({ space: z.string().optional(), text: z.string().optional() }),
		async handler(input, context) {
			ran.push({ command: name, scope: (context as { scope?: unknown }).scope ?? null, input });
			return success({ ok: name });
		},
	});

let fixture: Server;
let fixtureUrl = '';
let page: Server;
let pageUrl: URL;

/** Every request the relay sent an instance: its method, headers and body, as the instance received them. */
const sent: Array<{ method: string; headers: Record<string, string>; body: string }> = [];
/** Answers a test scripts instead of the fixture's, by the forwarded `tools/call`'s name, or for every request. */
let script:
	| ((body: string, init: RequestInit) => Promise<Response> | Response | undefined)
	| undefined;
const journal: JournalRecord[] = [];
let enabled = true;
let people: Map<string, 'member' | 'owner'>;

async function recordingFetch(
	input: Parameters<typeof fetch>[0],
	init: RequestInit = {}
): Promise<Response> {
	const headers = Object.fromEntries(new Headers(init.headers).entries());
	const body = typeof init.body === 'string' ? init.body : '';
	sent.push({ method: init.method ?? 'GET', headers, body });
	const scripted = await script?.(body, init);
	if (scripted) return scripted;
	return fetch(input, init);
}

const entry = (extra: Partial<ProjectionAppV1> = {}): ProjectionAppV1 =>
	({
		instance: 'work',
		app: 'notes',
		package: 'apps/notes/',
		transport: 'http',
		prefix: 'work',
		route: 'mounts/work/mcp',
		...extra,
	}) as ProjectionAppV1;

let relay: Relay;
function openRelay(
	limits: Partial<ServerLimitsV1> = {},
	extra: Partial<ProjectionAppV1> = {},
	clock?: () => number
): Relay {
	const options: RelayOptions = {
		origin: ORIGIN,
		workspace: WORKSPACE,
		limits: { ...SERVER_LIMITS_V1, ...limits },
		instances: [
			{
				entry: entry(extra),
				url: fixtureUrl,
				bearer: BEARER,
				manifest: async () => ({ plugin: { id: 'notes', kind: 'mounted' } }) as never,
			},
		],
		async session(incoming) {
			const person = incoming.headers['x-test-person'];
			if (person === 'agt_x') return { refused: 'AGENT_CANNOT_SIGN_IN' };
			return typeof person === 'string' ? { person } : { refused: 'UNAUTHORIZED' };
		},
		membership: async (person) => ({
			mode: 'provider',
			members: people.has(person) ? new Map([[person, people.get(person) as 'member']]) : new Map(),
			digest: 'd',
		}),
		workspaceApp: async (instance) =>
			instance === 'work'
				? ({
						id: 'work',
						listed: 'g1',
						overrides: enabled ? {} : { enabled: false },
					} as WorkspaceAppV1)
				: null,
		projects: async () => [ATLAS, VAULT],
		journal: async (record) => journal.push(record),
		fetch: recordingFetch as typeof fetch,
		scheduleDiscovery: false,
		...(clock ? { clock } : {}),
	};
	return createRelay(options);
}

interface PageAnswer {
	status: number;
	headers: IncomingHttpHeaders;
	body: string;
}

/** One page request, as the shell's transport sends it: same origin, JSON, the cookie's person. */
function send(
	body: unknown,
	options: {
		method?: string;
		path?: string;
		person?: string | null;
		headers?: Record<string, string>;
		signal?: AbortSignal;
	} = {}
): Promise<PageAnswer> {
	const text =
		body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
	return new Promise((done, fail) => {
		const outgoing = request(
			{
				host: pageUrl.hostname,
				port: pageUrl.port,
				// Sent exactly as given, fragment and all, as a hostile client may.
				path: options.path ?? '/mounts/work/mcp',
				method: options.method ?? 'POST',
				...(options.signal ? { signal: options.signal } : {}),
				headers: {
					origin: ORIGIN,
					'sec-fetch-site': 'same-origin',
					...(text !== undefined
						? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) }
						: {}),
					...(options.person === null ? {} : { 'x-test-person': options.person ?? 'usr_bea' }),
					...options.headers,
				},
			},
			(incoming) => {
				const chunks: Buffer[] = [];
				incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
				incoming.on('end', () =>
					done({
						status: incoming.statusCode ?? 0,
						headers: incoming.headers,
						body: Buffer.concat(chunks).toString(),
					})
				);
				incoming.on('error', fail);
			}
		);
		outgoing.on('error', fail);
		outgoing.end(text);
	});
}

const call = (
	name: string,
	args: Record<string, unknown> = {},
	extra: Record<string, unknown> = {},
	id: number | string = 1
) => ({
	jsonrpc: '2.0',
	id,
	method: 'tools/call',
	params: { name, arguments: args, ...extra },
});
const scope = (project?: string) => ({
	_meta: { 'dev.loam/scope': { workspace: WORKSPACE, ...(project ? { project } : {}) } },
});
const initialize = (id = 1) => ({
	jsonrpc: '2.0',
	id,
	method: 'initialize',
	params: {
		protocolVersion: '2025-11-25',
		clientInfo: { name: 'loam', version: '1' },
		capabilities: {},
	},
});

/** A scripted legacy-era answer: JSON, with the headers given. */
const jsonAnswer = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { 'content-type': 'application/json', ...headers },
	});

const refusalOf = (answer: PageAnswer) => ({
	status: answer.status,
	code: (JSON.parse(answer.body || '{}') as { code?: string }).code,
	marked: answer.headers['loam-relay-refusal'],
});

beforeAll(async () => {
	const handler = createMcpHandler({
		name: 'notes-fixture',
		version: '0.0.0',
		commands: [
			fixtureCommand('notes-get'),
			fixtureCommand('notes-list'),
			fixtureCommand('notes-delete', true),
		] as never,
		contextFields: [
			{
				name: 'scope',
				meta: 'dev.loam/scope',
				schema: z.strictObject({ workspace: z.string(), project: z.string().optional() }),
			},
		],
		host: '127.0.0.1',
		toolStrategy: 'hybrid',
		firstClassTools: ['notes-get'],
		bootstrap: true,
	});
	fixture = createServer(handler);
	await new Promise<void>((done) => fixture.listen(0, '127.0.0.1', done));
	fixtureUrl = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}/mcp`;
	page = createServer((incoming, outgoing) => {
		const path = (incoming.url ?? '/').split(/[?#]/)[0] as string;
		void relay.handle(incoming, outgoing, path.slice(1));
	});
	await new Promise<void>((done) => page.listen(0, '127.0.0.1', done));
	pageUrl = new URL(`http://127.0.0.1:${(page.address() as AddressInfo).port}/`);
});

afterAll(async () => {
	await relay?.close();
	page?.closeAllConnections();
	fixture?.closeAllConnections();
	await new Promise((done) => page?.close(done));
	await new Promise((done) => fixture?.close(done));
});

beforeEach(async () => {
	script = undefined;
	await relay?.close();
	sent.length = 0;
	ran.length = 0;
	journal.length = 0;
	script = undefined;
	enabled = true;
	people = new Map([
		['usr_bea', 'member'],
		['usr_olu', 'owner'],
	]);
	relay = openRelay();
	await relay.catalogs.rediscover('work');
	sent.length = 0;
});

describe('P6-E5: the gate (8.1 steps 1 to 4)', () => {
	it('P6-E5: `GET` is 405 with `Allow: POST, DELETE`, marked, counted and never journaled', async () => {
		const answer = await send(undefined, { method: 'GET' });
		expect(answer.status).toBe(405);
		expect(answer.headers.allow).toBe('POST, DELETE');
		expect(answer.headers['loam-relay-refusal']).toBe('1');
		expect(relay.counts.get('MOUNT_METHOD_REFUSED')).toBe(1);
		expect(journal).toEqual([]);
		expect(sent).toEqual([]);
	});

	it('P6-E5: a path beyond `mcp`, a query, a fragment and another spelling are INSTANCE_UNKNOWN', async () => {
		for (const path of [
			'/mounts/work/mcp/x',
			'/mounts/work/mcp?x=1',
			'/mounts/work/mcp#f',
			'/mounts/Work/mcp',
			'/mounts/work/MCP',
			'/mounts/work/rpc',
			'/mounts/nope/mcp',
		])
			expect(refusalOf(await send(call('notes-get'), { path }))).toEqual({
				status: 404,
				code: 'INSTANCE_UNKNOWN',
				marked: '1',
			});
		expect(sent).toEqual([]);
	});

	it('P6-E5: headers: a foreign `Origin`, a cross-site fetch and `text/plain` are REQUEST_NOT_SAME_ORIGIN; no session UNAUTHORIZED; an agent AGENT_CANNOT_SIGN_IN; counted, never journaled', async () => {
		expect(
			refusalOf(await send(call('notes-get'), { headers: { origin: 'https://evil.test' } })).code
		).toBe('REQUEST_NOT_SAME_ORIGIN');
		expect(
			refusalOf(await send(call('notes-get'), { headers: { 'sec-fetch-site': 'cross-site' } })).code
		).toBe('REQUEST_NOT_SAME_ORIGIN');
		expect(
			refusalOf(await send(call('notes-get'), { headers: { 'content-type': 'text/plain' } })).code
		).toBe('REQUEST_NOT_SAME_ORIGIN');
		expect(refusalOf(await send(call('notes-get'), { person: null }))).toEqual({
			status: 401,
			code: 'UNAUTHORIZED',
			marked: '1',
		});
		expect(refusalOf(await send(call('notes-get'), { person: 'agt_x' }))).toEqual({
			status: 401,
			code: 'AGENT_CANNOT_SIGN_IN',
			marked: '1',
		});
		expect(relay.counts.get('REQUEST_NOT_SAME_ORIGIN')).toBe(3);
		expect(journal).toEqual([]);
		expect(sent).toEqual([]);
	});

	it('P6-E5: a disabled instance answers the same bytes as one that does not exist, journaled with its code', async () => {
		const unknown = await send(call('notes-get'), { path: '/mounts/nope/mcp' });
		enabled = false;
		const disabled = await send(call('notes-get'));
		expect(disabled.status).toBe(unknown.status);
		expect(disabled.body).toBe(unknown.body);
		expect(journal.map((entry) => entry.result.error?.code)).toEqual([
			'INSTANCE_UNKNOWN',
			'INSTANCE_UNKNOWN',
		]);
		expect(sent).toEqual([]);
	});

	it('P6-E5: limits: a body over `request_body_bytes` is 413 REQUEST_TOO_LARGE, and nothing is forwarded', async () => {
		await relay.close();
		relay = openRelay({ request_body_bytes: 256 });
		const answer = await send(call('notes-get', { text: 'x'.repeat(400) }));
		expect(refusalOf(answer)).toEqual({ status: 413, code: 'REQUEST_TOO_LARGE', marked: '1' });
		expect(sent).toEqual([]);
	});
});

describe('P6-E5: decided and rebuilt, against a real AFD instance', () => {
	it("P6-E5: a member's call reaches the instance with its scope in `_meta`, the deployer's bearer, and none of the page's headers", async () => {
		const answer = await send(call('notes-get', { text: 'hi', confirm: true }, scope(ATLAS.id)), {
			headers: {
				cookie: 'session=page-cookie',
				authorization: 'Bearer page-token',
				'mcp-name': 'notes-delete',
				'mcp-method': 'tools/call',
				'mcp-protocol-version': '1999-01-01',
				traceparent: '00-x',
			},
		});
		expect(answer.status).toBe(200);
		expect(answer.headers['loam-relay-refusal']).toBeUndefined();
		expect(ran).toEqual([
			{
				command: 'notes-get',
				scope: { workspace: WORKSPACE, project: ATLAS.id },
				input: { text: 'hi' },
			},
		]);
		const forwarded = sent.find((request) => request.body.includes('notes-get'));
		expect(forwarded?.headers.authorization).toBe(`Bearer ${BEARER}`);
		expect(forwarded?.headers['mcp-name']).toBe('afd-call');
		expect(forwarded?.headers.cookie).toBeUndefined();
		expect(forwarded?.headers.traceparent).toBeUndefined();
		expect(forwarded?.headers['mcp-protocol-version']).toBeUndefined();
		expect(JSON.stringify(answer)).not.toContain(BEARER);
		expect(answer.headers['cache-control']).toBe('no-store');
	});

	it('P6-E5: a non-member of the project is refused before forwarding: PROJECT_NOT_FOUND, journaled with no argument', async () => {
		const answer = await send(call('notes-get', { text: 'secret-argument' }, scope(VAULT.id)));
		expect(refusalOf(answer)).toEqual({ status: 403, code: 'PROJECT_NOT_FOUND', marked: '1' });
		expect(sent).toEqual([]);
		expect(journal).toHaveLength(1);
		expect(journal[0]).toMatchObject({
			command: 'mount-relay',
			actor: { kind: 'human', id: 'usr_bea' },
			input: {
				instance: 'work',
				command: 'notes-get',
				scope: { workspace: WORKSPACE, project: VAULT.id },
			},
			result: { success: false, error: { code: 'PROJECT_NOT_FOUND' }, data: { status: 403 } },
		});
		expect(JSON.stringify(journal)).not.toContain('secret-argument');
	});

	it('P6-E5: `afd-call` naming a hidden mutation, `afd-batch`, `resources/read` and a bare JSON-RPC response never reach the instance', async () => {
		expect(refusalOf(await send(call('afd-call', { command: 'notes-delete' }))).code).toBe(
			'MOUNT_COMMAND_NOT_EXPOSED'
		);
		expect(refusalOf(await send(call('afd-batch', { commands: [] }))).code).toBe(
			'MOUNT_COMMAND_NOT_EXPOSED'
		);
		expect(
			refusalOf(
				await send({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'x' } })
			).code
		).toBe('MOUNT_METHOD_REFUSED');
		expect(refusalOf(await send({ jsonrpc: '2.0', id: 3, result: {} })).code).toBe(
			'MOUNT_METHOD_REFUSED'
		);
		expect(refusalOf(await send([call('notes-get')])).code).toBe('MOUNT_BATCH_REFUSED');
		expect(ran).toEqual([]);
		expect(sent.filter((request) => request.method === 'POST')).toEqual([]);
	});

	it('P6-E5: each forwarded `tools/call` is journaled as `mount-relay`: the effective command, its scope and status, no argument, result or token', async () => {
		await send(
			call('afd-call', { command: 'notes-list', input: { text: 'arg-text' } }, scope(ATLAS.id))
		);
		await send(call('afd-help', { format: 'brief' }));
		await send({ jsonrpc: '2.0', id: 4, method: 'ping' });
		expect(journal.map((entry) => entry.input)).toEqual([
			{
				instance: 'work',
				command: 'notes-list',
				scope: { workspace: WORKSPACE, project: ATLAS.id },
			},
			{ instance: 'work', command: 'afd-help' },
		]);
		expect(
			journal.every(
				(entry) => entry.result.success && (entry.result.data as { status: number }).status === 200
			)
		).toBe(true);
		expect(JSON.stringify(journal)).not.toMatch(/arg-text|bearer-secret|ok/);
	});

	it('P6-E5: a command missing from the catalog discovers again once, and is refused if still absent; never more than once in 30 seconds', async () => {
		await relay.close();
		let now = 1_000_000;
		relay = openRelay({}, {}, () => now);
		await relay.catalogs.rediscover('work');
		now += 31_000;
		const before = sent.length;
		expect(refusalOf(await send(call('afd-call', { command: 'notes-new' }))).code).toBe(
			'MOUNT_COMMAND_NOT_EXPOSED'
		);
		const discovered = sent.length - before;
		expect(discovered).toBeGreaterThan(0);
		expect(refusalOf(await send(call('afd-call', { command: 'notes-new' }))).code).toBe(
			'MOUNT_COMMAND_NOT_EXPOSED'
		);
		expect(sent.length - before).toBe(discovered);
	});
});

describe("P6-E5: the instance's answer by allow-list, and its sessions (8.1 steps 15 to 17)", () => {
	it('P6-E5: an instance\'s own `403 {"code":"MOUNT_SPACE_PINNED"}` with `Loam-Relay-Refusal: 1`, `Set-Cookie` and `Retry-After` passes with none of them, and none of its words', async () => {
		script = () =>
			jsonAnswer({ code: 'MOUNT_SPACE_PINNED', message: 'instance words' }, 403, {
				'loam-relay-refusal': '1',
				'set-cookie': 'x=1',
				'retry-after': '5',
				'x-instance': 'y',
			});
		const answer = await send(call('notes-get'));
		expect(answer.status).toBe(403);
		expect(answer.headers['loam-relay-refusal']).toBeUndefined();
		expect(answer.headers['set-cookie']).toBeUndefined();
		expect(answer.headers['retry-after']).toBeUndefined();
		expect(answer.headers['x-instance']).toBeUndefined();
		expect(answer.body).toBe('');
	});

	it('P6-E5: a redirect, a `text/html` answer and a JSON body holding two responses are each 502 MOUNT_RESULT_INVALID', async () => {
		const answers = [
			new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/' } }),
			new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
			jsonAnswer([
				{ jsonrpc: '2.0', id: 1, result: {} },
				{ jsonrpc: '2.0', id: 1, result: {} },
			]),
		];
		for (const scripted of answers) {
			script = () => scripted;
			expect(refusalOf(await send(call('notes-get')))).toEqual({
				status: 502,
				code: 'MOUNT_RESULT_INVALID',
				marked: '1',
			});
		}
	});

	it("P6-E5: a notification's `202` passes back empty, with no `Content-Type`", async () => {
		script = () => new Response(null, { status: 202 });
		const answer = await send({ jsonrpc: '2.0', method: 'notifications/initialized' });
		expect(answer.status).toBe(202);
		expect(answer.body).toBe('');
		expect(answer.headers['content-type']).toBeUndefined();
	});

	it("P6-E5: `Mcp-Session-Id` passed back only on `initialize`'s answer, bound to its person: another person's use of it is MOUNT_SESSION_UNKNOWN, and its DELETE answered 204 with nothing forwarded", async () => {
		script = (body) =>
			body.includes('"initialize"')
				? jsonAnswer(
						{
							jsonrpc: '2.0',
							id: 1,
							result: {
								protocolVersion: '2025-06-18',
								capabilities: {},
								serverInfo: { name: 'x', version: '1' },
							},
						},
						200,
						{ 'mcp-session-id': 'sess-1' }
					)
				: jsonAnswer({ jsonrpc: '2.0', id: 2, result: { content: [] } }, 200, {
						'mcp-session-id': 'sess-other',
					});
		const opened = await send(initialize(), { headers: { 'mcp-session-id': 'page-chosen' } });
		expect(opened.headers['mcp-session-id']).toBe('sess-1');
		const init = sent.find((request) => request.body.includes('"initialize"'));
		expect(init?.headers['mcp-session-id']).toBeUndefined();
		// The person's own session: forwarded with the id and the version its `initialize` answer named.
		const used = await send(call('notes-get', {}, {}, 2), {
			headers: { 'mcp-session-id': 'sess-1' },
		});
		expect(used.status).toBe(200);
		expect(used.headers['mcp-session-id']).toBeUndefined();
		expect(sent.at(-1)?.headers).toMatchObject({
			'mcp-session-id': 'sess-1',
			'mcp-protocol-version': '2025-06-18',
		});
		const count = sent.length;
		expect(
			refusalOf(
				await send(call('notes-get', {}, {}, 3), {
					person: 'usr_olu',
					headers: { 'mcp-session-id': 'sess-1' },
				})
			)
		).toEqual({
			status: 404,
			code: 'MOUNT_SESSION_UNKNOWN',
			marked: '1',
		});
		expect(
			refusalOf(
				await send(call('notes-get', {}, {}, 3), { headers: { 'mcp-session-id': 'never-issued' } })
			).code
		).toBe('MOUNT_SESSION_UNKNOWN');
		// A DELETE for a foreign, an unknown or an evicted id: 204, the same bytes, nothing forwarded.
		const foreign = await send(undefined, {
			method: 'DELETE',
			person: 'usr_olu',
			headers: { 'mcp-session-id': 'sess-1' },
		});
		const unknown = await send(undefined, {
			method: 'DELETE',
			headers: { 'mcp-session-id': 'never-issued' },
		});
		expect(foreign.status).toBe(204);
		expect([unknown.status, unknown.body]).toEqual([foreign.status, foreign.body]);
		expect(sent.length).toBe(count);
		// The person's own DELETE is forwarded with the relay's headers, and the binding dropped.
		script = () => new Response(null, { status: 200 });
		const own = await send(undefined, {
			method: 'DELETE',
			headers: { 'mcp-session-id': 'sess-1' },
		});
		expect([own.status, own.body, own.headers['content-type']]).toEqual([200, '', undefined]);
		expect(sent.at(-1)).toMatchObject({
			method: 'DELETE',
			headers: { 'mcp-session-id': 'sess-1', authorization: `Bearer ${BEARER}` },
		});
		expect(
			refusalOf(
				await send(call('notes-get', {}, {}, 4), { headers: { 'mcp-session-id': 'sess-1' } })
			).code
		).toBe('MOUNT_SESSION_UNKNOWN');
	});

	it('P6-E5: an id the instance issues that is already bound to another person is 502', async () => {
		script = () =>
			jsonAnswer({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } }, 200, {
				'mcp-session-id': 'shared',
			});
		expect((await send(initialize())).headers['mcp-session-id']).toBe('shared');
		expect(refusalOf(await send(initialize(), { person: 'usr_olu' }))).toEqual({
			status: 502,
			code: 'MOUNT_RESULT_INVALID',
			marked: '1',
		});
	});

	it('P6-E5: an upstream `404` on a bound id drops the binding', async () => {
		script = (body) =>
			body.includes('"initialize"')
				? jsonAnswer({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } }, 200, {
						'mcp-session-id': 'gone',
					})
				: new Response(null, { status: 404 });
		await send(initialize());
		expect(
			(await send(call('notes-get', {}, {}, 2), { headers: { 'mcp-session-id': 'gone' } })).status
		).toBe(404);
		expect(
			refusalOf(await send(call('notes-get', {}, {}, 3), { headers: { 'mcp-session-id': 'gone' } }))
				.code
		).toBe('MOUNT_SESSION_UNKNOWN');
	});

	it("P6-E5: `notifications/cancelled` is never forwarded, aborts only this person's in-flight request through the same binding, holds no slot, and is 202 either way", async () => {
		await relay.close();
		relay = openRelay({ relay_concurrency_per_person: 1 });
		await relay.catalogs.rediscover('work');
		let aborted = false;
		script = (body, init) => {
			if (body.includes('"initialize"'))
				return jsonAnswer(
					{ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } },
					200,
					{ 'mcp-session-id': 'held' }
				);
			return new Promise<Response>((_done, fail) => {
				init.signal?.addEventListener('abort', () => {
					aborted = true;
					fail(new Error('aborted'));
				});
			});
		};
		await send(initialize());
		const held = send(call('notes-get', {}, {}, 'slow'), { headers: { 'mcp-session-id': 'held' } });
		await new Promise((done) => setTimeout(done, 50));
		const count = sent.length;
		// Another person's cancellation, and one through no binding: 202, nothing aborted.
		const cancel = (requestId: string) => ({
			jsonrpc: '2.0',
			method: 'notifications/cancelled',
			params: { requestId },
		});
		expect((await send(cancel('slow'))).status).toBe(202);
		expect(aborted).toBe(false);
		// The person's own, through the binding, while their one slot is held: it holds no slot, and aborts the call.
		expect((await send(cancel('slow'), { headers: { 'mcp-session-id': 'held' } })).status).toBe(
			202
		);
		expect(aborted).toBe(true);
		expect(sent.length).toBe(count);
		expect((await held).status).toBe(502);
	});

	it('P6-E5: limits: past `relay_concurrency_per_person` 429 MOUNT_LIMIT with `Retry-After: 1`; an aborted page request frees its slot', async () => {
		await relay.close();
		relay = openRelay({ relay_concurrency_per_person: 1 });
		await relay.catalogs.rediscover('work');
		let upstreamAborted = false;
		script = (_body, init) =>
			new Promise<Response>((_done, fail) => {
				init.signal?.addEventListener('abort', () => {
					upstreamAborted = true;
					fail(new Error('aborted'));
				});
			});
		const controller = new AbortController();
		const first = send(call('notes-get'), { signal: controller.signal }).catch(() => undefined);
		await new Promise((done) => setTimeout(done, 50));
		const limited = await send(call('notes-get', {}, {}, 2));
		expect(refusalOf(limited)).toEqual({ status: 429, code: 'MOUNT_LIMIT', marked: '1' });
		expect(limited.headers['retry-after']).toBe('1');
		controller.abort();
		await first;
		await new Promise((done) => setTimeout(done, 50));
		expect(upstreamAborted).toBe(true);
		script = undefined;
		expect((await send(call('notes-get', {}, {}, 3))).status).toBe(200);
	});

	it('P6-E5: no response headers within `relay_timeout_ms` is 504 MOUNT_TIMEOUT; a network failure 502 MOUNT_UNREACHABLE', async () => {
		await relay.close();
		relay = openRelay({ relay_timeout_ms: 100 });
		await relay.catalogs.rediscover('work');
		script = (_body, init) =>
			new Promise<Response>((_done, fail) =>
				init.signal?.addEventListener('abort', () => fail(new Error('timeout')))
			);
		expect(refusalOf(await send(call('notes-get')))).toEqual({
			status: 504,
			code: 'MOUNT_TIMEOUT',
			marked: '1',
		});
		script = () => Promise.reject(new TypeError('fetch failed'));
		expect(refusalOf(await send(call('notes-get')))).toEqual({
			status: 502,
			code: 'MOUNT_UNREACHABLE',
			marked: '1',
		});
	});

	it('P6-E5: a stream passes notifications before its one response and ends after it; server requests are dropped', async () => {
		script = () =>
			new Response(
				[
					'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
					'',
					'data: {"jsonrpc":"2.0","id":50,"method":"elicitation/create","params":{}}',
					'',
					'data: {"jsonrpc":"2.0","id":1,"result":{"content":[]}}',
					'',
					'data: {"jsonrpc":"2.0","method":"notifications/late"}',
					'',
				].join('\n'),
				{ status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } }
			);
		const answer = await send(call('notes-get'));
		expect(answer.headers['content-type']).toBe('text/event-stream');
		expect(answer.body).toBe(
			'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}\n\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[]}}\n\n'
		);
	});
});

describe("P6-E5: the trust review's fixes on the route", () => {
	it('P6-E5: a refusal made while forwarding is journaled with its code: a timeout, an invalid answer', async () => {
		await relay.close();
		relay = openRelay({ relay_timeout_ms: 100 });
		await relay.catalogs.rediscover('work');
		script = (_body, init) =>
			new Promise<Response>((_done, fail) =>
				init.signal?.addEventListener('abort', () => fail(new Error('timeout')))
			);
		await send(call('notes-get'));
		script = () => new Response('<p>', { status: 200, headers: { 'content-type': 'text/html' } });
		await send({ jsonrpc: '2.0', id: 9, method: 'ping' });
		expect(journal.map((entry) => [entry.input, entry.result.error?.code])).toEqual([
			[{ instance: 'work', command: 'notes-get' }, 'MOUNT_TIMEOUT'],
			[{ instance: 'work', command: 'ping' }, 'MOUNT_RESULT_INVALID'],
		]);
	});

	it("P6-E5: a session DELETE's deadline is 504 MOUNT_TIMEOUT, and an instance's JSON-RPC error to it passes back", async () => {
		await relay.close();
		relay = openRelay({ relay_timeout_ms: 100 });
		await relay.catalogs.rediscover('work');
		const initAnswer = (id: string) =>
			jsonAnswer({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } }, 200, {
				'mcp-session-id': id,
			});
		script = (body, init) =>
			body.includes('"initialize"')
				? initAnswer('slow-del')
				: new Promise<Response>((_done, fail) =>
						init.signal?.addEventListener('abort', () => fail(new Error('timeout')))
					);
		await send(initialize());
		expect(
			refusalOf(
				await send(undefined, { method: 'DELETE', headers: { 'mcp-session-id': 'slow-del' } })
			)
		).toEqual({ status: 504, code: 'MOUNT_TIMEOUT', marked: '1' });
		script = (body) =>
			body.includes('"initialize"')
				? initAnswer('err-del')
				: jsonAnswer({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'gone' } }, 400);
		await send(initialize());
		const answered = await send(undefined, {
			method: 'DELETE',
			headers: { 'mcp-session-id': 'err-del' },
		});
		expect(answered.status).toBe(400);
		expect(JSON.parse(answered.body)).toEqual({
			jsonrpc: '2.0',
			id: null,
			error: { code: -32000, message: 'gone' },
		});
	});

	it('P6-E5: the records are read after the body arrives: a membership ended while it was arriving refuses the call', async () => {
		const answer = new Promise<PageAnswer>((done, fail) => {
			const text = JSON.stringify(call('notes-get', {}, scope(ATLAS.id)));
			const outgoing = request(
				{
					host: pageUrl.hostname,
					port: pageUrl.port,
					path: '/mounts/work/mcp',
					method: 'POST',
					headers: {
						origin: ORIGIN,
						'content-type': 'application/json',
						'content-length': Buffer.byteLength(text),
						'x-test-person': 'usr_bea',
					},
				},
				(incoming) => {
					const chunks: Buffer[] = [];
					incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
					incoming.on('end', () =>
						done({
							status: incoming.statusCode ?? 0,
							headers: incoming.headers,
							body: Buffer.concat(chunks).toString(),
						})
					);
				}
			);
			outgoing.on('error', fail);
			outgoing.write(text.slice(0, 10));
			setTimeout(() => {
				people.delete('usr_bea');
				outgoing.end(text.slice(10));
			}, 100);
		});
		expect(refusalOf(await answer).code).toBe('WORKSPACE_NOT_MEMBER');
		expect(ran).toEqual([]);
	});

	it("P6-E5: a stream's wait for the page ends on the request's abort, with no listener left behind", async () => {
		const { EventEmitter } = await import('node:events');
		const page = Object.assign(new EventEmitter(), {
			destroyed: false,
		}) as unknown as import('node:http').ServerResponse;
		const controller = new AbortController();
		const waiting = drained(page, controller.signal);
		controller.abort();
		await waiting;
		expect((page as unknown as InstanceType<typeof EventEmitter>).listenerCount('drain')).toBe(0);
		expect((page as unknown as InstanceType<typeof EventEmitter>).listenerCount('close')).toBe(0);
		const drainedOnce = drained(page, new AbortController().signal);
		(page as unknown as InstanceType<typeof EventEmitter>).emit('drain');
		await drainedOnce;
		expect((page as unknown as InstanceType<typeof EventEmitter>).listenerCount('close')).toBe(0);
	});
});

describe("P6-E5: the re-check's fixes on the route", () => {
	/** A page request whose body arrives in two parts, `between` running after the first. */
	function slowBody(body: unknown, between: () => void | Promise<void>): Promise<PageAnswer> {
		const text = JSON.stringify(body);
		return new Promise((done, fail) => {
			const outgoing = request(
				{
					host: pageUrl.hostname,
					port: pageUrl.port,
					path: '/mounts/work/mcp',
					method: 'POST',
					headers: {
						origin: ORIGIN,
						'content-type': 'application/json',
						'content-length': Buffer.byteLength(text),
						'x-test-person': 'usr_bea',
					},
				},
				(incoming) => {
					const chunks: Buffer[] = [];
					incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
					incoming.on('end', () =>
						done({
							status: incoming.statusCode ?? 0,
							headers: incoming.headers,
							body: Buffer.concat(chunks).toString(),
						})
					);
				}
			);
			outgoing.on('error', fail);
			outgoing.write(text.slice(0, 10));
			setTimeout(async () => {
				await between();
				outgoing.end(text.slice(10));
			}, 50);
		});
	}

	it('P6-E5: a request whose body was still arriving when the relay closed forwards nothing', async () => {
		const closing = relay;
		const answer = await slowBody(call('notes-get'), () => closing.close());
		expect(refusalOf(answer)).toEqual({ status: 503, code: 'SERVER_UNAVAILABLE', marked: '1' });
		expect(ran).toEqual([]);
		relay = openRelay();
		await relay.catalogs.rediscover('work');
	});

	it('P6-E5: an `initialize` with every slot held is refused before any binding is evicted', async () => {
		await relay.close();
		relay = openRelay({ relay_concurrency_per_person: 1 });
		await relay.catalogs.rediscover('work');
		let issued = 0;
		script = (body, init) => {
			if (body.includes('"initialize"'))
				return jsonAnswer(
					{ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } },
					200,
					{
						'mcp-session-id': `b${issued++}`,
					}
				);
			if (init.method === 'DELETE') return new Response(null, { status: 204 });
			return new Promise<Response>((_done, fail) =>
				init.signal?.addEventListener('abort', () => fail(new Error('aborted')))
			);
		};
		for (let index = 0; index < 4; index++) await send(initialize());
		const controller = new AbortController();
		const held = send(call('notes-get'), {
			signal: controller.signal,
			headers: { 'mcp-session-id': 'b0' },
		}).catch(() => undefined);
		await new Promise((done) => setTimeout(done, 50));
		const deletes = () => sent.filter((request) => request.method === 'DELETE').length;
		const before = deletes();
		expect(refusalOf(await send(initialize())).code).toBe('MOUNT_LIMIT');
		expect(deletes()).toBe(before);
		controller.abort();
		await held;
	});

	it('P6-E5: a refused name is recorded to 128 characters; a stream that ends with no response is recorded MOUNT_RESULT_INVALID', async () => {
		await send(call(`x${'y'.repeat(1000)}`));
		expect((journal.at(-1)?.input as { command?: string } | undefined)?.command).toHaveLength(128);
		script = () =>
			new Response('data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n', {
				status: 200,
				headers: { 'content-type': 'text/event-stream' },
			});
		await send(call('notes-get'));
		expect(journal.at(-1)?.result.error?.code).toBe('MOUNT_RESULT_INVALID');
	});

	it('P6-E5: the records are read again after a rediscovery: a membership ended during it refuses the call', async () => {
		await relay.close();
		let now = 1_000_000;
		relay = openRelay({}, {}, () => now);
		await relay.catalogs.rediscover('work');
		now += 31_000;
		script = (body) => {
			if (body.includes('afd-help')) people.delete('usr_bea');
			return undefined;
		};
		expect(refusalOf(await send(call('afd-call', { command: 'notes-new' }))).code).toBe(
			'WORKSPACE_NOT_MEMBER'
		);
	});

	it("P6-E5: every code the relay answers with, but the server's own `SERVER_UNAVAILABLE`, is one of the kernel's", async () => {
		const { MOUNT_FAILURE_CODES } = await import('@lushly-dev/loam-kernel/mounted');
		const { RELAY_CODES } = await import('./refusals.js');
		for (const code of Object.keys(RELAY_CODES).filter((code) => code !== 'SERVER_UNAVAILABLE'))
			expect(MOUNT_FAILURE_CODES.has(code as never), code).toBe(true);
	});

	it("P6-E5: the kernel's `MountFailureCode` and `LoamKernelErrorCode` hold each relay code, at run time and in the types", async () => {
		const { MOUNT_FAILURE_CODES } = await import('@lushly-dev/loam-kernel/mounted');
		const { RELAY_CODES } = await import('./refusals.js');
		// `LoamKernelErrorCode` is a type alone, with no runtime list: `pnpm check`'s typecheck holds it, and fails here
		// on any relay code outside it. `MountFailureCode` holds all but the server's own `SERVER_UNAVAILABLE`, which the
		// browser reads as `MOUNT_UNREACHABLE` (step 6's deviation 3).
		const kernelHolds: [Exclude<RelayCode, LoamKernelErrorCode>] extends [never] ? true : false =
			true;
		const mountHolds: [
			Exclude<Exclude<RelayCode, 'SERVER_UNAVAILABLE'>, MountFailureCode>,
		] extends [never]
			? true
			: false = true;
		expect([kernelHolds, mountHolds]).toEqual([true, true]);
		const codes = Object.keys(RELAY_CODES) as RelayCode[];
		expect(codes).toContain('SERVER_UNAVAILABLE');
		expect(codes.filter((code) => !MOUNT_FAILURE_CODES.has(code as MountFailureCode))).toEqual([
			'SERVER_UNAVAILABLE',
		]);
	});
});
