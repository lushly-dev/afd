/**
 * Input schemas are generated in Zod input mode, output schemas in output mode.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand, getRequiredFields, zodToJsonSchema } from './schema.js';
import { createMcpHandler } from './server.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const listInput = z.object({
	search: z.string().optional(),
	sortBy: z.enum(['createdAt', 'title']).default('createdAt'),
	limit: z.number().int().min(1).max(100).default(20),
	offset: z.number().default(0),
	owner: z.string(),
});

describe('input schemas in input mode', () => {
	it('does not advertise defaulted fields as required', () => {
		const cmd = defineCommand({
			name: 'todo-list',
			description: 'List todos',
			input: listInput,
			handler: async () => ({ success: true, data: [] }),
		});
		expect(cmd.jsonSchema.required).toEqual(['owner']);
		expect(cmd.jsonSchema.properties?.limit).toMatchObject({ type: 'integer', default: 20 });
		expect(getRequiredFields(listInput)).toEqual(['owner']);
		const parameters = cmd.toCommandDefinition().parameters;
		expect(parameters.filter((p) => p.required).map((p) => p.name)).toEqual(['owner']);
		expect(parameters.find((p) => p.name === 'limit')).toMatchObject({
			type: 'integer',
			required: false,
			default: 20,
		});
	});

	it('does not add additionalProperties: false, since unknown keys are stripped, not rejected', () => {
		expect(zodToJsonSchema(z.object({ a: z.string() })).additionalProperties).toBeUndefined();
		expect(zodToJsonSchema(z.object({ a: z.string() }).strict()).additionalProperties).toBe(false);
	});

	it('keeps output mode available and uses it for output schemas', () => {
		expect(zodToJsonSchema(listInput, { io: 'output' }).required).toEqual([
			'sortBy',
			'limit',
			'offset',
			'owner',
		]);
		const cmd = defineCommand({
			name: 'todo-get',
			description: 'Get a todo',
			input: z.object({}),
			output: z.object({ done: z.boolean().default(false) }),
			handler: async () => ({ success: true, data: { done: false } }),
		});
		expect(cmd.outputJsonSchema?.required).toEqual(['done']);
		expect(cmd.toCommandDefinition().returns?.required).toEqual(['done']);
	});

	it('accepts transforms in input schemas and describes their input type', () => {
		const create = () =>
			defineCommand({
				name: 'item-add',
				description: 'Add to a count',
				input: z.object({ amount: z.string().transform(Number), note: z.string().trim() }),
				examples: [{ title: 'Add', input: { amount: '2', note: 'x' } }],
				handler: async (input) => ({ success: true, data: input.amount + 1 }),
			});
		expect(create).not.toThrow();
		expect(create().jsonSchema.properties?.amount).toEqual({ type: 'string' });
		expect(() => zodToJsonSchema(z.string().transform(Number), { io: 'output' })).toThrow();
	});
});

describe('transform in an input schema over MCP', () => {
	async function host() {
		const add = defineCommand({
			name: 'counter-add',
			description: 'Add an amount given as a string',
			expose: { mcp: true },
			input: z.object({
				amount: z.string().transform((value) => Number.parseInt(value, 10)),
				step: z.number().default(1),
			}),
			handler: async (input) => ({ success: true, data: { total: input.amount + input.step } }),
		});
		const handler = createMcpHandler({
			name: 'schema-io',
			version: '1',
			host: '127.0.0.1',
			commands: [add],
			toolStrategy: 'individual',
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

	async function rpc(url: string, method: string, params?: unknown) {
		const response = await fetch(`${url}/message`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		});
		expect(response.status).toBe(200);
		return (await response.json()) as { result: Record<string, unknown> };
	}

	it('lists the input type and runs the transformed value through the handler', async () => {
		const url = await host();
		const listed = await rpc(url, 'tools/list');
		const tools = listed.result.tools as Array<{ name: string; inputSchema: unknown }>;
		expect(tools.find((tool) => tool.name === 'counter-add')?.inputSchema).toEqual({
			type: 'object',
			properties: { amount: { type: 'string' }, step: { type: 'number', default: 1 } },
			required: ['amount'],
		});

		const called = await rpc(url, 'tools/call', {
			name: 'counter-add',
			arguments: { amount: '41' },
		});
		const content = called.result.content as Array<{ text: string }>;
		expect(called.result.isError).toBe(false);
		expect(JSON.parse(content[0]?.text ?? '{}').data).toEqual({ total: 42 });
	});
});
