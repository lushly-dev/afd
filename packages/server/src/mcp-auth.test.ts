/**
 * @fileoverview MCP authorization end to end (`spec/authorization.md`, M1, M2, M4, M5 and M7):
 * `createMcpHandler({ auth })` on loopback HTTP, tokens from the test authorization server.
 * Every route needs the one bearer token; the metadata is public; refusals are M5's exact 401;
 * commands see frozen, branded `credentials` and never the token, and the brand ends with the
 * request.
 */

import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type CommandContext, MemoryJournalSink, success } from '@lushly-dev/afd-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
	startTestAuthorizationServer,
	type TestAuthorizationServer,
} from '../test-support/authorization-server.js';
import { createJournalMiddleware } from './journal.js';
import type { AuthRefusal } from './mcp-auth.js';
import { JwtVerifier, jwksKeySource, type TokenVerifier } from './mcp-auth-jwt.js';
import type { Credentials } from './mcp-auth-rules.js';
import { defineCommand } from './schema.js';
import { createMcpHandler, createMcpServer } from './server.js';
import type { McpHandlerOptions } from './server-types.js';
import { isVerifiedCredentials } from './verified-credentials.js';

const RESOURCE = 'https://mcp.test.example/mcp';
const METADATA = 'https://mcp.test.example/.well-known/oauth-protected-resource/mcp';
const CHALLENGE = `Bearer resource_metadata="${METADATA}", scope="todo:read"`;
const BODY = {
	error: 'UNAUTHORIZED',
	suggestion: `Obtain a token for ${RESOURCE} from an authorization server named in ${METADATA}.`,
};

let as: TestAuthorizationServer;
beforeAll(async () => {
	as = await startTestAuthorizationServer({ resource: RESOURCE });
});
afterAll(() => as.close());

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** Every context a command ran with, and what `createContext` saw. */
const seen: CommandContext[] = [];
const hooked: {
	authorization: unknown;
	distinct: unknown;
	raw: string[];
	credentials: unknown;
}[] = [];

const whoami = defineCommand({
	name: 'caller-get',
	description: 'Who is calling',
	expose: { mcp: true },
	input: z.object({}),
	handler: async (_input, context) => {
		if (context) seen.push(context);
		return success({
			actor: context?.actor ?? null,
			verified: isVerifiedCredentials(context?.credentials),
			frozen: Object.isFrozen(context?.credentials),
		});
	},
});

function verifier(): TokenVerifier {
	return new JwtVerifier({
		rules: { resource: RESOURCE },
		issuers: [
			{
				issuer: as.issuer,
				alias: 'test-as',
				algorithms: ['RS256', 'ES256', 'EdDSA'],
				keys: jwksKeySource(() => fetch(as.jwksUrl).then((response) => response.json())),
			},
		],
	});
}

async function serve(options: Partial<McpHandlerOptions> = {}, auth = {}) {
	seen.length = 0;
	hooked.length = 0;
	const refusals: AuthRefusal[] = [];
	const sink = new MemoryJournalSink();
	const handler = createMcpHandler({
		name: 'auth-test',
		version: '1',
		host: '127.0.0.1',
		commands: [whoami],
		middleware: [createJournalMiddleware(sink)],
		createContext: (req: IncomingMessage, verified) => {
			hooked.push({
				authorization: req.headers.authorization,
				distinct: req.headersDistinct.authorization,
				raw: [...req.rawHeaders],
				credentials: verified.credentials,
			});
			return {};
		},
		auth: {
			resource: RESOURCE,
			authorizationServers: [as.issuer],
			scopesSupported: ['todo:read'],
			verifier: verifier(),
			onRefusal: (refusal) => refusals.push(refusal),
			...auth,
		},
		...options,
	});
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, refusals, sink };
}

interface Sent {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	text: string;
}

