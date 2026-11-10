/**
 * @fileoverview MCP authorization scopes (`spec/authorization.md`, M6): the `staticScopes` and
 * `batches` cases, the 403 before dispatch on every route that carries a body, `INSUFFICIENT_SCOPE`
 * after routing and at execution, a host resolver's two phases, filtered listings, and hidden
 * commands answered byte for byte as a twin server answers a name it does not have.
 */

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	startTestAuthorizationServer,
	type TestAuthorizationServer,
} from '../test-support/authorization-server.js';
import { JwtVerifier, jwksKeySource } from './mcp-auth-jwt.js';
import type { Credentials } from './mcp-auth-rules.js';
import {
	requestDecision,
	ScopeChallenge,
	type ScopeDecision,
	type ScopeResolver,
	staticDecision,
} from './mcp-auth-scopes.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

const RESOURCE = 'https://mcp.test.example/mcp';
const METADATA = 'https://mcp.test.example/.well-known/oauth-protected-resource/mcp';

let as: TestAuthorizationServer;
beforeAll(async () => {
	as = await startTestAuthorizationServer({ resource: RESOURCE });
});
afterAll(() => as.close());
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

// ─── The shared cases ────────────────────────────────────────────────────────────────────────

interface Cases {
	staticScopes: {
		description: string;
		requiredScopes: string[];
		scopes: string[];
		held: string[];
		expected: 'allowed' | { missing: string[] };
	}[];
	batches: {
		description: string;
		steps: ('allowed' | 'defer' | { missing: string[] })[];
		expected: 'proceed' | { forbidden: string };
	}[];
}

const cases = JSON.parse(
	readFileSync(new URL('../../../spec/authorization.json', import.meta.url), 'utf8')
) as Cases;

describe('P3-E9: spec/authorization.json: staticScopes (M6)', () => {
	it.each(cases.staticScopes)('$description', ({ requiredScopes, scopes, held, expected }) => {
		expect(staticDecision(requiredScopes, scopes, held)).toEqual(expected);
	});
});

describe('P3-E9: spec/authorization.json: batches (M6)', () => {
	it.each(cases.batches)('$description', ({ steps, expected }) => {
		const decision = requestDecision(steps as ScopeDecision[], () => {});
		expect(
			decision === 'proceed' ? 'proceed' : { forbidden: decision.forbidden.join(' ') }
		).toEqual(expected);
	});

	it('refuses a missing step that names no valid scope, naming none, and warns', () => {
		const warnings: string[] = [];
		expect(requestDecision([{ missing: ['not a token'] }], (m) => warnings.push(m))).toEqual({
			forbidden: [],
		});
		expect(requestDecision([{ missing: [] }], (m) => warnings.push(m))).toEqual({ forbidden: [] });
		expect(warnings).toHaveLength(2);
	});
});

describe('P3-E9: M6, a host scheme challenge', () => {
	it('names the scheme and parameters, then the error and scopes', () => {
		const challenge = new ScopeChallenge('Gateway', { realm: 'todo' });
		expect(challenge.headerValue(['todo:write', 'todo:admin'])).toBe(
			'Gateway realm="todo", error="insufficient_scope", scope="todo:write todo:admin"'
		);
		expect(challenge.headerValue(['not a token'])).toBe(
			'Gateway realm="todo", error="insufficient_scope"'
		);
		expect(new ScopeChallenge('X').headerValue([])).toBe('X error="insufficient_scope"');
	});

	it('is always one valid header value', () => {
		for (const scheme of ['', 'Bearer', 'bearer', 'a b', 'a"b', 'é']) {
			expect(() => new ScopeChallenge(scheme), scheme).toThrow();
		}
		for (const params of [
			{ error: 'x' },
			{ Scope: 'x' },
			{ 'a b': 'x' },
			{ realm: 'a"b' },
			{ realm: 'a\\b' },
			{ realm: 'a\nb' },
			{ realm: 'é' },
			{ realm: 'a', REALM: 'b' },
		]) {
			expect(
				() => new ScopeChallenge('Gw', params as unknown as Record<string, string>),
				JSON.stringify(params)
			).toThrow();
		}
	});
});

