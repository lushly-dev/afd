/**
 * The MCP 2026-07-28 lane: `POST /mcp` (dual-era, stateless) and dual-era stdio, exercised
 * with the official MCP TypeScript SDK v2 client in both negotiation modes.
 */
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	createAfdContextEnterCommand,
	createAfdContextListCommand,
	createContextState,
} from './bootstrap/afd-context.js';
import { createExecutionEngine } from './execution.js';
import { defaultInstructions, serveModernStdio } from './mcp-modern.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';
import type { McpHandlerOptions } from './server-types.js';
import { createToolRouter } from './tool-router.js';
import { getToolsList } from './tools.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const MODERN = '2026-07-28';
const META = {
	'io.modelcontextprotocol/protocolVersion': MODERN,
	'io.modelcontextprotocol/clientCapabilities': {},
	'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
};

function commands() {
	return [
		defineCommand({
			name: 'item-create',
			description: 'Create an item',
			mutation: true,
			expose: { mcp: true },
			input: z.object({ title: z.string() }),
			handler: async ({ title }, context) =>
				success({ title, by: (context as { clientId?: string }).clientId ?? null }),
		}),
		defineCommand({
			name: 'doc-edit',
			description: 'Edit the document',
			contexts: ['document'],
			expose: { mcp: true },
			input: z.object({}),
			handler: async () => success({ edited: true }),
		}),
		defineCommand({
			name: 'boom-run',
			description: 'Throws',
			expose: { mcp: true },
			input: z.object({}),
			handler: async () => {
				throw new Error('secret detail');
			},
		}),
		defineCommand({
			name: 'secret-rotate',
			description: 'Private',
			input: z.object({}),
			handler: async () => success({}),
		}),
	];
}

async function serve(options: Partial<McpHandlerOptions> = {}) {
	const errors: Error[] = [];
	const handler = createMcpHandler({
		name: 'modern-test',
		version: '1.2.3',
		commands: commands(),
		host: '127.0.0.1',
		onError: (error) => errors.push(error),
		createContext: (req) => ({ clientId: String(req.headers['x-client-id'] ?? 'anon') }),
		...options,
	});
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { base, url: `${base}/mcp`, errors };
}

interface RpcBody {
	result?: Record<string, unknown>;
	error?: { code: number; message: string; data?: unknown };
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			...headers,
		},
		body: JSON.stringify(body),
	});
	const text = await response.text();
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		const data = /^data: (.*)$/m.exec(text)?.[1];
		json = data ? JSON.parse(data) : undefined;
	}
	return {
		status: response.status,
		json: (json ?? {}) as RpcBody,
		headers: response.headers,
	};
}

const modernHeaders = (method: string, name?: string) => ({
	'MCP-Protocol-Version': MODERN,
	'Mcp-Method': method,
	...(name ? { 'Mcp-Name': name } : {}),
});

async function connect(url: string, mode: 'auto' | 'legacy') {
	const client = new Client(
		{ name: 'modern-test-client', version: '0' },
		mode === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {}
	);
	await client.connect(new StreamableHTTPClientTransport(new URL(url)));
	cleanups.push(() => client.close());
	return client;
}

function text(result: unknown): Record<string, unknown> {
	const content = (result as { content: Array<{ text: string }> }).content;
	return JSON.parse(content[0]?.text ?? '{}');
}

