import type { DataAdapter } from '@lushly-dev/local-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function mockAdapter(): DataAdapter {
	return {
		get: vi.fn(),
		list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
		create: vi.fn().mockResolvedValue({}),
		update: vi.fn().mockResolvedValue({}),
		remove: vi.fn(),
		batch: vi.fn(),
		health: vi.fn(),
	};
}

describe('ViewStateRegistry', () => {
	describe('registration', () => {
		it('register stores a handler', () => {
			const reg = new ViewStateRegistry();
			const handler = createHandler({ open: true });
			reg.register('panel', handler);
			expect(reg.has('panel')).toBe(true);
		});

		it('throws on duplicate registration', () => {
			const reg = new ViewStateRegistry();
			reg.register('panel', createHandler({}));
			expect(() => reg.register('panel', createHandler({}))).toThrow('already registered');
		});

		it('unregister removes a handler', () => {
			const reg = new ViewStateRegistry();
			reg.register('panel', createHandler({}));
			reg.unregister('panel');
			expect(reg.has('panel')).toBe(false);
		});

		it('unregister is a no-op for unknown ID', () => {
			const reg = new ViewStateRegistry();
			expect(() => reg.unregister('unknown')).not.toThrow();
		});
	});

	describe('get/set', () => {
		it('get returns current state', () => {
			const reg = new ViewStateRegistry();
			reg.register('panel', createHandler({ open: true, tab: 'design' }));
			expect(reg.get('panel')).toEqual({ open: true, tab: 'design' });
		});

		it('get returns null for unknown ID', () => {
			const reg = new ViewStateRegistry();
			expect(reg.get('unknown')).toBeNull();
		});

		it('set calls handler.set and returns previous state', () => {
			const reg = new ViewStateRegistry();
			const handler = createHandler({ open: false, tab: 'design' });
			reg.register('panel', handler);

			const previous = reg.set('panel', { open: true });
			expect(previous).toEqual({ open: false, tab: 'design' });
			expect(handler.state).toEqual({ open: true, tab: 'design' });
		});

		it('set throws for unknown ID', () => {
			const reg = new ViewStateRegistry();
			expect(() => reg.set('unknown', { x: 1 })).toThrow('not registered');
		});
	});

	describe('list', () => {
		it('returns all registered entries', () => {
			const reg = new ViewStateRegistry();
			reg.register('a', createHandler({ x: 1 }));
			reg.register('b', createHandler({ y: 2 }));
			const list = reg.list();
			expect(list).toHaveLength(2);
			expect(list).toEqual(
				expect.arrayContaining([
					{ id: 'a', state: { x: 1 } },
					{ id: 'b', state: { y: 2 } },
				])
			);
		});

		it('returns empty array when none registered', () => {
			const reg = new ViewStateRegistry();
			expect(reg.list()).toEqual([]);
		});
	});

	describe('persistence', () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it('hydrate loads from adapter and calls handler.set', async () => {
			const adapter = mockAdapter();
			(adapter.list as ReturnType<typeof vi.fn>).mockResolvedValue({
				data: [{ id: 'panel', category: 'view-state', value: { open: true } }],
				total: 1,
			});

			const reg = new ViewStateRegistry({ adapter });
			const handler = createHandler({ open: false });
			reg.register('panel', handler);

			await reg.hydrate();
			expect(handler.state).toEqual({ open: true });
		});

		it('set triggers debounced persistence', async () => {
			const adapter = mockAdapter();
			const reg = new ViewStateRegistry({ adapter, debounceMs: 50 });
			reg.register('panel', createHandler({ open: false }));

			reg.set('panel', { open: true });
			expect(adapter.update).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(50);
			expect(adapter.update).toHaveBeenCalledTimes(1);
		});

		it('flush writes immediately', async () => {
			const adapter = mockAdapter();
			const reg = new ViewStateRegistry({ adapter, debounceMs: 5000 });
			reg.register('panel', createHandler({ open: false }));

			reg.set('panel', { open: true });
			await reg.flush();
			expect(adapter.update).toHaveBeenCalledTimes(1);
		});

		it('hydrate logs warning when adapter throws', async () => {
			const adapter = mockAdapter();
			(adapter.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			const reg = new ViewStateRegistry({ adapter });
			reg.register('panel', createHandler({ open: false }));

			await reg.hydrate();
			expect(warnSpy).toHaveBeenCalledWith('[afd-view-state] Hydration failed:', expect.any(Error));
			// Handler state unchanged
			expect(reg.get('panel')).toEqual({ open: false });
			warnSpy.mockRestore();
		});

		it('hydrate skips unregistered IDs from adapter', async () => {
			const adapter = mockAdapter();
			(adapter.list as ReturnType<typeof vi.fn>).mockResolvedValue({
				data: [{ id: 'unknown-panel', category: 'view-state', value: { open: true } }],
				total: 1,
			});

			const reg = new ViewStateRegistry({ adapter });
			await reg.hydrate();
			// No crash, unknown ID simply skipped
			expect(reg.has('unknown-panel')).toBe(false);
		});
	});

	describe('no adapter', () => {
		it('works entirely in-memory', () => {
			const reg = new ViewStateRegistry();
			reg.register('panel', createHandler({ open: false }));
			reg.set('panel', { open: true });
			expect(reg.get('panel')).toEqual({ open: true });
		});

		it('hydrate is a no-op', async () => {
			const reg = new ViewStateRegistry();
			await expect(reg.hydrate()).resolves.toBeUndefined();
		});

		it('flush is a no-op', async () => {
			const reg = new ViewStateRegistry();
			await expect(reg.flush()).resolves.toBeUndefined();
		});
	});

	it('destroy flushes and clears all handlers (no adapter)', async () => {
		const reg = new ViewStateRegistry();
		reg.register('a', createHandler({}));
		reg.register('b', createHandler({}));
		await reg.destroy();
		expect(reg.list()).toEqual([]);
	});

	it('destroy flushes persistence and clears handlers (with adapter)', async () => {
		vi.useFakeTimers();
		const adapter = mockAdapter();
		const reg = new ViewStateRegistry({ adapter, debounceMs: 5000 });
		reg.register('panel', createHandler({ open: false }));

		reg.set('panel', { open: true });
		// Pending write exists but debounce hasn't fired
		expect(adapter.update).not.toHaveBeenCalled();

		await reg.destroy();
		// Destroy should flush pending writes
		expect(adapter.update).toHaveBeenCalledTimes(1);
		expect(reg.list()).toEqual([]);
		vi.useRealTimers();
	});
});