// ─── A server ────────────────────────────────────────────────────────────────────────────────

const ran: string[] = [];
const todo = (name: string, scopes: string[], extra: Record<string, unknown> = {}) =>
	defineCommand({
		name,
		description: `The ${name} command`,
		expose: { mcp: true },
		scopes,
		input: z.object({ list: z.string().default('inbox'), title: z.string().optional() }),
		handler: async (input) => {
			ran.push(name);
			return success({ name, list: input.list });
		},
		...extra,
	});

function commands(options: { hidden?: boolean } = {}) {
	return [
		todo('todo-list', ['todo:read']),
		todo('todo-create', ['todo:write'], { mutation: true }),
		// The twin never had `todo-purge`, so nothing it has requires it.
		todo('todo-export', ['todo:export'], {
			requires: options.hidden === false ? ['todo-list'] : ['todo-list', 'todo-purge'],
		}),
		...(options.hidden === false
			? []
			: [todo('todo-purge', ['todo:admin'], { confirmPrompt: 'Purge every todo?' })]),
		// The archive list by default: only the validated input names it.
		defineCommand({
			name: 'todo-archive',
			description: 'The archive',
			expose: { mcp: true },
			scopes: ['todo:read'],
			input: z.object({ list: z.string().default('archive') }),
			handler: async (input) => {
				ran.push('todo-archive');
				return success({ list: input.list });
			},
		}),
		// Picks a list name, for a later pipeline step to draw on.
		defineCommand({
			name: 'list-pick',
			description: 'Pick a list',
			expose: { mcp: true },
			input: z.object({}),
			handler: async () => success({ list: 'archive' }),
		}),
	];
}

async function serve(options: Partial<McpHandlerOptions> = {}, auth: Record<string, unknown> = {}) {
	ran.length = 0;
	const handler = createMcpHandler({
		name: 'scopes-test',
		version: '1',
		host: '127.0.0.1',
		commands: commands(),
		...options,
		auth: {
			resource: RESOURCE,
			authorizationServers: [as.issuer],
			scopesSupported: ['todo:read'],
			verifier: new JwtVerifier({
				rules: { resource: RESOURCE },
				issuers: [{ issuer: as.issuer, algorithms: ['RS256'], keys: jwksKeySource(as.jwks()) }],
			}),
			onRefusal: () => {},
			...auth,
		} as never,
	});
	const server = createServer((req, res) => handler(req, res));
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const token = (scope: string) => as.issue({ claims: { scope } });

interface Sent {
	status: number;
	headers: Headers;
	text: string;
}

async function post(
	url: string,
	body: unknown,
	bearer: string,
	headers: Record<string, string> = {}
) {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			Authorization: `Bearer ${bearer}`,
			...headers,
		},
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});
	return { status: response.status, headers: response.headers, text: await response.text() };
}

const META = {
	'io.modelcontextprotocol/protocolVersion': '2026-07-28',
	'io.modelcontextprotocol/clientCapabilities': {},
	'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
};

/** A 2026-07-28 `tools/call` on `/mcp`. */
function call(base: string, bearer: string, name: string, args: unknown = {}) {
	return post(
		`${base}/mcp`,
		{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, _meta: META } },
		bearer,
		{ 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': name }
	);
}

/** The JSON of a `/mcp` answer, plain or one SSE event. */
function json(sent: Sent): Record<string, unknown> {
	try {
		return JSON.parse(sent.text);
	} catch {
		return JSON.parse(/^data: (.*)$/m.exec(sent.text)?.[1] ?? '{}');
	}
}