describe('POST /mcp wire (2026-07-28)', () => {
	it('answers server/discover with versions, instructions, serverInfo and cache hints', async () => {
		const { url } = await serve({ toolStrategy: 'lazy' });
		const { status, json } = await post(
			url,
			{ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: META } },
			modernHeaders('server/discover')
		);
		expect(status).toBe(200);
		const result = json.result as Record<string, unknown>;
		expect(result.resultType).toBe('complete');
		expect(result.supportedVersions).toEqual([MODERN]);
		expect(result.instructions).toContain('afd-discover');
		expect(result.ttlMs).toBe(300_000);
		expect(result.cacheScope).toBe('public');
		expect((result._meta as Record<string, unknown>)['io.modelcontextprotocol/serverInfo']).toEqual(
			{ name: 'modern-test', version: '1.2.3' }
		);
	});

	it('lists tools with resultType, cache hints and AFD _meta, without private commands', async () => {
		const { url } = await serve({ toolStrategy: 'individual', toolsListTtlMs: 0 });
		const { json } = await post(
			url,
			{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } },
			modernHeaders('tools/list')
		);
		const result = json.result as { tools: Array<{ name: string; _meta?: unknown }> } & Record<
			string,
			unknown
		>;
		expect(result.resultType).toBe('complete');
		expect(result.ttlMs).toBe(0);
		const names = result.tools.map((tool) => tool.name);
		expect(names).toContain('item-create');
		expect(names).not.toContain('secret-rotate');
		expect(result.tools.find((tool) => tool.name === 'item-create')?._meta).toMatchObject({
			mutation: true,
		});
	});

	it('rejects malformed modern requests with the spec status and error codes', async () => {
		const { url, errors } = await serve();
		const call = (name: string) => ({
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/call',
			params: { name, arguments: {}, _meta: META },
		});

		const mismatch = await post(url, call('afd-call'), modernHeaders('tools/call', 'other'));
		expect([mismatch.status, mismatch.json.error?.code]).toEqual([400, -32020]);

		const missingName = await post(url, call('afd-call'), modernHeaders('tools/call'));
		expect([missingName.status, missingName.json.error?.code]).toEqual([400, -32020]);

		const unsupported = await post(
			url,
			{
				jsonrpc: '2.0',
				id: 3,
				method: 'tools/list',
				params: { _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } },
			},
			{ ...modernHeaders('tools/list'), 'MCP-Protocol-Version': '2099-01-01' }
		);
		expect([unsupported.status, unsupported.json.error?.code]).toEqual([400, -32022]);

		const noCapabilities = await post(
			url,
			{
				jsonrpc: '2.0',
				id: 4,
				method: 'tools/list',
				params: { _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } },
			},
			modernHeaders('tools/list')
		);
		expect([noCapabilities.status, noCapabilities.json.error?.code]).toEqual([400, -32602]);

		const unknown = await post(
			url,
			{ jsonrpc: '2.0', id: 5, method: 'nope/nope', params: { _meta: META } },
			modernHeaders('nope/nope')
		);
		expect([unknown.status, unknown.json.error?.code]).toEqual([404, -32601]);

		expect((await fetch(url, { headers: { Accept: 'text/event-stream' } })).status).toBe(405);
		// Client mistakes are answered on the wire, not reported as server errors.
		expect(errors).toEqual([]);
	});

	it('keeps AFD Host and Origin validation in front of the SDK', async () => {
		const { url } = await serve();
		const origin = await post(
			url,
			{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } },
			{ ...modernHeaders('tools/list'), Origin: 'https://evil.example' }
		);
		expect(origin.status).toBe(403);
		expect(origin.json.error?.code).toBe(-32000);

		// fetch() drops a custom Host header, so send this one with node:http.
		const target = new URL(url);
		const hostStatus = await new Promise<number | undefined>((resolve) => {
			const req = httpRequest(
				{
					host: target.hostname,
					port: target.port,
					path: '/mcp',
					method: 'POST',
					headers: { Host: 'evil.example', 'Content-Type': 'application/json' },
				},
				(res) => {
					res.resume();
					resolve(res.statusCode);
				}
			);
			req.end('{}');
		});
		expect(hostStatus).toBe(403);
	});

	it('allows the MCP request headers in CORS preflights', async () => {
		const { url, base } = await serve({ cors: true, allowedOrigins: ['https://app.example'] });
		const response = await fetch(url, {
			method: 'OPTIONS',
			headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST' },
		});
		expect(response.status).toBe(204);
		const allowed = response.headers.get('access-control-allow-headers') ?? '';
		for (const header of ['MCP-Protocol-Version', 'Mcp-Method', 'Mcp-Name']) {
			expect(allowed).toContain(header);
		}
		expect(base).toMatch(/^http:/);
	});

	it('passes createContext values to commands and masks handler errors', async () => {
		const { url, errors } = await serve();
		const created = await post(
			url,
			{
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'afd-call',
					arguments: { command: 'item-create', input: { title: 'a' } },
					_meta: META,
				},
			},
			{ ...modernHeaders('tools/call', 'afd-call'), 'x-client-id': 'agent-7' }
		);
		const result = created.json.result as Record<string, unknown>;
		expect(result.resultType).toBe('complete');
		expect(text(result)).toMatchObject({ success: true, data: { title: 'a', by: 'agent-7' } });

		const failed = await post(
			url,
			{
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'afd-call', arguments: { command: 'boom-run', input: {} }, _meta: META },
			},
			modernHeaders('tools/call', 'afd-call')
		);
		const body = text(failed.json.result);
		expect(body).toMatchObject({ success: false, error: { code: 'COMMAND_EXECUTION_ERROR' } });
		expect(JSON.stringify(body)).not.toContain('secret detail');
		expect(errors.map((error) => error.message)).toContain('secret detail');
	});
});

