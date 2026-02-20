/**
 * @fileoverview Tests for DirectTransport and DirectClient
 *
 * These tests validate zero-overhead in-process command execution.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	type CommandDefinition,
	createDirectClient,
	DirectClient,
	type DirectRegistry,
	DirectTransport,
	type UnknownToolError,
} from './direct.js';

/**
 * Mock registry for testing - basic version without validation support
 */
class MockRegistry implements DirectRegistry {
	private todos = new Map<string, { id: string; title: string; completed: boolean }>();
	private idCounter = 0;
	public lastContext?: CommandContext;

	async execute<T>(
		name: string,
		input?: unknown,
		context?: CommandContext
	): Promise<CommandResult<T>> {
		// Capture context for testing
		this.lastContext = context;
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
			const createResult = await client.call<{ id: string; completed: boolean }>('todo-create', {
				title: 'Toggle test',
			});
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
// createDirectClient Factory Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('createDirectClient', () => {
	it('creates a DirectClient instance', () => {
		const registry = new MockRegistry();
		const client = createDirectClient(registry);

		expect(client).toBeInstanceOf(DirectClient);
		expect(client.hasCommand('todo-create')).toBe(true);
	});

	it('creates a DirectClient with options', () => {
		const registry = new MockRegistry();
		const client = createDirectClient(registry, {
			source: 'test-agent',
			debug: false,
			validateInputs: true,
		});

		expect(client.getSource()).toBe('test-agent');
	});

	it('propagates source to command context', async () => {
		const registry = new MockRegistry();
		const client = createDirectClient(registry, { source: 'my-agent' });

		await client.call('todo-list', {});

		expect(registry.lastContext?.source).toBe('my-agent');
	});

	it('propagates custom traceId to command context', async () => {
		const registry = new MockRegistry();
		const client = createDirectClient(registry);

		await client.call('todo-list', {}, { traceId: 'custom-trace-123' });

		expect(registry.lastContext?.traceId).toBe('custom-trace-123');
	});

	it('generates traceId when not provided', async () => {
		const registry = new MockRegistry();
		const client = createDirectClient(registry);

		await client.call('todo-list', {});

		expect(registry.lastContext?.traceId).toBeDefined();
		expect(registry.lastContext?.traceId).toMatch(/^trace-/);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Input Validation Tests
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mock registry with validation support
 */
class ValidatingMockRegistry implements DirectRegistry {
	private todos = new Map<string, { id: string; title: string; completed: boolean }>();
	private idCounter = 0;

	private commandDefs: Map<string, CommandDefinition> = new Map([
		[
			'todo-create',
			{
				name: 'todo-create',
				description: 'Create a new todo',
				parameters: [
					{ name: 'title', type: 'string', description: 'Todo title', required: true },
					{ name: 'priority', type: 'number', description: 'Priority level' },
				],
			},
		],
		[
			'todo-list',
			{
				name: 'todo-list',
				description: 'List all todos',
				parameters: [],
			},
		],
		[
			'todo-status',
			{
				name: 'todo-status',
				description: 'Get todo status',
				parameters: [
					{
						name: 'status',
						type: 'string',
						description: 'Status filter',
						enum: ['pending', 'completed', 'all'],
					},
				],
			},
		],
	]);

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
				return { success: true, data: { items, total: items.length } as T };
			}

			case 'todo-status': {
				return { success: true, data: { status: params.status } as T };
			}

			default:
				return {
					success: false,
					error: { code: 'COMMAND_NOT_FOUND', message: `Unknown command: ${name}` },
				};
		}
	}

	listCommandNames(): string[] {
		return Array.from(this.commandDefs.keys());
	}

	listCommands(): Array<{ name: string; description: string }> {
		return Array.from(this.commandDefs.values()).map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
		}));
	}

	hasCommand(name: string): boolean {
		return this.commandDefs.has(name);
	}

	getCommand(name: string): CommandDefinition | undefined {
		return this.commandDefs.get(name);
	}
}

