/**
 * Meta-tool (afd-call, afd-batch, afd-pipe, afd-discover, afd-detail) argument
 * validation: invalid arguments return structured failures, never thrown errors.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	batchArgsSchema,
	batchTool,
	callTool,
	detailTool,
	discoverTool,
	pipeTool,
} from './meta-tools.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const itemGet = defineCommand({
	name: 'item-get',
	description: 'Read an item',
	category: 'item',
	tags: ['read'],
	expose: { mcp: true },
	input: z.object({}),
	handler: async () => ({ success: true, data: 'item' }),
});

async function host(toolStrategy: 'individual' | 'grouped' | 'lazy' = 'lazy') {
	const handler = createMcpHandler({
		name: 'meta-tools',
		version: '1',
		host: '127.0.0.1',
		commands: [itemGet],
		toolStrategy,
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

async function call(url: string, name: string, args: unknown) {
	const response = await fetch(`${url}/message`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name, arguments: args },
		}),
	});
	expect(response.status).toBe(200);
	const body = (await response.json()) as {
		result: { content: [{ text: string }]; isError: boolean };
	};
	return { isError: body.result.isError, value: JSON.parse(body.result.content[0].text) };
}

describe('meta-tool argument validation over HTTP', () => {
	it.each([
		['afd-discover', { search: 123 }, 'search'],
		['afd-discover', { tagMode: 'some' }, 'tagMode'],
		['afd-discover', { tag: 5 }, 'tag'],
		['afd-discover', { limit: 'ten' }, 'limit'],
		['afd-detail', {}, 'command'],
		['afd-detail', { command: 42 }, 'command'],
		['afd-detail', { command: ['item-get', 7] }, 'command'],
		['afd-call', {}, 'command'],
		['afd-call', { command: 42 }, 'command'],
		['afd-call', { command: '' }, 'command'],
	])('%s %j returns VALIDATION_ERROR', async (tool, args, path) => {
		const url = await host();
		const { isError, value } = await call(url, tool, args);
		expect(isError).toBe(true);
		expect(value.success).toBe(false);
		expect(value.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			message: `Invalid ${tool} arguments`,
			suggestion: expect.stringContaining(path),
		});
		expect(value.error.details.errors[0].path).toBe(path);
	});

	it('rejects non-object arguments as JSON-RPC invalid params before routing', async () => {
		const url = await host();
		const response = await fetch(`${url}/message`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'afd-discover', arguments: 'not-an-object' },
			}),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ id: 1, error: { code: -32602 } });
	});

	it('explains missing and mistyped fields in the suggestion', async () => {
		const url = await host();
		const missing = await call(url, 'afd-detail', {});
		expect(missing.value.error.suggestion).toContain('Missing required field(s): command');
		expect(missing.value.error.suggestion).toContain('Provide { command: "command-name" }');
		const wrong = await call(url, 'afd-discover', { search: 123 });
		expect(wrong.value.error.suggestion).toContain('expected string, received number');
	});

	it('treats null arguments as omitted', async () => {
		const url = await host();
		const discovered = await call(url, 'afd-discover', { search: null, limit: null, tag: null });
		expect(discovered.value.success).toBe(true);
		expect(discovered.value.data.returned).toBe(1);
		const called = await call(url, 'afd-call', { command: 'item-get', input: null });
		expect(called.value).toMatchObject({ success: true, data: 'item' });
		expect((await call(url, 'afd-detail', { command: null })).value.error.code).toBe(
			'VALIDATION_ERROR'
		);
	});

	it('still serves valid meta-tool calls', async () => {
		const url = await host();
		expect(
			(await call(url, 'afd-discover', { tag: ['read'], tagMode: 'all' })).value.data
		).toMatchObject({ returned: 1 });
		expect((await call(url, 'afd-detail', { command: ['item-get'] })).value.data[0].found).toBe(
			true
		);
		expect((await call(url, 'afd-call', { command: 'item-get' })).value.data).toBe('item');
	});

	it('pinpoints batch shape errors and keeps INVALID_BATCH_REQUEST', async () => {
		const url = await host();
		for (const args of [
			{ commands: 'item-get' },
			{ commands: [{ command: ' ' }] },
			{ commands: [{ command: 'item-get' }], options: { parallelism: 0 } },
		]) {
			const { isError, value } = await call(url, 'afd-batch', args);
			expect(isError).toBe(true);
			expect(value.error.code).toBe('INVALID_BATCH_REQUEST');
			expect(value.error.details.errors.length).toBeGreaterThan(0);
			expect(value.error.suggestion).toContain('Provide { commands: [...] }');
		}
		const ok = await call(url, 'afd-batch', { commands: [{ command: 'item-get', input: {} }] });
		expect(ok.value.success).toBe(true);
	});

	it('pinpoints pipeline shape errors and keeps INVALID_PIPELINE_REQUEST', async () => {
		const url = await host();
		const shape = await call(url, 'afd-pipe', { steps: [{ command: 'item-get', input: 'x' }] });
		expect(shape.isError).toBe(true);
		expect(shape.value.steps[0].error).toMatchObject({ code: 'INVALID_PIPELINE_REQUEST' });
		expect(shape.value.steps[0].error.details.errors[0].path).toBe('steps.0.input');

		// A malformed condition passes the shape check and is caught by the envelope check.
		const condition = await call(url, 'afd-pipe', {
			steps: [{ command: 'item-get', when: { $bogus: 1 } }],
		});
		expect(condition.value.steps[0].error.code).toBe('INVALID_PIPELINE_REQUEST');
		expect(condition.value.steps[0].error.details).toBeUndefined();

		const ok = await call(url, 'afd-pipe', { steps: [{ command: 'item-get' }] });
		expect(ok.value.steps[0].status).toBe('success');
	});
});

describe('meta-tool definitions', () => {
	it('advertise the schemas the router validates', () => {
		expect(callTool.inputSchema).toMatchObject({
			type: 'object',
			properties: { command: { type: 'string' }, input: { type: 'object' } },
			required: ['command'],
		});
		expect(detailTool.inputSchema).toMatchObject({
			properties: { command: { anyOf: [{ type: 'string' }, { type: 'array' }] } },
			required: ['command'],
		});
		expect(discoverTool.inputSchema.required).toBeUndefined();
		expect(batchTool.inputSchema).toMatchObject({
			required: ['commands'],
			properties: { options: { properties: { parallelism: { type: 'integer' } } } },
		});
		expect(pipeTool.inputSchema).toMatchObject({ required: ['steps'] });
		for (const tool of [callTool, batchTool, pipeTool, discoverTool, detailTool]) {
			expect(tool.inputSchema).not.toHaveProperty('$schema');
			for (const key of ['oneOf', 'anyOf', 'allOf']) {
				expect(tool.inputSchema).not.toHaveProperty(key);
			}
		}
	});

	it('accept every batch envelope the shared validator accepts', () => {
		expect(
			batchArgsSchema.safeParse({
				commands: [{ id: 'a', command: 'item-get', input: 'any value' }],
				options: { stopOnError: true, timeout: 0, parallelism: 2 },
			}).success
		).toBe(true);
	});
});