describe('POST /mcp with SDK v2 clients', () => {
	it.each(['auto', 'legacy'] as const)('serves the %s negotiation mode', async (mode) => {
		const { url } = await serve();
		const client = await connect(url, mode);
		expect(client.getProtocolEra()).toBe(mode === 'auto' ? 'modern' : 'legacy');
		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name)).toContain('afd-call');
		const created = await client.callTool({
			name: 'afd-call',
			arguments: { command: 'item-create', input: { title: 'b' } },
		});
		expect(text(created)).toMatchObject({ success: true, data: { title: 'b' } });
		const hidden = await client.callTool({
			name: 'afd-call',
			arguments: { command: 'secret-rotate', input: {} },
		});
		expect(text(hidden)).toMatchObject({ error: { code: 'COMMAND_NOT_FOUND' } });
	});

	it('serves /mcp next to the legacy /message lane', async () => {
		const { base } = await serve();
		const legacy = await post(`${base}/message`, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
		expect(legacy.status).toBe(200);
		expect((legacy.json.result as { tools: unknown[] }).tools.length).toBeGreaterThan(0);
	});
});

describe('contexts on the stateless lane', () => {
	const contexts = [{ name: 'document' }, { name: 'billing' }];

	it('scopes tools/list and tools/call by _meta["dev.afd/context"]', async () => {
		const { url } = await serve({ contexts, toolStrategy: 'individual' });
		const client = await connect(url, 'auto');
		const all = (await client.listTools()).tools.map((tool) => tool.name);
		expect(all).toContain('doc-edit');
		const billing = await client.listTools({ _meta: { 'dev.afd/context': 'billing' } });
		expect(billing.tools.map((tool) => tool.name)).not.toContain('doc-edit');

		const denied = await client.callTool({
			name: 'doc-edit',
			arguments: {},
			_meta: { 'dev.afd/context': 'billing' },
		});
		expect(text(denied)).toMatchObject({ error: { code: 'COMMAND_NOT_IN_CONTEXT' } });
		const allowed = await client.callTool({
			name: 'doc-edit',
			arguments: {},
			_meta: { 'dev.afd/context': 'document' },
		});
		expect(text(allowed)).toMatchObject({ success: true });
	});

	it('validates but never stores afd-context-enter on a stateless request', async () => {
		const { url } = await serve({ contexts });
		const client = await connect(url, 'auto');
		const entered = text(
			await client.callTool({ name: 'afd-context-enter', arguments: { context: 'billing' } })
		);
		expect(entered).toMatchObject({
			success: true,
			data: { entered: 'billing', previous: null, persisted: false },
		});
		expect(String(entered.reasoning)).toContain('dev.afd/context');
		const listed = text(await client.callTool({ name: 'afd-context-list', arguments: {} }));
		expect(listed).toMatchObject({ data: { activeContext: null } });
		const unknown = text(
			await client.callTool({ name: 'afd-context-enter', arguments: { context: 'nope' } })
		);
		expect(unknown).toMatchObject({ error: { code: 'CONTEXT_NOT_FOUND' } });
	});

	it('marks tools/list immediately stale by default, since clients cache it without _meta', async () => {
		const { url } = await serve({ contexts });
		const { json } = await post(
			url,
			{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } },
			modernHeaders('tools/list')
		);
		expect((json.result as Record<string, unknown>).ttlMs).toBe(0);
	});

	it('rejects an unknown _meta context as invalid params', async () => {
		const { url } = await serve({ contexts });
		const { status, json } = await post(
			url,
			{
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
				params: { _meta: { ...META, 'dev.afd/context': 'nope' } },
			},
			modernHeaders('tools/list')
		);
		expect(status).toBe(200);
		expect(json.error?.code).toBe(-32602);
	});

	it('keeps SESSION_REQUIRED for legacy clients without a session on /mcp', async () => {
		const { url } = await serve({ contexts });
		const client = await connect(url, 'legacy');
		const entered = text(
			await client.callTool({ name: 'afd-context-enter', arguments: { context: 'billing' } })
		);
		expect(entered).toMatchObject({ error: { code: 'SESSION_REQUIRED' } });
	});
});

