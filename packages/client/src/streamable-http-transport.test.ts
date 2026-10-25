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
});
