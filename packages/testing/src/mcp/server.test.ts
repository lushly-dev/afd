/**
 * JSON-RPC behaviour of the testing MCP server: notifications get no
 * response, and the stdio transport answers malformed input correctly.
 */

import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpTestingServer, type JsonRpcRequest, runStdioServer } from './server.js';

describe('notifications', () => {
	const server = createMcpTestingServer({ commandHandler: vi.fn() });

	it('does not answer notifications/initialized', async () => {
		await expect(
			server.handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' })
		).resolves.toBeUndefined();
	});

	it('does not answer an unknown method sent as a notification', async () => {
		await expect(
			server.handleRequest({ jsonrpc: '2.0', method: 'no/such/method' })
		).resolves.toBeUndefined();
	});

	it('runs a tools/call notification but sends no result', async () => {
		const request: JsonRpcRequest = {
			jsonrpc: '2.0',
			method: 'tools/call',
			params: { name: 'scenario-suggest', arguments: { context: 'natural', query: 'errors' } },
		};

		await expect(server.handleRequest(request)).resolves.toBeUndefined();
	});

	it('does not answer a notification whose handling fails', async () => {
		await expect(
			server.handleRequest({ jsonrpc: '2.0', method: 'tools/call', params: 'bad' })
		).resolves.toBeUndefined();
	});

	it('still answers requests with an id, including errors', async () => {
		const response = await server.handleRequest({ jsonrpc: '2.0', id: 7, method: 'tools/call' });

		expect(response).toMatchObject({ jsonrpc: '2.0', id: 7, error: { code: -32602 } });
	});
});

describe('runStdioServer', () => {
	const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin');

	afterEach(() => {
		if (originalStdin) Object.defineProperty(process, 'stdin', originalStdin);
		vi.restoreAllMocks();
	});

	async function run(lines: string[]): Promise<unknown[]> {
		Object.defineProperty(process, 'stdin', {
			value: Readable.from(lines.map((line) => `${line}\n`)),
			configurable: true,
		});
		const written: unknown[] = [];
		vi.spyOn(console, 'log').mockImplementation((text: string) => {
			written.push(JSON.parse(text));
		});
		await runStdioServer({});
		return written;
	}

	it('answers requests, skips notifications and reports malformed input', async () => {
		const written = await run([
			JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
			JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
			'',
			'not json',
			JSON.stringify({ jsonrpc: '2.0', id: 2 }),
			JSON.stringify({ jsonrpc: '1.0', id: 'x', method: 'ping' }),
			JSON.stringify([{ jsonrpc: '2.0', id: 3, method: 'ping' }]),
			JSON.stringify({ jsonrpc: '2.0', id: { bad: true }, method: 'ping' }),
			JSON.stringify({ jsonrpc: '2.0', id: 'last', method: 'tools/list', params: {} }),
		]);

		expect(written.map((response) => (response as { id: unknown }).id)).toEqual([
			1,
			null,
			2,
			'x',
			null,
			null,
			'last',
		]);
		expect(written[0]).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
		expect(written[1]).toMatchObject({ error: { code: -32700, message: 'Invalid JSON' } });
		for (const response of written.slice(2, 6)) {
			expect(response).toMatchObject({ error: { code: -32600 } });
		}
		expect(written[6]).toMatchObject({ result: { tools: expect.any(Array) } });
	});
});