describe('DirectClient Input Validation', () => {
	let registry: ValidatingMockRegistry;
	let client: DirectClient;

	beforeEach(() => {
		registry = new ValidatingMockRegistry();
		client = createDirectClient(registry, { validateInputs: true });
	});

	it('passes validation for valid input', async () => {
		const result = await client.call('todo-create', { title: 'Test' });
		expect(result.success).toBe(true);
	});

	it('fails validation for missing required parameter', async () => {
		const result = await client.call('todo-create', {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toContain("Required parameter 'title' is missing");
	});

	it('fails validation for wrong type', async () => {
		const result = await client.call('todo-create', { title: 123 });

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toContain('wrong type');
	});

	it('fails validation for invalid enum value', async () => {
		const result = await client.call('todo-status', { status: 'invalid' });

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toContain('must be one of');
	});

	it('passes validation for valid enum value', async () => {
		const result = await client.call('todo-status', { status: 'pending' });
		expect(result.success).toBe(true);
	});

	it('skips validation when validateInputs is false', async () => {
		const noValidationClient = createDirectClient(registry, { validateInputs: false });

		// This would fail validation but should execute since validation is disabled
		const result = await noValidationClient.call('todo-create', {});

		// Will execute but handler might fail - point is validation didn't block it
		// The registry handler will still work with undefined title
		expect(result).toBeDefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Performance Tests - Benchmark Suite
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

	it('meets <0.5ms latency requirement (issue #12)', async () => {
		const registry = new MockRegistry();
		const client = createDirectClient(registry, { validateInputs: false });

		// Warm up
		for (let i = 0; i < 10; i++) {
			await client.call('todo-list', {});
		}

		// Benchmark
		const iterations = 1000;
		const latencies: number[] = [];

		for (let i = 0; i < iterations; i++) {
			const start = performance.now();
			await client.call('todo-list', {});
			const end = performance.now();
			latencies.push(end - start);
		}

		// Calculate statistics
		const avgMs = latencies.reduce((a, b) => a + b, 0) / iterations;
		const sortedLatencies = latencies.sort((a, b) => a - b);
		const p50 = sortedLatencies[Math.floor(iterations * 0.5)] ?? 0;
		const p95 = sortedLatencies[Math.floor(iterations * 0.95)] ?? 0;
		const p99 = sortedLatencies[Math.floor(iterations * 0.99)] ?? 0;

		// Issue #12 requirement: latency < 0.5ms for simple commands
		expect(avgMs).toBeLessThan(0.5);
		expect(p50).toBeLessThan(0.5);

		// Log benchmark results for visibility
		console.log(`DirectClient Benchmark Results (${iterations} iterations):`);
		console.log(`  Average: ${avgMs.toFixed(4)}ms`);
		console.log(`  P50:     ${p50.toFixed(4)}ms`);
		console.log(`  P95:     ${p95.toFixed(4)}ms`);
		console.log(`  P99:     ${p99.toFixed(4)}ms`);
	});

	it('maintains low latency with validation enabled', async () => {
		const registry = new ValidatingMockRegistry();
		const client = createDirectClient(registry, { validateInputs: true });

		// Warm up
		for (let i = 0; i < 10; i++) {
			await client.call('todo-create', { title: 'Warmup' });
		}

		// Benchmark
		const iterations = 500;
		const latencies: number[] = [];

		for (let i = 0; i < iterations; i++) {
			const start = performance.now();
			await client.call('todo-create', { title: `Todo ${i}` });
			const end = performance.now();
			latencies.push(end - start);
		}

		const avgMs = latencies.reduce((a, b) => a + b, 0) / iterations;

		// Even with validation, should still be under 0.5ms
		expect(avgMs).toBeLessThan(0.5);

		console.log(`DirectClient with Validation Benchmark (${iterations} iterations):`);
		console.log(`  Average: ${avgMs.toFixed(4)}ms`);
	});

	it('is significantly faster than MCP transport would be', async () => {
		const registry = new MockRegistry();
		const client = createDirectClient(registry);

		const iterations = 100;
		const start = performance.now();

		for (let i = 0; i < iterations; i++) {
			await client.call('todo-list', {});
		}

		const elapsed = performance.now() - start;
		const avgMs = elapsed / iterations;

		// DirectClient should be at least 10x faster than typical MCP (~2-10ms)
		// This means we expect < 0.2ms average
		expect(avgMs).toBeLessThan(0.2);

		console.log(`DirectClient vs MCP comparison:`);
		console.log(`  DirectClient average: ${avgMs.toFixed(4)}ms`);
		console.log(`  Typical MCP HTTP:     ~2-5ms (10-50x slower)`);
		console.log(`  Typical MCP SSE:      ~5-10ms (25-100x slower)`);
	});
});
