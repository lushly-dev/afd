/**
 * The meta-tools' `meta` argument (`spec/command-metadata.md`, "Decisions on the tool surface
 * (#466)"): `dev.afd/context` and declared context fields applied as if sent in `_meta`, over
 * MCP 2026-07-28, `/message` and in process; unknown keys dropped; a key sent both ways must agree.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ContextField } from './context-fields.js';
import { createDirectRegistry } from './direct-registry.js';
import { createDirectToolSurface } from './direct-tool-surface.js';
import { liftMetaArgument, metaArgumentKeys } from './meta-argument.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

const FIELDS: ContextField[] = [
	{ name: 'scope', meta: 'dev.example/scope', schema: z.object({ project: z.string() }) },
];
const CONTEXTS = [
	{ name: 'billing', description: 'Billing work' },
	{ name: 'support', description: 'Support work' },
];

const commands = [
	defineCommand({
		name: 'scope-echo',
		description: 'Return the scope the call sees',
		expose: { mcp: true },
		input: z.object({}),
		handler: async (_input, context) => success({ scope: context?.scope ?? null }),
	}),
	defineCommand({
		name: 'invoice-list',
		description: 'List invoices',
		contexts: ['billing'],
		expose: { mcp: true },
		input: z.object({}),
		handler: async () => success({ invoices: [] }),
	}),
	defineCommand({
		name: 'ticket-list',
		description: 'List tickets',
		contexts: ['support'],
		expose: { mcp: true },
		input: z.object({}),
		handler: async () => success({ tickets: [] }),
	}),
];

const SCOPE = { 'dev.example/scope': { project: 'p-1' } };

describe('liftMetaArgument', () => {
	const keys = metaArgumentKeys(FIELDS);

	it('leaves other tools, and meta-tool calls without meta, unchanged', () => {
		const args = { meta: SCOPE };
		expect(liftMetaArgument('scope-echo', args, undefined, keys)).toEqual({
			ok: true,
			args,
			meta: undefined,
		});
		expect(liftMetaArgument('afd-call', { command: 'x' }, { a: 1 }, keys)).toEqual({
			ok: true,
			args: { command: 'x' },
			meta: { a: 1 },
		});
	});

	it('moves known keys into _meta, drops the rest, and accepts an agreeing duplicate', () => {
		const lifted = liftMetaArgument(
			'afd-call',
			{ command: 'x', meta: { ...SCOPE, 'dev.afd/context': 'billing', 'dev.other/key': 1 } },
			{ 'dev.example/scope': { project: 'p-1' }, 'io.modelcontextprotocol/x': true },
			keys
		);
		expect(lifted).toEqual({
			ok: true,
			args: { command: 'x' },
			meta: { ...SCOPE, 'dev.afd/context': 'billing', 'io.modelcontextprotocol/x': true },
		});
	});

	it('refuses a key the two disagree on, and a meta that is not an object', () => {
		const disagree = liftMetaArgument(
			'afd-detail',
			{ command: 'x', meta: { 'dev.afd/context': 'billing' } },
			{ 'dev.afd/context': 'other' },
			keys
		);
		expect(disagree).toMatchObject({
			ok: false,
			error: { code: 'VALIDATION_ERROR', details: { meta: 'dev.afd/context' } },
		});
		expect(liftMetaArgument('afd-call', { meta: null }, undefined, keys)).toEqual({
			ok: true,
			args: {},
			meta: undefined,
		});
		expect(
			liftMetaArgument(
				'afd-call',
				{ meta: { 'dev.afd/context': null } },
				{ 'dev.afd/context': 'billing' },
				keys
			)
		).toEqual({ ok: true, args: {}, meta: { 'dev.afd/context': 'billing' } });
		expect(liftMetaArgument('afd-batch', { meta: [1] }, undefined, keys)).toMatchObject({
			ok: false,
			error: { code: 'VALIDATION_ERROR', details: { argument: 'meta' } },
		});
	});
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function serve(options: Partial<McpHandlerOptions> = {}) {
	const handler = createMcpHandler({
		name: 'meta-argument',
		version: '1.0.0',
		host: '127.0.0.1',
		commands,
		toolStrategy: 'lazy',
		contexts: CONTEXTS,
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

function text(result: unknown): { success: boolean; data?: unknown; error?: { code: string } } {
	const content = (result as { content: Array<{ text: string }> }).content;
	return JSON.parse(content[0]?.text ?? '{}');
}

describe('over MCP 2026-07-28', () => {
	async function connect(options?: Partial<McpHandlerOptions>) {
		const client = new Client(
			{ name: 'meta-client', version: '0' },
			{ versionNegotiation: { mode: 'auto' } }
		);
		await client.connect(new StreamableHTTPClientTransport(new URL(`${await serve(options)}/mcp`)));
		cleanups.push(() => client.close());
		return client;
	}

	it('delivers declared fields and the context through afd-call, afd-batch and afd-pipe', async () => {
		const client = await connect();
		const call = await client.callTool({
			name: 'afd-call',
			arguments: { command: 'scope-echo', input: {}, meta: SCOPE },
		});
		expect(text(call)).toMatchObject({ success: true, data: { scope: { project: 'p-1' } } });

		// In no context every command is callable; in billing, a support command is not.
		const anywhere = await client.callTool({
			name: 'afd-call',
			arguments: { command: 'ticket-list', input: {} },
		});
		expect(text(anywhere).success).toBe(true);
		const inBilling = await client.callTool({
			name: 'afd-call',
			arguments: { command: 'ticket-list', input: {}, meta: { 'dev.afd/context': 'billing' } },
		});
		expect(text(inBilling).success).toBe(false);

		const batch = text(
			await client.callTool({
				name: 'afd-batch',
				arguments: { commands: [{ command: 'scope-echo', input: {} }], meta: SCOPE },
			})
		) as unknown as { results: Array<{ result: { data: unknown } }> };
		expect(batch.results[0]?.result.data).toEqual({ scope: { project: 'p-1' } });

		const pipe = text(
			await client.callTool({
				name: 'afd-pipe',
				arguments: { steps: [{ command: 'scope-echo' }], meta: SCOPE },
			})
		) as { data?: unknown };
		expect(pipe.data).toEqual({ scope: { project: 'p-1' } });
	});

	it('scopes afd-discover and afd-detail by the context it names', async () => {
		const client = await connect();
		const names = async (meta?: Record<string, unknown>) =>
			(
				text(await client.callTool({ name: 'afd-discover', arguments: meta ? { meta } : {} })) as {
					data?: { commands: Array<{ name: string }> };
				}
			).data?.commands.map((command) => command.name);
		expect(await names()).toContain('ticket-list');
		expect(await names({ 'dev.afd/context': 'billing' })).not.toContain('ticket-list');

		const detail = text(
			await client.callTool({
				name: 'afd-detail',
				arguments: { command: 'ticket-list', meta: { 'dev.afd/context': 'billing' } },
			})
		) as { data?: Array<{ found: boolean }> };
		expect(detail.data?.[0]?.found).toBe(false);
	});

	it('fails a call whose _meta and meta argument disagree', async () => {
		const client = await connect();
		const result = await client.callTool({
			name: 'afd-call',
			arguments: { command: 'scope-echo', input: {}, meta: SCOPE },
			_meta: { 'dev.example/scope': { project: 'p-2' } },
		});
		expect(result.isError).toBe(true);
		expect(text(result)).toMatchObject({
			success: false,
			error: { code: 'VALIDATION_ERROR', details: { meta: 'dev.example/scope' } },
		});
	});

	it('validates a declared field it delivers, and lets createContext win', async () => {
		const client = await connect({ createContext: () => ({ scope: { project: 'host' } }) });
		const result = await client.callTool({
			name: 'afd-call',
			arguments: { command: 'scope-echo', input: {}, meta: SCOPE },
		});
		expect(text(result)).toMatchObject({ data: { scope: { project: 'host' } } });

		const plain = await connect();
		const invalid = await plain.callTool({
			name: 'afd-call',
			arguments: {
				command: 'scope-echo',
				input: {},
				meta: { 'dev.example/scope': { project: 7 } },
			},
		});
		expect(text(invalid)).toMatchObject({
			error: { code: 'VALIDATION_ERROR', details: { field: 'scope' } },
		});
	});
});

describe('over /message', () => {
	it('delivers a declared field through afd-call', async () => {
		const response = await fetch(`${await serve()}/message`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'afd-call',
					arguments: { command: 'scope-echo', input: {}, meta: SCOPE },
				},
			}),
		});
		const body = (await response.json()) as { result: unknown };
		expect(text(body.result)).toMatchObject({ data: { scope: { project: 'p-1' } } });
	});
});

describe('in process', () => {
	const registry = createDirectRegistry(commands, {
		contexts: CONTEXTS,
		contextFields: FIELDS,
		tools: createDirectToolSurface({ strategy: 'lazy' }),
	});

	it('applies meta as the activeContext option and context values', async () => {
		const result = await registry.execute('afd-call', {
			command: 'invoice-list',
			input: {},
			meta: { 'dev.afd/context': 'billing' },
		});
		expect(result).toMatchObject({ success: true, data: { invoices: [] } });
		const scoped = await registry.execute('afd-call', {
			command: 'scope-echo',
			input: {},
			meta: SCOPE,
		});
		expect(scoped).toMatchObject({ data: { scope: { project: 'p-1' } } });
	});

	it('fails when meta disagrees with the activeContext option or the context', async () => {
		const context = await registry.execute(
			'afd-call',
			{ command: 'invoice-list', input: {}, meta: { 'dev.afd/context': 'billing' } },
			{},
			{ activeContext: 'other' }
		);
		expect(context.error).toMatchObject({ code: 'VALIDATION_ERROR' });
		const field = await registry.execute(
			'afd-call',
			{ command: 'scope-echo', input: {}, meta: SCOPE },
			{ scope: { project: 'p-2' } }
		);
		expect(field.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			details: { meta: 'dev.example/scope' },
		});
	});

	it('refuses an unknown context named in meta', async () => {
		const result = await registry.execute('afd-call', {
			command: 'invoice-list',
			input: {},
			meta: { 'dev.afd/context': 'nowhere' },
		});
		expect(result.error?.code).toBe('CONTEXT_NOT_FOUND');
	});
});