/** One HTTP request; `authorization` may repeat the header. Stops reading an event stream. */
function send(
	url: string,
	options: {
		method?: string;
		authorization?: string | string[];
		body?: unknown;
		contentType?: string;
		headers?: Record<string, string>;
	} = {}
): Promise<Sent> {
	const body =
		options.body === undefined
			? undefined
			: typeof options.body === 'string'
				? options.body
				: JSON.stringify(options.body);
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			url,
			{
				method: options.method ?? (body === undefined ? 'GET' : 'POST'),
				headers: {
					...(body !== undefined
						? { 'Content-Type': options.contentType ?? 'application/json' }
						: {}),
					...(options.authorization !== undefined ? { Authorization: options.authorization } : {}),
					...options.headers,
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				const done = () =>
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						text: Buffer.concat(chunks).toString('utf8'),
					});
				if (
					res.headers['content-type']?.startsWith('text/event-stream') &&
					res.statusCode === 200
				) {
					res.once('data', (chunk: Buffer) => {
						chunks.push(chunk);
						req.destroy();
						done();
					});
					return;
				}
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', done);
			}
		);
		req.on('error', reject);
		req.end(body);
	});
}

const rpc = (method: string, params: unknown = {}) => ({ jsonrpc: '2.0', id: 1, method, params });
const MODERN_META = {
	'io.modelcontextprotocol/protocolVersion': '2026-07-28',
	'io.modelcontextprotocol/clientCapabilities': {},
	'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
};
const modernCall = {
	body: rpc('tools/call', { name: 'caller-get', arguments: {}, _meta: MODERN_META }),
	headers: {
		Accept: 'application/json, text/event-stream',
		'MCP-Protocol-Version': '2026-07-28',
		'Mcp-Method': 'tools/call',
		'Mcp-Name': 'caller-get',
	},
};

/** Each HTTP route that can reach a command, a tool list or a stream (M1), and two others. */
const ROUTES: {
	name: string;
	path: string;
	method: string;
	body?: unknown;
	headers?: Record<string, string>;
}[] = [
	{ name: '/mcp', path: '/mcp', method: 'POST', ...modernCall },
	{ name: '/sse', path: '/sse', method: 'GET' },
	{ name: '/message', path: '/message', method: 'POST', body: rpc('tools/list') },
	{ name: '/rpc', path: '/rpc', method: 'POST', body: rpc('caller-get') },
	{
		name: '/batch',
		path: '/batch',
		method: 'POST',
		body: { commands: [{ command: 'caller-get', input: {} }] },
	},
	{ name: '/stream', path: '/stream/caller-get', method: 'GET' },
	{ name: '/health', path: '/health', method: 'GET' },
	{ name: 'an unknown path', path: '/elsewhere', method: 'GET' },
];

function expectUnauthorized(sent: Sent, tokenSent: boolean) {
	expect(sent.status).toBe(401);
	expect(sent.headers['www-authenticate']).toBe(
		tokenSent ? `${CHALLENGE}, error="invalid_token"` : CHALLENGE
	);
	expect(sent.headers['content-type']).toBe('application/json');
	expect(JSON.parse(sent.text)).toEqual(BODY);
}

describe('P3-E9: M7: protected-resource metadata', () => {
	it('is served without a token at both well-known paths, by GET only', async () => {
		const { base } = await serve();
		const document = {
			resource: RESOURCE,
			authorization_servers: [as.issuer],
			scopes_supported: ['todo:read'],
			bearer_methods_supported: ['header'],
			tls_client_certificate_bound_access_tokens: false,
		};
		for (const path of [
			'/.well-known/oauth-protected-resource/mcp',
			'/.well-known/oauth-protected-resource',
		]) {
			const sent = await send(`${base}${path}`);
			expect(sent.status, path).toBe(200);
			expect(sent.headers['content-type']).toBe('application/json');
			expect(JSON.parse(sent.text)).toEqual(document);
			const post = await send(`${base}${path}`, { method: 'POST', body: {} });
			expect(post.status).toBe(405);
			expect(post.headers.allow).toBe('GET');
		}
	});
});

