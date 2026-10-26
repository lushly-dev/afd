/**
 * `McpClient` answering MCP 2026-07-28 `input_required` results over `streamable-http`: an
 * `onElicitation` handler, or an `INPUT_REQUIRED` failure without one.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
	acceptedContent,
	createMcpHandler,
	inputRequired,
	Server,
} from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { McpClient } from './client.js';
import type { ElicitationRequest } from './types.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** `wipe-run` asks for a confirmation; `state-run` asks with requestState only. */
function sdkServer() {
	const server = new Server(
		{ name: 'confirming', version: '1.0.0' },
		{ capabilities: { tools: {} } }
	);
	server.setRequestHandler('tools/list', async () => ({
		tools: [
			{ name: 'wipe-run', description: 'Wipe', inputSchema: { type: 'object' } },
			{ name: 'state-run', description: 'Needs state', inputSchema: { type: 'object' } },
		],
	}));
	server.setRequestHandler('tools/call', async (request, ctx) => {
		if (request.params.name === 'state-run') {
			return inputRequired({ requestState: 'opaque' }) as never;
		}
		const answer = acceptedContent<{ confirm?: boolean }>(ctx.mcpReq.inputResponses, 'confirm');
		if (answer?.confirm !== true) {
			return inputRequired({
				inputRequests: {
					confirm: inputRequired.elicit({
						message: 'Wipe everything?',
						requestedSchema: {
							type: 'object',
							properties: { confirm: { type: 'boolean' } },
							required: ['confirm'],
						},
					}),
				},
			}) as never;
		}
		const body = { success: true, data: { wiped: true } };
		return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false };
	});
	return server;
}

async function serve() {
	const handler = createMcpHandler(() => sdkServer());
	const http = createServer(toNodeHandler(handler));
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		await handler.close();
		http.closeAllConnections();
		await new Promise<void>((resolve) => http.close(() => resolve()));
	});
	return `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
}

function client(url: string, extra: Partial<ConstructorParameters<typeof McpClient>[0]> = {}) {
	const created = new McpClient({ url, autoReconnect: false, timeout: 5000, ...extra });
	cleanups.push(() => created.disconnect());
	return created;
}

describe('elicitation', () => {
	it('answers through onElicitation and returns the final result', async () => {
		const asked: ElicitationRequest[] = [];
		const mcp = client(await serve(), {
			onElicitation: async (request) => {
				asked.push(request);
				return { action: 'accept', content: { confirm: true } };
			},
		});
		await mcp.connect();
		expect(await mcp.call('wipe-run', {})).toMatchObject({ success: true, data: { wiped: true } });
		expect(asked).toEqual([
			{
				message: 'Wipe everything?',
				requestedSchema: {
					type: 'object',
					properties: { confirm: { type: 'boolean' } },
					required: ['confirm'],
				},
			},
		]);
	});

	it('returns INPUT_REQUIRED with what the server asked when there is no handler', async () => {
		const mcp = client(await serve());
		await mcp.connect();
		const result = await mcp.call('state-run', {});
		expect(result).toMatchObject({
			success: false,
			error: { code: 'INPUT_REQUIRED', retryable: false },
			data: { inputRequests: {} },
		});
	});
});