describe('dual-era stdio', () => {
	function stdioDeps() {
		const remote = commands().filter((command) => command.expose?.mcp);
		const contexts = [{ name: 'document' }, { name: 'billing' }];
		const legacyState = createContextState();
		const all = [
			...remote,
			defineCommand({
				...createAfdContextListCommand(() => [...contexts], legacyState),
				input: z.object({}),
				expose: { mcp: true },
			}),
			defineCommand({
				...createAfdContextEnterCommand(() => [...contexts], legacyState),
				input: z.object({ context: z.string().min(1) }),
				expose: { mcp: true },
			}),
		];
		const engine = createExecutionEngine({
			commandMap: new Map(all.map((command) => [command.name, command])),
			middleware: [],
			devMode: false,
			contextState: legacyState,
		});
		const routeToolCall = createToolRouter({
			executeCommand: engine.executeCommand,
			executeBatch: engine.executeBatch,
			executePipeline: engine.executePipeline,
			commands: all,
			toolStrategy: 'individual',
			devMode: false,
			allCommands: all,
			exposedCommandNames: new Set(all.map((command) => command.name)),
			contextState: legacyState,
		});
		return {
			legacyState,
			deps: {
				name: 'stdio-test',
				version: '0.0.1',
				instructions: defaultInstructions({
					name: 'stdio-test',
					toolStrategy: 'individual',
					contexts,
				}),
				getToolsList: () => getToolsList(all, 'individual'),
				routeToolCall,
				contexts,
				devMode: false,
			},
		};
	}

	it.each(['auto', 'legacy'] as const)('serves the %s negotiation mode', async (mode) => {
		const { deps, legacyState } = stdioDeps();
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		const handle = serveModernStdio(deps, legacyState, serverSide);
		const client = new Client(
			{ name: 'stdio-client', version: '0' },
			mode === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {}
		);
		await client.connect(clientSide);
		cleanups.push(async () => {
			await client.close();
			await handle.close();
		});
		expect(client.getProtocolEra()).toBe(mode === 'auto' ? 'modern' : 'legacy');
		expect(client.getInstructions()).toContain('dev.afd/context');
		const created = await client.callTool({ name: 'item-create', arguments: { title: 'c' } });
		expect(text(created)).toMatchObject({ success: true, data: { title: 'c', by: null } });

		await client.callTool({ name: 'afd-context-enter', arguments: { context: 'document' } });
		// A legacy connection keeps one stack for its lifetime; a modern request never does.
		expect(legacyState.getActive()).toBe(mode === 'legacy' ? 'document' : null);
	});
});
