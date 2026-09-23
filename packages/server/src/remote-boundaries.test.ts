import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BatchResult, CommandError, CommandResult } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';
import { createMcpHandler, createMcpServer } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
const publicCommand = defineCommand({
	name: 'item-get',
	description: 'Read an item',
	category: 'inventory',
	expose: { mcp: true },
	input: z.object({}),
	handler: async () => ({ success: true, data: ['one', 'two'] }),
});
async function host(options: Partial<McpHandlerOptions> = {}) {
	const handler = createMcpHandler({
		name: 'boundary-test',
		version: '1',
		host: '127.0.0.1',
		commands: [publicCommand],
		...options,
	});
	const server = createServer(handler);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
	});
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { url, handler, server };
}
async function post(
	url: string,
	path: string,
	body: unknown,
	headers: Record<string, string> = {}
) {
	if (headers.Host) {
		return new Promise<Response>((resolve, reject) => {
			const req = httpRequest(
				`${url}${path}`,
				{ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } },
				(res) => {
					const chunks: Buffer[] = [];
					res.on('data', (chunk: Buffer) => chunks.push(chunk));
					res.on('end', () =>
						resolve(
							new Response(Buffer.concat(chunks), {
								status: res.statusCode,
								headers: res.headers as Record<string, string>,
							})
						)
					);
				}
			);
			req.on('error', reject);
			req.end(JSON.stringify(body));
		});
	}
	return fetch(`${url}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
	});
}
async function readJson<T>(response: Response): Promise<T> {
	return (await response.json()) as T;
}
async function call(url: string, name: string, args: unknown = {}) {
	const response = await post(url, '/message', {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/call',
		params: { name, arguments: args },
	});
	const body = await readJson<{ result: { content: [{ text: string }] } }>(response);
	return JSON.parse(body.result.content[0].text);
}

describe('remote exposure', () => {
	it.each(['individual', 'grouped', 'lazy'] as const)(
		'guards every execution path in %s mode',
		async (toolStrategy) => {
			const handler = vi.fn(async () => ({ success: true, data: 'secret' }));
			const hidden = defineCommand({
				name: 'secret-reset',
				description: 'Private mutation',
				expose: { mcp: false },
				input: z.object({}),
				handler,
			});
			const implicit = defineCommand({
				name: 'implicit-reset',
				description: 'Default private mutation',
				input: z.object({}),
				handler,
			});
			const { url } = await host({ commands: [publicCommand, hidden, implicit], toolStrategy });
			const listed = await (await post(url, '/message', { method: 'tools/list' })).text();
			expect(listed).not.toContain('secret');
			const discovered = await call(url, 'afd-discover');
			expect(JSON.stringify(discovered)).not.toContain('secret');
			for (const name of ['secret-reset', 'implicit-reset']) {
				expect((await call(url, name)).success).toBe(false);
				expect((await call(url, 'afd-call', { command: name })).success).toBe(false);
				expect(
					(await call(url, 'afd-batch', { commands: [{ command: name }] })).results[0].result
						.success
				).toBe(false);
				expect((await call(url, 'afd-pipe', { steps: [{ command: name }] })).steps[0].status).toBe(
					'failure'
				);
				const rpc = await readJson<{ result: CommandResult }>(
					await post(url, '/rpc', { method: name })
				);
				expect(rpc.result.success).toBe(false);
				const batch = await readJson<BatchResult>(
					await post(url, '/batch', { commands: [{ command: name }] })
				);
				expect(batch.results[0]?.result.success).toBe(false);
				expect(await (await post(url, `/stream/${name}`, {})).text()).toContain(
					'COMMAND_NOT_FOUND'
				);
				expect(await (await fetch(`${url}/stream/${name}`)).text()).toContain('COMMAND_NOT_FOUND');
			}
			expect(handler).not.toHaveBeenCalled();
			const direct = createMcpServer({
				name: 'direct',
				version: '1',
				commands: [hidden, implicit],
			});
			expect((await direct.execute('secret-reset', {})).success).toBe(true);
			expect((await direct.execute('implicit-reset', {})).success).toBe(true);
		}
	);
});

describe('grouped dispatch', () => {
	it('uses actual category membership and preserves hyphenated actions', async () => {
		const command = defineCommand({
			...publicCommand,
			name: 'item-get-details',
			input: z.object({}),
		});
		const { url } = await host({ commands: [command] });
		expect((await call(url, 'inventory', { action: 'get-details' })).data).toEqual(['one', 'two']);
		expect((await call(url, 'unknown', { action: 'get-details' })).error.code).toBe(
			'COMMAND_NOT_FOUND'
		);
	});
	it('supports custom groups and rejects ambiguous actions', async () => {
		const duplicate = defineCommand({ ...publicCommand, name: 'other-get', input: z.object({}) });
		const { url } = await host({ commands: [publicCommand, duplicate], groupByFn: () => 'custom' });
		expect((await call(url, 'custom', { action: 'get' })).error.code).toBe('AMBIGUOUS_ACTION');
		expect((await call(url, 'afd-call', { command: 'item-get' })).success).toBe(true);
		const single = await host({ groupByFn: () => 'custom' });
		expect((await call(single.url, 'custom', { action: 'get' })).success).toBe(true);
	});
});

describe('HTTP boundaries and lifecycle', () => {
	it('rejects hostile origins, hosts and simple content types before execution', async () => {
		const onCommand = vi.fn();
		const { url } = await host({ onCommand });
		for (const path of ['/rpc', '/message', '/batch', '/stream/item-get']) {
			expect(
				(await post(url, path, { method: 'item-get' }, { Origin: 'https://evil.example' })).status
			).toBe(403);
		}
		expect(
			(await fetch(`${url}/stream/item-get`, { headers: { Origin: 'https://evil.example' } }))
				.status
		).toBe(403);
		expect(
			(await fetch(`${url}/stream/item-get`, { headers: { 'sec-fetch-site': 'cross-site' } }))
				.status
		).toBe(403);
		expect(
			(await fetch(`${url}/stream/item-get`, { headers: { 'sec-fetch-site': 'same-site' } })).status
		).toBe(403);
		expect((await post(url, '/rpc', { method: 'item-get' }, { Host: 'evil.example' })).status).toBe(
			403
		);
		expect(
			(await post(url, '/rpc', { method: 'item-get' }, { 'Content-Type': 'text/plain' })).status
		).toBe(415);
		expect(onCommand).not.toHaveBeenCalled();
		expect((await post(url, '/rpc', { method: 'item-get' })).status).toBe(200);
		expect((await post(url, '/rpc', { method: 'item-get' }, { Origin: url })).status).toBe(200);
	});
	it('supports explicit proxy/browser origins and intentional development access', async () => {
		const { url } = await host({
			cors: true,
			allowedHosts: ['proxy.example'],
			allowedOrigins: ['https://ui.example'],
		});
		const response = await post(
			url,
			'/rpc',
			{ method: 'item-get' },
			{ Host: 'proxy.example', Origin: 'https://ui.example' }
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://ui.example');
		const dev = await host({ devMode: true });
		expect(
			(
				await post(
					dev.url,
					'/rpc',
					{ method: 'item-get' },
					{ Origin: 'https://development.example' }
				)
			).status
		).toBe(200);
	});
	it('bounds fixed and chunked bodies and recovers after malformed input', async () => {
		const { url } = await host({ maxBodyBytes: 80 });
		expect((await post(url, '/rpc', { padding: 'x'.repeat(100) })).status).toBe(413);
		const status = await new Promise<number | undefined>((resolve, reject) => {
			const req = httpRequest(
				`${url}/rpc`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
				},
				(res) => {
					res.resume();
					res.on('end', () => resolve(res.statusCode));
				}
			);
			req.on('error', reject);
			req.write('x'.repeat(50));
			req.end('x'.repeat(50));
		});
		expect(status).toBe(413);
		expect(
			(
				await fetch(`${url}/rpc`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: '{',
				})
			).status
		).toBe(400);
		expect((await post(url, '/rpc', { method: 'item-get' }, { Host: 'bad/host' })).status).toBe(
			400
		);
		expect((await fetch(`${url}/health`)).status).toBe(200);
	});
	it('survives an interrupted upload and malformed stream target', async () => {
		const { url, server } = await host();
		let uploaded: () => void = () => {};
		const received = new Promise<void>((resolve) => {
			uploaded = resolve;
		});
		const closed = new Promise<void>((resolve) => {
			server.once('request', (request) => {
				request.once('data', uploaded);
				request.once('close', resolve);
			});
		});
		const upload = httpRequest(`${url}/rpc`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Content-Length': '1000' },
		});
		upload.on('error', () => {});
		upload.write('{');
		await received;
		upload.destroy();
		await closed;
		expect((await fetch(`${url}/stream/%ZZ`)).status).toBe(400);
		expect((await fetch(`${url}/health`)).status).toBe(200);
	});

	it('propagates stream cancellation to the command context', async () => {
		let cancelled: () => void = () => {};
		const cancellation = new Promise<void>((resolve) => {
			cancelled = resolve;
		});
		const command = defineCommand({
			name: 'slow-read',
			description: 'Wait for cancellation',
			expose: { mcp: true },
			input: z.object({}),
			handler: async (_input, context) => {
				await new Promise<void>((resolve) =>
					context.signal?.addEventListener(
						'abort',
						() => {
							cancelled();
							resolve();
						},
						{ once: true }
					)
				);
				return { success: true };
			},
		});
		const { url } = await host({ commands: [command] });
		const controller = new AbortController();
		const response = await fetch(`${url}/stream/slow-read`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}',
			signal: controller.signal,
		});
		const body = response.text().catch(() => 'aborted');
		controller.abort();
		await cancellation;
		await body;
	});

	it('streams POST JSON and legacy GET input to completion', async () => {
		const { url } = await host();
		for (const response of [
			await post(url, '/stream/item-get', {}),
			await fetch(`${url}/stream/item-get?input=%7B%7D`),
		]) {
			const body = await response.text();
			expect(body).toContain('"data":"one"');
			expect(body).toContain('"type":"complete"');
		}
	});
	it('disposes idle SSE connections owned by an embedded handler', async () => {
		const { url, handler } = await host();
		const response = await fetch(`${url}/sse`);
		handler.dispose();
		expect(await response.text()).toContain('event: endpoint');
	});
	it('stops a standalone server without waiting for its SSE client', async () => {
		const server = createMcpServer({
			name: 'shutdown',
			version: '1',
			commands: [],
			transport: 'http',
			host: '127.0.0.1',
			port: 3398,
		});
		await server.start();
		try {
			const response = await fetch(`${server.getUrl()}/sse`);
			const body = response.text().catch(() => 'closed');
			await server.stop();
			await body;
		} finally {
			await server.stop();
		}
	});
});

it('wires configured contexts through the public factory for all remote paths', async () => {
	const commands = ['edit', 'print'].map((context) =>
		defineCommand({
			name: `${context}-run`,
			description: `Run ${context}`,
			expose: { mcp: true },
			contexts: [context],
			input: z.object({}),
			handler: async () => ({ success: true }),
		})
	);
	const { url } = await host({
		commands,
		contexts: [{ name: 'edit' }, { name: 'print' }],
		toolStrategy: 'individual',
	});
	expect((await call(url, 'afd-context-enter', { context: 'edit' })).success).toBe(true);
	const tools = await (await post(url, '/message', { method: 'tools/list' })).text();
	expect(tools).toContain('edit-run');
	expect(tools).not.toContain('print-run');
	expect(
		(await call(url, 'afd-batch', { commands: [{ command: 'print-run' }] })).results[0].result.error
			.code
	).toBe('COMMAND_NOT_IN_CONTEXT');
	expect(
		(await call(url, 'afd-pipe', { steps: [{ command: 'print-run' }] })).steps[0].error.code
	).toBe('COMMAND_NOT_IN_CONTEXT');
	expect((await call(url, 'afd-context-exit')).success).toBe(true);
	expect((await call(url, 'print-run')).success).toBe(true);
});

it('preflights complete MCP and REST envelopes before any write handler', async () => {
	const write = vi.fn(async () => ({ success: true }));
	const command = defineCommand({
		...publicCommand,
		name: 'item-write',
		input: z.object({}),
		handler: write,
	});
	const { url } = await host({ commands: [command] });
	const batch = { commands: [{ command: 'item-write', input: {} }, null] };
	const rest = await post(url, '/batch', batch);
	expect(rest.status).toBe(400);
	expect((await readJson<{ error: CommandError }>(rest)).error.suggestion).toEqual(
		expect.any(String)
	);
	expect((await call(url, 'afd-batch', batch)).error.code).toBe('INVALID_BATCH_REQUEST');
	const pipeline = await call(url, 'afd-pipe', {
		steps: [{ command: 'item-write' }, { command: 'item-write', when: { $eq: null } }],
	});
	expect(pipeline.steps[0].error).toMatchObject({
		code: 'INVALID_PIPELINE_REQUEST',
		suggestion: expect.any(String),
	});
	expect(write).not.toHaveBeenCalled();
});
