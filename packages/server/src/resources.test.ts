/**
 * `spec/mcp-resources.md` against a real `@modelcontextprotocol/client` over Streamable HTTP, in
 * both MCP eras (2025-11-25 `legacy` and 2026-07-28 `modern`), and over dual-era stdio: every
 * case of `spec/mcp-resources.json`, plus the rules the cases do not pin (capabilities, cache
 * hints, `Mcp-Name`, provider entries, `ui://` views, directory reads).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { success } from '@lushly-dev/afd-core';
import {
	Client,
	ProtocolError,
	type ProtocolError as ProtocolErrorType,
	StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defaultInstructions, serveModernStdio } from './mcp-modern.js';
import {
	createResourceService,
	MCP_APP_MIME_TYPE,
	type ResourceEntry,
	type ResourceProvider,
	type ResourcesOption,
} from './resources.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';
import type { McpHandlerOptions } from './server-types.js';
import { type Skill, SkillCatalog } from './skills.js';

const here = dirname(fileURLToPath(import.meta.url));
interface SpecFile {
	toolMetaKeys: Array<{ key: string; value: unknown; allowed: boolean }>;
	catalog: {
		skills: Array<{
			path: string;
			files: Array<{ path: string; text?: string; base64?: string }>;
		}>;
		skillsList: { skills: unknown[] };
		resourcesList: { resources: unknown[] };
		reads: Array<{ uri: string; contents: unknown[] }>;
		errors: Array<{ method: string; uri: string; code: number }>;
		skillsGet: Array<{ uri: string; skillsListIndex: number }>;
	};
	catalogFailures: Array<{ name: string; skills: SpecFile['catalog']['skills']; entry: string }>;
}
const spec = JSON.parse(
	readFileSync(resolve(here, '../../../spec/mcp-resources.json'), 'utf8')
) as SpecFile;

/** The spec's skills as the catalog takes them: `text` as a string, `base64` as bytes. */
function toSkills(skills: SpecFile['catalog']['skills']): Skill[] {
	return skills.map((skill) => ({
		path: skill.path,
		files: Object.fromEntries(
			skill.files.map((file) => [
				file.path,
				file.text !== undefined
					? file.text
					: new Uint8Array(Buffer.from(file.base64 ?? '', 'base64')),
			])
		),
	}));
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const ERAS = ['legacy', 'modern'] as const;
type Era = (typeof ERAS)[number];

const hello = defineCommand({
	name: 'hello-greet',
	description: 'Greet a person',
	expose: { mcp: true },
	input: z.object({ name: z.string() }),
	handler: async ({ name }) => success({ greeting: `Hello, ${name}!` }),
});

async function serve(options: Partial<McpHandlerOptions> = {}) {
	const errors: Error[] = [];
	const handler = createMcpHandler({
		name: 'resources-test',
		version: '1.0.0',
		host: '127.0.0.1',
		commands: [hello],
		onError: (error) => errors.push(error),
		...options,
	});
	const http = createServer(handler);
	await new Promise<void>((resolveListen) => http.listen(0, '127.0.0.1', resolveListen));
	cleanups.push(async () => {
		handler.dispose();
		http.closeAllConnections();
		await new Promise<void>((resolveClose) => http.close(() => resolveClose()));
	});
	return { url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`, errors };
}

async function connect(url: string, era: Era) {
	const client = new Client(
		{ name: 'resources-test-client', version: '0' },
		era === 'modern' ? { versionNegotiation: { mode: 'auto' } } : {}
	);
	await client.connect(new StreamableHTTPClientTransport(new URL(url)));
	cleanups.push(() => client.close());
	return client;
}

const anyResult = z.looseObject({});
const call = (client: Client, method: string, params: Record<string, unknown> = {}) =>
	client.request({ method, params }, anyResult) as Promise<Record<string, unknown>>;

/** The JSON-RPC error a request fails with. */
async function failure(work: Promise<unknown>): Promise<ProtocolErrorType> {
	try {
		await work;
	} catch (error) {
		expect(error).toBeInstanceOf(ProtocolError);
		return error as ProtocolErrorType;
	}
	throw new Error('expected the request to fail');
}

const MODERN = '2026-07-28';
const META = {
	'io.modelcontextprotocol/protocolVersion': MODERN,
	'io.modelcontextprotocol/clientCapabilities': {},
	'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
};

/** One raw modern-era request, for the wire fields an SDK client hides. */
async function modernPost(
	url: string,
	method: string,
	params: Record<string, unknown> = {},
	name?: string
) {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			'MCP-Protocol-Version': MODERN,
			'Mcp-Method': method,
			...(name === undefined ? {} : { 'Mcp-Name': name }),
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: META } }),
	});
	const text = await response.text();
	const data = /^data: (.*)$/m.exec(text)?.[1] ?? text;
	return {
		status: response.status,
		body: JSON.parse(data) as {
			result?: Record<string, unknown>;
			error?: { code: number; message: string; data?: unknown };
		},
	};
}

const catalogSkills = toSkills(spec.catalog.skills);

describe('tool _meta keys (spec/mcp-resources.json toolMetaKeys)', () => {
	const escaped = (key: string) => key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
	const define = (key: string, value: unknown) =>
		defineCommand({
			name: 'meta-probe',
			description: 'Probe the key rule',
			expose: { mcp: true },
			input: z.object({}),
			toolMeta: { [key]: value },
			handler: async () => success({}),
		});
	const register = (key: string, value: unknown) => () =>
		createMcpHandler({ name: 'keys', version: '1.0.0', commands: [define(key, value)] }).dispose();

	it.each(spec.toolMetaKeys)('$key = $value is allowed: $allowed', ({ key, value, allowed }) => {
		const registration = register(key, value);
		if (allowed) expect(registration).not.toThrow();
		else expect(registration).toThrow(new RegExp(`meta-probe.*${escaped(key)}`));
	});
});

describe('catalog checks (spec/mcp-resources.json catalogFailures)', () => {
	it.each(spec.catalogFailures)('refuses $name', ({ skills, entry }) => {
		expect(() => new SkillCatalog(toSkills(skills))).toThrow(entry);
	});

	it('stops the server from being built', () => {
		const bad = spec.catalogFailures[0];
		expect(() => new SkillCatalog(toSkills(bad?.skills ?? []))).toThrow();
	});
});

describe.each(ERAS)('a skill catalog over Streamable HTTP (%s)', (era) => {
	const serveCatalog = async (extra: Partial<McpHandlerOptions> = {}) => {
		const { url } = await serve({ skills: new SkillCatalog(catalogSkills), ...extra });
		return { url, client: await connect(url, era) };
	};

	it('returns the fixture skills/list', async () => {
		const { client } = await serveCatalog();
		const list = await call(client, 'skills/list');
		expect(list.skills).toEqual(spec.catalog.skillsList.skills);
		expect(list).not.toHaveProperty('nextCursor');
	});

	it('returns the fixture resources/list, in order', async () => {
		const { client } = await serveCatalog();
		const list = await client.listResources();
		expect(list.resources).toEqual(spec.catalog.resourcesList.resources);
		expect(list).not.toHaveProperty('nextCursor');
	});

	it.each(spec.catalog.reads)('reads $uri', async ({ uri, contents }) => {
		const { client } = await serveCatalog();
		const read = await client.readResource({ uri });
		expect(read.contents).toEqual(contents);
	});

	it.each(spec.catalog.skillsGet)('gets $uri', async ({ uri, skillsListIndex }) => {
		const { client } = await serveCatalog();
		expect(await call(client, 'skills/get', { uri })).toMatchObject({
			skill: spec.catalog.skillsList.skills[skillsListIndex],
		});
	});

	it.each(spec.catalog.errors)('answers $method $uri with $code', async ({ method, uri, code }) => {
		const { client } = await serveCatalog();
		const error = await failure(
			method === 'resources/read' ? client.readResource({ uri }) : call(client, method, { uri })
		);
		expect(error.code).toBe(code);
		expect(error.data).toEqual({ uri });
		if (method === 'resources/read') expect(error.message).toContain('Resource not found');
	});

	it('declares resources and the skills extension, not subscribe or listChanged', async () => {
		const { client } = await serveCatalog();
		const capabilities = client.getServerCapabilities() as Record<string, unknown>;
		expect(capabilities.extensions).toEqual({ 'io.modelcontextprotocol/skills': {} });
		const resources = (capabilities.resources ?? {}) as Record<string, unknown>;
		expect(resources.subscribe ?? false).toBe(false);
		expect(resources.listChanged ?? false).toBe(false);
		expect(capabilities).not.toHaveProperty('prompts');
	});

	it('answers a cursor with -32602 and templates with an empty list', async () => {
		const { client } = await serveCatalog();
		expect((await failure(call(client, 'skills/list', { cursor: 'x' }))).code).toBe(-32602);
		expect((await failure(call(client, 'resources/list', { cursor: 'x' }))).code).toBe(-32602);
		expect((await call(client, 'resources/templates/list')).resourceTemplates).toEqual([]);
	});

	it('answers resources/subscribe and resources/directory/read with -32601', async () => {
		const { url, client } = await serveCatalog();
		const uri = 'skill://acme/lint-rules/SKILL.md';
		if (era === 'modern') {
			// The 2026-07-28 client has no subscribe request to send.
			expect((await modernPost(url, 'resources/subscribe', { uri })).body.error?.code).toBe(-32601);
			expect(
				(await modernPost(url, 'resources/directory/read', { uri: 'skill://acme/lint-rules' })).body
					.error?.code
			).toBe(-32601);
		} else {
			expect((await failure(call(client, 'resources/subscribe', { uri }))).code).toBe(-32601);
			expect(
				(
					await failure(
						call(client, 'resources/directory/read', { uri: 'skill://acme/lint-rules' })
					)
				).code
			).toBe(-32601);
		}
	});

	it('declares directoryRead and lists directory children in byte order', async () => {
		const { client } = await serveCatalog({
			skills: new SkillCatalog(catalogSkills, { directoryRead: true }),
		});
		expect((client.getServerCapabilities() as Record<string, unknown>).extensions).toEqual({
			'io.modelcontextprotocol/skills': { directoryRead: true },
		});
		const root = await call(client, 'resources/directory/read', { uri: 'skill://hello-greeting' });
		expect((root.resources as Array<{ uri: string }>).map((child) => child.uri)).toEqual([
			'skill://hello-greeting/SKILL.md',
			'skill://hello-greeting/assets',
			'skill://hello-greeting/references',
		]);
		expect((root.resources as Array<Record<string, unknown>>)[1]).toEqual({
			uri: 'skill://hello-greeting/assets',
			name: 'assets',
			mimeType: 'inode/directory',
		});
		const sub = await call(client, 'resources/directory/read', {
			uri: 'skill://hello-greeting/references',
		});
		expect((sub.resources as Array<{ uri: string }>).map((child) => child.uri)).toEqual([
			'skill://hello-greeting/references/STYLE.md',
		]);
		const missing = await failure(
			call(client, 'resources/directory/read', { uri: 'skill://hello-greeting/nowhere' })
		);
		expect(missing.code).toBe(-32602);
		expect(missing.data).toEqual({ uri: 'skill://hello-greeting/nowhere' });
		// Directory resources are not listed.
		expect((await client.listResources()).resources).toEqual(spec.catalog.resourcesList.resources);
	});

	it('still lists the same tools as a server without resources', async () => {
		const withSkills = await serveCatalog();
		const without = await serve();
		const plain = await connect(without.url, era);
		expect((await withSkills.client.listTools()).tools).toEqual((await plain.listTools()).tools);
	});
});

describe('a server without resources or skills', () => {
	it.each(ERAS)('declares neither resources nor prompts (%s)', async (era) => {
		const { url } = await serve();
		const client = await connect(url, era);
		const capabilities = client.getServerCapabilities() as Record<string, unknown>;
		expect(capabilities).not.toHaveProperty('resources');
		expect(capabilities).not.toHaveProperty('prompts');
		expect(capabilities).not.toHaveProperty('extensions');
	});
});

describe('a request that is not a command', () => {
	it.each(ERAS)('answers resources/list with -32601 without resources (%s)', async (era) => {
		const { url } = await serve();
		if (era === 'modern') {
			// The SDK answers an unserved method with HTTP 404 carrying the JSON-RPC error.
			for (const method of ['resources/list', 'skills/list']) {
				const { status, body } = await modernPost(url, method);
				expect([status, body.error?.code]).toEqual([404, -32601]);
			}
			return;
		}
		const client = await connect(url, era);
		expect((await failure(call(client, 'resources/list'))).code).toBe(-32601);
		expect((await failure(call(client, 'skills/list'))).code).toBe(-32601);
	});

	it.each(ERAS)('runs no createContext, middleware or command for a read (%s)', async (era) => {
		const seen: string[] = [];
		const { url } = await serve({
			skills: new SkillCatalog(catalogSkills),
			createContext: () => {
				seen.push('createContext');
				return {};
			},
			middleware: [
				async (_name, _input, _context, next) => {
					seen.push('middleware');
					return next();
				},
			],
			onCommand: () => seen.push('onCommand'),
		});
		const client = await connect(url, era);
		await client.listResources();
		await client.readResource({ uri: 'skill://acme/lint-rules/SKILL.md' });
		await call(client, 'skills/list');
		expect(seen).toEqual([]);
	});
});

describe('modern-era wire fields', () => {
	it('carries ttlMs and a public cacheScope on every resource result', async () => {
		const { url } = await serve({
			skills: new SkillCatalog(catalogSkills),
			toolsListTtlMs: 12_345,
		});
		const uri = 'skill://acme/lint-rules/SKILL.md';
		const results = await Promise.all([
			modernPost(url, 'resources/list'),
			modernPost(url, 'resources/templates/list'),
			modernPost(url, 'resources/read', { uri }, uri),
			modernPost(url, 'skills/list'),
			modernPost(url, 'skills/get', { uri }),
		]);
		for (const { status, body } of results) {
			expect(status).toBe(200);
			expect(body.result).toMatchObject({
				resultType: 'complete',
				ttlMs: 12_345,
				cacheScope: 'public',
			});
		}
	});

	it('uses the default TTL, and keeps it under contexts', async () => {
		const { url } = await serve({
			skills: new SkillCatalog(catalogSkills),
			contexts: [{ name: 'billing' }],
		});
		const { body } = await modernPost(url, 'resources/list');
		expect(body.result?.ttlMs).toBe(300_000);
		expect(body.result?.cacheScope).toBe('public');
		// The tools list is stale under contexts; the resource list does not vary by context.
		const tools = await modernPost(url, 'tools/list');
		expect(tools.body.result?.ttlMs).toBe(0);
	});

	it('does not vary resources/list by _meta["dev.afd/context"]', async () => {
		const { url } = await serve({
			skills: new SkillCatalog(catalogSkills),
			contexts: [{ name: 'billing' }],
		});
		const plain = await modernPost(url, 'resources/list');
		const scoped = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				'MCP-Protocol-Version': MODERN,
				'Mcp-Method': 'resources/list',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'resources/list',
				params: { _meta: { ...META, 'dev.afd/context': 'billing' } },
			}),
		});
		const text = await scoped.text();
		const body = JSON.parse(/^data: (.*)$/m.exec(text)?.[1] ?? text);
		expect(body.result.resources).toEqual(plain.body.result?.resources);
	});

	it('answers a read without Mcp-Name with HTTP 400 and -32020', async () => {
		const { url } = await serve({ skills: new SkillCatalog(catalogSkills) });
		const uri = 'skill://acme/lint-rules/SKILL.md';
		const missing = await modernPost(url, 'resources/read', { uri });
		expect(missing.status).toBe(400);
		expect(missing.body.error?.code).toBe(-32020);
		const mismatch = await modernPost(url, 'resources/read', { uri }, 'skill://other/SKILL.md');
		expect(mismatch.status).toBe(400);
		expect(mismatch.body.error?.code).toBe(-32020);
	});

	it('does not require Mcp-Name on skills/list, skills/get or directory reads', async () => {
		const { url } = await serve({
			skills: new SkillCatalog(catalogSkills, { directoryRead: true }),
		});
		const uri = 'skill://acme/lint-rules/SKILL.md';
		expect((await modernPost(url, 'skills/list')).status).toBe(200);
		expect((await modernPost(url, 'skills/get', { uri })).status).toBe(200);
		expect(
			(await modernPost(url, 'resources/directory/read', { uri: 'skill://acme/lint-rules' })).status
		).toBe(200);
	});

	it('answers subscriptions/listen for resources without notifications', async () => {
		const { url } = await serve({ skills: new SkillCatalog(catalogSkills) });
		const client = await connect(url, 'modern');
		expect(client.getServerCapabilities()?.resources?.subscribe ?? false).toBe(false);
	});
});

const digestOf = (bytes: string | Uint8Array) =>
	`sha256:${createHash('sha256').update(bytes).digest('hex')}`;

describe('a resource provider', () => {
	const view = '<!doctype html><title>View</title>';
	const binary = new Uint8Array([0xff, 0xfe, 0x00]);
	const entries: ResourceEntry[] = [
		{ uri: 'ui://hello/view.html', name: 'Hello view', mimeType: MCP_APP_MIME_TYPE, content: view },
		{ uri: 'file:///notes/readme.txt', name: 'Readme', mimeType: 'text/plain', title: 'Read me' },
		{ uri: 'data:///bin', name: 'Binary', size: 3, _meta: { 'com.example/tag': 'x' } },
		{ uri: 'file:///boom', name: 'Boom' },
	];

	function provider(): ResourceProvider {
		return {
			list: () => entries,
			read(uri) {
				if (uri === 'file:///notes/readme.txt') return { content: 'Hello\n' };
				if (uri === 'data:///bin') return { content: binary };
				if (uri === 'ui://hello/unlisted.html') {
					return {
						content: view,
						mimeType: MCP_APP_MIME_TYPE,
						_meta: { ui: { prefersBorder: true, csp: { connectDomains: [] } } },
					};
				}
				if (uri === 'file:///boom') throw new Error('secret detail');
				return undefined;
			},
		};
	}

	describe.each(ERAS)('(%s)', (era) => {
		it('lists entries in provider order with size and digest of bytes given up front', async () => {
			const { url } = await serve({ resources: provider() });
			const client = await connect(url, era);
			const { resources } = await client.listResources();
			expect(resources).toEqual([
				{
					uri: 'ui://hello/view.html',
					name: 'Hello view',
					mimeType: MCP_APP_MIME_TYPE,
					size: Buffer.byteLength(view),
					_meta: { 'dev.afd/digest': digestOf(view) },
				},
				{
					uri: 'file:///notes/readme.txt',
					name: 'Readme',
					title: 'Read me',
					mimeType: 'text/plain',
				},
				{ uri: 'data:///bin', name: 'Binary', size: 3, _meta: { 'com.example/tag': 'x' } },
				{ uri: 'file:///boom', name: 'Boom' },
			]);
			expect((await client.listResources()).resources).toEqual(resources);
			expect(client.getServerCapabilities()).toMatchObject({ resources: {} });
			expect(client.getServerCapabilities()).not.toHaveProperty('extensions');
		});

		it('lets a modern client cache the list for the advertised TTL, and a legacy client not', async () => {
			let lists = 0;
			const { url } = await serve({
				resources: {
					list: () => {
						lists += 1;
						return [{ uri: 'file:///a', name: 'A' }];
					},
				},
			});
			const client = await connect(url, era);
			const built = lists;
			await client.listResources();
			await client.listResources();
			// A served list calls `list()` once; a modern client keeps the first answer for its TTL.
			expect(lists - built).toBe(era === 'modern' ? 1 : 2);
		});

		it('reads bytes given up front, text, a blob, and an unlisted URI', async () => {
			const { url } = await serve({ resources: provider() });
			const client = await connect(url, era);
			expect((await client.readResource({ uri: 'ui://hello/view.html' })).contents).toEqual([
				{ uri: 'ui://hello/view.html', mimeType: MCP_APP_MIME_TYPE, text: view },
			]);
			expect((await client.readResource({ uri: 'file:///notes/readme.txt' })).contents).toEqual([
				{ uri: 'file:///notes/readme.txt', mimeType: 'text/plain', text: 'Hello\n' },
			]);
			expect((await client.readResource({ uri: 'data:///bin' })).contents).toEqual([
				{ uri: 'data:///bin', blob: Buffer.from(binary).toString('base64') },
			]);
		});

		it('serves a ui:// view with _meta.ui on the content item', async () => {
			const { url } = await serve({ resources: provider() });
			const client = await connect(url, era);
			expect((await client.readResource({ uri: 'ui://hello/unlisted.html' })).contents).toEqual([
				{
					uri: 'ui://hello/unlisted.html',
					mimeType: MCP_APP_MIME_TYPE,
					text: view,
					_meta: { ui: { prefersBorder: true, csp: { connectDomains: [] } } },
				},
			]);
		});

		it('answers an unknown URI with -32602 and the URI in data', async () => {
			const { url } = await serve({ resources: provider() });
			const client = await connect(url, era);
			const error = await failure(client.readResource({ uri: 'file:///nothing' }));
			expect(error.code).toBe(-32602);
			expect(error.message).toContain('Resource not found');
			expect(error.data).toEqual({ uri: 'file:///nothing' });
		});

		it('never asks the provider for a skill:// URI', async () => {
			const asked: string[] = [];
			const { url } = await serve({
				resources: {
					list: () => [],
					read: (uri) => {
						asked.push(uri);
						return { content: 'x' };
					},
				},
			});
			const client = await connect(url, era);
			expect((await failure(client.readResource({ uri: 'skill://x/SKILL.md' }))).code).toBe(-32602);
			expect(asked).toEqual([]);
		});

		it('answers a failing read with a generic -32603 and reports the cause', async () => {
			const { url, errors } = await serve({ resources: provider() });
			const client = await connect(url, era);
			const error = await failure(client.readResource({ uri: 'file:///boom' }));
			expect(error.code).toBe(-32603);
			expect(error.message).not.toContain('secret detail');
			expect(errors.map((reported) => reported.message)).toContain('secret detail');
		});

		it('refuses a list that breaks a rule while the server runs', async () => {
			let live: ResourceEntry[] = [{ uri: 'file:///a', name: 'A' }];
			const { url } = await serve({ resources: { list: () => live } });
			const client = await connect(url, era);
			const fresh = { cacheMode: 'bypass' } as const;
			expect((await client.listResources(undefined, fresh)).resources).toHaveLength(1);
			live = [
				{ uri: 'file:///a', name: 'A' },
				{ uri: 'file:///a', name: 'Again' },
			];
			expect((await failure(client.listResources(undefined, fresh))).code).toBe(-32603);
			live = [{ uri: 'file:///b', name: 'B' }];
			expect((await client.listResources(undefined, fresh)).resources).toEqual([
				{ uri: 'file:///b', name: 'B' },
			]);
		});

		it('refuses a read whose bytes differ from the listed size', async () => {
			const { url } = await serve({
				resources: {
					list: () => [{ uri: 'file:///s', name: 'S', size: 10 }],
					read: () => ({ content: 'short' }),
				},
			});
			const client = await connect(url, era);
			expect((await failure(client.readResource({ uri: 'file:///s' }))).code).toBe(-32603);
		});

		it('serves skills and a provider together, provider entries first', async () => {
			const { url } = await serve({
				resources: [{ uri: 'file:///a', name: 'A' }],
				skills: new SkillCatalog(catalogSkills),
			});
			const client = await connect(url, era);
			const { resources } = await client.listResources();
			expect(resources[0]).toEqual({ uri: 'file:///a', name: 'A' });
			expect(resources.slice(1)).toEqual(spec.catalog.resourcesList.resources);
		});
	});

	describe('entries are checked when the server is built', () => {
		const build = (resources: ResourcesOption) =>
			createMcpHandler({
				name: 'bad',
				version: '1.0.0',
				commands: [hello],
				resources,
			});

		it.each([
			['a relative URI', { uri: 'notes/readme.txt', name: 'x' }, 'notes/readme.txt'],
			['a URI with whitespace', { uri: 'file:///a b', name: 'x' }, 'file:///a b'],
			['no name', { uri: 'file:///a', name: '' }, 'file:///a'],
			['the skill:// scheme', { uri: 'skill://x/SKILL.md', name: 'x' }, 'skill://x/SKILL.md'],
			[
				'a ui:// entry without the MCP Apps type',
				{ uri: 'ui://x/v.html', name: 'x' },
				'ui://x/v.html',
			],
			['ui in _meta', { uri: 'file:///a', name: 'x', _meta: { ui: {} } }, 'file:///a'],
			[
				'a reserved _meta key',
				{ uri: 'file:///a', name: 'x', _meta: { 'dev.afd/digest': 'x' } },
				'dev.afd/digest',
			],
			[
				'a size that differs from the content',
				{ uri: 'file:///a', name: 'x', content: 'abc', size: 4 },
				'file:///a',
			],
		] satisfies Array<[string, ResourceEntry, string]>)('refuses %s', (_name, entry, named) => {
			expect(() => build([entry])).toThrow(named);
		});

		it('refuses two entries with one URI', () => {
			expect(() =>
				build([
					{ uri: 'file:///a', name: 'x' },
					{ uri: 'file:///a', name: 'y' },
				])
			).toThrow('file:///a');
		});

		it('compares URIs as exact strings', () => {
			expect(() =>
				build([
					{ uri: 'file:///a', name: 'x' },
					{ uri: 'file:///A', name: 'y' },
				])
			).not.toThrow();
		});
	});
});

describe('dual-era stdio', () => {
	async function stdioClient(era: Era, resources: Parameters<typeof createResourceService>) {
		const service = createResourceService(...resources);
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		const handle = serveModernStdio(
			{
				name: 'stdio-resources',
				version: '1.0.0',
				instructions: defaultInstructions({ name: 'stdio-resources', toolStrategy: 'individual' }),
				getToolsList: () => [],
				routeToolCall: async () => ({ content: [], isError: true }),
				resources: service,
				resourcesTtlMs: 300_000,
				devMode: false,
			},
			undefined,
			serverSide
		);
		const client = new Client(
			{ name: 'stdio-client', version: '0' },
			era === 'modern' ? { versionNegotiation: { mode: 'auto' } } : {}
		);
		await client.connect(clientSide);
		cleanups.push(async () => {
			await client.close();
			await handle.close();
		});
		return client;
	}

	it.each(ERAS)('serves the fixture catalog (%s)', async (era) => {
		const client = await stdioClient(era, [undefined, new SkillCatalog(catalogSkills), 300_000]);
		expect((await call(client, 'skills/list')).skills).toEqual(spec.catalog.skillsList.skills);
		expect((await client.listResources()).resources).toEqual(spec.catalog.resourcesList.resources);
		for (const { uri, contents } of spec.catalog.reads) {
			expect((await client.readResource({ uri })).contents).toEqual(contents);
		}
		for (const { method, uri, code } of spec.catalog.errors) {
			const error = await failure(
				method === 'resources/read' ? client.readResource({ uri }) : call(client, method, { uri })
			);
			expect(error.code).toBe(code);
			expect(error.data).toEqual({ uri });
		}
	});
});