describe('P3-E9: M1, M2 and M5: every route needs the one bearer token', () => {
	it.each(ROUTES)(
		'$name: 401 without a token, and 401 invalid_token for a refused one',
		async (route) => {
			const { base, refusals } = await serve();
			const url = `${base}${route.path}`;
			const options = { method: route.method, body: route.body, headers: route.headers };
			expectUnauthorized(await send(url, options), false);
			expectUnauthorized(
				await send(url, { ...options, authorization: 'Bearer not.a.token' }),
				true
			);
			expect(refusals).toEqual([{ rule: 'no-token' }, { rule: 'unknown-issuer' }]);
			expect(seen).toEqual([]);
		}
	);

	it.each(ROUTES.filter((route) => route.name !== 'an unknown path'))(
		'$name: passes with a valid token',
		async (route) => {
			const { base } = await serve();
			const sent = await send(`${base}${route.path}`, {
				method: route.method,
				body: route.body,
				headers: route.headers,
				authorization: `Bearer ${await as.issue()}`,
			});
			expect(sent.status).toBe(200);
		}
	);

	it('refuses a token in the query, in a form body or in a second header, even beside a valid one', async () => {
		const { base, refusals } = await serve();
		const token = await as.issue();
		const authorization = `Bearer ${token}`;
		const body = rpc('caller-get');
		expectUnauthorized(
			await send(`${base}/rpc?access_token=${token}`, { body, authorization }),
			true
		);
		expectUnauthorized(
			await send(`${base}/rpc`, {
				body: `access_token=${token}`,
				contentType: 'application/x-www-form-urlencoded',
				authorization,
			}),
			true
		);
		expectUnauthorized(
			await send(`${base}/rpc`, { body, authorization: [authorization, authorization] }),
			true
		);
		expectUnauthorized(await send(`${base}/rpc`, { body, authorization: `Basic ${token}` }), true);
		expect(refusals.map((refusal) => refusal.rule)).toEqual([
			'token-location',
			'token-location',
			'token-location',
			'token-malformed',
		]);
		expect(seen).toEqual([]);
	});

	it('answers a form body that carries no token as the route would: JSON only', async () => {
		const { base } = await serve();
		const sent = await send(`${base}/rpc`, {
			body: 'a=1',
			contentType: 'application/x-www-form-urlencoded',
			authorization: `Bearer ${await as.issue()}`,
		});
		expect(sent.status).toBe(415);
		expect(seen).toEqual([]);
	});

	it('logs the rule code and issuer alias, never the token or a claim', async () => {
		const { base, refusals } = await serve();
		const token = await as.issue({ claims: { aud: 'https://other.example/mcp' } });
		expectUnauthorized(
			await send(`${base}/rpc`, { body: rpc('caller-get'), authorization: `Bearer ${token}` }),
			true
		);
		expect(refusals).toEqual([{ rule: 'audience', issuer: 'test-as' }]);
		expect(JSON.stringify(refusals)).not.toContain(token);
	});

	it('logs to console.warn by default', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const { base } = await serve({}, { onRefusal: undefined });
			await send(`${base}/rpc`, { body: rpc('caller-get'), authorization: 'Bearer abc' });
			expect(warn).toHaveBeenCalledWith(
				"[afd] refused a request's bearer token: rule=unknown-issuer issuer=-"
			);
		} finally {
			warn.mockRestore();
		}
	});

	it('fails closed when the verifier throws, or returns credentials that are not M4 credentials', async () => {
		const throwing: TokenVerifier = {
			verify: async () => {
				throw new Error('boom');
			},
		};
		const first = await serve({}, { verifier: throwing });
		expectUnauthorized(
			await send(`${first.base}/rpc`, { body: rpc('caller-get'), authorization: 'Bearer abc' }),
			true
		);
		expect(first.refusals).toEqual([{ rule: 'unavailable' }]);
		const sloppy: TokenVerifier = {
			verify: async () => ({
				ok: true,
				credentials: { issuer: 'x', subject: '', clientId: 'c' } as unknown as Credentials,
			}),
		};
		const second = await serve({}, { verifier: sloppy });
		expectUnauthorized(
			await send(`${second.base}/rpc`, { body: rpc('caller-get'), authorization: 'Bearer abc' }),
			true
		);
		expect(second.refusals).toEqual([{ rule: 'claims' }]);
		expect(seen).toEqual([]);
	});

	it('answers 15,000 inner spaces or tabs in the header with the M5 401, quickly', async () => {
		const { base, refusals } = await serve();
		for (const blank of [' ', '\t']) {
			const started = performance.now();
			const sent = await send(`${base}/rpc`, {
				body: rpc('caller-get'),
				authorization: `Bearer abc${blank.repeat(15_000)}def`,
			});
			expectUnauthorized(sent, true);
			// The whole round trip, loopback included; the parser alone is held to 20 ms.
			expect(performance.now() - started).toBeLessThan(1000);
		}
		expect(refusals.map((refusal) => refusal.rule)).toEqual(['token-malformed', 'token-malformed']);
	});

	it("holds a host verifier's credentials to the layer's own rules: binding and expiry", async () => {
		const now = Math.floor(Date.now() / 1000);
		const credentials = {
			issuer: as.issuer,
			subject: 'user-1',
			clientId: 'agent-1',
			scopes: [],
			resource: RESOURCE,
			issuedAt: now - 60,
			expiresAt: now + 600,
		};
		const answering = (answer: Partial<Credentials>): TokenVerifier => ({
			verify: async () => ({ ok: true, credentials: { ...credentials, ...answer } as Credentials }),
		});
		const cases: [Partial<Credentials>, Record<string, unknown>, string][] = [
			// A token bound to a certificate this request did not present.
			[{ cnf: { 'x5t#S256': 'thumb' } }, {}, 'binding'],
			// No binding where the layer requires one.
			[{}, { requireBoundTokens: true }, 'binding'],
			// Already expired: the host verifier allowed what M3 rule 8 refuses.
			[{ expiresAt: now - 1 }, {}, 'expired'],
		];
		for (const [answer, auth, rule] of cases) {
			const { base, refusals } = await serve({}, { verifier: answering(answer), ...auth });
			expectUnauthorized(
				await send(`${base}/rpc`, { body: rpc('caller-get'), authorization: 'Bearer abc' }),
				true
			);
			expect(refusals).toEqual([{ rule }]);
		}
		expect(seen).toEqual([]);
		const { base } = await serve({}, { verifier: answering({}) });
		const sent = await send(`${base}/rpc`, {
			body: rpc('caller-get'),
			authorization: 'Bearer abc',
		});
		expect(sent.status).toBe(200);
	});

	it("logs a host verifier's issuer only when it is a visible ASCII alias", async () => {
		const naming = (issuer: string): TokenVerifier => ({
			verify: async () => ({ ok: false, rule: 'inactive', issuer }),
		});
		const first = await serve({}, { verifier: naming('user@example.com\nforged line') });
		await send(`${first.base}/rpc`, { body: rpc('caller-get'), authorization: 'Bearer abc' });
		expect(first.refusals).toEqual([{ rule: 'inactive', issuer: 'host' }]);
		const second = await serve({}, { verifier: naming('idp') });
		await send(`${second.base}/rpc`, { body: rpc('caller-get'), authorization: 'Bearer abc' });
		expect(second.refusals).toEqual([{ rule: 'inactive', issuer: 'idp' }]);
	});

	it("passes a host verifier's own rule code to the log as a 401 invalid_token", async () => {
		const inner = verifier();
		// What a host's wrapper does: refuse more, never accept more.
		const host: TokenVerifier = {
			verify: async (token, request) => {
				const result = await inner.verify(token, request);
				return result.ok && result.credentials.subject.startsWith('agt_')
					? { ok: false, rule: 'AGENT_CANNOT_SIGN_IN', issuer: 'test-as' }
					: result;
			},
		};
		const { base, refusals } = await serve({}, { verifier: host });
		const token = await as.issue({ claims: { sub: 'agt_abc' } });
		expectUnauthorized(
			await send(`${base}/rpc`, { body: rpc('caller-get'), authorization: `Bearer ${token}` }),
			true
		);
		expect(refusals).toEqual([{ rule: 'AGENT_CANNOT_SIGN_IN', issuer: 'test-as' }]);
	});

	it('answers a CORS preflight without a token, and exposes WWW-Authenticate', async () => {
		const { base } = await serve({ cors: true, allowedOrigins: ['https://app.example'] });
		const preflight = await send(`${base}/mcp`, {
			method: 'OPTIONS',
			headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST' },
		});
		expect(preflight.status).toBe(204);
		const refused = await send(`${base}/rpc`, {
			body: rpc('caller-get'),
			headers: { Origin: 'https://app.example' },
		});
		expect(refused.headers['access-control-expose-headers']).toContain('WWW-Authenticate');
	});
});

