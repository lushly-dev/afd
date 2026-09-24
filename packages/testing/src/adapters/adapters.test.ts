/**
 * Adapter Tests
 *
 * Tests for the adapter system (registry, generic, todo adapters).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGenericAdapter, genericAdapter } from './generic.js';
import {
	createAdapterRegistry,
	detectAdapter,
	getAdapter,
	getGlobalRegistry,
	listAdapters,
	registerAdapter,
	resetGlobalRegistry,
} from './registry.js';
import { createTodoAdapter, type TodoFixture, todoAdapter } from './todo.js';
import type { AdapterContext, AppAdapter, FixtureValidationResult } from './types.js';

/** Run an adapter's fixture validator, failing the test if it has none. */
async function validateFixture(
	adapter: AppAdapter,
	fixture: unknown
): Promise<FixtureValidationResult> {
	const result = await adapter.fixture.validate?.(fixture);
	if (!result) throw new Error(`Adapter '${adapter.name}' has no fixture validator`);
	return result;
}

// ============================================================================
// Registry Tests
// ============================================================================

describe('Adapter Registry', () => {
	beforeEach(() => {
		resetGlobalRegistry();
	});

	describe('createAdapterRegistry', () => {
		it('creates empty registry', () => {
			const registry = createAdapterRegistry();
			expect(registry.list()).toHaveLength(0);
		});

		it('creates registry with initial adapters', () => {
			const registry = createAdapterRegistry({
				adapters: [todoAdapter],
			});
			expect(registry.list()).toHaveLength(1);
			expect(registry.has('todo')).toBe(true);
		});

		it('creates registry with default adapter', () => {
			const registry = createAdapterRegistry({
				adapters: [genericAdapter],
				defaultAdapter: 'generic',
			});
			// Detection returns default when no match
			const detected = registry.detect({ unknown: true });
			expect(detected?.name).toBe('generic');
		});
	});

	describe('register()', () => {
		it('registers an adapter', () => {
			const registry = createAdapterRegistry();
			registry.register(todoAdapter);
			expect(registry.has('todo')).toBe(true);
		});

		it('throws on duplicate registration', () => {
			const registry = createAdapterRegistry();
			registry.register(todoAdapter);
			expect(() => registry.register(todoAdapter)).toThrow('already registered');
		});
	});

	describe('get()', () => {
		it('returns registered adapter', () => {
			const registry = createAdapterRegistry({ adapters: [todoAdapter] });
			const adapter = registry.get('todo');
			expect(adapter).toBe(todoAdapter);
		});

		it('returns undefined for unknown adapter', () => {
			const registry = createAdapterRegistry();
			expect(registry.get('unknown')).toBeUndefined();
		});
	});

	describe('list()', () => {
		it('returns all registered adapters', () => {
			const registry = createAdapterRegistry({
				adapters: [todoAdapter, genericAdapter],
			});
			const adapters = registry.list();
			expect(adapters).toHaveLength(2);
			expect(adapters.map((a) => a.name)).toContain('todo');
			expect(adapters.map((a) => a.name)).toContain('generic');
		});
	});

	describe('detect()', () => {
		it('detects adapter from fixture app field', () => {
			const registry = createAdapterRegistry({ adapters: [todoAdapter] });
			const fixture = { app: 'todo', todos: [] };
			const detected = registry.detect(fixture);
			expect(detected?.name).toBe('todo');
		});

		it('returns undefined when no match', () => {
			const registry = createAdapterRegistry({ adapters: [todoAdapter] });
			const fixture = { app: 'unknown' };
			const detected = registry.detect(fixture);
			expect(detected).toBeUndefined();
		});
	});

	describe('has()', () => {
		it('returns true for registered adapter', () => {
			const registry = createAdapterRegistry({ adapters: [todoAdapter] });
			expect(registry.has('todo')).toBe(true);
		});

		it('returns false for unregistered adapter', () => {
			const registry = createAdapterRegistry();
			expect(registry.has('todo')).toBe(false);
		});
	});
});

