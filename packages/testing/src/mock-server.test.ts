import {
	type BatchResult,
	type CommandDefinition,
	type CommandResult,
	failure,
	type McpRequest,
	type McpResponse,
	success,
} from '@lushly-dev/afd-core';
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
				expose: { mcp: true },
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

	describe('server parity', () => {
		type ToolResult = { content: Array<{ text: string }>; isError: boolean };
		function parse<T>(response: McpResponse): { body: T; isError: boolean } {
			const result = response.result as ToolResult;
			return { body: JSON.parse(result.content[0]?.text ?? '{}') as T, isError: result.isError };
		}

		function internalCommand(onRun: () => void): CommandDefinition {
			return {
				name: 'secret-rotate',
				description: 'Rotate secrets (in-app only)',
				parameters: [],
				handler: async () => {
					onRun();
					return success({ rotated: true });
				},
			};
		}

		it('lists and runs only commands exposed to MCP', async () => {
			let ran = false;
			const server = createMockServer([
				internalCommand(() => {
					ran = true;
				}),
				createMockCommand('item-get', () => ({ id: '1' })),
			]);

			const list = await server.handleRequest(request(20, 'tools/list'));
			const call = parse<CommandResult>(
				await server.handleRequest(request(21, 'tools/call', { name: 'secret-rotate' }))
			);

			expect((list.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name)).toEqual([
				'item-get',
			]);
			expect(call.isError).toBe(true);
			expect(call.body.error?.code).toBe('COMMAND_NOT_EXPOSED');
			expect(ran).toBe(false);
		});

		it('exposure-checks every afd-batch entry', async () => {
			let ran = false;
			const server = createMockServer([
				internalCommand(() => {
					ran = true;
				}),
				createMockCommand('item-get', () => ({ id: '1' })),
			]);

			const batch = parse<BatchResult>(
				await server.handleRequest(
					request(22, 'tools/call', {
						name: 'afd-batch',
						arguments: {
							commands: [
								{ command: 'secret-rotate', input: {} },
								{ command: 'item-get', input: {} },
							],
						},
					})
				)
			);

			expect(batch.body.results.map((r) => r.result.error?.code)).toEqual([
				'COMMAND_NOT_EXPOSED',
				undefined,
			]);
			expect(ran).toBe(false);
		});

		it('enforces the afd-batch timeout with parallelism and aborts in-flight commands', async () => {
			let started = 0;
			let aborted = 0;
			const slow = createMockCommand('slow-run', () => 'late');
			slow.handler = async (_input, context) => {
				started++;
				await new Promise<void>((resolve) => {
					const timer = setTimeout(resolve, 400);
					context?.signal?.addEventListener('abort', () => {
						aborted++;
						clearTimeout(timer);
						resolve();
					});
				});
				return success('late');
			};
			const server = createMockServer([slow]);

			const begin = performance.now();
			const batch = parse<BatchResult>(
				await server.handleRequest(
					request(23, 'tools/call', {
						name: 'afd-batch',
						arguments: {
							commands: Array.from({ length: 6 }, () => ({ command: 'slow-run', input: {} })),
							options: { timeout: 50, parallelism: 3 },
						},
					})
				)
			);

			expect(performance.now() - begin).toBeLessThan(300);
			expect({ started, aborted }).toEqual({ started: 3, aborted: 3 });
			expect(batch.body.results).toHaveLength(6);
			expect(batch.body.results.every((r) => r.result.error?.code === 'BATCH_TIMEOUT')).toBe(true);
		});

		it('rejects a malformed afd-batch before running anything', async () => {
			let calls = 0;
			const server = createMockServer([
				createMockCommand('item-get', () => {
					calls++;
					return { id: '1' };
				}),
			]);

			const batch = parse<BatchResult>(
				await server.handleRequest(
					request(24, 'tools/call', {
						name: 'afd-batch',
						arguments: { commands: [{ command: 'item-get', input: {} }, null] },
					})
				)
			);

			expect(batch.isError).toBe(true);
			expect(batch.body.error?.code).toBe('INVALID_BATCH_REQUEST');
			expect(calls).toBe(0);
		});

		it('redacts handler exceptions unless devMode is set', async () => {
			const boom: CommandDefinition = {
				name: 'item-boom',
				description: 'Throws',
				parameters: [],
				expose: { mcp: true },
				handler: async () => {
					throw new Error('/srv/app/db.ts: connection refused');
				},
			};
			const call = request(25, 'tools/call', { name: 'item-boom' });

			const hidden = parse<CommandResult>(await createMockServer([boom]).handleRequest(call));
			const shown = parse<CommandResult>(
				await createMockServer([boom], { devMode: true }).handleRequest(call)
			);

			expect(hidden.body.error?.message).toBe('An internal error occurred');
			expect(JSON.stringify(hidden.body)).not.toContain('/srv/app');
			expect(shown.body.error?.message).toContain('connection refused');
		});
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