describe('P3-E9: M4: credentials on the context, never the token', () => {
	const expected = (token: string) => {
		const [, payload] = token.split('.');
		const claims = JSON.parse(Buffer.from(payload as string, 'base64url').toString());
		return {
			issuer: as.issuer,
			subject: 'user-1',
			clientId: 'agent-1',
			scopes: ['todo:read'],
			resource: RESOURCE,
			expiresAt: claims.exp,
			issuedAt: claims.iat,
		};
	};

	it.each(ROUTES.filter((route) => ['/mcp', '/rpc', '/batch', '/stream'].includes(route.name)))(
		'$name: the command sees the verified credentials and the default actor',
		async (route) => {
			const { base } = await serve();
			const token = await as.issue();
			await send(`${base}${route.path}`, {
				method: route.method,
				body: route.body,
				headers: route.headers,
				authorization: `Bearer ${token}`,
			});
			expect(seen).toHaveLength(1);
			const context = seen[0] as CommandContext;
			expect(context.credentials).toEqual(expected(token));
			expect(context.actor).toEqual({ kind: 'agent', id: 'agent-1', onBehalfOf: 'user-1' });
		}
	);

	it('lets createContext map the actor from the credentials, never replace them', async () => {
		const { base } = await serve({
			createContext: (_req, { credentials }) => ({
				actor: {
					kind: 'agent',
					id: `mapped:${credentials?.clientId}`,
					onBehalfOf: credentials?.subject,
				},
				credentials: { issuer: 'forged', subject: 'admin', clientId: 'x' },
			}),
		});
		const token = await as.issue();
		await send(`${base}/rpc`, { body: rpc('caller-get'), authorization: `Bearer ${token}` });
		const context = seen[0] as CommandContext;
		expect(context.actor).toEqual({ kind: 'agent', id: 'mapped:agent-1', onBehalfOf: 'user-1' });
		expect(context.credentials).toEqual(expected(token));
	});

	it('removes the Authorization header before createContext, and no context or journal entry holds the token', async () => {
		const { base, sink } = await serve();
		const token = await as.issue();
		for (const route of ROUTES.filter((r) =>
			['/mcp', '/rpc', '/batch', '/stream'].includes(r.name)
		)) {
			await send(`${base}${route.path}`, {
				method: route.method,
				body: route.body,
				headers: route.headers,
				authorization: `Bearer ${token}`,
			});
		}
		expect(seen).toHaveLength(4);
		for (const call of hooked) {
			expect(call.authorization).toBeUndefined();
			expect(call.distinct).toBeUndefined();
			expect(call.raw.join('\n')).not.toContain(token);
			expect(call.raw.map((name) => name.toLowerCase())).not.toContain('authorization');
		}
		const signature = token.split('.')[2] as string;
		for (const context of seen) {
			const shown = JSON.stringify(context, (_key, value) =>
				value instanceof AbortSignal ? '[signal]' : value
			);
			expect(shown).not.toContain(token);
			expect(shown).not.toContain(signature);
		}
		const entries = await sink.read();
		expect(entries).toHaveLength(4);
		const journal = JSON.stringify(entries);
		expect(journal).not.toContain(token);
		expect(journal).not.toContain(signature);
		expect(journal).not.toContain('credentials');
		expect(journal).not.toContain(as.issuer);
	});

	it('runs a real MCP client through the token: credentials reach the command over /mcp', async () => {
		const { base } = await serve();
		const token = await as.issue({ alg: 'EdDSA' });
		const client = new Client({ name: 'auth-client', version: '0' });
		await client.connect(
			new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
				requestInit: { headers: { Authorization: `Bearer ${token}` } },
			})
		);
		try {
			const result = await client.callTool({ name: 'caller-get', arguments: {} });
			expect(JSON.stringify(result)).toContain('"verified":true');
			expect((seen.at(-1) as CommandContext).credentials).toEqual(expected(token));
		} finally {
			await client.close();
		}
	});
});