describe('Global Registry', () => {
	beforeEach(() => {
		resetGlobalRegistry();
	});

	it('getGlobalRegistry creates registry on first call', () => {
		const registry = getGlobalRegistry();
		expect(registry).toBeDefined();
		expect(registry.list()).toHaveLength(0);
	});

	it('registerAdapter adds to global registry', () => {
		registerAdapter(todoAdapter);
		expect(getAdapter('todo')).toBe(todoAdapter);
	});

	it('listAdapters returns all from global registry', () => {
		registerAdapter(todoAdapter);
		registerAdapter(genericAdapter);
		expect(listAdapters()).toHaveLength(2);
	});

	it('detectAdapter uses global registry', () => {
		registerAdapter(todoAdapter);
		const detected = detectAdapter({ app: 'todo' });
		expect(detected?.name).toBe('todo');
	});
});

// ============================================================================
// Generic Adapter Tests
// ============================================================================

describe('Generic Adapter', () => {
	describe('createGenericAdapter', () => {
		it('creates adapter with defaults', () => {
			const adapter = createGenericAdapter('myapp');
			expect(adapter.name).toBe('myapp');
			expect(adapter.version).toBe('1.0.0');
			expect(adapter.cli.command).toBe('myapp');
		});

		it('creates adapter with custom options', () => {
			const adapter = createGenericAdapter('myapp', {
				version: '2.0.0',
				cliCommand: 'my-app-cli',
				defaultArgs: ['--json'],
				commands: ['cmd-one', 'cmd-two'],
				errors: ['ERROR_ONE'],
				jobs: ['job-one'],
			});
			expect(adapter.version).toBe('2.0.0');
			expect(adapter.cli.command).toBe('my-app-cli');
			expect(adapter.cli.defaultArgs).toEqual(['--json']);
			expect(adapter.commands.list()).toEqual(['cmd-one', 'cmd-two']);
			expect(adapter.errors.list()).toEqual(['ERROR_ONE']);
			expect(adapter.jobs.list()).toEqual(['job-one']);
		});
	});

	describe('fixture.apply', () => {
		it('applies generic data fixture', async () => {
			const adapter = createGenericAdapter('test');
			const handler = vi.fn().mockResolvedValue({ success: true, data: {} });
			const context: AdapterContext = { cli: 'test', handler };

			const fixture = {
				app: 'test',
				data: [{ command: 'cmd-one', input: { key: 'value' } }, { command: 'cmd-two' }],
			};

			const result = await adapter.fixture.apply(fixture, context);
			expect(result.appliedCommands).toHaveLength(2);
			expect(handler).toHaveBeenCalledTimes(2);
			expect(handler).toHaveBeenCalledWith('cmd-one', { key: 'value' });
			expect(handler).toHaveBeenCalledWith('cmd-two', {});
		});

		it('applies generic setup fixture', async () => {
			const adapter = createGenericAdapter('test');
			const handler = vi.fn().mockResolvedValue({ success: true });
			const context: AdapterContext = { cli: 'test', handler };

			const fixture = {
				app: 'test',
				setup: [{ command: 'init' }],
			};

			const result = await adapter.fixture.apply(fixture, context);
			expect(result.appliedCommands).toHaveLength(1);
			expect(handler).toHaveBeenCalledWith('init', {});
		});

		it('stops at the first failed command and warns about entries without a command', async () => {
			const adapter = createGenericAdapter('test');
			const handler = vi
				.fn()
				.mockResolvedValueOnce({ success: true })
				.mockResolvedValueOnce({ success: false, error: { code: 'BOOM', message: 'failed' } });

			const result = await adapter.fixture.apply(
				{
					app: 'test',
					data: [{ command: 'seed-one' }, { input: {} }],
					setup: [{ command: 'setup-one' }, { command: 'setup-two' }],
				},
				{ cli: 'test', handler }
			);

			expect(handler.mock.calls.map((call) => call[0])).toEqual(['seed-one', 'setup-one']);
			expect(result.appliedCommands.at(-1)?.result?.success).toBe(false);
			expect(result.warnings).toContain("Skipped a fixture entry without a string 'command'");
		});

		it('propagates handler exceptions instead of turning them into warnings', async () => {
			const adapter = createGenericAdapter('test');
			const handler = vi.fn().mockRejectedValue(new Error('connection refused'));

			await expect(
				adapter.fixture.apply(
					{ app: 'test', setup: [{ command: 'init' }] },
					{ cli: 'test', handler }
				)
			).rejects.toThrow('connection refused');
		});

		it('returns warning when no handler', async () => {
			const adapter = createGenericAdapter('test');
			const context: AdapterContext = { cli: 'test' };

			const result = await adapter.fixture.apply({ app: 'test' }, context);
			expect(result.warnings).toContain('No command handler provided, fixture not applied');
		});
	});

	describe('fixture.validate', () => {
		it('validates valid fixture', async () => {
			const adapter = createGenericAdapter('test');
			const result = await validateFixture(adapter, {
				app: 'test',
				data: [{ command: 'cmd' }],
			});
			expect(result.valid).toBe(true);
		});

		it('rejects non-object fixture', async () => {
			const adapter = createGenericAdapter('test');
			const result = await validateFixture(adapter, 'not an object');
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Fixture must be an object');
		});

		it('warns about missing app field', async () => {
			const adapter = createGenericAdapter('test');
			const result = await validateFixture(adapter, { data: [] });
			expect(result.valid).toBe(false);
			expect(result.errors?.some((e) => e.includes('app'))).toBe(true);
		});
	});

	describe('errors.isRetryable', () => {
		it('identifies retryable errors', () => {
			expect(genericAdapter.errors.isRetryable?.('TIMEOUT')).toBe(true);
			expect(genericAdapter.errors.isRetryable?.('NETWORK_ERROR')).toBe(true);
			expect(genericAdapter.errors.isRetryable?.('NOT_FOUND')).toBe(false);
		});
	});
});

