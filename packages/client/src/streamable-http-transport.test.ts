/**
 * `McpClient` over the `streamable-http` transport against servers built on the official MCP
 * TypeScript SDK v2: a dual-era server (MCP 2026-07-28 and 2025) and a 2025-only one.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NodeStreamableHTTPServerTransport, toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, Server } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { McpClient } from './client.js';
import { HttpStatusError } from './client-errors.js';
import { StreamableHttpTransport } from './streamable-http-transport.js';
import { createTransport } from './transport.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** An SDK server with one AFD-shaped tool. */
function sdkServer() {
	const server = new Server(
		{ name: 'sdk-server', version: '9.9.9' },
		{ capabilities: { tools: {} }, instructions: 'Use echo-run.' }
	);
	server.setRequestHandler('tools/list', async () => ({
		tools: [
			{
				name: 'echo-run',
				description: 'Echo the input',
				inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
			},
		],
	}));
	server.setRequestHandler('tools/call', async (request) => {
		if (request.params.name !== 'echo-run') {
			throw new Error(`Unknown tool: ${request.params.name}`);
		}
		const body = { success: true, data: { echo: request.params.arguments?.text ?? null } };
		return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false };
	});
	return server;
}

async function listen(handler: Parameters<typeof createServer>[1]) {
	const http = createServer(handler);
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		http.closeAllConnections();
		await new Promise<void>((resolve) => http.close(() => resolve()));
	});
	return `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
}

/** Dual-era: `createMcpHandler` serves 2026-07-28 and stateless 2025. */
async function dualEraServer() {
	const handler = createMcpHandler(() => sdkServer());
	cleanups.push(() => handler.close());
	return listen(toNodeHandler(handler));
}

/** 2025-only: a stateless legacy Streamable HTTP transport, no `server/discover`. */
async function legacyOnlyServer() {
	return listen(async (req, res) => {
		const server = sdkServer();
		const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		await server.connect(transport);
		await transport.handleRequest(req, res);
	});
}

function client(url: string, extra: Partial<ConstructorParameters<typeof McpClient>[0]> = {}) {
	const created = new McpClient({ url, autoReconnect: false, timeout: 5000, ...extra });
	cleanups.push(() => created.disconnect());
	return created;
}

describe('streamable-http transport', () => {
	it('sends every request through a fetch it is given', async () => {
		const url = await legacyOnlyServer();
		const seen: string[] = [];
		const transport = new StreamableHttpTransport(url, {
			clientName: 'test',
			clientVersion: '1',
			mode: 'legacy',
			fetch: (input, init) => {
				seen.push(init?.method ?? 'GET');
				return fetch(input, init);
			},
		});
		await transport.connect();
		cleanups.push(async () => transport.disconnect());
		const listed = await transport.send({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/list',
			params: {},
		} as never);
		expect((listed.result as { tools: unknown[] }).tools).toHaveLength(1);
		expect(seen.filter((method) => method === 'POST').length).toBeGreaterThanOrEqual(2);
	});

	it('is the default for a /mcp URL and negotiates MCP 2026-07-28 with a dual-era server', async () => {
		const url = await dualEraServer();
		// No transport option: a URL that does not end in /sse selects streamable-http.
		const mcp = client(url);
		const init = await mcp.connect();
		expect(init.protocolVersion).toBe('2026-07-28');
		expect(init.serverInfo).toEqual({ name: 'sdk-server', version: '9.9.9' });
		expect((await mcp.listTools()).map((tool) => tool.name)).toEqual(['echo-run']);
		const result = await mcp.call('echo-run', { text: 'hi' });
		expect(result).toMatchObject({ success: true, data: { echo: 'hi' } });
	});

	it('uses the 2025 handshake with protocolMode legacy', async () => {
		const url = await dualEraServer();
		const init = await client(url, { protocolMode: 'legacy' }).connect();
		expect(init.protocolVersion).toBe('2025-11-25');
	});

	it('falls back to initialize against a 2025-only server', async () => {
		const url = await legacyOnlyServer();
		const mcp = client(url);
		const init = await mcp.connect();
		expect(init.protocolVersion).toBe('2025-11-25');
		expect(await mcp.call('echo-run', { text: 'old' })).toMatchObject({
			data: { echo: 'old' },
		});
	});

	it('fails to connect in protocolMode modern against a 2025-only server', async () => {
		const url = await legacyOnlyServer();
		const mcp = client(url, { protocolMode: 'modern' });
		mcp.on('error', () => {});
		await expect(mcp.connect()).rejects.toThrow(/2026-07-28/);
	});

	it('maps a JSON-RPC error from the server to a failed CommandResult', async () => {
		const url = await dualEraServer();
		const mcp = client(url);
		await mcp.connect();
		const result = await mcp.call('missing-tool', {});
		expect(result.success).toBe(false);
	});

	it('passes resources/list and resources/read through, in both eras', async () => {
		const resourceServer = () => {
			const server = new Server(
				{ name: 'resource-server', version: '1.0.0' },
				{ capabilities: { resources: {} } }
			);
			server.setRequestHandler('resources/list', async () => ({
				resources: [
					{ uri: 'ui://probe/view', name: 'view', mimeType: 'text/html;profile=mcp-app' },
				],
			}));
			server.setRequestHandler('resources/read', async (request) => ({
				contents: [
					{ uri: request.params.uri, mimeType: 'text/html;profile=mcp-app', text: '<p>view</p>' },
				],
			}));
			return server;
		};
		const handler = createMcpHandler(() => resourceServer());
		cleanups.push(() => handler.close());
		const url = await listen(toNodeHandler(handler));
		for (const mode of ['modern', 'legacy'] as const) {
			const transport = new StreamableHttpTransport(url, {
				clientName: 'test',
				clientVersion: '1',
				mode,
			});
			await transport.connect();
			cleanups.push(async () => transport.disconnect());
			const listed = await transport.send({
				jsonrpc: '2.0',
				id: 1,
				method: 'resources/list',
				params: {},
			} as never);
			expect(listed.error, mode).toBeUndefined();
			expect((listed.result as { resources: Array<{ uri: string }> }).resources[0]?.uri).toBe(
				'ui://probe/view'
			);
			const read = await transport.send({
				jsonrpc: '2.0',
				id: 2,
				method: 'resources/read',
				params: { uri: 'ui://probe/view' },
			} as never);
			expect((read.result as { contents: Array<{ text: string }> }).contents[0]?.text, mode).toBe(
				'<p>view</p>'
			);
		}
	});

	it('is also available through createTransport', async () => {
		const url = await dualEraServer();
		const transport = createTransport('streamable-http', url);
		await transport.connect();
		cleanups.push(async () => transport.disconnect());
		const response = await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
		expect((response.result as { tools: unknown[] }).tools).toHaveLength(1);
		const unsupported = await transport.send({ jsonrpc: '2.0', id: 2, method: 'ping' });
		expect(unsupported.error?.code).toBe(-32601);
		transport.disconnect();
		expect(transport.isConnected()).toBe(false);
	});

	it('classifies non-2xx HTTP statuses and 403 insufficient_scope challenges as HttpStatusError (#1706)', async () => {
		let failWith: { status: number; text: string; headers?: Record<string, string> } | undefined;
		const handler = createMcpHandler(() => sdkServer());
		cleanups.push(() => handler.close());
		const sdkNode = toNodeHandler(handler);
		const url = await listen((req, res) => {
			if (failWith) {
				res.writeHead(failWith.status, failWith.text, {
					'Content-Type': 'text/plain',
					...failWith.headers,
				});
				res.end(failWith.text);
				return;
			}
			sdkNode(req, res);
		});
		const mcp = client(url);
		await mcp.connect();

		failWith = { status: 401, text: 'Unauthorized' };
		await expect(mcp.request('tools/call', { name: 'echo-run', arguments: {} })).rejects.toThrow(
			HttpStatusError
		);
		const called = await mcp.call('echo-run', {});
		expect(called.success).toBe(false);
		expect(called.error?.code).toBe('HTTP_401');
		expect(called.error?.retryable).toBe(false);

		const batched = await mcp.batch([{ command: 'echo-run', input: {} }]);
		expect(batched.success).toBe(false);
		expect(batched.summary.failureCount).toBe(1);
		expect(batched.error?.code).toBe('HTTP_401');

		const piped = await mcp.pipe([{ command: 'echo-run', input: {} }]);
		expect(piped.steps[0]?.status).toBe('failure');
		expect(piped.steps[0]?.error?.code).toBe('HTTP_401');

		// 403 with WWW-Authenticate: Bearer error="insufficient_scope" throws InsufficientScopeError in the SDK.
		failWith = {
			status: 403,
			text: 'Forbidden',
			headers: {
				'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="todo:write"',
			},
		};
		const forbidden = await mcp.call('echo-run', {});
		expect(forbidden.success).toBe(false);
		expect(forbidden.error?.code).toBe('HTTP_403');
		expect(forbidden.error?.retryable).toBe(false);
		const forbiddenBatch = await mcp.batch([{ command: 'echo-run', input: {} }]);
		expect(forbiddenBatch.summary.failureCount).toBe(1);
		expect(forbiddenBatch.error?.code).toBe('HTTP_403');

		failWith = { status: 503, text: 'Service Unavailable' };
		await expect(mcp.request('tools/call', { name: 'echo-run', arguments: {} })).rejects.toThrow(
			HttpStatusError
		);
		const unavailable = await mcp.call('echo-run', {});
		expect(unavailable.success).toBe(false);
		expect(unavailable.error).toMatchObject({
			code: 'OUTCOME_UNKNOWN',
			retryable: false,
			details: { cause: 'HTTP_503' },
		});
	});
});