describe('P3-E9: the brand: credentials afd-server verified, for one request', () => {
	it('are frozen and pass isVerifiedCredentials while the request runs, and stop when it ends', async () => {
		const { base } = await serve();
		const sent = await send(`${base}/rpc`, {
			body: rpc('caller-get'),
			authorization: `Bearer ${await as.issue()}`,
		});
		expect(JSON.parse(sent.text).result).toMatchObject({
			success: true,
			data: { verified: true, frozen: true },
		});
		const credentials = (seen[0] as CommandContext).credentials as Credentials;
		expect(Object.isFrozen(credentials.scopes)).toBe(true);
		await vi.waitFor(() => expect(isVerifiedCredentials(credentials)).toBe(false));
	});

	it('a copy, or credentials createContext builds, are never branded', async () => {
		const { base } = await serve();
		await send(`${base}/rpc`, {
			body: rpc('caller-get'),
			authorization: `Bearer ${await as.issue()}`,
		});
		expect(isVerifiedCredentials({ ...((seen[0] as CommandContext).credentials as object) })).toBe(
			false
		);
		const plain = createMcpHandler({
			name: 'no-auth',
			version: '1',
			host: '127.0.0.1',
			commands: [whoami],
			createContext: () => ({
				credentials: { issuer: 'i', subject: 's', clientId: 'c', expiresAt: 4e9 },
			}),
		});
		const server = createServer(plain);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		cleanups.push(async () => {
			plain.dispose();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		});
		const sent = await send(`http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`, {
			body: rpc('caller-get'),
		});
		expect(JSON.parse(sent.text).result.data).toMatchObject({ verified: false });
	});
});