/** The CommandResult a `tools/call` returned. */
function toolResult(sent: Sent): Record<string, unknown> {
	const result = json(sent).result as { content: { text: string }[] };
	return JSON.parse(result.content[0]?.text ?? '{}');
}

function expectForbidden(sent: Sent, missing: string) {
	expect(sent.status).toBe(403);
	expect(sent.headers.get('www-authenticate')).toBe(
		missing
			? `Bearer error="insufficient_scope", scope="${missing}", resource_metadata="${METADATA}"`
			: `Bearer error="insufficient_scope", resource_metadata="${METADATA}"`
	);
	expect(sent.headers.get('content-type')).toBe('application/json');
	expect(JSON.parse(sent.text)).toEqual({
		error: 'INSUFFICIENT_SCOPE',
		suggestion: missing
			? `Obtain a token for ${RESOURCE} that also grants ${missing}, then retry.`
			: `Obtain a token for ${RESOURCE} that grants the scopes this call needs, then retry.`,
	});
}

describe('P3-E9: M6, the 403 before dispatch', () => {
	it('refuses a command tool, grouped actions, afd-call, afd-batch and afd-pipe, naming every missing scope once in step order', async () => {
		const base = await serve({ toolStrategy: 'individual' }, { requiredScopes: ['todo:read'] });
		const reader = await token('todo:read');
		expectForbidden(await call(base, reader, 'todo-create'), 'todo:write');
		expectForbidden(
			await call(base, reader, 'afd-call', { command: 'todo-create', input: {} }),
			'todo:write'
		);
		expectForbidden(
			await call(base, reader, 'afd-batch', {
				commands: [
					{ command: 'todo-list' },
					{ command: 'todo-create' },
					{ command: 'todo-export' },
					{ command: 'todo-create' },
				],
			}),
			'todo:write todo:export'
		);
		expectForbidden(
			await call(base, reader, 'afd-pipe', {
				steps: [{ command: 'todo-export' }, { command: 'todo-create' }],
			}),
			'todo:export todo:write'
		);
		// The required scope comes first, then the command's.
		expectForbidden(await call(base, await token(''), 'todo-create'), 'todo:read todo:write');
		expect(ran).toEqual([]);
		const allowed = await call(base, reader, 'todo-list');
		expect(allowed.status).toBe(200);
		expect(ran).toEqual(['todo-list']);
	});

	it('resolves a grouped call as the router does', async () => {
		const base = await serve({}, { requiredScopes: ['todo:read'] });
		const reader = await token('todo:read');
		expectForbidden(
			await call(base, reader, 'todo', { action: 'create', params: {} }),
			'todo:write'
		);
		// An action no member has runs nothing: the required scopes alone.
		const unknown = await call(base, reader, 'todo', { action: 'nothing' });
		expect(unknown.status).toBe(200);
		expect(toolResult(unknown)).toMatchObject({ error: { code: 'COMMAND_NOT_FOUND' } });
		const missingAction = await call(base, reader, 'todo', {});
		expect(toolResult(missingAction)).toMatchObject({ error: { code: 'INVALID_GROUPED_CALL' } });
	});

	it('decides /rpc as afd-call, /batch as afd-batch and /stream as the command', async () => {
		const base = await serve();
		const reader = await token('todo:read');
		expectForbidden(
			await post(
				`${base}/rpc`,
				{ jsonrpc: '2.0', id: 1, method: 'todo-create', params: {} },
				reader
			),
			'todo:write'
		);
		expectForbidden(
			await post(
				`${base}/batch`,
				{
					commands: [
						{ command: 'todo-export', input: {} },
						{ command: 'todo-create', input: {} },
					],
				},
				reader
			),
			'todo:export todo:write'
		);
		expectForbidden(await post(`${base}/stream/todo-create`, {}, reader), 'todo:write');
		expect(ran).toEqual([]);
	});

	it('needs the required scopes for every other method, and refuses a JSON-RPC batch first', async () => {
		const base = await serve({}, { requiredScopes: ['todo:read'] });
		const none = await token('');
		expectForbidden(
			await post(
				`${base}/mcp`,
				{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } },
				none,
				{ 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' }
			),
			'todo:read'
		);
		expectForbidden(
			await post(`${base}/message`, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, none),
			'todo:read'
		);
		for (const path of ['/mcp', '/message', '/rpc']) {
			const batch = await post(`${base}${path}`, [{ jsonrpc: '2.0', id: 1, method: 'ping' }], none);
			expect(batch.status, path).toBe(400);
			expect(JSON.parse(batch.text), path).toEqual({
				jsonrpc: '2.0',
				id: null,
				error: {
					code: -32600,
					message: 'JSON-RPC batches are not supported: send one message per request',
				},
			});
		}
	});

	it('passes on a body it cannot parse, answered by the route exactly as without authorization', async () => {
		const base = await serve();
		const sent = await post(`${base}/mcp`, '{not json', await token('todo:read'));
		expect(sent.status).toBe(400);
		const rpc = await post(`${base}/rpc`, '{not json', await token('todo:read'));
		expect(rpc.status).toBe(400);
		expect(JSON.parse(rpc.text)).toMatchObject({ error: { code: -32700 } });
	});
});

