/**
 * Declared context fields over MCP and AFD's HTTP lanes (`spec/context-fields.md`): values come
 * from `_meta` on both eras, over Streamable HTTP and stdio, and on `/message`, `/rpc`, `/batch`
 * and `/stream`; `createContext` wins; undeclared keys are dropped; `tools/list` does not vary;
 * `server/discover` and `afd-help` list the fields.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ContextField } from './context-fields.js';
import { createExecutionEngine } from './execution.js';
import { defaultInstructions, serveModernStdio } from './mcp-modern.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';
import type { McpHandlerOptions } from './server-types.js';
import { createToolRouter } from './tool-router.js';
import { getToolsList } from './tools.js';

const FIELDS: ContextField[] = [
	{ name: 'scope', meta: 'dev.example/scope', schema: z.object({ project: z.string() }) },
	{ name: 'locale', meta: 'dev.example/locale', schema: z.string().max(35) },
];

function commands() {
	return [
		defineCommand({
			name: 'scope-echo',
			description: 'Return the declared fields the call sees',
			input: z.object({}),
			expose: { mcp: true },
			handler: async (_input, context) =>
				success({
					scope: context?.scope ?? null,
					locale: context?.locale ?? null,
					undeclared: context?.['dev.example/other'] ?? null,
				}),
		}),
	];
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function serve(options: Partial<McpHandlerOptions> = {}) {
	const handler = createMcpHandler({
		name: 'fields-test',
		version: '1.0.0',
		commands: commands(),
		host: '127.0.0.1',
		toolStrategy: 'individual',
		bootstrap: true,
		contextFields: FIELDS,
		...options,
	});
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function connect(url: string, mode: 'auto' | 'legacy') {
	const client = new Client(
		{ name: 'fields-client', version: '0' },
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

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			...headers,
		},
		body: JSON.stringify(body),
	});
	const raw = await response.text();
	try {
		return JSON.parse(raw);
	} catch {
		const data = /^data: (.*)$/m.exec(raw)?.[1];
		return data ? JSON.parse(data) : undefined;
	}
}

const META = {
	'dev.example/scope': { project: 'p-1' },
	'dev.example/locale': 'en-GB',
	'dev.example/other': 'dropped',
};

describe.each(['auto', 'legacy'] as const)('tools/call over Streamable HTTP (%s)', (mode) => {
	it('delivers declared _meta values, drops undeclared keys and rejects invalid values', async () => {
		const client = await connect(`${await serve()}/mcp`, mode);
		expect(client.getProtocolEra()).toBe(mode === 'auto' ? 'modern' : 'legacy');

		const result = await client.callTool({ name: 'scope-echo', arguments: {}, _meta: META });
		expect(text(result)).toMatchObject({
			success: true,
			data: { scope: { project: 'p-1' }, locale: 'en-GB', undeclared: null },
		});

		const invalid = await client.callTool({
			name: 'scope-echo',
			arguments: {},
			_meta: { 'dev.example/scope': { project: 7 } },
		});
		expect(text(invalid)).toMatchObject({
			success: false,
			error: { code: 'VALIDATION_ERROR', details: { field: 'scope', meta: 'dev.example/scope' } },
		});
	});

	it('lets a value from createContext win over the caller', async () => {
		const client = await connect(
			`${await serve({ createContext: () => ({ locale: 'fr-FR' }) })}/mcp`,
			mode
		);
		const result = await client.callTool({ name: 'scope-echo', arguments: {}, _meta: META });
		expect(text(result)).toMatchObject({ data: { locale: 'fr-FR' } });
	});

	it('does not vary tools/list by a declared field', async () => {
		const client = await connect(`${await serve()}/mcp`, mode);
		const plain = await client.listTools();
		const withMeta = await client.listTools({ _meta: META });
		expect(withMeta.tools).toEqual(plain.tools);
	});
});

describe('discovery', () => {
	const described = [
		{
			name: 'scope',
			meta: 'dev.example/scope',
			schema: expect.objectContaining({ type: 'object' }),
			required: false,
			journal: false,
		},
		{
			name: 'locale',
			meta: 'dev.example/locale',
			schema: expect.objectContaining({ type: 'string' }),
			required: false,
			journal: false,
		},
	];

	it('server/discover lists the fields under _meta["dev.afd/context-fields"]', async () => {
		const body = await postJson(
			`${await serve()}/mcp`,
			{
				jsonrpc: '2.0',
				id: 1,
				method: 'server/discover',
				params: {
					_meta: {
						'io.modelcontextprotocol/protocolVersion': '2026-07-28',
						'io.modelcontextprotocol/clientCapabilities': {},
						'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
					},
				},
			},
			{ 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'server/discover' }
		);
		expect(body.result.supportedVersions).toContain('2026-07-28');
		expect(body.result._meta['dev.afd/context-fields']).toEqual(described);
	});

	it('afd-help lists the fields', async () => {
		const client = await connect(`${await serve()}/mcp`, 'auto');
		const help = text(await client.callTool({ name: 'afd-help', arguments: {} }));
		expect((help.data as { contextFields: unknown }).contextFields).toEqual(described);
	});
});

describe('AFD HTTP lanes', () => {
	it('/message tools/call reads params._meta', async () => {
		const base = await serve();
		const body = await postJson(`${base}/message`, {
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name: 'scope-echo', arguments: {}, _meta: META },
		});
		expect(text(body.result)).toMatchObject({
			data: { scope: { project: 'p-1' }, undeclared: null },
		});
	});

	it('/rpc reads params._meta and leaves it out of the input', async () => {
		const base = await serve();
		const body = await postJson(`${base}/rpc`, {
			jsonrpc: '2.0',
			id: 1,
			method: 'scope-echo',
			params: { _meta: META },
		});
		expect(body.result).toMatchObject({ success: true, data: { locale: 'en-GB' } });
	});

	it('/batch reads the body _meta for every item', async () => {
		const base = await serve();
		const body = await postJson(`${base}/batch`, {
			commands: [
				{ id: 'a', command: 'scope-echo', input: {} },
				{ id: 'b', command: 'scope-echo', input: {} },
			],
			_meta: META,
		});
		expect(
			body.results.map((item: { result: { data: { locale: string } } }) => item.result.data.locale)
		).toEqual(['en-GB', 'en-GB']);
	});

	it('/stream reads the body _meta and leaves it out of the input', async () => {
		const base = await serve();
		const response = await fetch(`${base}/stream/scope-echo`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ _meta: META }),
		});
		const events = await response.text();
		expect(events).toContain('"locale":"en-GB"');
	});
});

describe.each(['auto', 'legacy'] as const)('tools/call over stdio (%s)', (mode) => {
	it('delivers declared _meta values', async () => {
		const all = commands();
		const engine = createExecutionEngine({
			commandMap: new Map(all.map((command) => [command.name, command])),
			middleware: [],
			devMode: false,
			contextFields: FIELDS,
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
		});
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		const handle = serveModernStdio(
			{
				name: 'fields-stdio',
				version: '0.0.1',
				instructions: defaultInstructions({ name: 'fields-stdio', toolStrategy: 'individual' }),
				getToolsList: () => getToolsList(all, 'individual'),
				routeToolCall,
				contextFields: FIELDS,
				devMode: false,
			},
			undefined,
			serverSide
		);
		const client = new Client(
			{ name: 'fields-stdio-client', version: '0' },
			mode === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {}
		);
		await client.connect(clientSide);
		cleanups.push(async () => {
			await client.close();
			await handle.close();
		});
		expect(client.getProtocolEra()).toBe(mode === 'auto' ? 'modern' : 'legacy');
		const result = await client.callTool({ name: 'scope-echo', arguments: {}, _meta: META });
		expect(text(result)).toMatchObject({
			data: { scope: { project: 'p-1' }, locale: 'en-GB', undeclared: null },
		});
	});
});