describe('P3-E9: HTTP sessions belong to the caller that created them', () => {
	it("answers another principal's use of a session as an unknown session, and leaves it unchanged", async () => {
		const { base } = await serve({ contexts: [{ name: 'edit', description: 'Editing' }] });
		const alice = `Bearer ${await as.issue()}`;
		const mallory = `Bearer ${await as.issue({ claims: { sub: 'user-2' } })}`;
		const opened = await send(`${base}/message`, {
			body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
			authorization: alice,
		});
		const session = opened.headers['mcp-session-id'] as string;
		expect(session).toMatch(/^[0-9a-f-]{36}$/);
		const call = (authorization: string, method: string, params = {}) =>
			send(`${base}/rpc`, {
				body: rpc(method, params),
				authorization,
				headers: { 'Mcp-Session-Id': session },
			});
		expect(
			JSON.parse((await call(alice, 'afd-context-enter', { context: 'edit' })).text)
		).toMatchObject({
			result: { success: true },
		});
		for (const path of ['/rpc', '/message', '/batch']) {
			const body =
				path === '/batch'
					? { commands: [{ command: 'afd-context-exit', input: {} }] }
					: path === '/message'
						? { jsonrpc: '2.0', id: 1, method: 'tools/list' }
						: rpc('afd-context-exit');
			const ask = (id: string) =>
				send(`${base}${path}`, { body, authorization: mallory, headers: { 'Mcp-Session-Id': id } });
			const unknown = await ask('00000000-0000-4000-8000-000000000000');
			const refused = await ask(session);
			expect(unknown.status, path).toBe(404);
			expect(refused.status, path).toBe(unknown.status);
			expect(refused.text, path).toBe(unknown.text);
		}
		const listed = JSON.parse((await call(alice, 'afd-context-list')).text);
		expect(listed.result.data.activeContext).toBe('edit');
	});
});

