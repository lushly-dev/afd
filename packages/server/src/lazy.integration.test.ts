import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { executeDetail, executeDiscover } from './lazy-tools.js';
import { defineCommand } from './schema.js';
import { createMcpServer } from './server.js';
import { getToolsList } from './tools.js';

function createTestCommands() {
	return [
		defineCommand({
			name: 'todo-create',
			description: 'Creates a new todo item',
			category: 'todo',
			mutation: true,
			input: z.object({ title: z.string() }),
			handler: async (input) => ({
				success: true as const,
				data: { id: '1', title: input.title },
			}),
		}),
		defineCommand({
			name: 'todo-list',
			description: 'Lists all todo items',
			category: 'todo',
			mutation: false,
			input: z.object({}),
			handler: async () => ({ success: true as const, data: [] }),
		}),
		defineCommand({
			name: 'user-get',
			description: 'Gets a user by ID',
			category: 'user',
			mutation: false,
			input: z.object({ id: z.string() }),
			handler: async () => ({
				success: true as const,
				data: { id: '1', name: 'Alice' },
			}),
		}),
	];
}

describe('lazy strategy tool enumeration', () => {
	it('returns exactly 5 tools in lazy mode', () => {
		const commands = createTestCommands();
		const tools = getToolsList(commands, 'lazy');
		expect(tools).toHaveLength(5);
		const names = tools.map((t) => t.name);
		expect(names).toContain('afd-discover');
		expect(names).toContain('afd-detail');
		expect(names).toContain('afd-call');
		expect(names).toContain('afd-batch');
		expect(names).toContain('afd-pipe');
	});

	it('afd-call is present in individual strategy', () => {
		const tools = getToolsList(createTestCommands(), 'individual');
		expect(tools.map((t) => t.name)).toContain('afd-call');
	});

	it('afd-call is present in grouped strategy', () => {
		const tools = getToolsList(createTestCommands(), 'grouped');
		expect(tools.map((t) => t.name)).toContain('afd-call');
	});
});

describe('afd-call via server.execute', () => {
	it('executes a command via afd-call', async () => {
		const server = createMcpServer({
			name: 'test',
			version: '1.0.0',
			commands: createTestCommands(),
			toolStrategy: 'lazy',
			transport: 'http',
			port: 3400,
		});

		// Use the server's execute method for afd-call style dispatch
		const result = await server.execute('todo-create', { title: 'Test' });
		expect(result.success).toBe(true);
		expect(result.data).toEqual({ id: '1', title: 'Test' });
	});

	it('returns COMMAND_NOT_FOUND for unknown command', async () => {
		const server = createMcpServer({
			name: 'test',
			version: '1.0.0',
			commands: createTestCommands(),
			toolStrategy: 'lazy',
			transport: 'http',
			port: 3401,
		});

		const result = await server.execute('nonexistent-cmd', {});
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('COMMAND_NOT_FOUND');
	});
});

describe('afd-discover with context filtering via router', () => {
	it('filters commands by active context in afd-discover', async () => {
		const { createContextState } = await import('./bootstrap/afd-context.js');
		const { createToolRouter } = await import('./tool-router.js');
		const state = createContextState();
		state.enter('todo');

		const cmdA = defineCommand({
			name: 'todo-list',
			description: 'Lists todos',
			input: z.object({}),
			contexts: ['todo'],
			handler: async () => ({ success: true as const, data: [] }),
		});
		const cmdB = defineCommand({
			name: 'admin-reset',
			description: 'Resets admin state',
			input: z.object({}),
			contexts: ['admin'],
			handler: async () => ({ success: true as const, data: null }),
		});
		const cmdC = defineCommand({
			name: 'app-help',
			description: 'Shows help',
			input: z.object({}),
			handler: async () => ({ success: true as const, data: 'help' }),
		});

		const commands = [cmdA, cmdB, cmdC];
		const router = createToolRouter({
			executeCommand: async () => ({ success: true as const, data: null }),
			executeBatch: async () => ({
				success: true,
				results: [],
				timing: { totalMs: 0, averageMs: 0, startedAt: '', completedAt: '' },
				metadata: { successCount: 0, failureCount: 0, totalCount: 0, confidence: 1 },
				steps: [],
			}),
			executePipeline: async () => ({
				data: undefined,
				metadata: {
					confidence: 0,
					confidenceBreakdown: [],
					reasoning: [],
					warnings: [],
					sources: [],
					alternatives: [],
					executionTimeMs: 0,
					completedSteps: 0,
					totalSteps: 0,
				},
				steps: [],
			}),
			commands,
			toolStrategy: 'lazy',
			devMode: false,
			contextState: state,
		});

		const result = await router('afd-discover', {});
		const parsed = JSON.parse(result.content[0]?.text ?? '{}');
		const names = parsed.data?.commands?.map((c: { name: string }) => c.name) ?? [];
		expect(names).toContain('todo-list');
		expect(names).toContain('app-help');
		expect(names).not.toContain('admin-reset');
	});
});

describe('full discover -> detail -> call workflow', () => {
	it('completes the discovery flow end-to-end', async () => {
		const commands = createTestCommands();
		const server = createMcpServer({
			name: 'test',
			version: '1.0.0',
			commands,
			toolStrategy: 'lazy',
			transport: 'http',
			port: 3402,
		});

		// Step 1: Discover
		const discoverResult = executeDiscover(commands, { category: 'todo' });
		expect(discoverResult.success).toBe(true);
		expect(discoverResult.data?.commands).toHaveLength(2);

		// Step 2: Detail
		const exposedNames = new Set(commands.map((c) => c.name));
		const detailResult = executeDetail(commands, exposedNames, {
			command: discoverResult.data?.commands.map((c) => c.name) ?? [],
		});
		expect(detailResult.success).toBe(true);
		expect(detailResult.data?.every((e) => e.found)).toBe(true);

		// Step 3: Call
		const callResult = await server.execute('todo-create', { title: 'From discovery' });
		expect(callResult.success).toBe(true);
	});
});