describe('P3-E9: M6, INSUFFICIENT_SCOPE after routing', () => {
	it('fails a call decided after routing (GET /stream) with INSUFFICIENT_SCOPE, never a handler call', async () => {
		const base = await serve();
		const response = await fetch(`${base}/stream/todo-export?input=${encodeURIComponent('{}')}`, {
			headers: { Authorization: `Bearer ${await token('todo:read')}` },
		});
		const text = await response.text();
		const chunk = JSON.parse(/^data: (.*)$/m.exec(text)?.[1] ?? '{}');
		expect(chunk).toMatchObject({
			type: 'error',
			error: {
				code: 'INSUFFICIENT_SCOPE',
				retryable: false,
				details: { scopes: ['todo:export'] },
				suggestion: `Obtain a token for ${RESOURCE} that also grants todo:export, then retry.`,
			},
		});
		expect(ran).toEqual([]);
	});
});

/** A resolver deciding from a table of scopes, and from the `list` argument. */
function resolver(
	options: { hide?: string[]; defer?: string[]; asked?: string[] } = {}
): ScopeResolver {
	const needs: Record<string, string> = {
		'todo-list': 'todo:read',
		'todo-create': 'todo:write',
		'todo-export': 'todo:export',
		'todo-purge': 'todo:admin',
	};
	return {
		resolve(command, input, credentials) {
			options.asked?.push(command);
			if (options.defer?.includes(command)) return 'defer';
			const list = (input as { list?: unknown } | undefined)?.list;
			// The archive list needs more, whether it was sent or a default supplied it.
			const need = list === 'archive' ? 'todo:archive' : needs[command];
			return need && !credentials.scopes.includes(need) ? { missing: [need] } : 'allowed';
		},
		visible: (command) => !options.hide?.includes(command),
	};
}

