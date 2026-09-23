import type { DataAdapter } from '@lushly-dev/local-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebouncedPersistence } from './persistence.js';

function mockAdapter(): DataAdapter {
	return {
		get: vi.fn().mockResolvedValue(null),
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

	it('creates the record when update reports it does not exist', async () => {
		const adapter = mockAdapter();
		(adapter.update as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error('HTTP 404: Not Found')
		);
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

interface Deferred {
	promise: Promise<unknown>;
	resolve: (value?: unknown) => void;
}

function deferred(): Deferred {
	let resolve: (value?: unknown) => void = () => {};
	const promise = new Promise<unknown>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

/**
 * An adapter whose updates stay in flight until the test settles them, in
 * any order, recording the order in which updates start and finish.
 */
function slowAdapter() {
	const adapter = mockAdapter();
	const inFlight: Array<{ value: unknown; settle: Deferred }> = [];
	const started: unknown[] = [];
	const finished: unknown[] = [];
	let concurrent = 0;
	let maxConcurrent = 0;
	(adapter.update as ReturnType<typeof vi.fn>).mockImplementation(
		async (_table: string, _id: string, record: { value: unknown }) => {
			const settle = deferred();
			inFlight.push({ value: record.value, settle });
			started.push(record.value);
			concurrent++;
			maxConcurrent = Math.max(maxConcurrent, concurrent);
			await settle.promise;
			concurrent--;
			finished.push(record.value);
			return {};
		}
	);
	return {
		adapter,
		inFlight,
		started,
		finished,
		maxConcurrent: () => maxConcurrent,
	};
}

describe('DebouncedPersistence single-flight flushes', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('never overlaps flushes, so the last scheduled state is the last one written', async () => {
		const slow = slowAdapter();
		const dp = new DebouncedPersistence(slow.adapter, 'settings', 'view-state', 100);

		dp.schedule('panel', { width: 1 });
		await vi.advanceTimersByTimeAsync(100); // flush 1 starts writing width 1
		dp.schedule('panel', { width: 2 });
		await vi.advanceTimersByTimeAsync(100); // flush 2 waits for flush 1

		expect(slow.started).toEqual([{ width: 1 }]);

		slow.inFlight[0]?.settle.resolve();
		await vi.advanceTimersByTimeAsync(0);
		expect(slow.started).toEqual([{ width: 1 }, { width: 2 }]);

		slow.inFlight[1]?.settle.resolve();
		await dp.flush();

		expect(slow.finished).toEqual([{ width: 1 }, { width: 2 }]);
		expect(slow.maxConcurrent()).toBe(1);
	});

	it('re-runs after an in-flight flush for state that changed meanwhile', async () => {
		const slow = slowAdapter();
		const dp = new DebouncedPersistence(slow.adapter, 'settings', 'view-state', 5000);

		dp.schedule('panel', { open: true });
		const first = dp.flush();
		await vi.advanceTimersByTimeAsync(0);
		dp.schedule('panel', { open: false });
		const second = dp.flush();

		slow.inFlight[0]?.settle.resolve();
		await first;
		await vi.advanceTimersByTimeAsync(0);
		expect(slow.started).toEqual([{ open: true }, { open: false }]);

		slow.inFlight[1]?.settle.resolve();
		await second;
		expect(slow.finished).toEqual([{ open: true }, { open: false }]);
	});

	it('coalesces flush calls made before the queued flush starts', async () => {
		const slow = slowAdapter();
		const dp = new DebouncedPersistence(slow.adapter, 'settings', 'view-state', 5000);

		dp.schedule('a', { v: 1 });
		const running = dp.flush();
		await vi.advanceTimersByTimeAsync(0);
		dp.schedule('a', { v: 2 });
		const queuedA = dp.flush();
		dp.schedule('b', { v: 3 });
		const queuedB = dp.flush();

		expect(queuedB).toBe(queuedA);
		expect(queuedA).not.toBe(running);

		slow.inFlight[0]?.settle.resolve();
		await vi.advanceTimersByTimeAsync(0);
		for (const entry of slow.inFlight.slice(1)) entry.settle.resolve();
		await vi.advanceTimersByTimeAsync(0);
		slow.inFlight[2]?.settle.resolve();
		await queuedA;

		expect(slow.started).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }]);
	});

	it('destroy waits for an in-flight flush', async () => {
		const slow = slowAdapter();
		const dp = new DebouncedPersistence(slow.adapter, 'settings', 'view-state', 100);

		dp.schedule('panel', { open: true });
		await vi.advanceTimersByTimeAsync(100); // the timer flush is now in flight

		let destroyed = false;
		const destroying = dp.destroy().then(() => {
			destroyed = true;
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(destroyed).toBe(false);

		slow.inFlight[0]?.settle.resolve();
		await destroying;
		expect(destroyed).toBe(true);
		expect(slow.finished).toEqual([{ open: true }]);
	});
});

describe('DebouncedPersistence create fallback', () => {
	const errors: Array<[string, unknown]> = [
		['an HTTP 404 message', new Error('HTTP 404: Not Found')],
		['a 404 status', Object.assign(new Error('missing'), { status: 404 })],
		['a 404 statusCode', Object.assign(new Error('missing'), { statusCode: 404 })],
		['a NOT_FOUND code', Object.assign(new Error('missing'), { code: 'RECORD_NOT_FOUND' })],
	];

	it.each(errors)('creates the record for %s without asking the adapter', async (_label, err) => {
		const adapter = mockAdapter();
		(adapter.update as ReturnType<typeof vi.fn>).mockRejectedValue(err);
		const dp = new DebouncedPersistence(adapter, 'settings', 'view-state', 100);

		dp.schedule('panel', { open: true });
		await dp.flush();

		expect(adapter.create).toHaveBeenCalledTimes(1);
		expect(adapter.get).not.toHaveBeenCalled();
	});

	it('does not create when the update failed for another reason and the record exists', async () => {
		const adapter = mockAdapter();
		const failure = new Error('HTTP 500: database locked');
		(adapter.update as ReturnType<typeof vi.fn>).mockRejectedValue(failure);
		(adapter.get as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'panel' });
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const dp = new DebouncedPersistence(adapter, 'settings', 'view-state', 100);

		dp.schedule('panel', { open: true });
		await dp.flush();

		expect(adapter.get).toHaveBeenCalledWith('settings', 'panel');
		expect(adapter.create).not.toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalledWith('[afd-view-state] Failed to persist "panel":', failure);
		warnSpy.mockRestore();
	});

	it('does not create when the adapter cannot confirm the record is missing', async () => {
		const adapter = mockAdapter();
		(adapter.update as ReturnType<typeof vi.fn>).mockRejectedValue('offline');
		(adapter.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const dp = new DebouncedPersistence(adapter, 'settings', 'view-state', 100);

		dp.schedule('panel', { open: true });
		await dp.flush();

		expect(adapter.create).not.toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('creates when an unrecognised update error hides a missing record', async () => {
		const adapter = mockAdapter();
		(adapter.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no such row'));
		const dp = new DebouncedPersistence(adapter, 'settings', 'view-state', 100);

		dp.schedule('panel', { open: true });
		await dp.flush();

		expect(adapter.get).toHaveBeenCalledWith('settings', 'panel');
		expect(adapter.create).toHaveBeenCalledWith(
			'settings',
			expect.objectContaining({ id: 'panel', category: 'view-state', value: { open: true } })
		);
	});
});
