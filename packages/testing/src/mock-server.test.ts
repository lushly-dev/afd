import { failure, type McpRequest, success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { createMockServer, MockMcpServer } from './mock-server.js';
import { createMockCommand } from './test-helpers.js';

function request(id: number, method: string, params?: Record<string, unknown>): McpRequest {
	return { jsonrpc: '2.0', id, method, params };
}

describe('MockMcpServer', () => {
	it('initializes with protocol and server capability metadata', async () => {
		const response = await new MockMcpServer().handleRequest(request(1, 'initialize'));

		expect(response.result).toMatchObject({
			protocolVersion: '2024-11-05',
			capabilities: { tools: { listChanged: false } },
			serverInfo: { name: 'MockMcpServer', version: '0.1.0' },
		});
	});

	it('lists constructor and dynamically registered tools', async () => {
		const server = createMockServer([createMockCommand('item-get', () => ({ id: '1' }))]);
		server.register(createMockCommand('item-list', () => []));

		const response = await server.handleRequest(request(2, 'tools/list'));
		const tools = (response.result as { tools: Array<{ name: string }> }).tools;

		expect(tools.map((tool) => tool.name)).toEqual(['item-get', 'item-list']);
		expect(server.getTools()).toHaveLength(2);
	});

	it('executes a tool and serializes successful results as MCP content', async () => {
		const server = createMockServer();
		server.register(
			createMockCommand<{ name: string }, { greeting: string }>('user-greet', ({ name }) => ({
				greeting: `Hello ${name}`,
			}))
		);

		const response = await server.handleRequest(
			request(3, 'tools/call', { name: 'user-greet', arguments: { name: 'Ada' } })
		);
		const result = response.result as { content: Array<{ text: string }>; isError: boolean };

		expect(result.isError).toBe(false);
		expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual(success({ greeting: 'Hello Ada' }));
	});

	it('marks command failures as tool errors', async () => {
		const server = createMockServer([
			{
				name: 'item-delete',
				description: 'Delete an item',
				parameters: [],
				handler: async () => failure({ code: 'NOT_FOUND', message: 'Missing item' }),
			},
		]);

		const response = await server.handleRequest(request(4, 'tools/call', { name: 'item-delete' }));
		const result = response.result as { content: Array<{ text: string }>; isError: boolean };

		expect(result.isError).toBe(true);
		expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual(
			failure({ code: 'NOT_FOUND', message: 'Missing item' })
		);
	});

	it('returns protocol errors for missing names and unknown methods', async () => {
		const server = createMockServer();

		const invalidCall = await server.handleRequest(request(5, 'tools/call', {}));
		const unknownMethod = await server.handleRequest(request(6, 'resources/list'));

		expect(invalidCall.error).toMatchObject({ code: -32602, message: 'Missing tool name' });
		expect(unknownMethod.error).toMatchObject({ code: -32601 });
	});

	it('converts unexpected execution throws into internal errors', async () => {
		const server = createMockServer();
		server.getTools = () => {
			throw 'registry failed';
		};

		const response = await server.handleRequest(request(7, 'tools/list'));

		expect(response.error).toEqual({ code: -32603, message: 'registry failed' });
	});

	it('records requests defensively and clears or resets the log', async () => {
		const server = createMockServer();
		await server.handleRequest(request(8, 'initialize'));

		const snapshot = server.getRequestLog();
		snapshot.length = 0;
		expect(server.getRequestLog()).toHaveLength(1);

		server.clearRequestLog();
		expect(server.getRequestLog()).toEqual([]);
		await server.handleRequest(request(9, 'tools/list'));
		server.reset();
		expect(server.getRequestLog()).toEqual([]);
	});
});