describe('P3-E9: M6, a host resolver', () => {
	it('decides instead of the static rule, defers to the registry, and refuses an empty missing', async () => {
		const base = await serve(
			{ toolStrategy: 'individual' },
			{ resolver: { ...resolver({ defer: ['todo-export'] }), resolve: undefined } }
		).catch((error: Error) => error);
		expect(base).toBeInstanceOf(Error);
		const served = await serve(
			{ toolStrategy: 'individual' },
			{ resolver: resolver({ defer: ['todo-export'] }) }
		);
		const reader = await token('todo:read');
		expectForbidden(await call(served, reader, 'todo-create'), 'todo:write');
		// Defer lets the registry answer.
		expect((await call(served, reader, 'todo-export')).status).toBe(200);
		expect(ran).toEqual(['todo-export']);
		const empty = await serve(
			{ toolStrategy: 'individual' },
			{
				resolver: {
					resolve: (): ScopeDecision => ({ missing: [] }),
					visible: () => true,
				},
			}
		);
		expectForbidden(await call(empty, reader, 'todo-list'), '');
	});

	it('decides again at execution on the validated input: a default and a pipeline reference', async () => {
		const base = await serve({ toolStrategy: 'individual' }, { resolver: resolver() });
		const reader = await token('todo:read');
		// Sent, the archive list is refused before dispatch.
		expectForbidden(await call(base, reader, 'todo-list', { list: 'archive' }), 'todo:archive');
		// Supplied by a default, it passes before dispatch and is refused at execution.
		const defaulted = await call(base, reader, 'todo-archive', {});
		expect(defaulted.status).toBe(200);
		expect(toolResult(defaulted)).toMatchObject({
			success: false,
			error: {
				code: 'INSUFFICIENT_SCOPE',
				retryable: false,
				details: { scopes: ['todo:archive'] },
			},
		});
		// Drawn from an earlier step, the same.
		const piped = await call(base, reader, 'afd-pipe', {
			steps: [{ command: 'list-pick' }, { command: 'todo-list', input: { list: '$prev.list' } }],
		});
		expect(piped.status).toBe(200);
		expect(JSON.stringify(toolResult(piped))).toContain('INSUFFICIENT_SCOPE');
		expect(ran).toEqual([]);
		// With the scope, both run.
		const archivist = await token('todo:read todo:archive');
		expect(toolResult(await call(base, archivist, 'todo-archive', {}))).toMatchObject({
			success: true,
		});
		expect(ran).toEqual(['todo-archive']);
	});

	it('is never asked about a name that does not exist or a hidden command', async () => {
		const asked: string[] = [];
		const base = await serve(
			{ toolStrategy: 'individual' },
			{ resolver: resolver({ hide: ['todo-purge'], asked }), filterToolsByScope: true }
		);
		const admin = await token('todo:read todo:admin');
		await call(base, admin, 'todo-purge');
		await call(base, admin, 'no-such-command');
		await call(base, admin, 'afd-call', { command: 'todo-purge' });
		await call(base, admin, 'afd-batch', { commands: [{ command: 'todo-purge' }] });
		expect(asked.filter((name) => name === 'todo-purge' || name === 'no-such-command')).toEqual([]);
	});
});

describe('P3-E9: M6, listing', () => {
	async function listed(base: string, bearer: string) {
		const sent = await post(
			`${base}/mcp`,
			{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } },
			bearer,
			{ 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' }
		);
		return json(sent).result as { tools: { name: string; _meta?: Record<string, unknown> }[] };
	}

	it('lists only what the token can use, privately, with filterToolsByScope', async () => {
		const base = await serve({ toolStrategy: 'individual' }, { filterToolsByScope: true });
		const result = await listed(base, await token('todo:read todo:export'));
		const names = result.tools.map((tool) => tool.name);
		expect(names).toContain('todo-list');
		expect(names).toContain('todo-export');
		expect(names).not.toContain('todo-create');
		expect(names).not.toContain('todo-purge');
		expect(result).toMatchObject({ cacheScope: 'private' });
		const exportTool = result.tools.find((tool) => tool.name === 'todo-export');
		expect(exportTool?._meta).toMatchObject({ scopes: ['todo:export'] });
		// No suggestion names a command the caller is not shown.
		const typo = toolResult(
			await call(base, await token('todo:read todo:export'), 'afd-call', { command: 'todo-creat' })
		);
		expect(JSON.stringify(typo)).not.toContain('todo-create');
	});

	it('lists everything, publicly, without filterToolsByScope', async () => {
		const base = await serve({ toolStrategy: 'individual' });
		const result = await listed(base, await token('todo:read'));
		expect(result.tools.map((tool) => tool.name)).toContain('todo-purge');
		expect(result).toMatchObject({ cacheScope: 'public' });
	});
});

