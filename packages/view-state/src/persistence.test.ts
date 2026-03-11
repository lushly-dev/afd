import type { DataAdapter } from '@lushly-dev/local-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebouncedPersistence } from './persistence.js';

function mockAdapter(): DataAdapter {
	return {
		get: vi.fn(),
		list: vi.fn(),
		create: vi.fn().mockResolvedValue({}),
		update: vi.fn().mockResolvedValue({}),
		remove: vi.fn(),
		batch: vi.fn(),
		health: vi.fn(),
	};
}

describe('DebouncedPersistence', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('batches writes until debounce fires', async () => {
		const adapter = mockAdapter();
		const dp = new DebouncedPersistence(adapter, 'settings', 'view-state', 100);

		dp.schedule('a', { open: true });
		dp.schedule('b', { tab: 'styles' });

		expect(adapter.update).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(100);

		expect(adapter.update).toHaveBeenCalledTimes(2);
	});

	it('flush writes immediately without waiting for debounce', async () => {
		const adapter = mockAdapter();
		const dp = new DebouncedPersistence(adapter, 'settings', 'view-state', 5000);

		dp.schedule('a', { open: true });
		await dp.flush();

		expect(adapter.update).toHaveBeenCalledTimes(1);
	});

	it('latest value wins when same ID scheduled multiple times', async () => {
		const adapter = mockAdapter();
		const dp = new DebouncedPersistence(adapter, 'settings', 'view-state', 100);

		dp.schedule('a', { open: true });
		dp.schedule('a', { open: false });

		await vi.advanceTimersByTimeAsync(100);

		expect(adapter.update).toHaveBeenCalledTimes(1);
		expect(adapter.update).toHaveBeenCalledWith(
			'settings',
			'a',
			expect.objectContaining({
				value: { open: false },
			})
		);
	});

	it('falls back to create when update fails', async () => {
		const adapter = mockAdapter();
		(adapter.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
		const dp = new DebouncedPersistence(adapter, 'settings', 'view-state', 100);

		dp.schedule('new-id', { x: 1 });
		await vi.advanceTimersByTimeAsync(100);

		expect(adapter.create).toHaveBeenCalledTimes(1);
		expect(adapter.create).toHaveBeenCalledWith(
			'settings',
			expect.objectContaining({
				id: 'new-id',
				value: { x: 1 },
			})
		);
	});

	it('logs warning but does not throw when both update and create fail', async () => {
		const adapter = mockAdapter();
		(adapter.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
		(adapter.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('also fail'));
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const dp = new DebouncedPersistence(adapter, 'settings', 'view-state', 100);

		dp.schedule('bad', { x: 1 });
		await vi.advanceTimersByTimeAsync(100);

		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('destroy flushes and stops accepting new writes', async () => {
		const adapter = mockAdapter();
		const dp = new DebouncedPersistence(adapter, 'settings', 'view-state', 5000);

		dp.schedule('a', { open: true });
		await dp.destroy();

		expect(adapter.update).toHaveBeenCalledTimes(1);

		// After destroy, schedule is a no-op
		dp.schedule('b', { open: false });
		await dp.flush();
		expect(adapter.update).toHaveBeenCalledTimes(1);
	});
});