// ============================================================================
// Todo Adapter Tests
// ============================================================================

describe('Todo Adapter', () => {
	describe('todoAdapter', () => {
		it('has correct configuration', () => {
			expect(todoAdapter.name).toBe('todo');
			expect(todoAdapter.version).toBe('1.0.0');
			expect(todoAdapter.cli.inputFormat).toBe('json-arg');
		});

		it('lists all commands', async () => {
			const commands = await todoAdapter.commands.list();
			expect(commands).toContain('todo-create');
			expect(commands).toContain('todo-list');
			expect(commands).toContain('todo-toggle');
			expect(commands).toContain('todo-delete');
			expect(commands.every((c) => /^todo-[a-z-]+$/.test(c))).toBe(true);
			expect(commands.length).toBe(11);
		});

		it('lists all error codes', () => {
			const errors = todoAdapter.errors.list();
			expect(errors).toContain('NOT_FOUND');
			expect(errors).toContain('VALIDATION_ERROR');
		});

		it('lists all jobs', () => {
			const jobs = todoAdapter.jobs.list();
			expect(jobs).toContain('manage-daily-tasks');
			expect(jobs).toContain('track-progress');
		});

		it('gets related commands for job', () => {
			const commands = todoAdapter.jobs.getRelatedCommands?.('manage-daily-tasks');
			expect(commands).toContain('todo-create');
			expect(commands).toContain('todo-update');
		});
	});

	describe('fixture.apply', () => {
		it('applies todo fixture with clearFirst', async () => {
			const handler = vi.fn().mockResolvedValue({ success: true, data: { id: 'test-1' } });
			const context: AdapterContext = { cli: 'todo', handler };

			const fixture: TodoFixture = {
				app: 'todo',
				clearFirst: true,
				todos: [{ title: 'Test todo', priority: 'high' }],
			};

			const result = await todoAdapter.fixture.apply(fixture, context);

			expect(result.appliedCommands.length).toBeGreaterThanOrEqual(2);
			expect(result.appliedCommands[0]?.command).toBe('todo-clear');
			expect(result.appliedCommands[1]?.command).toBe('todo-create');
			// clearFirst clears every todo, not only completed ones
			expect(handler).toHaveBeenCalledWith('todo-clear', { all: true });
			expect(handler).toHaveBeenCalledWith('todo-create', {
				title: 'Test todo',
				priority: 'high',
			});
		});

		it('clears first by default and records each real result', async () => {
			const handler = vi.fn().mockResolvedValue({ success: true, data: { id: 'test-1' } });
			const context: AdapterContext = { cli: 'todo', handler };

			const result = await todoAdapter.fixture.apply(
				{ app: 'todo', todos: [{ title: 'A', description: 'details' }] },
				context
			);

			expect(result.appliedCommands.map((c) => c.command)).toEqual(['todo-clear', 'todo-create']);
			expect(result.appliedCommands[1]?.input).toEqual({
				title: 'A',
				priority: 'medium',
				description: 'details',
			});
			expect(result.appliedCommands[1]?.result).toEqual({ success: true, data: { id: 'test-1' } });
		});

		it('stops at the first failed command', async () => {
			const handler = vi
				.fn()
				.mockResolvedValueOnce({ success: true, data: { cleared: 0 } })
				.mockResolvedValueOnce({
					success: false,
					error: { code: 'VALIDATION_ERROR', message: 'Title too long' },
				});
			const context: AdapterContext = { cli: 'todo', handler };

			const result = await todoAdapter.fixture.apply(
				{ app: 'todo', todos: [{ title: 'x'.repeat(300) }, { title: 'never created' }] },
				context
			);

			expect(handler).toHaveBeenCalledTimes(2);
			expect(result.appliedCommands.at(-1)?.result?.success).toBe(false);
		});

		it('stops when clearing fails', async () => {
			const handler = vi.fn().mockResolvedValue({
				success: false,
				error: { code: 'COMMAND_NOT_FOUND', message: 'Unknown command todo-clear' },
			});

			const result = await todoAdapter.fixture.apply(
				{ app: 'todo', todos: [{ title: 'never created' }] },
				{ cli: 'todo', handler }
			);

			expect(handler).toHaveBeenCalledTimes(1);
			expect(result.appliedCommands).toHaveLength(1);
		});

		it('warns instead of toggling when create returns no id', async () => {
			const handler = vi.fn().mockResolvedValue({ success: true, data: {} });

			const result = await todoAdapter.fixture.apply(
				{ app: 'todo', clearFirst: false, todos: [{ title: 'Done', completed: true }] },
				{ cli: 'todo', handler }
			);

			expect(result.appliedCommands.map((c) => c.command)).toEqual(['todo-create']);
			expect(result.warnings?.[0]).toContain('no id');
		});

		it('stops when toggling a completed todo fails', async () => {
			const handler = vi
				.fn()
				.mockResolvedValueOnce({ success: true, data: { id: 'a' } })
				.mockResolvedValueOnce({ success: false, error: { code: 'NOT_FOUND', message: 'gone' } });

			const result = await todoAdapter.fixture.apply(
				{
					app: 'todo',
					clearFirst: false,
					todos: [{ title: 'Done', completed: true }, { title: 'never created' }],
				},
				{ cli: 'todo', handler }
			);

			expect(result.appliedCommands.map((c) => c.command)).toEqual(['todo-create', 'todo-toggle']);
		});

		it('resets by clearing every todo', async () => {
			const handler = vi.fn().mockResolvedValue({ success: true });

			await todoAdapter.fixture.reset({ cli: 'todo', handler });

			expect(handler).toHaveBeenCalledWith('todo-clear', { all: true });
		});

		it('toggles completed todos', async () => {
			const handler = vi.fn().mockResolvedValue({ success: true, data: { id: 'test-1' } });
			const context: AdapterContext = { cli: 'todo', handler };

			const fixture: TodoFixture = {
				app: 'todo',
				clearFirst: false,
				todos: [{ title: 'Completed todo', completed: true }],
			};

			const result = await todoAdapter.fixture.apply(fixture, context);

			// Should have create and toggle
			const commands = result.appliedCommands.map((c) => c.command);
			expect(commands).toEqual(['todo-create', 'todo-toggle']);
			expect(handler).toHaveBeenCalledWith('todo-toggle', { id: 'test-1' });
		});
	});

	describe('fixture.validate', () => {
		it('validates valid fixture', async () => {
			const result = await validateFixture(todoAdapter, {
				app: 'todo',
				todos: [{ title: 'Test' }],
			});
			expect(result.valid).toBe(true);
		});

		it('rejects wrong app name', async () => {
			const result = await validateFixture(todoAdapter, {
				app: 'other',
				todos: [],
			});
			expect(result.valid).toBe(false);
			expect(result.errors?.some((e) => e.includes("'todo'"))).toBe(true);
		});

		it('rejects todo without title', async () => {
			const result = await validateFixture(todoAdapter, {
				app: 'todo',
				todos: [{ priority: 'high' }],
			});
			expect(result.valid).toBe(false);
			expect(result.errors?.some((e) => e.includes('title'))).toBe(true);
		});

		it('rejects invalid priority', async () => {
			const result = await validateFixture(todoAdapter, {
				app: 'todo',
				todos: [{ title: 'Test', priority: 'urgent' }],
			});
			expect(result.valid).toBe(false);
			expect(result.errors?.some((e) => e.includes('priority'))).toBe(true);
		});
	});

	describe('commands.mapFileToCommands', () => {
		it('maps create.ts to todo-create', () => {
			const commands = todoAdapter.commands.mapFileToCommands?.('src/commands/create.ts');
			expect(commands).toContain('todo-create');
		});

		it('maps store.ts to all commands', () => {
			const commands = todoAdapter.commands.mapFileToCommands?.('src/store.ts');
			expect(commands).toHaveLength(11);
		});

		it('returns empty for unknown files', () => {
			const commands = todoAdapter.commands.mapFileToCommands?.('src/utils/helper.ts');
			expect(commands).toEqual([]);
		});
	});

	describe('createTodoAdapter', () => {
		it('creates adapter with overrides', () => {
			const adapter = createTodoAdapter({
				version: '2.0.0',
			});
			expect(adapter.name).toBe('todo');
			expect(adapter.version).toBe('2.0.0');
		});
	});
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Adapter Integration', () => {
	beforeEach(() => {
		resetGlobalRegistry();
	});

	it('full workflow: register, detect, apply', async () => {
		// Register adapter
		registerAdapter(todoAdapter);

		// Detect from fixture
		const fixture: TodoFixture = {
			app: 'todo',
			todos: [{ title: 'Integration test' }],
		};
		const adapter = detectAdapter(fixture);
		expect(adapter?.name).toBe('todo');
		if (!adapter) throw new Error('Expected the todo adapter to be detected');

		// Apply fixture
		const handler = vi.fn().mockResolvedValue({ success: true, data: { id: 'int-1' } });
		const context: AdapterContext = { cli: 'todo', handler };
		const result = await adapter.fixture.apply(fixture, context);

		expect(result.appliedCommands.length).toBeGreaterThan(0);
		expect(handler).toHaveBeenCalled();
	});

	it('falls back to generic when no adapter matches', () => {
		registerAdapter(genericAdapter);

		const registry = getGlobalRegistry();
		// Can't detect because app: 'custom' doesn't match 'generic'
		const detected = registry.detect({ app: 'custom' });
		expect(detected).toBeUndefined();
	});
});