describe('P3-E9: M6, hidden commands answer as names that do not exist', () => {
	/** The same request to a server hiding `todo-purge` and to a twin that does not have it. */
	async function twins(strategy: McpHandlerOptions['toolStrategy']) {
		const auth = { resolver: resolver({ hide: ['todo-purge'] }), filterToolsByScope: true };
		const options = { toolStrategy: strategy, confirmations: 'enforce' as const };
		const hiding = await serve(options, auth);
		const twin = await serve({ ...options, commands: commands({ hidden: false }) }, auth);
		const bearer = await token('todo:read todo:admin todo:export');
		/** A response with its timings normalized. */
		const same = async (send: (base: string) => Promise<Sent>) => {
			const normalize = async (base: string) => {
				const sent = await send(base);
				return {
					status: sent.status,
					type: sent.headers.get('content-type'),
					challenge: sent.headers.get('www-authenticate'),
					// Timings, timestamps and trace ids differ between any two runs.
					body: sent.text
						.replace(/(executionTimeMs|durationMs|totalMs|averageMs)\\?":[0-9.]+/g, '$1":0')
						.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'T')
						.replace(/(batch|pipeline|afd-call|trace)-\d+-[a-z0-9]+/g, '$1-id'),
				};
			};
			const [hidden, missing] = [await normalize(hiding), await normalize(twin)];

			expect(hidden).toEqual(missing);
			return hidden;
		};
		return { bearer, same };
	}

	it('on its own tool, afd-call, afd-batch, afd-pipe and afd-detail', async () => {
		const { bearer, same } = await twins('individual');
		const own = await same((base) => call(base, bearer, 'todo-purge', {}));
		expect(own.body).toContain('COMMAND_NOT_FOUND');
		await same((base) => call(base, bearer, 'afd-call', { command: 'todo-purge' }));
		await same((base) =>
			call(base, bearer, 'afd-batch', {
				commands: [{ command: 'todo-list', input: {} }, { command: 'todo-purge' }],
			})
		);
		await same((base) => call(base, bearer, 'afd-pipe', { steps: [{ command: 'todo-purge' }] }));
		const detail = await same((base) =>
			call(base, bearer, 'afd-detail', { command: 'todo-purge' })
		);
		expect(detail.body).toContain('found\\":false');
		await same((base) => call(base, bearer, 'afd-detail', { command: 'todo-export' }));
		await same((base) =>
			post(`${base}/rpc`, { jsonrpc: '2.0', id: 1, method: 'todo-purge', params: {} }, bearer)
		);
		expect(ran).toEqual(['todo-list', 'todo-list']);
	});

	it('as a grouped action, and its `requires` names it nowhere', async () => {
		const { bearer, same } = await twins('grouped');
		await same((base) => call(base, bearer, 'todo', { action: 'purge' }));
		await same((base) => call(base, bearer, 'todo', {}));
		const list = await same((base) =>
			post(
				`${base}/mcp`,
				{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } },
				bearer,
				{ 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' }
			)
		);
		expect(list.body).not.toContain('todo-purge');
		expect(list.body).toContain('todo-export');
	});
});

describe('P3-E9: M6, credentials the resolver sees', () => {
	it('are the verified credentials, never the token', async () => {
		const seen: Credentials[] = [];
		const base = await serve(
			{ toolStrategy: 'individual' },
			{
				resolver: {
					resolve: (_command: string, _input: unknown, credentials: Credentials) => {
						seen.push(credentials);
						return 'allowed';
					},
					visible: () => true,
				},
			}
		);
		const bearer = await token('todo:read');
		await call(base, bearer, 'todo-list');
		expect(seen.length).toBeGreaterThan(0);
		expect(JSON.stringify(seen)).not.toContain(bearer);
		expect(seen[0]).toMatchObject({ subject: 'user-1', scopes: ['todo:read'] });
	});
});
