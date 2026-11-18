import {
	type BatchResult,
	type CommandDefinition,
	type CommandResult,
	failure,
	type McpRequest,
	type McpResponse,
	success,
} from '@lushly-dev/afd-core';
import { defineCommand } from '@lushly-dev/afd-server/direct';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMockServer, MockMcpServer } from './mock-server.js';
import { createMockCommand } from './test-helpers.js';

function request(id: number, method: string, params?: Record<string, unknown>): McpRequest {
	return { jsonrpc: '2.0', id, method, params };
}

describe('MockMcpServer', () => {
	it('initializes with protocol and server capability metadata', async () => {
		const server = new MockMcpServer();
		const response = await server.handleRequest(request(1, 'initialize'));

		expect(response.result).toMatchObject({
			protocolVersion: '2025-11-25',
			capabilities: { tools: { listChanged: false } },
			serverInfo: { name: 'MockMcpServer', version: '0.1.0' },
		});
		const older = await server.handleRequest(
			request(2, 'initialize', { protocolVersion: '2024-11-05' })
		);
		expect(older.result).toMatchObject({ protocolVersion: '2024-11-05' });
	});

	it('serves MCP 2026-07-28 requests with discover, resultType and serverInfo', async () => {
		const server = createMockServer([createMockCommand('item-get', () => ({ id: '1' }))]);
		const meta = {
			'io.modelcontextprotocol/protocolVersion': '2026-07-28',
			'io.modelcontextprotocol/clientCapabilities': {},
		};
		const discover = await server.handleRequest(request(1, 'server/discover', { _meta: meta }));
		expect(discover.result).toMatchObject({
			resultType: 'complete',
			supportedVersions: ['2026-07-28'],
			_meta: { 'io.modelcontextprotocol/serverInfo': { name: 'MockMcpServer' } },
		});
		const list = await server.handleRequest(request(2, 'tools/list', { _meta: meta }));
		expect(list.result).toMatchObject({ resultType: 'complete', ttlMs: 0, cacheScope: 'private' });
		const call = await server.handleRequest(
			request(3, 'tools/call', { name: 'item-get', arguments: {}, _meta: meta })
		);
		expect(call.result).toMatchObject({ resultType: 'complete', isError: false });
		const unsupported = await server.handleRequest(
			request(4, 'tools/list', {
				_meta: { ...meta, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' },
			})
		);
		expect(unsupported.error).toMatchObject({
			code: -32022,
			data: { supported: ['2026-07-28'], requested: '2099-01-01' },
		});
		// Legacy requests are unchanged.
		const legacy = await server.handleRequest(request(5, 'tools/list'));
		expect(legacy.result).not.toHaveProperty('resultType');
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
		expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({
			...success({ greeting: 'Hello Ada' }),
			metadata: { executionTimeMs: expect.any(Number), actorKind: 'agent' },
		});
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
		expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({
			...failure({ code: 'NOT_FOUND', message: 'Missing item' }),
			metadata: { executionTimeMs: expect.any(Number), actorKind: 'agent' },
		});
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

		it('validates production Zod commands before middleware and strips undeclared input', async () => {
			const inputs: unknown[] = [];
			const middlewareInputs: unknown[] = [];
			const command = defineCommand({
				name: 'item-create',
				description: 'Create an item',
				input: z.object({ title: z.string().min(2), count: z.number().default(1) }),
				expose: { mcp: true },
				async handler(input) {
					inputs.push(input);
					return success(input);
				},
			});
			const server = createMockServer([command], {
				actor: { kind: 'test' },
				middleware: [
					async (_name, input, context, next) => {
						middlewareInputs.push(input);
						expect(context.interface).toBe('mcp');
						expect(context.actor).toEqual({ kind: 'test' });
						return next();
					},
				],
			});
			const invalid = parse<CommandResult>(
				await server.handleRequest(
					request(30, 'tools/call', {
						name: 'item-create',
						arguments: { title: 7 },
					})
				)
			);
			const valid = parse<CommandResult>(
				await server.handleRequest(
					request(31, 'tools/call', {
						name: 'item-create',
						arguments: { title: 'Book', extra: true },
					})
				)
			);

			expect(invalid.body.error).toMatchObject({
				code: 'VALIDATION_ERROR',
				suggestion: expect.any(String),
			});
			expect(invalid.isError).toBe(true);
			expect(valid.body).toMatchObject({ success: true, data: { title: 'Book', count: 1 } });
			expect(inputs).toEqual([{ title: 'Book', count: 1 }]);
			expect(middlewareInputs).toEqual(inputs);
			expect(server.getTools()[0]?.inputSchema).toEqual(command.jsonSchema);
		});

		it('preserves core parameter schemas without inventing runtime validation and suggests a close name', async () => {
			const inputs: unknown[] = [];
			const command: CommandDefinition = {
				name: 'item-create',
				description: 'Create an item',
				expose: { mcp: true },
				parameters: [
					{
						name: 'title',
						type: 'string',
						description: 'Title',
						required: true,
						schema: { type: 'string', not: { type: 'string', const: 'reserved' } },
					},
				],
				handler: async (input) => {
					inputs.push(input);
					return success(input);
				},
			};
			const server = createMockServer([command]);
			const result = parse<CommandResult>(
				await server.handleRequest(
					request(32, 'tools/call', {
						name: 'item-create',
						arguments: { title: 7 },
					})
				)
			);
			const typo = parse<CommandResult>(
				await server.handleRequest(
					request(33, 'tools/call', {
						name: 'item-creat',
					})
				)
			);
			expect(result.body.success).toBe(true);
			expect(inputs).toEqual([{ title: 7 }]);
			expect(server.getTools()[0]?.inputSchema.properties?.title).toEqual(
				command.parameters[0]?.schema
			);
			expect(typo.body.error).toMatchObject({
				code: 'COMMAND_NOT_FOUND',
				suggestion: expect.stringContaining('item-create'),
			});
		});

		it('validates dynamically registered commands in batch calls and rejects explicit null', async () => {
			const inputs: unknown[] = [];
			const server = createMockServer();
			const command = defineCommand({
				name: 'item-create',
				description: 'Create an item',
				expose: { mcp: true },
				input: z.object({ title: z.string() }),
				async handler(input) {
					inputs.push(input);
					return success(input);
				},
			});
			server.register(command);
			expect(() => server.register(command)).toThrow('Duplicate command name');
			const batch = parse<BatchResult>(
				await server.handleRequest(
					request(34, 'tools/call', {
						name: 'afd-batch',
						arguments: {
							commands: [
								{ command: 'item-create', input: { title: 7 } },
								{ command: 'item-create', input: { title: 'Book', extra: true } },
							],
						},
					})
				)
			);
			const invalid = parse<CommandResult>(
				await server.handleRequest(
					request(35, 'tools/call', {
						name: 'item-create',
						arguments: null,
					})
				)
			);
			expect(batch.body.results.map((entry) => entry.result.error?.code)).toEqual([
				'VALIDATION_ERROR',
				undefined,
			]);
			expect(inputs).toEqual([{ title: 'Book' }]);
			expect(invalid.body.error?.code).toBe('VALIDATION_ERROR');
			expect(server.getTools().map((tool) => tool.name)).toEqual(['item-create']);
		});

		it('scopes each request and batch entry to its active context without retaining state', async () => {
			let calls = 0;
			const command = defineCommand({
				name: 'item-create',
				description: 'Create an item',
				expose: { mcp: true },
				input: z.object({}),
				contexts: ['editing'],
				async handler() {
					calls++;
					return success({});
				},
			});
			const server = createMockServer([command], {
				contexts: [{ name: 'editing' }, { name: 'viewing' }],
			});
			const meta = { 'dev.afd/context': 'viewing' };
			const blocked = parse<CommandResult>(
				await server.handleRequest(
					request(36, 'tools/call', {
						name: 'item-create',
						_meta: meta,
					})
				)
			);
			const batch = parse<BatchResult>(
				await server.handleRequest(
					request(37, 'tools/call', {
						name: 'afd-batch',
						_meta: meta,
						arguments: { commands: [{ command: 'item-create', input: {} }] },
					})
				)
			);
			const listed = await server.handleRequest(request(38, 'tools/list', { _meta: meta }));
			expect(blocked.body.error?.code).toBe('COMMAND_NOT_IN_CONTEXT');
			expect(batch.body.results[0]?.result.error?.code).toBe('COMMAND_NOT_IN_CONTEXT');
			expect(listed.result).toEqual({ tools: [] });
			expect(calls).toBe(0);
			const allowed = parse<CommandResult>(
				await server.handleRequest(request(39, 'tools/call', { name: 'item-create' }))
			);
			expect(allowed.body.success).toBe(true);
			expect(calls).toBe(1);
			const unknown = parse<CommandResult>(
				await server.handleRequest(
					request(40, 'tools/call', {
						name: 'item-create',
						_meta: { 'dev.afd/context': 'missing' },
					})
				)
			);
			expect(unknown.body.error?.code).toBe('CONTEXT_NOT_FOUND');
		});

		it('validates declared request context fields for single calls and batches', async () => {
			const seen: unknown[] = [];
			const command = defineCommand({
				name: 'item-get',
				description: 'Get an item',
				expose: { mcp: true },
				input: z.object({}),
				async handler(_input, context) {
					seen.push(context.workspace);
					return success({});
				},
			});
			const server = createMockServer([command], {
				contextFields: [
					{
						name: 'workspace',
						meta: 'dev.example/workspace',
						schema: z.object({ id: z.string(), label: z.string() }).transform((value) => value.id),
						required: true,
					},
				],
			});
			const missing = parse<CommandResult>(
				await server.handleRequest(request(41, 'tools/call', { name: 'item-get' }))
			);
			const invalid = parse<CommandResult>(
				await server.handleRequest(
					request(42, 'tools/call', {
						name: 'item-get',
						_meta: { 'dev.example/workspace': 7 },
					})
				)
			);
			const batch = parse<BatchResult>(
				await server.handleRequest(
					request(43, 'tools/call', {
						name: 'afd-batch',
						_meta: { 'dev.example/workspace': { id: 'garden', label: 'Garden' } },
						arguments: {
							commands: [{ command: 'item-get', input: {} }],
							meta: { 'dev.example/workspace': { label: 'Garden', id: 'garden' } },
						},
					})
				)
			);
			expect(missing.body.error?.code).toBe('VALIDATION_ERROR');
			expect(invalid.body.error?.code).toBe('VALIDATION_ERROR');
			expect(batch.body.results[0]?.result.success).toBe(true);
			expect(seen).toEqual(['garden']);
			const discovery = await server.handleRequest(request(49, 'server/discover'));
			expect(discovery.result).toMatchObject({
				_meta: {
					'dev.afd/context-fields': [
						{
							name: 'workspace',
							meta: 'dev.example/workspace',
							required: true,
							journal: false,
							schema: { type: 'object', required: ['id', 'label'] },
						},
					],
				},
			});
		});

		it('merges batch meta before dispatch and rejects conflicting or malformed carriers', async () => {
			let calls = 0;
			const command = defineCommand({
				name: 'item-create',
				description: 'Create an item',
				expose: { mcp: true },
				input: z.object({}),
				contexts: ['editing'],
				async handler() {
					calls++;
					return success({});
				},
			});
			const server = createMockServer([command], {
				contexts: [{ name: 'editing' }, { name: 'viewing' }],
			});
			const commands = [{ command: 'item-create', input: {} }];
			const scoped = parse<BatchResult>(
				await server.handleRequest(
					request(44, 'tools/call', {
						name: 'afd-batch',
						arguments: { commands, meta: { 'dev.afd/context': 'viewing' } },
					})
				)
			);
			const conflict = parse<CommandResult>(
				await server.handleRequest(
					request(45, 'tools/call', {
						name: 'afd-batch',
						arguments: { commands, meta: { 'dev.afd/context': 'viewing' } },
						_meta: { 'dev.afd/context': 'editing' },
					})
				)
			);
			const malformed = parse<CommandResult>(
				await server.handleRequest(
					request(46, 'tools/call', {
						name: 'afd-batch',
						arguments: { commands, meta: 'editing' },
					})
				)
			);
			expect(scoped.body.results[0]?.result.error?.code).toBe('COMMAND_NOT_IN_CONTEXT');
			expect(conflict.body.error).toMatchObject({
				code: 'VALIDATION_ERROR',
				details: { meta: 'dev.afd/context' },
			});
			expect(malformed.body.error).toMatchObject({
				code: 'VALIDATION_ERROR',
				details: { argument: 'meta' },
			});
			expect(calls).toBe(0);
		});

		it('rejects non-string active contexts instead of converting them to configured names', async () => {
			let calls = 0;
			const server = createMockServer(
				[
					createMockCommand('item-get', () => {
						calls++;
						return {};
					}),
				],
				{
					contexts: [{ name: '1' }],
				}
			);
			const single = await server.handleRequest(
				request(47, 'tools/call', { name: 'item-get', _meta: { 'dev.afd/context': 1 } })
			);
			const batch = await server.handleRequest(
				request(48, 'tools/call', {
					name: 'afd-batch',
					arguments: {
						commands: [{ command: 'item-get', input: {} }],
						meta: { 'dev.afd/context': 1 },
					},
				})
			);
			expect(single.error?.code).toBe(-32602);
			expect(batch.error?.code).toBe(-32602);
			expect(calls).toBe(0);
		});

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
