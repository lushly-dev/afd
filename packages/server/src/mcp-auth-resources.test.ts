/**
 * @fileoverview Per-caller `ResourceProvider` under MCP authorization (`spec/authorization.md`,
 * M6, "Other methods"; `spec/mcp-resources.md`, R3/R4; #2265).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { InMemoryTransport, ProtocolErrorCode, Server } from '@modelcontextprotocol/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
	startTestAuthorizationServer,
	type TestAuthorizationServer,
} from '../test-support/authorization-server.js';
import { JwtVerifier, jwksKeySource } from './mcp-auth-jwt.js';
import type { Credentials } from './mcp-auth-rules.js';
import { serveModernStdio } from './mcp-modern.js';
import {
	createResourceService,
	type ResourceCaller,
	type ResourceEntry,
	type ResourceProvider,
	resourceCacheHints,
} from './resources.js';
import { defineCommand } from './schema.js';
import type { ScopeView } from './scope-view.js';
import { createMcpHandler } from './server.js';
import type { McpHandlerOptions } from './server-types.js';
import { SkillCatalog } from './skills.js';
import { isVerifiedCredentials } from './verified-credentials.js';

const RESOURCE = 'https://docs.example.com/mcp';
const MODERN = '2026-07-28';
const LEGACY = '2025-11-25';
const META = {
	'io.modelcontextprotocol/protocolVersion': MODERN,
	'io.modelcontextprotocol/clientCapabilities': {},
	'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
};
const SKILL_URI = 'skill://demo/SKILL.md';
const SKILL_CATALOG = new SkillCatalog(
	[
		{
			path: 'demo',
			files: {
				'SKILL.md': '---\nname: demo\ndescription: Demo skill\n---\nBody\n',
			},
		},
	],
	{ directoryRead: true }
);

const ping = defineCommand({
	name: 'ping-echo',
	description: 'Ping',
	expose: { mcp: true },
	input: z.object({}),
	handler: async () => success({ ok: true }),
});

let as: TestAuthorizationServer;
beforeAll(async () => {
	as = await startTestAuthorizationServer({ resource: RESOURCE });
});
afterAll(() => as.close());

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

interface RpcResponse {
	status: number;
	body: {
		result?: Record<string, unknown>;
		error?: { code?: number; message?: string; data?: Record<string, unknown> };
	};
}

function listUris(res: RpcResponse): string[] {
	const resources = (res.body.result?.resources ?? []) as Array<{ uri: string }>;
	return resources.map((r) => r.uri);
}

function firstText(res: RpcResponse): string | undefined {
	const contents = (res.body.result?.contents ?? []) as Array<{ text?: string }>;
	return contents[0]?.text;
}

function authOptions(extra: Record<string, unknown> = {}) {
	return {
		resource: RESOURCE,
		authorizationServers: [as.issuer],
		verifier: new JwtVerifier({
			rules: { resource: RESOURCE },
			issuers: [{ issuer: as.issuer, algorithms: ['RS256'], keys: jwksKeySource(as.jwks()) }],
		}),
		onRefusal: () => {},
		...extra,
	};
}

function makeCredentials(scopes: string[], subject = 'user-1'): Credentials {
	const now = Math.floor(Date.now() / 1000);
	return {
		issuer: as.issuer,
		subject,
		clientId: 'gateway-client',
		scopes,
		resource: RESOURCE,
		issuedAt: now - 10,
		expiresAt: now + 600,
	};
}

async function listenHandler(
	options: Partial<McpHandlerOptions>,
	wrap?: (
		handler: ReturnType<typeof createMcpHandler>
	) => (req: IncomingMessage, res: ServerResponse) => Promise<void>
): Promise<string> {
	const handler = createMcpHandler({
		name: 'resources-auth-test',
		version: '1.0.0',
		host: '127.0.0.1',
		commands: [ping],
		...options,
	});
	const serve = wrap ? wrap(handler) : handler;
	const server = createServer((req, res) => {
		serve(req, res).catch((error: Error) => {
			if (!res.headersSent) res.writeHead(500);
			res.end(error.message);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

async function postModern(
	url: string,
	method: string,
	params: Record<string, unknown> = {},
	options: { token?: string; mcpName?: string; headers?: Record<string, string> } = {}
): Promise<RpcResponse> {
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			'MCP-Protocol-Version': MODERN,
			'Mcp-Method': method,
			...(options.mcpName ? { 'Mcp-Name': options.mcpName } : {}),
			...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
			...options.headers,
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method,
			params: { ...params, _meta: META },
		}),
	});
	const text = await res.text();
	const line = /^data: (.*)$/m.exec(text)?.[1] ?? text;
	return { status: res.status, body: JSON.parse(line) };
}

async function postLegacy(
	url: string,
	method: string,
	params: Record<string, unknown> = {},
	options: { token?: string; headers?: Record<string, string> } = {}
): Promise<RpcResponse> {
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			'MCP-Protocol-Version': LEGACY,
			...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
			...options.headers,
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});
	const text = await res.text();
	const line = /^data: (.*)$/m.exec(text)?.[1] ?? text;
	return { status: res.status, body: JSON.parse(line) };
}

function gatedProvider(observed?: {
	callers: Array<{
		op: 'list' | 'read';
		caller: ResourceCaller | undefined;
		callerFrozen: boolean;
		credsFrozen: boolean;
		verified: boolean;
	}>;
}): ResourceProvider {
	const hasDocsRead = (caller?: ResourceCaller) =>
		caller?.credentials?.scopes.includes('docs:read') === true;
	const record = (op: 'list' | 'read', caller: ResourceCaller | undefined) => {
		if (!observed) return;
		observed.callers.push({
			op,
			caller,
			callerFrozen: caller !== undefined && Object.isFrozen(caller),
			credsFrozen: caller?.credentials !== undefined && Object.isFrozen(caller.credentials),
			verified: isVerifiedCredentials(caller?.credentials),
		});
	};
	return {
		list(caller) {
			record('list', caller);
			if (!hasDocsRead(caller)) return [];
			return [
				{ uri: 'file:///secret.txt', name: 'secret', mimeType: 'text/plain' },
				{
					uri: 'file:///inline.txt',
					name: 'inline',
					mimeType: 'text/plain',
					content: 'inline secret',
				},
			];
		},
		read(uri, caller) {
			record('read', caller);
			if (!hasDocsRead(caller)) return undefined;
			if (uri === 'file:///secret.txt') return { content: 'the secret' };
			if (uri === 'file:///unlisted.txt')
				return { content: 'unlisted secret', mimeType: 'text/plain' };
			return undefined;
		},
	};
}

describe('per-caller ResourceProvider under MCP authorization', () => {
	it.each(['modern', 'legacy'] as const)(
		'filters resources/list and resources/read per caller with -32602 parity (%s)',
		async (era) => {
			const observed = {
				callers: [] as Array<{
					op: 'list' | 'read';
					caller: ResourceCaller | undefined;
					callerFrozen: boolean;
					credsFrozen: boolean;
					verified: boolean;
				}>,
			};
			const url = await listenHandler({
				auth: authOptions(),
				resources: gatedProvider(observed),
				toolsListTtlMs: 12_345,
			});
			// Startup check called list() once with no caller.
			expect(observed.callers).toHaveLength(1);
			expect(observed.callers[0]?.caller).toBeUndefined();
			observed.callers.length = 0;

			const reader = await as.issue({ claims: { scope: 'docs:read', sub: 'alice' } });
			const other = await as.issue({ claims: { scope: 'todo:read', sub: 'bob' } });

			const send = (
				method: string,
				params: Record<string, unknown>,
				token: string,
				mcpName?: string
			) =>
				era === 'modern'
					? postModern(url, method, params, { token, mcpName })
					: postLegacy(url, method, params, { token });

			// Authorized caller sees both entries.
			const readerList = await send('resources/list', {}, reader);
			expect(readerList.status).toBe(200);
			expect(listUris(readerList)).toEqual(['file:///secret.txt', 'file:///inline.txt']);

			// Unauthorized caller sees empty list.
			const otherList = await send('resources/list', {}, other);
			expect(otherList.status).toBe(200);
			expect(otherList.body.result?.resources).toEqual([]);

			// Authorized caller reads read()-backed, inline-content, and unlisted URIs.
			const secretRead = await send(
				'resources/read',
				{ uri: 'file:///secret.txt' },
				reader,
				'file:///secret.txt'
			);
			expect(secretRead.status).toBe(200);
			expect(firstText(secretRead)).toBe('the secret');

			const inlineRead = await send(
				'resources/read',
				{ uri: 'file:///inline.txt' },
				reader,
				'file:///inline.txt'
			);
			expect(inlineRead.status).toBe(200);
			expect(firstText(inlineRead)).toBe('inline secret');

			const unlistedRead = await send(
				'resources/read',
				{ uri: 'file:///unlisted.txt' },
				reader,
				'file:///unlisted.txt'
			);
			expect(unlistedRead.status).toBe(200);
			expect(firstText(unlistedRead)).toBe('unlisted secret');

			// Unauthorized caller gets -32602 identical to an absent URI for every gated resource.
			const absent = await send(
				'resources/read',
				{ uri: 'file:///absent.txt' },
				other,
				'file:///absent.txt'
			);
			expect(absent.body.error).toEqual({
				code: -32602,
				message: 'Resource not found',
				data: { uri: 'file:///absent.txt' },
			});
			for (const uri of ['file:///secret.txt', 'file:///inline.txt', 'file:///unlisted.txt']) {
				const denied = await send('resources/read', { uri }, other, uri);
				expect(denied.body.error).toEqual({
					code: absent.body.error?.code,
					message: absent.body.error?.message,
					data: { uri },
				});
			}

			// Every request invocation saw a frozen caller and frozen, branded verified credentials.
			expect(observed.callers.length).toBeGreaterThan(0);
			for (const entry of observed.callers) {
				expect(entry.callerFrozen).toBe(true);
				expect(entry.credsFrozen).toBe(true);
				expect(entry.verified).toBe(true);
			}
			// After responses have closed, credentials are no longer branded as verified.
			await new Promise((resolve) => setTimeout(resolve, 10));
			for (const entry of observed.callers) {
				expect(isVerifiedCredentials(entry.caller?.credentials)).toBe(false);
			}

			// Cache hints: modern carries ttlMs and cacheScope: "private"; legacy omits both.
			if (era === 'modern') {
				expect(readerList.body.result).toMatchObject({ ttlMs: 12_345, cacheScope: 'private' });
				expect(otherList.body.result).toMatchObject({ ttlMs: 12_345, cacheScope: 'private' });
				expect(secretRead.body.result).toMatchObject({ ttlMs: 12_345, cacheScope: 'private' });
				expect(inlineRead.body.result).toMatchObject({ ttlMs: 12_345, cacheScope: 'private' });
				expect(unlistedRead.body.result).toMatchObject({ ttlMs: 12_345, cacheScope: 'private' });
			} else {
				expect(readerList.body.result?.cacheScope).toBeUndefined();
				expect(readerList.body.result?.ttlMs).toBeUndefined();
				expect(secretRead.body.result?.cacheScope).toBeUndefined();
				expect(secretRead.body.result?.ttlMs).toBeUndefined();
			}
		}
	);

	it.each(['modern', 'legacy'] as const)(
		'forwards verified credentials on host-admitted requests (%s)',
		async (era) => {
			const seenSubjects: string[] = [];
			const url = await listenHandler(
				{
					auth: authOptions(),
					resources: {
						list(caller) {
							if (caller?.credentials) {
								expect(isVerifiedCredentials(caller.credentials)).toBe(true);
								expect(Object.isFrozen(caller.credentials)).toBe(true);
								seenSubjects.push(caller.credentials.subject);
							}
							return caller?.credentials?.scopes.includes('docs:read')
								? [{ uri: 'file:///host-secret.txt', name: 'host-secret' }]
								: [];
						},
						read(uri, caller) {
							if (
								uri === 'file:///host-secret.txt' &&
								caller?.credentials?.scopes.includes('docs:read')
							) {
								return { content: `for ${caller.credentials.subject}` };
							}
							return undefined;
						},
					},
				},
				(handler) => {
					const pre = handler.preDispatchCheck();
					return async (req, res) => {
						const role = req.headers['x-test-role'];
						const creds =
							role === 'reader'
								? makeCredentials(['docs:read'], 'host-alice')
								: makeCredentials(['todo:read'], 'host-bob');
						handler.admit(req, creds);
						const chunks: Buffer[] = [];
						for await (const chunk of req) chunks.push(chunk as Buffer);
						const body = Buffer.concat(chunks);
						const decision = pre.decide(req, body);
						if (!decision.proceed) {
							res.writeHead(decision.status, decision.headers);
							res.end(decision.body);
							return;
						}
						await handler(req, res, body);
					};
				}
			);

			const send = (
				method: string,
				params: Record<string, unknown>,
				role: string,
				mcpName?: string
			) =>
				era === 'modern'
					? postModern(url, method, params, { mcpName, headers: { 'x-test-role': role } })
					: postLegacy(url, method, params, { headers: { 'x-test-role': role } });

			const allowedList = await send('resources/list', {}, 'reader');
			expect(allowedList.body.result?.resources).toHaveLength(1);
			const deniedList = await send('resources/list', {}, 'other');
			expect(deniedList.body.result?.resources).toEqual([]);

			const allowedRead = await send(
				'resources/read',
				{ uri: 'file:///host-secret.txt' },
				'reader',
				'file:///host-secret.txt'
			);
			expect(firstText(allowedRead)).toBe('for host-alice');

			const deniedRead = await send(
				'resources/read',
				{ uri: 'file:///host-secret.txt' },
				'other',
				'file:///host-secret.txt'
			);
			expect(deniedRead.body.error).toEqual({
				code: -32602,
				message: 'Resource not found',
				data: { uri: 'file:///host-secret.txt' },
			});
			expect(seenSubjects).toContain('host-alice');
			expect(seenSubjects).toContain('host-bob');

			if (era === 'modern') {
				expect(allowedList.body.result?.cacheScope).toBe('private');
				expect(deniedList.body.result?.cacheScope).toBe('private');
				expect(allowedRead.body.result?.cacheScope).toBe('private');
			} else {
				expect(allowedList.body.result?.cacheScope).toBeUndefined();
				expect(allowedRead.body.result?.cacheScope).toBeUndefined();
			}
		}
	);
});

describe('cacheScope matrix (R3 / R4)', () => {
	it('marks provider responses private while keeping SkillCatalog reads and skills/* public', async () => {
		const url = await listenHandler({
			auth: authOptions(),
			resources: gatedProvider(),
			skills: SKILL_CATALOG,
		});
		const reader = await as.issue({ claims: { scope: 'docs:read' } });
		const other = await as.issue({ claims: { scope: 'todo:read' } });

		// Combined resources/list includes a ResourceProvider on an authorized server -> private.
		const readerList = await postModern(url, 'resources/list', {}, { token: reader });
		expect(readerList.body.result?.cacheScope).toBe('private');
		expect(listUris(readerList)).toEqual(['file:///secret.txt', 'file:///inline.txt', SKILL_URI]);

		// Even when the provider returns no entries for a caller, the list stays private.
		const otherList = await postModern(url, 'resources/list', {}, { token: other });
		expect(otherList.body.result?.cacheScope).toBe('private');
		expect(listUris(otherList)).toEqual([SKILL_URI]);

		// Provider read -> private.
		const providerRead = await postModern(
			url,
			'resources/read',
			{ uri: 'file:///secret.txt' },
			{ token: reader, mcpName: 'file:///secret.txt' }
		);
		expect(providerRead.body.result?.cacheScope).toBe('private');

		// Static SkillCatalog read -> public.
		const skillRead = await postModern(
			url,
			'resources/read',
			{ uri: SKILL_URI },
			{ token: reader, mcpName: SKILL_URI }
		);
		expect(skillRead.status).toBe(200);
		expect(skillRead.body.result?.cacheScope).toBe('public');

		// Templates and Skills extension methods stay public.
		const templates = await postModern(url, 'resources/templates/list', {}, { token: reader });
		expect(templates.body.result?.cacheScope).toBe('public');
		const skillsList = await postModern(url, 'skills/list', {}, { token: reader });
		expect(skillsList.body.result?.cacheScope).toBe('public');
		const skillGet = await postModern(url, 'skills/get', { uri: SKILL_URI }, { token: reader });
		expect(skillGet.body.result?.cacheScope).toBe('public');
		const dirRead = await postModern(
			url,
			'resources/directory/read',
			{ uri: 'skill://demo' },
			{ token: reader }
		);
		expect(dirRead.body.result?.cacheScope).toBe('public');
	});

	it('fails safe to private for static ResourceEntry[] on an authorized server', async () => {
		const staticEntries: ResourceEntry[] = [
			{ uri: 'file:///static.txt', name: 'static', content: 'static body' },
		];
		const url = await listenHandler({
			auth: authOptions(),
			resources: staticEntries,
		});
		const token = await as.issue({ claims: { scope: 'docs:read' } });
		const listed = await postModern(url, 'resources/list', {}, { token });
		expect(listed.body.result?.cacheScope).toBe('private');
		const read = await postModern(
			url,
			'resources/read',
			{ uri: 'file:///static.txt' },
			{ token, mcpName: 'file:///static.txt' }
		);
		expect(read.body.result?.cacheScope).toBe('private');
	});

	it('keeps skills-only authorized servers public', async () => {
		const url = await listenHandler({
			auth: authOptions(),
			skills: SKILL_CATALOG,
		});
		const token = await as.issue({ claims: { scope: 'docs:read' } });
		const listed = await postModern(url, 'resources/list', {}, { token });
		expect(listed.body.result?.cacheScope).toBe('public');
		const read = await postModern(
			url,
			'resources/read',
			{ uri: SKILL_URI },
			{ token, mcpName: SKILL_URI }
		);
		expect(read.body.result?.cacheScope).toBe('public');
	});

	it('keeps unauthenticated servers with a ResourceProvider public and passes undefined credentials', async () => {
		const seen: Array<ResourceCaller | undefined> = [];
		const url = await listenHandler({
			resources: {
				list(caller) {
					seen.push(caller);
					return [{ uri: 'file:///open.txt', name: 'open', content: 'hello' }];
				},
			},
		});
		seen.length = 0;
		const listed = await postModern(url, 'resources/list');
		expect(listed.body.result?.cacheScope).toBe('public');
		const read = await postModern(
			url,
			'resources/read',
			{ uri: 'file:///open.txt' },
			{ mcpName: 'file:///open.txt' }
		);
		expect(read.body.result?.cacheScope).toBe('public');
		expect(seen).toHaveLength(2);
		for (const caller of seen) {
			expect(caller).toBeDefined();
			expect(caller?.credentials).toBeUndefined();
		}
	});

	it('preserves existing 0-arg list() and 1-arg read(uri) ResourceProvider implementations', async () => {
		const legacyProvider: ResourceProvider = {
			list: () => [{ uri: 'file:///legacy.txt', name: 'legacy' }],
			read: (uri: string) => (uri === 'file:///legacy.txt' ? { content: 'legacy ok' } : undefined),
		};
		const url = await listenHandler({
			auth: authOptions(),
			resources: legacyProvider,
		});
		const token = await as.issue({ claims: {} });
		const listed = await postModern(url, 'resources/list', {}, { token });
		expect(listed.body.result?.cacheScope).toBe('private');
		expect(listUris(listed)).toEqual(['file:///legacy.txt']);
		const read = await postModern(
			url,
			'resources/read',
			{ uri: 'file:///legacy.txt' },
			{ token, mcpName: 'file:///legacy.txt' }
		);
		expect(read.body.result?.cacheScope).toBe('private');
		expect(firstText(read)).toBe('legacy ok');
	});
});

describe('authorization enforcement and error handling on resources', () => {
	it('enforces requiredScopes before invoking the provider', async () => {
		const listSpy = vi.fn((_caller?: ResourceCaller) => [] as ResourceEntry[]);
		const readSpy = vi.fn((_uri: string, _caller?: ResourceCaller) => undefined);
		const url = await listenHandler({
			auth: authOptions({ requiredScopes: ['api:access'] }),
			resources: { list: listSpy, read: readSpy },
		});
		listSpy.mockClear();

		const token = await as.issue({ claims: { scope: 'docs:read' } });
		const res = await postModern(url, 'resources/list', {}, { token });
		expect(res.status).toBe(403);
		expect(listSpy).not.toHaveBeenCalled();

		const readRes = await postModern(
			url,
			'resources/read',
			{ uri: 'file:///secret.txt' },
			{ token, mcpName: 'file:///secret.txt' }
		);
		expect(readRes.status).toBe(403);
		expect(readSpy).not.toHaveBeenCalled();
	});

	it('enforces requiredScopes after routing when pre-dispatch was bypassed (host-admitted)', async () => {
		const listSpy = vi.fn((_caller?: ResourceCaller) => [
			{ uri: 'file:///secret.txt', name: 'secret', content: 'hidden' },
		]);
		const readSpy = vi.fn((_uri: string, _caller?: ResourceCaller) => ({ content: 'hidden' }));
		const url = await listenHandler(
			{
				auth: authOptions({ requiredScopes: ['api:access'] }),
				resources: { list: listSpy, read: readSpy },
			},
			(handler) => async (req, res) => {
				handler.admit(req, makeCredentials(['docs:read']));
				await handler(req, res);
			}
		);
		listSpy.mockClear();

		const listed = await postModern(url, 'resources/list');
		expect(listed.body.error?.code).toBe(ProtocolErrorCode.InvalidRequest);
		expect(listed.body.error?.data).toMatchObject({
			code: 'INSUFFICIENT_SCOPE',
			scopes: ['api:access'],
		});
		expect(listSpy).not.toHaveBeenCalled();

		const read = await postModern(
			url,
			'resources/read',
			{ uri: 'file:///secret.txt' },
			{ mcpName: 'file:///secret.txt' }
		);
		expect(read.body.error?.code).toBe(ProtocolErrorCode.InvalidRequest);
		expect(read.body.error?.data).toMatchObject({
			code: 'INSUFFICIENT_SCOPE',
			scopes: ['api:access'],
		});
		expect(listSpy).not.toHaveBeenCalled();
		expect(readSpy).not.toHaveBeenCalled();
	});

	it('keeps modern stdio unaffected by HTTP token admission while marking auth-configured provider responses private', async () => {
		const seen: Array<ResourceCaller | undefined> = [];
		const service = createResourceService(
			{
				list(caller) {
					seen.push(caller);
					return [{ uri: 'file:///stdio.txt', name: 'stdio', content: 'stdio ok' }];
				},
			},
			SKILL_CATALOG,
			7_500
		);
		if (!service) throw new Error('expected resource service');
		seen.length = 0;

		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const handle = serveModernStdio(
			{
				name: 'stdio-auth-test',
				version: '1.0.0',
				instructions: 'test',
				getToolsList: () => [],
				routeToolCall: async () => ({ content: [{ type: 'text', text: '{}' }], isError: false }),
				resources: service,
				resourcesTtlMs: 7_500,
				authConfigured: true,
				devMode: false,
			},
			undefined,
			serverTransport
		);
		cleanups.push(() => handle.close());

		const sendRaw = (method: string, params: Record<string, unknown> = {}) =>
			new Promise<Record<string, unknown>>((resolve) => {
				clientTransport.onmessage = (msg) => resolve(msg as unknown as Record<string, unknown>);
				void clientTransport.send({
					jsonrpc: '2.0',
					id: 1,
					method,
					params: { ...params, _meta: META },
				} as never);
			});

		const listed = await sendRaw('resources/list');
		expect(listed.error).toBeUndefined();
		expect((listed.result as { cacheScope?: string; ttlMs?: number })?.cacheScope).toBe('private');
		expect((listed.result as { ttlMs?: number })?.ttlMs).toBe(7_500);

		const providerRead = await sendRaw('resources/read', { uri: 'file:///stdio.txt' });
		expect(providerRead.error).toBeUndefined();
		expect((providerRead.result as { cacheScope?: string })?.cacheScope).toBe('private');

		const skillRead = await sendRaw('resources/read', { uri: SKILL_URI });
		expect(skillRead.error).toBeUndefined();
		expect((skillRead.result as { cacheScope?: string })?.cacheScope).toBe('public');

		expect(seen).toHaveLength(2);
		for (const caller of seen) {
			expect(caller).toBeDefined();
			expect(caller?.credentials).toBeUndefined();
		}
	});

	it('returns -32603 and reports onError when a per-caller list() returns invalid entries or read() throws', async () => {
		const errors: Error[] = [];
		const url = await listenHandler({
			auth: authOptions(),
			onError: (err) => errors.push(err),
			resources: {
				list(caller) {
					if (caller?.credentials?.subject === 'bad-entry') {
						return [{ uri: 'not a valid uri', name: 'bad' }];
					}
					return [{ uri: 'file:///boom.txt', name: 'boom' }];
				},
				read(uri, caller) {
					if (uri === 'file:///boom.txt' && caller?.credentials?.subject === 'throws') {
						throw new Error('secret backend stack');
					}
					return undefined;
				},
			},
		});

		const badListToken = await as.issue({ claims: { sub: 'bad-entry' } });
		const badList = await postModern(url, 'resources/list', {}, { token: badListToken });
		expect(badList.body.error?.code).toBe(-32603);
		expect(badList.body.error?.message).toBe('Internal error');

		const throwToken = await as.issue({ claims: { sub: 'throws' } });
		const badRead = await postModern(
			url,
			'resources/read',
			{ uri: 'file:///boom.txt' },
			{ token: throwToken, mcpName: 'file:///boom.txt' }
		);
		expect(badRead.body.error?.code).toBe(-32603);
		expect(badRead.body.error?.message).toBe('Internal error');
		expect(errors).toHaveLength(2);
	});

	it('fails closed when requireView is true and requestView returns undefined, and sets private when requestView carries credentials', async () => {
		const listSpy = vi.fn((caller?: ResourceCaller): ResourceEntry[] =>
			caller?.credentials ? [{ uri: 'file:///direct.txt', name: 'direct', content: 'secret' }] : []
		);
		const service = createResourceService({ list: listSpy }, SKILL_CATALOG, 5_000);
		if (!service) throw new Error('expected resource service');
		listSpy.mockClear();

		const makePair = async (serving: {
			authConfigured?: boolean;
			requireView?: boolean;
			requestView?: () => ScopeView | undefined;
		}) => {
			const server = new Server(
				{ name: 'unit', version: '1' },
				{
					capabilities: service.capabilities as never,
					cacheHints: resourceCacheHints(
						5_000,
						Boolean(serving.authConfigured && service.hasProvider)
					),
				}
			);
			service.install(server, {
				modern: true,
				internalError: (err) => new Error(String(err)) as never,
				...serving,
			});
			const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
			await server.connect(serverTransport);
			cleanups.push(() => server.close());
			const sendRaw = (method: string, params: Record<string, unknown> = {}) =>
				new Promise<Record<string, unknown>>((resolve) => {
					clientTransport.onmessage = (msg) => resolve(msg as unknown as Record<string, unknown>);
					void clientTransport.send({
						jsonrpc: '2.0',
						id: 1,
						method,
						params: { ...params, _meta: META },
					} as never);
				});
			return { sendRaw };
		};

		// 1. Fail-closed when requireView: true (HTTP with auth) and requestView returns undefined.
		const unauthenticated = await makePair({
			authConfigured: true,
			requireView: true,
			requestView: () => undefined,
		});
		const denied = await unauthenticated.sendRaw('resources/list');
		expect((denied.error as { code?: number; data?: { code?: string } })?.code).toBe(
			ProtocolErrorCode.InvalidRequest
		);
		expect((denied.error as { data?: { code?: string } })?.data?.code).toBe('UNAUTHORIZED');
		expect(listSpy).not.toHaveBeenCalled();

		// 2. Request carrying verified credentials without authConfigured still sets private for provider and public for skills.
		const fakeView: ScopeView = {
			credentials: makeCredentials(['docs:read']),
			filtered: false,
			known: () => true,
			shown: () => true,
			decideCall: () => 'proceed',
			decideCommands: () => 'proceed',
			decideRequest: () => 'proceed',
			decideExecution: () => 'proceed',
			decideTask: () => 'proceed',
			settle: () => {},
			insufficientScope: () => ({
				code: 'INSUFFICIENT_SCOPE',
				message: 'missing',
				suggestion: 'retry',
				retryable: false,
			}),
		};
		const withCreds = await makePair({
			authConfigured: false,
			requestView: () => fakeView,
		});
		const listed = await withCreds.sendRaw('resources/list');
		expect((listed.result as { cacheScope?: string })?.cacheScope).toBe('private');
		const providerRead = await withCreds.sendRaw('resources/read', { uri: 'file:///direct.txt' });
		expect((providerRead.result as { cacheScope?: string })?.cacheScope).toBe('private');
		const skillRead = await withCreds.sendRaw('resources/read', { uri: SKILL_URI });
		expect((skillRead.result as { cacheScope?: string })?.cacheScope).toBe('public');
	});
});
