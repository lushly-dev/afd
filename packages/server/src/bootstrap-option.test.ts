/**
 * The `bootstrap` server option registers afd-help, afd-docs and afd-schema as
 * MCP tools that describe only what a remote agent can see.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';
import { createMcpHandler, createMcpServer } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const docEdit = defineCommand({
	name: 'doc-edit',
	description: 'Edit a document',
	category: 'doc',
	expose: { mcp: true },
	requires: ['doc-open'],
	contexts: ['editing'],
	input: z.object({ text: z.string() }),
	handler: async () => ({ success: true, data: 'edited' }),
});
const docPrint = defineCommand({
	name: 'doc-print',
	description: 'Print a document',
	category: 'doc',
	expose: { mcp: true },
	contexts: ['printing'],
	input: z.object({}),
	handler: async () => ({ success: true, data: 'printed' }),
});
const secret = defineCommand({
	name: 'secret-reset',
	description: 'Private reset',
	input: z.object({}),
	handler: async () => ({ success: true, data: 'reset' }),
});
const commands = [docEdit, docPrint, secret];

async function host(options: Partial<McpHandlerOptions> = {}) {
	const handler = createMcpHandler({
		name: 'bootstrap-option',
		version: '1',
		host: '127.0.0.1',
		commands,
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

async function rpc(
	url: string,
	method: string,
	params?: unknown,
	headers: Record<string, string> = {}
) {
	const response = await fetch(`${url}/message`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});
	return (await response.json()) as { result: Record<string, unknown> };
}

/** Initialize over HTTP and return the headers that bind later calls to that MCP session. */
async function openSession(url: string): Promise<Record<string, string>> {
	const response = await fetch(`${url}/message`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize' }),
	});
	const id = response.headers.get('mcp-session-id');
	expect(id).toBeTruthy();
	return { 'Mcp-Session-Id': id ?? '' };
}

async function listTools(url: string) {
	const { result } = await rpc(url, 'tools/list');
	return result.tools as Array<{ name: string; inputSchema: Record<string, unknown> }>;
}

async function call(
	url: string,
	name: string,
	args: unknown = {},
	headers: Record<string, string> = {}
) {
	const { result } = await rpc(url, 'tools/call', { name, arguments: args }, headers);
	const content = result.content as Array<{ text: string }>;
	return JSON.parse(content[0]?.text ?? '{}');
}

describe('bootstrap: false (default)', () => {
	it('registers no bootstrap tools', async () => {
		const url = await host({ toolStrategy: 'individual' });
		const names = (await listTools(url)).map((tool) => tool.name);
		expect(names).not.toContain('afd-help');
		expect((await call(url, 'afd-help')).error.code).toBe('COMMAND_NOT_FOUND');
		const server = createMcpServer({ name: 'x', version: '1', transport: 'http', commands });
		expect((await server.execute('afd-help', {})).error?.code).toBe('COMMAND_NOT_FOUND');
	});
});

describe('bootstrap: true', () => {
	it('lists afd-help, afd-docs and afd-schema with input schemas', async () => {
		const url = await host({ toolStrategy: 'individual', bootstrap: true });
		const tools = await listTools(url);
		for (const name of ['afd-help', 'afd-docs', 'afd-schema']) {
			const tool = tools.find((t) => t.name === name);
			expect(tool?.inputSchema.type).toBe('object');
			expect(tool?.inputSchema.required).toBeUndefined();
		}
	});

	it('describes only MCP-exposed commands, with requires', async () => {
		const url = await host({ toolStrategy: 'individual', bootstrap: true });
		const help = await call(url, 'afd-help', { format: 'full' });
		expect(help.success).toBe(true);
		const names = help.data.commands.map((c: { name: string }) => c.name);
		expect(names).toEqual(['doc-edit', 'doc-print', 'afd-help', 'afd-docs', 'afd-schema']);
		expect(help.data.commands[0].requires).toEqual(['doc-open']);
		for (const tool of ['afd-docs', 'afd-schema']) {
			const text = JSON.stringify(await call(url, tool));
			expect(text).toContain('doc-edit');
			expect(text).not.toContain('secret-reset');
		}
		const ts = await call(url, 'afd-schema', { format: 'typescript' });
		expect(ts.data.typescript).toContain('export type DocEditInput = {\n\ttext: string;\n};');
	});

	it('validates bootstrap tool input like any command', async () => {
		const url = await host({ toolStrategy: 'individual', bootstrap: true });
		expect((await call(url, 'afd-help', { format: 'huge' })).error.code).toBe('VALIDATION_ERROR');
	});

	it('runs in-process through server.execute', async () => {
		const server = createMcpServer({
			name: 'x',
			version: '1',
			transport: 'http',
			commands,
			bootstrap: true,
		});
		const result = await server.execute('afd-help', {});
		expect(result.success).toBe(true);
		expect(JSON.stringify(result.data)).not.toContain('secret-reset');
		expect(server.getCommands()).toEqual(commands);
	});

	it('follows the active context and lists the context commands', async () => {
		const url = await host({
			toolStrategy: 'individual',
			bootstrap: true,
			contexts: [{ name: 'editing' }, { name: 'printing' }],
		});
		// Contexts are per MCP session over HTTP, so bind these calls to one session.
		const session = await openSession(url);
		const before = await call(url, 'afd-help', {}, session);
		const all = before.data.commands.map((c: { name: string }) => c.name);
		expect(all).toEqual(expect.arrayContaining(['doc-edit', 'doc-print', 'afd-context-enter']));
		expect((await call(url, 'afd-context-enter', { context: 'editing' }, session)).success).toBe(
			true
		);
		const inEditing = (await call(url, 'afd-help', {}, session)).data.commands.map(
			(c: { name: string }) => c.name
		);
		expect(inEditing).toContain('doc-edit');
		expect(inEditing).not.toContain('doc-print');
		expect(inEditing).toContain('afd-help');
		// Another session is unaffected by this one's context.
		const other = await openSession(url);
		const otherNames = (await call(url, 'afd-help', {}, other)).data.commands.map(
			(c: { name: string }) => c.name
		);
		expect(otherNames).toContain('doc-print');
	});

	it('groups the bootstrap tools under their category in grouped mode', async () => {
		const url = await host({ bootstrap: true });
		const bootstrap = (await listTools(url)).find((tool) => tool.name === 'bootstrap');
		expect(bootstrap?.inputSchema).toMatchObject({
			properties: { action: { enum: ['help', 'docs', 'schema'] } },
		});
		const docs = await call(url, 'bootstrap', { action: 'docs', params: { command: 'doc-edit' } });
		expect(docs.data.markdown).toContain('| text | string | Yes |');
	});
});
