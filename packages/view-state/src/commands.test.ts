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
	};
	return obj;
}

describe('createViewStateCommands', () => {
	let registry: ViewStateRegistry;
	let commands: ReturnType<typeof createViewStateCommands>;
	let get: (typeof commands)[0];
	let set: (typeof commands)[1];
	let list: (typeof commands)[2];

	beforeEach(() => {
		registry = new ViewStateRegistry();
		commands = createViewStateCommands(registry);
		[get, set, list] = commands;
	});

	describe('view-state-get', () => {
		it('returns state for a registered ID', async () => {
			registry.register('panel', createHandler({ open: true, tab: 'design' }));
			const result = await get.handler({ id: 'panel' }, {} as never);
			expect(result.success).toBe(true);
			expect(result.data).toEqual({ id: 'panel', state: { open: true, tab: 'design' } });
		});

		it('returns failure for unknown ID', async () => {
			const result = await get.handler({ id: 'unknown' }, {} as never);
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
			const result = await set.handler({ id: 'panel', state: { open: true } }, {} as never);
			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				id: 'panel',
				state: { open: true, tab: 'design' },
				previous: { open: false, tab: 'design' },
			});
		});

		it('includes undoCommand and undoArgs', async () => {
			registry.register('panel', createHandler({ open: false }));
			const result = await set.handler({ id: 'panel', state: { open: true } }, {} as never);
			expect(result.undoCommand).toBe('view-state-set');
			expect(result.undoArgs).toEqual({ id: 'panel', state: { open: false } });
		});

		it('returns failure for unknown ID', async () => {
			const result = await set.handler({ id: 'unknown', state: { open: true } }, {} as never);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('VIEW_STATE_NOT_FOUND');
		});

		it('undo round-trip restores previous state', async () => {
			registry.register('panel', createHandler({ open: false, tab: 'design' }));

			// Set
			const setResult = await set.handler({ id: 'panel', state: { open: true } }, {} as never);
			expect(registry.get('panel')).toEqual({ open: true, tab: 'design' });

			// Undo
			const undoArgs = setResult.undoArgs as { id: string; state: Record<string, unknown> };
			await set.handler(undoArgs, {} as never);
			expect(registry.get('panel')).toEqual({ open: false, tab: 'design' });
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
			const result = await list.handler({}, {} as never);
			expect(result.success).toBe(true);
			expect(result.data?.total).toBe(2);
			expect(result.data?.states).toHaveLength(2);
		});

		it('returns empty when none registered', async () => {
			const result = await list.handler({}, {} as never);
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
