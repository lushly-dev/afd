/**
 * @fileoverview A host's own layer (`spec/authorization.md`, M6, "A host's own layer"):
 * `handler.admit`, the host vouching for a caller, and `handler.preDispatchCheck`, the bearer
 * layer's own decision before dispatch, compared byte for byte with the bearer layer's answers and
 * with `spec/authorization.json`'s 403.
 */

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type CommandContext, success } from '@lushly-dev/afd-core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
	startTestAuthorizationServer,
	type TestAuthorizationServer,
} from '../test-support/authorization-server.js';
import * as credentialsEntry from './credentials.js';
import * as direct from './direct.js';
import * as root from './index.js';
import type { PreDispatch, PreDispatchCheckOptions } from './mcp-auth.js';
import { JwtVerifier, jwksKeySource } from './mcp-auth-jwt.js';
import type { Credentials } from './mcp-auth-rules.js';
import { ScopeChallenge } from './mcp-auth-scopes.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';
import type { McpHandlerOptions } from './server-types.js';
import { isVerifiedCredentials } from './verified-credentials.js';

/** The resource of `spec/authorization.json`'s challenge cases. */
const RESOURCE = 'https://todo.example.com/mcp';
const METADATA = 'https://todo.example.com/.well-known/oauth-protected-resource/mcp';

let as: TestAuthorizationServer;
beforeAll(async () => {
	as = await startTestAuthorizationServer({ resource: RESOURCE });
});
afterAll(() => as.close());
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const seen: CommandContext[] = [];
const commands = [
	defineCommand({
		name: 'todo-list',
		description: 'List',
		expose: { mcp: true },
		scopes: ['todo:read'],
		input: z.object({ list: z.string().default('inbox') }),
		handler: async (input, context) => {
			if (context) seen.push(context);
			return success({
				list: input.list,
				verified: isVerifiedCredentials(context?.credentials),
				frozen: Object.isFrozen(context?.credentials),
			});
		},
	}),
	defineCommand({
		name: 'todo-purge',
		description: 'Purge',
		expose: { mcp: true },
		scopes: ['todo:write', 'todo:admin'],
		input: z.object({}),
		handler: async () => success({}),
	}),
];

function credentials(extra: Partial<Record<keyof Credentials, unknown>> = {}): Credentials {
	const now = Math.floor(Date.now() / 1000);
	return {
		issuer: as.issuer,
		subject: 'user-1',
		clientId: 'gateway-client',
		scopes: ['todo:read'],
		resource: RESOURCE,
		issuedAt: now - 10,
		expiresAt: now + 600,
		...extra,
	} as Credentials;
}

function handlerOptions(auth: Record<string, unknown> = {}): McpHandlerOptions {
	return {
		name: 'host-test',
		version: '1',
		host: '127.0.0.1',
		commands,
		toolStrategy: 'individual',
		auth: {
			resource: RESOURCE,
			authorizationServers: [as.issuer],
			verifier: new JwtVerifier({
				rules: { resource: RESOURCE },
				issuers: [{ issuer: as.issuer, algorithms: ['RS256'], keys: jwksKeySource(as.jwks()) }],
			}),
			onRefusal: () => {},
			...auth,
		} as never,
	};
}