describe('P3-E9: configuration fails closed', () => {
	const base = () => ({
		name: 'cfg',
		version: '1',
		commands: [whoami],
	});

	it('refuses a verifier that accepts an issuer the metadata does not name', () => {
		expect(() =>
			createMcpHandler({
				...base(),
				auth: {
					resource: RESOURCE,
					authorizationServers: ['https://elsewhere.example'],
					verifier: verifier(),
				},
			})
		).toThrow(/does not name/);
	});

	it('refuses a verifier whose audience is another resource', () => {
		expect(() =>
			createMcpHandler({
				...base(),
				auth: {
					resource: 'https://elsewhere.example/mcp',
					authorizationServers: [as.issuer],
					verifier: verifier(),
				},
			})
		).toThrow(/audience/);
	});

	it('refuses scope options that are not scope tokens, a boolean or a resolver (M6)', () => {
		const auth = { resource: RESOURCE, authorizationServers: [as.issuer], verifier: verifier() };
		const make =
			(extra: Record<string, unknown>, commands = [whoami]) =>
			() =>
				createMcpHandler({ ...base(), commands, auth: { ...auth, ...extra } as never });
		expect(make({ requiredScopes: ['todo read'] })).toThrow(/not an OAuth scope token/);
		expect(make({ requiredScopes: 'todo:read' })).toThrow(/array of scope tokens/);
		expect(make({ filterToolsByScope: 'yes' })).toThrow(/filterToolsByScope must be a boolean/);
		expect(make({ resolver: { resolve: () => 'allowed' } })).toThrow(/resolve\(\) and visible\(\)/);
		const badScope = defineCommand({
			name: 'caller-write',
			description: 'Write',
			expose: { mcp: true },
			scopes: ['bad scope'],
			input: z.object({}),
			handler: async () => success({}),
		});
		expect(make({}, [whoami, badScope] as never)).toThrow(/caller-write/);
		expect(make({ requiredScopes: ['todo:read'], filterToolsByScope: true })).not.toThrow();
	});

	it('refuses a missing verifier, an http resource and no authorization server', () => {
		const auth = { resource: RESOURCE, authorizationServers: [as.issuer], verifier: verifier() };
		expect(() =>
			createMcpHandler({ ...base(), auth: { ...auth, verifier: undefined } as never })
		).toThrow(/verifier/);
		expect(() =>
			createMcpHandler({
				...base(),
				auth: {
					...auth,
					resource: 'http://mcp.test.example/mcp',
					verifier: { verify: auth.verifier.verify },
				},
			})
		).toThrow(/https/);
		expect(() =>
			createMcpHandler({ ...base(), auth: { ...auth, authorizationServers: [] } })
		).toThrow(/at least one/);
	});

	it('leaves in-process calls unaffected (M1)', async () => {
		const server = createMcpServer({
			...base(),
			transport: 'http',
			auth: { resource: RESOURCE, authorizationServers: [as.issuer], verifier: verifier() },
		});
		const result = await server.execute('caller-get', {});
		expect(result).toMatchObject({ success: true, data: { verified: false } });
	});
});
