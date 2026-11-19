/**
 * MCP tool fields derived from command metadata (`spec/command-metadata.md`, "MCP tool fields"):
 * annotations, the CommandResult `outputSchema`, and `structuredContent`, checked with the MCP
 * TypeScript SDK v2 client, which validates `structuredContent` against `outputSchema`.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { commandResultOutputSchema, failure, success } from '@lushly-dev/afd-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Ajv } from '@modelcontextprotocol/client/validators/ajv';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand, defineCommandWithSchema } from './schema.js';
import { createMcpHandler } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const Todo = z.object({ id: z.string(), title: z.string() });
const Task = z.object({
	title: z.string(),
	get subtasks() {
		return z.array(Task);
	},
});
const commands = [
	defineCommand({
		name: 'todo-get',
		description: 'Get a todo',
		mutation: false,
		expose: { mcp: true },
		input: z.object({ id: z.string() }),
		output: Todo,
		handler: async ({ id }) =>
			id === 'missing'
				? failure({ code: 'NOT_FOUND', message: 'No such todo', suggestion: 'List todos first' })
				: success({ id, title: 'Milk' }),
	}),
	// Zod emits a recursive type into `definitions`, referenced as `#/definitions/...`.
	defineCommand({
		name: 'todo-tree',
		description: 'Get a todo with its subtasks',
		mutation: false,
		expose: { mcp: true },
		input: z.object({ fail: z.boolean() }),
		output: z.object({ root: Task }),
		handler: async ({ fail }) =>
			fail
				? failure({ code: 'NOT_FOUND', message: 'No tree', suggestion: 'List todos first' })
				: success({ root: { title: 'Shop', subtasks: [{ title: 'Milk', subtasks: [] }] } }),
	}),
	// A schema written by hand keeps a nested type in `$defs`.
	defineCommandWithSchema({
		name: 'todo-tagged',
		description: 'Get a tagged todo',
		mutation: false,
		expose: { mcp: true },
		input: z.object({ fail: z.boolean() }),
		jsonSchema: {
			type: 'object',
			properties: { fail: { type: 'boolean' } },
			required: ['fail'],
		},
		outputJsonSchema: {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			properties: { tags: { type: 'array', items: { $ref: '#/$defs/Tag' } } },
			required: ['tags'],
			$defs: {
				Tag: {
					type: 'object',
					properties: { name: { type: 'string' } },
					required: ['name'],
					additionalProperties: false,
				},
			},
		} as never,
		handler: async ({ fail }) =>
			fail
				? failure({ code: 'NOT_FOUND', message: 'No tags', suggestion: 'List todos first' })
				: success({ tags: [{ name: 'home' }] }),
	}),
	defineCommand({
		name: 'todo-purge',
		description: 'Delete every todo',
		mutation: true,
		destructive: true,
		expose: { mcp: true },
		input: z.object({}),
		handler: async () => success({ deleted: 3 }),
	}),
	defineCommand({
		name: 'todo-touch',
		description: 'Unspecified mutation',
		expose: { mcp: true },
		input: z.object({}),
		handler: async () => success({}),
	}),
];

async function connect(options: Partial<McpHandlerOptions> = {}) {
	const handler = createMcpHandler({
		name: 'surface',
		version: '1.0.0',
		commands,
		host: '127.0.0.1',
		toolStrategy: 'individual',
		...options,
	});
	const http = createServer(handler);
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
	const url = new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`);
	const client = new Client(
		{ name: 'surface-test', version: '0' },
		{ versionNegotiation: { mode: 'auto' } }
	);
	await client.connect(new StreamableHTTPClientTransport(url));
	cleanups.push(async () => {
		await client.close();
		handler.dispose();
		http.closeAllConnections();
		await new Promise<void>((resolve) => http.close(() => resolve()));
	});
	return client;
}

describe('MCP tool fields', () => {
	it('derives annotations only from metadata the command sets', async () => {
		const client = await connect();
		const tools = Object.fromEntries(
			(await client.listTools()).tools.map((tool) => [tool.name, tool])
		);
		expect(tools['todo-get']?.annotations).toEqual({ readOnlyHint: true });
		expect(tools['todo-purge']?.annotations).toEqual({
			readOnlyHint: false,
			destructiveHint: true,
		});
		expect(tools['todo-touch']?.annotations).toBeUndefined();
		expect(tools['afd-call']?.annotations).toBeUndefined();
	});

	it('advertises the CommandResult envelope as outputSchema and satisfies it', async () => {
		const client = await connect();
		const tools = Object.fromEntries(
			(await client.listTools()).tools.map((tool) => [tool.name, tool])
		);
		const schema = tools['todo-get']?.outputSchema as { properties: Record<string, unknown> };
		expect(schema.properties.data).toMatchObject({ type: 'object', required: ['id', 'title'] });
		expect(tools['todo-purge']?.outputSchema).toBeUndefined();

		// The client validates structuredContent against outputSchema, for success and failure.
		const found = await client.callTool({ name: 'todo-get', arguments: { id: 't1' } });
		expect(found.structuredContent).toMatchObject({
			success: true,
			data: { id: 't1', title: 'Milk' },
		});
		expect(JSON.parse((found.content as Array<{ text: string }>)[0]?.text ?? '')).toEqual(
			found.structuredContent
		);
		const missing = await client.callTool({ name: 'todo-get', arguments: { id: 'missing' } });
		expect(missing.isError).toBe(true);
		expect(missing.structuredContent).toMatchObject({
			success: false,
			error: { code: 'NOT_FOUND' },
		});
	});

	it('moves $defs and definitions to the envelope, where the client resolves them', async () => {
		const client = await connect();
		const tools = Object.fromEntries(
			(await client.listTools()).tools.map((tool) => [tool.name, tool])
		);
		for (const [name, key] of [
			['todo-tree', 'definitions'],
			['todo-tagged', '$defs'],
		] as const) {
			const schema = tools[name]?.outputSchema as Record<string, unknown> & {
				properties: { data: Record<string, unknown> };
			};
			expect(schema[key]).toBeDefined();
			expect(schema.properties.data[key]).toBeUndefined();
			expect(schema.properties.data.$schema).toBeUndefined();

			// The client validates structuredContent against outputSchema, for success and failure.
			const found = await client.callTool({ name, arguments: { fail: false } });
			expect(found.isError).toBeFalsy();
			expect(found.structuredContent).toMatchObject({ success: true });
			const failed = await client.callTool({ name, arguments: { fail: true } });
			expect(failed.isError).toBe(true);
			expect(failed.structuredContent).toMatchObject({
				success: false,
				error: { code: 'NOT_FOUND' },
			});
		}
	});

	it('validates local references against the output schema with its own $id', () => {
		const data = {
			$id: 'https://example.com/item',
			type: 'object',
			properties: { tag: { type: 'string', $ref: '#/$defs/Tag' } },
			$defs: { Tag: { $ref: '#/definitions/Name' } },
			definitions: { Name: { type: 'string', minLength: 1 } },
		} as const;
		const schema = commandResultOutputSchema(data);
		const validate = new Ajv().compile(schema);
		expect(validate({ success: true, data: { tag: 'home' } })).toBe(true);
		expect(validate({ success: true, data: { tag: '' } })).toBe(false);
	});

	it('sends structuredContent from tools without an outputSchema too', async () => {
		const client = await connect();
		const purged = await client.callTool({ name: 'todo-purge', arguments: {} });
		expect(purged.structuredContent).toMatchObject({ success: true, data: { deleted: 3 } });
		const batch = await client.callTool({
			name: 'afd-batch',
			arguments: { commands: [{ command: 'todo-touch', input: {} }] },
		});
		expect(batch.structuredContent).toMatchObject({ summary: { successCount: 1 } });
	});

	it('can switch the top-level outputSchema off', async () => {
		const client = await connect({ advertiseOutputSchema: false });
		const tool = (await client.listTools()).tools.find((item) => item.name === 'todo-get');
		expect(tool?.outputSchema).toBeUndefined();
		expect(tool?._meta).toMatchObject({ outputSchema: { type: 'object' } });
	});
});
