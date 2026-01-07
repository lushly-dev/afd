/**
 * @fileoverview Tests for DirectTransport and DirectClient
 *
 * These tests validate zero-overhead in-process command execution.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DirectClient, DirectTransport, type DirectRegistry, type UnknownToolError } from './direct.js';
import type { CommandResult } from '@lushly-dev/afd-core';

/**
 * Mock registry for testing
 */
class MockRegistry implements DirectRegistry {
	private todos = new Map<string, { id: string; title: string; completed: boolean }>();
	private idCounter = 0;

	async execute<T>(name: string, input?: unknown): Promise<CommandResult<T>> {
		const params = (input ?? {}) as Record<string, unknown>;

		switch (name) {
			case 'todo-create': {
				const id = `todo-${++this.idCounter}`;
				const todo = {
					id,
					title: params.title as string,
					completed: false,
				};
				this.todos.set(id, todo);
				return { success: true, data: todo as T };
			}

			case 'todo-list': {
				const items = Array.from(this.todos.values());
				return {
					success: true,
					data: { items, total: items.length } as T,
				};
			}

			case 'todo-get': {
				const todo = this.todos.get(params.id as string);
				if (!todo) {
					return {
						success: false,
						error: { code: 'NOT_FOUND', message: `Todo ${params.id} not found` },
					};
				}
				return { success: true, data: todo as T };
			}

			case 'todo-toggle': {
				const todo = this.todos.get(params.id as string);
				if (!todo) {
					return {
						success: false,
						error: { code: 'NOT_FOUND', message: `Todo ${params.id} not found` },
					};
				}
				todo.completed = !todo.completed;
				return { success: true, data: todo as T };
			}

			case 'todo-delete': {
				const deleted = this.todos.delete(params.id as string);
				return { success: true, data: { deleted } as T };
			}

			case 'todo-clear': {
				const count = this.todos.size;
				this.todos.clear();
				return { success: true, data: { cleared: count } as T };
			}

			default:
				return {
					success: false,
					error: { code: 'COMMAND_NOT_FOUND', message: `Unknown command: ${name}` },
				};
		}
	}

	listCommandNames(): string[] {
		return ['todo-create', 'todo-list', 'todo-get', 'todo-toggle', 'todo-delete', 'todo-clear'];
	}

	listCommands(): Array<{ name: string; description: string }> {
		return [
			{ name: 'todo-create', description: 'Create a new todo' },
			{ name: 'todo-list', description: 'List all todos' },
			{ name: 'todo-get', description: 'Get a todo by ID' },
			{ name: 'todo-toggle', description: 'Toggle todo completion' },
			{ name: 'todo-delete', description: 'Delete a todo' },
			{ name: 'todo-clear', description: 'Clear all todos' },
		];
	}

