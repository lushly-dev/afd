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
import type { AdapterContext } from './types.js';

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
				commands: ['cmd.one', 'cmd.two'],
				errors: ['ERROR_ONE'],
				jobs: ['job-one'],
			});
			expect(adapter.version).toBe('2.0.0');
			expect(adapter.cli.command).toBe('my-app-cli');
			expect(adapter.cli.defaultArgs).toEqual(['--json']);
			expect(adapter.commands.list()).toEqual(['cmd.one', 'cmd.two']);
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
				data: [{ command: 'cmd.one', input: { key: 'value' } }, { command: 'cmd.two' }],
			};

			const result = await adapter.fixture.apply(fixture, context);
			expect(result.appliedCommands).toHaveLength(2);
			expect(handler).toHaveBeenCalledTimes(2);
			expect(handler).toHaveBeenCalledWith('cmd.one', { key: 'value' });
			expect(handler).toHaveBeenCalledWith('cmd.two', {});
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
			const result = await adapter.fixture.validate?.({
				app: 'test',
				data: [{ command: 'cmd' }],
			});
			expect(result.valid).toBe(true);
		});

		it('rejects non-object fixture', async () => {
			const adapter = createGenericAdapter('test');
			const result = await adapter.fixture.validate?.('not an object');
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Fixture must be an object');
		});

		it('warns about missing app field', async () => {
			const adapter = createGenericAdapter('test');
			const result = await adapter.fixture.validate?.({ data: [] });
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

		it('lists all commands', () => {
			const commands = todoAdapter.commands.list();
			expect(commands).toContain('todo.create');
			expect(commands).toContain('todo.list');
			expect(commands).toContain('todo.toggle');
			expect(commands).toContain('todo.delete');
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
			expect(commands).toContain('todo.create');
			expect(commands).toContain('todo.update');
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
			expect(result.appliedCommands[0]?.command).toBe('todo.clear');
			expect(result.appliedCommands[1]?.command).toBe('todo.create');
			expect(handler).toHaveBeenCalledWith('todo.clear', {});
			expect(handler).toHaveBeenCalledWith('todo.create', {
				title: 'Test todo',
				description: undefined,
				priority: 'high',
			});
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
			expect(commands).toContain('todo.create');
			expect(commands).toContain('todo.toggle');
		});
	});

	describe('fixture.validate', () => {
		it('validates valid fixture', async () => {
			const result = await todoAdapter.fixture.validate?.({
				app: 'todo',
				todos: [{ title: 'Test' }],
			});
			expect(result.valid).toBe(true);
		});

		it('rejects wrong app name', async () => {
			const result = await todoAdapter.fixture.validate?.({
				app: 'other',
				todos: [],
			});
			expect(result.valid).toBe(false);
			expect(result.errors?.some((e) => e.includes("'todo'"))).toBe(true);
		});

		it('rejects todo without title', async () => {
			const result = await todoAdapter.fixture.validate?.({
				app: 'todo',
				todos: [{ priority: 'high' }],
			});
			expect(result.valid).toBe(false);
			expect(result.errors?.some((e) => e.includes('title'))).toBe(true);
		});

		it('rejects invalid priority', async () => {
			const result = await todoAdapter.fixture.validate?.({
				app: 'todo',
				todos: [{ title: 'Test', priority: 'urgent' }],
			});
			expect(result.valid).toBe(false);
			expect(result.errors?.some((e) => e.includes('priority'))).toBe(true);
		});
	});

	describe('commands.mapFileToCommands', () => {
		it('maps create.ts to todo.create', () => {
			const commands = todoAdapter.commands.mapFileToCommands?.('src/commands/create.ts');
			expect(commands).toContain('todo.create');
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

		// Apply fixture
		const handler = vi.fn().mockResolvedValue({ success: true, data: { id: 'int-1' } });
		const context: AdapterContext = { cli: 'todo', handler };
		const result = await adapter?.fixture.apply(fixture, context);

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
