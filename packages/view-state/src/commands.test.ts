import type { ZodCommandDefinition } from '@lushly-dev/afd-server';
import { beforeEach, describe, expect, it } from 'vitest';
import { createViewStateCommands } from './commands.js';
import { ViewStateRegistry } from './registry.js';
import type { ViewStateHandler } from './types.js';

function createHandler(
	initial: Record<string, unknown>
): ViewStateHandler & { state: Record<string, unknown> } {
	const obj = {
		state: { ...initial },
		get: () => ({ ...obj.state }),
		set: (partial: Partial<Record<string, unknown>>) => {
			Object.assign(obj.state, partial);
		},
		replace: (state: Record<string, unknown>) => {
			obj.state = { ...state };
		},
	};
	return obj;
}

function commandNamed(commands: ZodCommandDefinition[], name: string): ZodCommandDefinition {
	const command = commands.find((candidate) => candidate.name === name);
	if (!command) throw new Error(`Command ${name} not found`);
	return command;
}

describe('createViewStateCommands', () => {
	let registry: ViewStateRegistry;
	let get: ZodCommandDefinition;
	let set: ZodCommandDefinition;
	let list: ZodCommandDefinition;

	beforeEach(() => {
		registry = new ViewStateRegistry();
		const commands = createViewStateCommands(registry);
		expect(commands.map((command) => command.name)).toEqual([
			'view-state-get',
			'view-state-set',
			'view-state-list',
		]);
		get = commandNamed(commands, 'view-state-get');
		set = commandNamed(commands, 'view-state-set');
		list = commandNamed(commands, 'view-state-list');
	});

	describe('view-state-get', () => {
		it('returns state for a registered ID', async () => {
			registry.register('panel', createHandler({ open: true, tab: 'design' }));
			const result = await get.handler({ id: 'panel' }, {});
			expect(result.success).toBe(true);
			expect(result.data).toEqual({ id: 'panel', state: { open: true, tab: 'design' } });
		});

		it('returns failure for unknown ID', async () => {
			const result = await get.handler({ id: 'unknown' }, {});
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('VIEW_STATE_NOT_FOUND');
			expect(result.error?.suggestion).toContain('view-state-list');
		});

		it('has correct command metadata', () => {
			expect(get.name).toBe('view-state-get');
			expect(get.mutation).toBe(false);
			expect(get.category).toBe('view-state');
		});
	});

	describe('view-state-set', () => {
		it('returns current and previous state', async () => {
			registry.register('panel', createHandler({ open: false, tab: 'design' }));
			const result = await set.handler({ id: 'panel', state: { open: true } }, {});
			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				id: 'panel',
				state: { open: true, tab: 'design' },
				previous: { open: false, tab: 'design' },
			});
		});

		it('includes undoCommand and undoArgs', async () => {
			registry.register('panel', createHandler({ open: false }));
			const result = await set.handler({ id: 'panel', state: { open: true } }, {});
			expect(result.undoCommand).toBe('view-state-set');
			expect(result.undoArgs).toEqual({ id: 'panel', state: { open: false }, replace: true });
		});

		it('returns failure for unknown ID', async () => {
			const result = await set.handler({ id: 'unknown', state: { open: true } }, {});
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('VIEW_STATE_NOT_FOUND');
		});

		it('undo round-trip restores previous state', async () => {
			registry.register('panel', createHandler({ open: false, tab: 'design' }));

			// Set
			const setResult = await set.handler({ id: 'panel', state: { open: true } }, {});
			expect(registry.get('panel')).toEqual({ open: true, tab: 'design' });

			// Undo
			const undoArgs = setResult.undoArgs as {
				id: string;
				state: Record<string, unknown>;
				replace: boolean;
			};
			expect(undoArgs.replace).toBe(true);
			await set.handler(undoArgs, {});
			expect(registry.get('panel')).toEqual({ open: false, tab: 'design' });
		});

		it('restores added and nested keys through replacement undo', async () => {
			registry.register(
				'panel',
				createHandler({ open: false, options: { theme: 'light', density: 'compact' } })
			);

			const setResult = await set.handler(
				{
					id: 'panel',
					state: { temporary: true, options: { theme: 'dark' } },
				},
				{}
			);
			expect(registry.get('panel')).toEqual({
				open: false,
				temporary: true,
				options: { theme: 'dark' },
			});

			await set.handler(setResult.undoArgs, {});
			expect(registry.get('panel')).toEqual({
				open: false,
				options: { theme: 'light', density: 'compact' },
			});
		});

		it('does not advertise undo for a legacy partial-only handler', async () => {
			const handler: ViewStateHandler = {
				get: () => ({ open: false }),
				set: () => {},
			};
			registry.register('legacy-panel', handler);

			const result = await set.handler({ id: 'legacy-panel', state: { temporary: true } }, {});
			expect(result.undoCommand).toBeUndefined();
			expect(result.undoArgs).toBeUndefined();
			expect(result.warnings?.[0]?.code).toBe('VIEW_STATE_UNDO_UNAVAILABLE');
		});

		it('rejects explicit replacement for a legacy partial-only handler', async () => {
			registry.register('legacy-panel', {
				get: () => ({ open: false }),
				set: () => {},
			});

			const result = await set.handler(
				{ id: 'legacy-panel', state: { open: true }, replace: true },
				{}
			);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('VIEW_STATE_REPLACE_UNSUPPORTED');
		});

		it('has correct command metadata', () => {
			expect(set.name).toBe('view-state-set');
			expect(set.mutation).toBe(true);
			expect(set.category).toBe('view-state');
		});
	});

	describe('view-state-list', () => {
		it('returns all states with total', async () => {
			registry.register('a', createHandler({ x: 1 }));
			registry.register('b', createHandler({ y: 2 }));
			const result = await list.handler({}, {});
			expect(result.success).toBe(true);
			expect(result.data).toMatchObject({ total: 2 });
			expect(result.data).toHaveProperty('states.length', 2);
		});

		it('returns empty when none registered', async () => {
			const result = await list.handler({}, {});
			expect(result.success).toBe(true);
			expect(result.data).toEqual({ states: [], total: 0 });
		});

		it('has correct command metadata', () => {
			expect(list.name).toBe('view-state-list');
			expect(list.mutation).toBe(false);
			expect(list.category).toBe('view-state');
		});
	});
});