async function listen(serve: (req: IncomingMessage, res: ServerResponse) => Promise<void>) {
	const server = createServer((req, res) => {
		serve(req, res).catch((error: Error) => {
			res.writeHead(599);
			res.end(error.message);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function readAll(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

/**
 * A gateway: it vouches for every caller with `vouch()`'s credentials (none when it returns
 * `undefined`), runs the decision before dispatch, and passes the request on with its body.
 */
async function gateway(
	vouch: (req: IncomingMessage) => Credentials | undefined,
	options: { check?: PreDispatchCheckOptions | false; auth?: Record<string, unknown> } = {}
) {
	seen.length = 0;
	const handler = createMcpHandler(handlerOptions(options.auth));
	cleanups.push(async () => handler.dispose());
	const check = options.check === false ? undefined : handler.preDispatchCheck(options.check);
	const errors: Error[] = [];
	const base = await listen(async (req, res) => {
		const body = await readAll(req);
		const vouched = vouch(req);
		if (vouched) {
			try {
				handler.admit(req, vouched);
			} catch (error) {
				errors.push(error as Error);
			}
		}
		const decided: PreDispatch = check ? check.decide(req, body) : { proceed: true };
		if (!decided.proceed) {
			res.writeHead(decided.status, decided.headers);
			res.end(decided.body);
			return;
		}
		await handler(req, res, body);
	});
	return { base, errors, handler };
}

/** The bearer layer, for the same requests. */
async function bearerServer(auth: Record<string, unknown> = {}) {
	const handler = createMcpHandler(handlerOptions(auth));
	cleanups.push(async () => handler.dispose());
	return listen((req, res) => handler(req, res));
}

interface Sent {
	status: number;
	headers: Headers;
	text: string;
}

async function post(
	url: string,
	body: unknown,
	headers: Record<string, string> = {}
): Promise<Sent> {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});
	return { status: response.status, headers: response.headers, text: await response.text() };
}

const rpc = (method: string, params: unknown = {}) => ({ jsonrpc: '2.0', id: 1, method, params });

const shape = (sent: Sent) => ({
	status: sent.status,
	type: sent.headers.get('content-type'),
	challenge: sent.headers.get('www-authenticate'),
	// A call's trace id and timing differ between any two runs.
	body: sent.text
		.replace(/"(executionTimeMs|durationMs)":[0-9.]+/g, '"$1":0')
		.replace(/"traceId":"[^"]*"/g, '"traceId":"t"'),
});

describe('P3-E9: M6, a host admits the callers it vouches for', () => {
	it('is a method of the handler alone, never an export of any entry', async () => {
		for (const entry of [root, direct, credentialsEntry] as Record<string, unknown>[]) {
			expect(entry.admit).toBeUndefined();
			expect(Object.keys(entry).filter((name) => /admit|brand/i.test(name))).toEqual([]);
		}
		const plain = createMcpHandler({ name: 'plain', version: '1', commands });
		expect(() => plain.admit({} as IncomingMessage, credentials())).toThrow(
			/needs the auth option/
		);
		expect(() => plain.preDispatchCheck()).toThrow(/needs the auth option/);
	});

	it('gives the command frozen, branded credentials for the request alone', async () => {
		const { base, errors } = await gateway(() => credentials());
		const sent = await post(`${base}/rpc`, rpc('todo-list'));
		expect(errors).toEqual([]);
		expect(JSON.parse(sent.text).result).toMatchObject({
			success: true,
			data: { verified: true, frozen: true },
		});
		const context = seen[0] as CommandContext;
		expect(context.credentials).toEqual(
			credentials({
				expiresAt: (context.credentials as Credentials).expiresAt,
				issuedAt: (context.credentials as Credentials).issuedAt,
			})
		);
		expect(context.actor).toEqual({ kind: 'agent', id: 'gateway-client', onBehalfOf: 'user-1' });
		await vi.waitFor(() => expect(isVerifiedCredentials(context.credentials)).toBe(false));
	});

	it('refuses a request that already carries a bearer token, in the header or the query', async () => {
		const { base, errors } = await gateway(() => credentials(), { check: false });
		const header = await post(`${base}/rpc`, rpc('todo-list'), { Authorization: 'Bearer abc' });
		const query = await post(`${base}/rpc?access_token=abc`, rpc('todo-list'));
		expect(errors.map((error) => error.message)).toEqual([
			expect.stringMatching(/carries a bearer token/),
			expect.stringMatching(/carries a bearer token/),
		]);
		// Not admitted, so the bearer layer answers: a bad token, and a token in the query.
		expect(header.status).toBe(401);
		expect(query.status).toBe(401);
		expect(seen).toEqual([]);
	});

	it('refuses credentials that fail the checks a verifier’s do', async () => {
		const now = Math.floor(Date.now() / 1000);
		const refused: [
			Partial<Record<keyof Credentials, unknown>>,
			Record<string, unknown>,
			RegExp,
		][] = [
			[{ subject: '' }, {}, /rule claims/],
			[{ resource: 'https://elsewhere.example/mcp' }, {}, /rule claims/],
			[{ expiresAt: 'soon' }, {}, /rule claims/],
			[{ expiresAt: now }, {}, /rule expired/],
			[{ scopes: ['not a token'] }, {}, /rule claims/],
			[{}, { requireBoundTokens: true, verifier: undefined }, /rule binding/],
			[{ cnf: { 'x5t#S256': 'thumb' } }, {}, /rule binding/],
		];
		for (const [extra, auth, message] of refused) {
			const handler = createMcpHandler(
				handlerOptions({
					...auth,
					...(auth.requireBoundTokens
						? {
								verifier: new JwtVerifier({
									rules: { resource: RESOURCE, requireBoundTokens: true },
									issuers: [
										{ issuer: as.issuer, algorithms: ['RS256'], keys: jwksKeySource(as.jwks()) },
									],
								}),
							}
						: {}),
				})
			);
			const req = {
				headers: {},
				rawHeaders: [],
				url: '/rpc',
				socket: {},
			} as unknown as IncomingMessage;
			expect(() => handler.admit(req, credentials(extra)), JSON.stringify(extra)).toThrow(message);
			handler.dispose();
		}
	});

	it('refuses to admit a request twice: one request has one source of credentials', async () => {
		const handler = createMcpHandler(handlerOptions());
		cleanups.push(async () => handler.dispose());
		const req = {
			headers: {},
			rawHeaders: [],
			url: '/rpc',
			socket: {},
		} as unknown as IncomingMessage;
		handler.admit(req, credentials());
		expect(() => handler.admit(req, credentials())).toThrow(/admitted before/);
	});

	it('answers a request with neither admitted credentials nor a token with M5’s 401', async () => {
		const { base } = await gateway(() => undefined);
		const sent = await post(`${base}/rpc`, rpc('todo-list'));
		expect(sent.status).toBe(401);
		expect(sent.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${METADATA}"`);
		expect(seen).toEqual([]);
	});

	it('decides after routing when the host runs no decision before dispatch', async () => {
		const { base } = await gateway(() => credentials({ scopes: [] }), { check: false });
		const sent = await post(`${base}/rpc`, rpc('todo-list'));
		expect(sent.status).toBe(200);
		expect(JSON.parse(sent.text).result).toMatchObject({
			success: false,
			error: { code: 'INSUFFICIENT_SCOPE', details: { scopes: ['todo:read'] } },
		});
		expect(seen).toEqual([]);
	});
});

interface ChallengeCase {
	status: number;
	resource: string;
	missing?: string[];
	header: string;
	body: unknown;
}

const challengeCases = (
	JSON.parse(
		readFileSync(new URL('../../../spec/authorization.json', import.meta.url), 'utf8')
	) as { challenges: ChallengeCase[] }
).challenges.filter((entry) => entry.status === 403);

describe('P3-E9: M6, the decision before dispatch of a host’s own layer', () => {
	it.each(challengeCases)(
		'gives spec/authorization.json’s 403 when $missing are missing',
		async (entry) => {
			expect(entry.resource).toBe(RESOURCE);
			const { base } = await gateway(() => credentials({ scopes: [] }));
			const sent = await post(`${base}/rpc`, rpc('todo-purge'));
			expect(sent.status).toBe(403);
			expect(sent.headers.get('www-authenticate')).toBe(entry.header);
			expect(JSON.parse(sent.text)).toEqual(entry.body);
		}
	);

	it('answers every request as the bearer layer does after admitting the same credentials', async () => {
		const host = (await gateway(() => credentials({ scopes: ['todo:read'] }))).base;
		const bearer = await bearerServer();
		const token = await as.issue({ claims: { scope: 'todo:read' } });
		const requests: [string, unknown][] = [
			['/rpc', rpc('todo-purge')],
			['/rpc', rpc('todo-list')],
			['/batch', { commands: [{ command: 'todo-purge', input: {} }] }],
			['/stream/todo-purge', {}],
			['/message', [rpc('ping')]],
			['/rpc', '{not json'],
		];
		for (const [path, body] of requests) {
			const fromHost = shape(await post(`${host}${path}`, body));
			const fromBearer = shape(
				await post(`${bearer}${path}`, body, { Authorization: `Bearer ${token}` })
			);
			expect(fromHost, path).toEqual(fromBearer);
		}
	});

	it('answers a body over the cap with the bearer layer’s 413', async () => {
		const handler = createMcpHandler({ ...handlerOptions(), maxBodyBytes: 64 });
		cleanups.push(async () => handler.dispose());
		const check = handler.preDispatchCheck();
		expect(check.maxBodyBytes).toBe(64);
		const req = {
			method: 'POST',
			url: '/rpc',
			headers: { 'content-type': 'application/json' },
			rawHeaders: [],
			socket: {},
		} as unknown as IncomingMessage;
		const decided = check.decide(req, 'x'.repeat(65));
		expect(decided).toMatchObject({ proceed: false, status: 413 });
		const bearer = await listen((r, s) => handler(r, s));
		const sent = await post(`${bearer}/rpc`, `{"pad":"${'x'.repeat(80)}"}`, {
			Authorization: `Bearer ${await as.issue()}`,
		});
		expect(decided.proceed === false && decided.body).toBe(sent.text);
		expect(sent.status).toBe(413);
	});

	it('spells a 403 in the host’s own scheme and names what its callers obtain', async () => {
		const { base } = await gateway(() => credentials({ scopes: [] }), {
			check: {
				challenge: new ScopeChallenge('Gateway', { realm: 'todo' }),
				scopeSource: 'a new assertion from the gateway',
			},
		});
		const sent = await post(`${base}/rpc`, rpc('todo-purge'));
		expect(sent.status).toBe(403);
		expect(sent.headers.get('www-authenticate')).toBe(
			'Gateway realm="todo", error="insufficient_scope", scope="todo:write todo:admin"'
		);
		expect(JSON.parse(sent.text)).toEqual({
			error: 'INSUFFICIENT_SCOPE',
			suggestion:
				'Obtain a new assertion from the gateway that also grants todo:write todo:admin, then retry.',
		});
	});

	it('proceeds for a method other than POST, and for a request it admitted nothing for', async () => {
		const handler = createMcpHandler(handlerOptions());
		cleanups.push(async () => handler.dispose());
		const check = handler.preDispatchCheck();
		const get = {
			method: 'GET',
			url: '/rpc',
			headers: {},
			rawHeaders: [],
			socket: {},
		} as unknown as IncomingMessage;
		expect(check.decide(get, '')).toEqual({ proceed: true });
		const post = {
			method: 'POST',
			url: '/rpc',
			headers: { 'content-type': 'application/json' },
			rawHeaders: [],
			socket: {},
		} as unknown as IncomingMessage;
		expect(check.decide(post, JSON.stringify(rpc('todo-purge')))).toEqual({ proceed: true });
	});
});