	hasCommand(name: string): boolean {
		return this.listCommandNames().includes(name);
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// DirectClient Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('DirectClient', () => {
	let registry: MockRegistry;
	let client: DirectClient;

	beforeEach(() => {
		registry = new MockRegistry();
		client = new DirectClient(registry);
	});

	describe('listCommands', () => {
		it('returns all available commands', () => {
			const commands = client.listCommands();
			expect(commands).toHaveLength(6);
			expect(commands.map((c) => c.name)).toContain('todo-create');
		});
	});

	describe('listCommandNames', () => {
		it('returns command names as strings', () => {
			const names = client.listCommandNames();
			expect(names).toEqual([
				'todo-create',
				'todo-list',
				'todo-get',
				'todo-toggle',
				'todo-delete',
				'todo-clear',
			]);
		});
	});

	describe('hasCommand', () => {
		it('returns true for existing commands', () => {
			expect(client.hasCommand('todo-create')).toBe(true);
			expect(client.hasCommand('todo-list')).toBe(true);
		});

		it('returns false for non-existent commands', () => {
			expect(client.hasCommand('unknown-command')).toBe(false);
		});
	});

	describe('call', () => {
		it('executes create command successfully', async () => {
			const result = await client.call<{ id: string; title: string }>('todo-create', {
				title: 'Test todo',
			});

			expect(result.success).toBe(true);
			expect(result.data?.title).toBe('Test todo');
			expect(result.data?.id).toBeDefined();
		});

		it('executes list command and returns items', async () => {
			// Create some todos first
			await client.call('todo-create', { title: 'First' });
			await client.call('todo-create', { title: 'Second' });

			const result = await client.call<{ items: unknown[]; total: number }>('todo-list', {});

			expect(result.success).toBe(true);
			expect(result.data?.total).toBe(2);
			expect(result.data?.items).toHaveLength(2);
		});

		it('handles not found errors correctly', async () => {
			const result = await client.call('todo-get', { id: 'non-existent' });

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('NOT_FOUND');
		});

		it('executes toggle command', async () => {
			const createResult = await client.call<{ id: string; completed: boolean }>(
				'todo-create',
				{ title: 'Toggle test' }
			);
			const id = createResult.data?.id;

			const toggleResult = await client.call<{ completed: boolean }>('todo-toggle', { id });

			expect(toggleResult.success).toBe(true);
			expect(toggleResult.data?.completed).toBe(true);

			// Toggle again
			const toggleResult2 = await client.call<{ completed: boolean }>('todo-toggle', { id });
			expect(toggleResult2.data?.completed).toBe(false);
		});

		it('returns UnknownToolError for unknown commands', async () => {
			const result = await client.call('unknown-command', {});

			expect(result.success).toBe(false);
			
			// Check for UnknownToolError structure
			const errorData = result.data as UnknownToolError;
			expect(errorData.error).toBe('UNKNOWN_TOOL');
			expect(errorData.requested_tool).toBe('unknown-command');
			expect(errorData.available_tools).toContain('todo-create');
			expect(errorData.available_tools).toHaveLength(6);
		});

		it('provides fuzzy match suggestions for similar commands', async () => {
			const result = await client.call('todo-creat', {}); // typo

			expect(result.success).toBe(false);
			
			const errorData = result.data as UnknownToolError;
			expect(errorData.suggestions).toContain('todo-create');
			expect(errorData.hint).toBe("Did you mean 'todo-create'?");
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// DirectTransport Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('DirectTransport', () => {
	let registry: MockRegistry;
	let transport: DirectTransport;

	beforeEach(() => {
		registry = new MockRegistry();
		transport = new DirectTransport(registry);
	});

	describe('connect/disconnect', () => {
		it('connects immediately', async () => {
			expect(transport.isConnected()).toBe(false);
			await transport.connect();
			expect(transport.isConnected()).toBe(true);
		});

		it('disconnects and calls close handler', async () => {
			let closeCalled = false;
			transport.onClose(() => {
				closeCalled = true;
			});

			await transport.connect();
			transport.disconnect();

			expect(transport.isConnected()).toBe(false);
			expect(closeCalled).toBe(true);
		});
	});

	describe('send - initialize', () => {
		it('handles initialize request', async () => {
			await transport.connect();

			const response = await transport.send({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {},
			});

			expect(response.id).toBe(1);
			expect(response.result).toBeDefined();
			expect(response.result.protocolVersion).toBe('2024-11-05');
			expect(response.result.serverInfo.name).toBe('direct-transport');
		});
	});

	describe('send - tools/list', () => {
		it('lists available tools', async () => {
			await transport.connect();

			const response = await transport.send({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/list',
				params: {},
			});

			expect(response.result.tools).toHaveLength(6);
			expect(response.result.tools[0].name).toBe('todo-create');
		});
	});

	describe('send - tools/call', () => {
		it('executes tool and returns result', async () => {
			await transport.connect();

			const response = await transport.send({
				jsonrpc: '2.0',
				id: 3,
				method: 'tools/call',
				params: {
					name: 'todo-create',
					arguments: { title: 'Transport test' },
				},
			});

			expect(response.result.isError).toBe(false);
			expect(response.result.content).toHaveLength(1);

			const content = JSON.parse(response.result.content[0].text);
			expect(content.success).toBe(true);
			expect(content.data.title).toBe('Transport test');
		});

		it('calls message handler after response', async () => {
			let messageReceived = false;
			transport.onMessage(() => {
				messageReceived = true;
			});

			await transport.connect();
			await transport.send({
				jsonrpc: '2.0',
				id: 4,
				method: 'tools/call',
				params: { name: 'todo-list', arguments: {} },
			});

			expect(messageReceived).toBe(true);
		});
	});

	describe('send - unknown method', () => {
		it('returns error for unknown methods', async () => {
			await transport.connect();

			const response = await transport.send({
				jsonrpc: '2.0',
				id: 5,
				method: 'unknown/method',
				params: {},
			});

			expect(response.error).toBeDefined();
			expect(response.error?.code).toBe(-32601);
		});
	});

	describe('error handling', () => {
		it('calls error handler on exceptions', async () => {
			// Create a registry that throws when executing
			const errorRegistry: DirectRegistry = {
				execute: async () => {
					throw new Error('Intentional test error');
				},
				listCommandNames: () => ['test-command'],
				listCommands: () => [{ name: 'test-command', description: 'Test' }],
				hasCommand: (name) => name === 'test-command', // Must return true to reach execute
			};

			const errorTransport = new DirectTransport(errorRegistry);
			let errorCaught: Error | null = null;
			errorTransport.onError((err) => {
				errorCaught = err;
			});

			await errorTransport.connect();
			const response = await errorTransport.send({
				jsonrpc: '2.0',
				id: 6,
				method: 'tools/call',
				params: { name: 'test-command', arguments: {} },
			});

			expect(response.error).toBeDefined();
			expect(response.error?.message).toBe('Intentional test error');
			expect(errorCaught?.message).toBe('Intentional test error');
		});

		it('returns UnknownToolError via MCP for unknown tools', async () => {
			await transport.connect();

			const response = await transport.send({
				jsonrpc: '2.0',
				id: 7,
				method: 'tools/call',
				params: { name: 'nonexistent-tool', arguments: {} },
			});

			// Should return as a result with isError=true, not as an MCP error
			expect(response.result).toBeDefined();
			expect(response.result.isError).toBe(true);

			const content = JSON.parse(response.result.content[0].text);
			expect(content.error).toBe('UNKNOWN_TOOL');
			expect(content.requested_tool).toBe('nonexistent-tool');
			expect(content.available_tools).toContain('todo-create');
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Performance Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('DirectClient Performance', () => {
	it('executes commands under 1ms average', async () => {
		const registry = new MockRegistry();
		const client = new DirectClient(registry);

		const iterations = 100;
		const start = performance.now();

		for (let i = 0; i < iterations; i++) {
			await client.call('todo-list', {});
		}

		const elapsed = performance.now() - start;
		const avgMs = elapsed / iterations;

		// Should be well under 1ms for direct execution
		expect(avgMs).toBeLessThan(1);
	});
});
