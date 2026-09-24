/**
 * HTTP transport conformance: JSON-RPC envelopes, notifications, SSE limits, GET streaming
 * of mutations, and the `createContext` request hook.
 */
import {
	createServer,
	request as httpRequest,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CommandContext } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createExecutionEngine } from './execution.js';
import { createHttpHandler } from './http-handler.js';
import { createRateLimitMiddleware } from './middleware.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function listen(
	handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
	dispose: () => void
) {
	const server = createServer(handler);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	cleanups.push(async () => {
		dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
	});
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const seen: CommandContext[] = [];
const readItem = defineCommand({
	name: 'item-get',
	description: 'Read an item',
	expose: { mcp: true },
	input: z.object({ id: z.string().optional() }),
	handler: async (input, context) => {
		if (context) seen.push(context);
		return success({ id: input.id ?? 'one' });
	},
});
const writeItem = defineCommand({
	name: 'item-write',
	description: 'Write an item',
	expose: { mcp: true },
	mutation: true,
	input: z.object({ value: z.string().optional() }),
	handler: async (input, context) => {
		if (context) seen.push(context);
		return success({ written: input.value ?? true });
	},
});

async function host(options: Partial<McpHandlerOptions> = {}) {
	seen.length = 0;
	const handler = createMcpHandler({
		name: 'transport-test',
		version: '1',
		host: '127.0.0.1',
		commands: [readItem, writeItem],
		toolStrategy: 'individual',
		...options,
	});
	return { url: await listen(handler, handler.dispose), handler };
}

function post(url: string, path: string, body: unknown, headers: Record<string, string> = {}) {
	return fetch(`${url}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});
}

async function rpcError(response: Response) {
	const body = (await response.json()) as {
		jsonrpc: string;
		id: unknown;
		error: { code: number; message: string; data: { suggestion: string } };
	};
	expect(body.jsonrpc).toBe('2.0');
	expect(body.error.data.suggestion).toEqual(expect.any(String));
	return body;
}

function toolText(body: unknown): unknown {
	const result = (body as { result: { content: [{ text: string }] } }).result;
	return JSON.parse(result.content[0].text);
}

describe('JSON-RPC notifications', () => {
	it('acknowledges /message notifications with 202 and never executes them', async () => {
		const { url } = await host();
		for (const method of ['notifications/initialized', 'notifications/cancelled', 'tools/call']) {
			const response = await post(url, '/message', {
				jsonrpc: '2.0',
				method,
				params: { name: 'item-write', arguments: {} },
			});
			expect(response.status).toBe(202);
			expect(await response.text()).toBe('');
		}
		expect(seen).toHaveLength(0);
	});

	it('runs /rpc notifications without answering them', async () => {
		const { url } = await host();
		const response = await post(url, '/rpc', { jsonrpc: '2.0', method: 'item-write', params: {} });
		expect(response.status).toBe(202);
		expect(await response.text()).toBe('');
		expect(seen).toHaveLength(1);
	});

	it('keeps answering the simple /rpc format without jsonrpc or id', async () => {
		const { url } = await host();
		const response = await post(url, '/rpc', { method: 'item-get' });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			jsonrpc: '2.0',
			id: null,
			result: { success: true },
		});
	});
});

describe('JSON-RPC errors', () => {
	it('answers unparseable bodies with -32700 and HTTP 400', async () => {
		const { url } = await host();
		for (const path of ['/message', '/rpc']) {
			const response = await post(url, path, '{');
			expect(response.status).toBe(400);
			const body = await rpcError(response);
			expect(body.id).toBeNull();
			expect(body.error.code).toBe(-32700);
		}
	});

	it('answers invalid requests and batch arrays with -32600 and HTTP 400', async () => {
		const { url } = await host();
		const invalid = [
			[{ jsonrpc: '2.0', id: 1, method: 'ping' }],
			'"ping"',
			{ jsonrpc: '1.0', id: 1, method: 'ping' },
			{ jsonrpc: '2.0', id: { nested: true }, method: 'ping' },
			{ jsonrpc: '2.0', id: 1 },
			{ jsonrpc: '2.0', id: 1, method: '' },
		];
		for (const path of ['/message', '/rpc']) {
			for (const body of invalid) {
				const response = await post(url, path, body);
				expect(response.status).toBe(400);
				expect((await rpcError(response)).error.code).toBe(-32600);
			}
		}
		const batch = await rpcError(await post(url, '/message', []));
		expect(batch.error.message).toContain('batch');
	});

	it('answers unknown methods with -32601 and the request id', async () => {
		const { url } = await host();
		const response = await post(url, '/message', {
			jsonrpc: '2.0',
			id: 'a',
			method: 'resources/list',
		});
		expect(response.status).toBe(200);
		const body = await rpcError(response);
		expect(body).toMatchObject({ id: 'a', error: { code: -32601 } });
	});

	it('answers malformed tools/call params with -32602', async () => {
		const { url } = await host();
		for (const params of [undefined, { arguments: {} }, { name: 'item-get', arguments: [1] }]) {
			const response = await post(url, '/message', {
				jsonrpc: '2.0',
				id: 7,
				method: 'tools/call',
				params,
			});
			expect(response.status).toBe(200);
			expect(await rpcError(response)).toMatchObject({ id: 7, error: { code: -32602 } });
		}
		expect(seen).toHaveLength(0);
	});

	it('answers internal errors with -32603, reporting them to onError', async () => {
		const onError = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error('onError failed too');
			})
			.mockImplementation(async () => {
				throw new Error('async onError failed too');
			});
		const { url } = await host({
			onError,
			createContext: () => {
				throw new Error('database down: secret-host');
			},
		});
		const message = await post(url, '/message', {
			jsonrpc: '2.0',
			id: 3,
			method: 'tools/call',
			params: { name: 'item-get' },
		});
		expect(message.status).toBe(200);
		const body = await rpcError(message);
		expect(body).toMatchObject({ id: 3, error: { code: -32603, message: 'Internal error' } });
		expect(JSON.stringify(body)).not.toContain('secret-host');
		const rpc = await post(url, '/rpc', { jsonrpc: '2.0', id: 4, method: 'item-get' });
		expect(await rpcError(rpc)).toMatchObject({ id: 4, error: { code: -32603 } });
		const batch = await post(url, '/batch', { commands: [{ command: 'item-get' }] });
		expect(batch.status).toBe(500);
		expect(await batch.json()).toMatchObject({ success: false, error: { code: 'HTTP_500' } });
		expect(onError).toHaveBeenCalledTimes(3);
		expect(seen).toHaveLength(0);
	});

	it('includes internal error messages in devMode', async () => {
		const { url } = await host({
			devMode: true,
			createContext: async () => {
				throw new Error('database down');
			},
		});
		const body = await rpcError(await post(url, '/rpc', { id: 1, method: 'item-get' }));
		expect(body.error.message).toBe('database down');
	});

	it('uses JSON-RPC bodies for transport rejections on JSON-RPC routes only', async () => {
		const { url } = await host();
		const message = await post(
			url,
			'/message',
			{ jsonrpc: '2.0', id: 1, method: 'ping' },
			{
				'Content-Type': 'text/plain',
			}
		);
		expect(message.status).toBe(415);
		expect((await rpcError(message)).error.code).toBe(-32000);
		const batch = await post(url, '/batch', {}, { 'Content-Type': 'text/plain' });
		expect(batch.status).toBe(415);
		expect(await batch.json()).toMatchObject({ success: false, error: { code: 'HTTP_415' } });
	});

	it('lets browsers send and read the session header, and 404s unknown routes', async () => {
		const { url } = await host({ cors: true, allowedOrigins: ['https://ui.example'] });
		const preflight = await fetch(`${url}/message`, {
			method: 'OPTIONS',
			headers: { Origin: 'https://ui.example' },
		});
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get('access-control-allow-headers')).toContain('Mcp-Session-Id');
		expect(preflight.headers.get('access-control-expose-headers')).toBe('Mcp-Session-Id');
		expect((await fetch(`${url}/missing`)).status).toBe(404);
		const badInput = await fetch(`${url}/stream/item-get?input=%7B`);
		expect(badInput.status).toBe(400);
		expect(await badInput.json()).toMatchObject({ success: false, error: { code: 'HTTP_400' } });
	});

	it('answers ping and legacy initialized requests', async () => {
		const { url } = await host();
		for (const method of ['ping', 'notifications/initialized']) {
			const response = await post(url, '/message', { jsonrpc: '2.0', id: 1, method });
			expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
		}
	});
});

describe('GET /stream', () => {
	it('refuses mutations with 405 and points to POST', async () => {
		const { url } = await host();
		const response = await fetch(`${url}/stream/item-write?input=%7B%7D`);
		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('POST');
		const body = (await response.json()) as { error: { code: string; suggestion: string } };
		expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
		expect(body.error.suggestion).toContain('POST /stream/item-write');
		expect(seen).toHaveLength(0);
		const posted = await post(url, '/stream/item-write', { value: 'x' });
		expect(await posted.text()).toContain('"written":"x"');
		expect(await (await fetch(`${url}/stream/item-get`)).text()).toContain('"type":"complete"');
	});

	it('caps query input at maxBodyBytes, like a POST body', async () => {
		const { url } = await host({ maxBodyBytes: 64 });
		const fits = JSON.stringify({ id: 'x'.repeat(40) });
		const tooLarge = JSON.stringify({ id: 'x'.repeat(80) });
		// Multibyte characters count as their UTF-8 bytes: 30 × 3 bytes > 64.
		const multibyte = JSON.stringify({ id: '€'.repeat(30) });

		const ok = await fetch(`${url}/stream/item-get?input=${encodeURIComponent(fits)}`);
		expect(ok.status).toBe(200);
		expect(await ok.text()).toContain('"type":"complete"');
		for (const input of [tooLarge, multibyte]) {
			const viaGet = await fetch(`${url}/stream/item-get?input=${encodeURIComponent(input)}`);
			expect(viaGet.status).toBe(413);
			expect(await viaGet.json()).toMatchObject({
				success: false,
				error: { code: 'HTTP_413', suggestion: expect.stringContaining('POST') },
			});
			expect((await post(url, '/stream/item-get', JSON.parse(input))).status).toBe(413);
		}
		expect(seen).toHaveLength(1);
	});

	it('caps query input that a large host header limit lets through', async () => {
		seen.length = 0;
		const handler = createMcpHandler({
			name: 'transport-test',
			version: '1',
			host: '127.0.0.1',
			commands: [readItem],
			maxBodyBytes: 32 * 1024,
		});
		// The host raises Node's 16 KiB header limit; the stream input cap still applies.
		const server = createServer({ maxHeaderSize: 256 * 1024 }, handler);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		cleanups.push(async () => {
			handler.dispose();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		});
		const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		const input = encodeURIComponent(JSON.stringify({ id: 'x'.repeat(64 * 1024) }));

		const response = await fetch(`${url}/stream/item-get?input=${input}`);

		expect(response.status).toBe(413);
		expect(seen).toHaveLength(0);
	});
});

describe('/sse connections', () => {
	it('caps concurrent connections with 503 and frees slots on close', async () => {
		const { url, handler } = await host({ maxSseConnections: 1 });
		const first = new AbortController();
		const open = await fetch(`${url}/sse`, { signal: first.signal });
		expect(open.status).toBe(200);
		const rejected = await fetch(`${url}/sse`);
		expect(rejected.status).toBe(503);
		expect(rejected.headers.get('retry-after')).toBe('5');
		expect(await rejected.json()).toMatchObject({ error: { code: 'SSE_CAPACITY_REACHED' } });
		first.abort();
		await open.text().catch(() => undefined);
		await vi.waitFor(async () => {
			const again = await fetch(`${url}/sse`);
			expect(again.status).toBe(200);
			handler.dispose();
			await again.text();
		});
	});

	it('sends heartbeat comments and forgets closed clients', async () => {
		const engine = createExecutionEngine({ commandMap: new Map(), middleware: [], devMode: false });
		const http = createHttpHandler({
			name: 'sse',
			version: '1',
			host: '127.0.0.1',
			port: 0,
			cors: false,
			devMode: false,
			sseHeartbeatMs: 10,
			getToolsList: () => [],
			routeToolCall: async () => ({ content: [], isError: false }),
			...engine,
		});
		const url = await listen(http.handler, http.dispose);
		const controller = new AbortController();
		const response = await fetch(`${url}/sse`, { signal: controller.signal });
		const reader = response.body?.getReader();
		let text = '';
		while (reader && !text.includes(': ping')) {
			const chunk = await reader.read();
			text += new TextDecoder().decode(chunk.value);
		}
		expect(text).toContain('event: endpoint');
		expect(http.sseClients.size).toBe(1);
		controller.abort();
		await vi.waitFor(() => expect(http.sseClients.size).toBe(0));
	});

	it('validates its limits', () => {
		const base = {
			name: 'sse',
			version: '1',
			host: '127.0.0.1',
			port: 0,
			cors: false,
			devMode: false,
			getToolsList: () => [],
			routeToolCall: async () => ({ content: [], isError: false }),
			...createExecutionEngine({ commandMap: new Map(), middleware: [], devMode: false }),
		};
		expect(() => createHttpHandler({ ...base, maxSseConnections: 0 })).toThrow('maxSseConnections');
		expect(() => createHttpHandler({ ...base, sseHeartbeatMs: -1 })).toThrow('heartbeat');
	});
});

describe('createContext', () => {
	it('reaches every remote execution path without overriding reserved keys', async () => {
		const { url } = await host({
			createContext: async (req) => ({
				user: req.headers['x-user'],
				traceId: 'forged',
				interface: 'cli',
				signal: 'forged',
			}),
		});
		const headers = { 'x-user': 'ada' };
		const tool = (name: string, args: unknown) =>
			post(
				url,
				'/message',
				{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
				headers
			);
		await tool('item-get', {});
		await tool('afd-call', { command: 'item-get', input: {} });
		await tool('afd-batch', { commands: [{ command: 'item-get', input: {} }] });
		await tool('afd-pipe', { steps: [{ command: 'item-get' }] });
		await post(url, '/rpc', { id: 1, method: 'item-get' }, headers);
		await post(url, '/batch', { commands: [{ command: 'item-get', input: {} }] }, headers);
		await (await post(url, '/stream/item-get', {}, headers)).text();
		await (await fetch(`${url}/stream/item-get`, { headers })).text();

		expect(seen).toHaveLength(8);
		for (const context of seen) {
			expect(context.user).toBe('ada');
			expect(context.interface).toBe('mcp');
			expect(context.signal).toBeInstanceOf(AbortSignal);
			expect(context.traceId).toEqual(expect.any(String));
			expect(context.traceId).not.toBe('forged');
		}
	});

	it('keeps request values out of pipeline $input', async () => {
		const { url } = await host({ createContext: () => ({ apiKey: 'server-secret' }) });
		const response = await post(url, '/message', {
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: {
				name: 'afd-pipe',
				arguments: { steps: [{ command: 'item-write', input: { value: '$input.apiKey' } }] },
			},
		});
		expect(JSON.stringify(toolText(await response.json()))).not.toContain('server-secret');
		expect(seen[0]?.apiKey).toBe('server-secret');
	});

	it('rejects a non-object result as an internal error', async () => {
		const { url } = await host({
			createContext: () => null as unknown as Record<string, unknown>,
		});
		const body = await rpcError(await post(url, '/rpc', { id: 1, method: 'item-get' }));
		expect(body.error.code).toBe(-32603);
	});

	it('limits each client separately when the rate limit keys on it', async () => {
		const { url } = await host({
			createContext: (req) => ({ clientId: req.headers['x-client'] ?? 'anonymous' }),
			middleware: [
				createRateLimitMiddleware({
					maxRequests: 2,
					windowMs: 60_000,
					keyFn: (context) => String(context.clientId),
				}),
			],
		});
		const callAs = async (client: string) => {
			const response = await post(
				url,
				'/rpc',
				{ id: 1, method: 'item-get' },
				{ 'x-client': client }
			);
			return ((await response.json()) as { result: { error?: { code: string } } }).result;
		};
		expect((await callAs('a')).error).toBeUndefined();
		expect((await callAs('a')).error).toBeUndefined();
		expect((await callAs('a')).error?.code).toBe('RATE_LIMITED');
		expect((await callAs('b')).error).toBeUndefined();
	});
});

describe('client disconnects', () => {
	it('aborts the command signal of a non-stream request', async () => {
		let aborted: (reason: unknown) => void = () => {};
		const abortReason = new Promise<unknown>((resolve) => {
			aborted = resolve;
		});
		let started: () => void = () => {};
		const running = new Promise<void>((resolve) => {
			started = resolve;
		});
		const slow = defineCommand({
			name: 'slow-read',
			description: 'Wait for cancellation',
			expose: { mcp: true },
			input: z.object({}),
			handler: async (_input, context) => {
				started();
				await new Promise<void>((resolve) =>
					context?.signal?.addEventListener(
						'abort',
						() => {
							aborted(context.signal?.reason);
							resolve();
						},
						{ once: true }
					)
				);
				return success({});
			},
		});
		const { url } = await host({ commands: [slow] });
		const request = httpRequest(`${url}/rpc`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
		});
		request.on('error', () => {});
		request.end(JSON.stringify({ id: 1, method: 'slow-read' }));
		await running;
		request.destroy();
		expect(String(await abortReason)).toContain('Client disconnected');
	});
});
