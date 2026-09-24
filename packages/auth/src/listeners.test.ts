import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListenerSet, reportListenerError } from './listeners.js';

/**
 * Capture microtasks queued by the default error path instead of letting them
 * throw into the test runner, and return a function that runs them.
 */
function captureMicrotasks(): Array<() => void> {
	const queued: Array<() => void> = [];
	vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
		queued.push(callback);
	});
	return queued;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('ListenerSet', () => {
	it('keeps calling later listeners after one throws', () => {
		const errors: unknown[] = [];
		const listeners = new ListenerSet<string>((error) => errors.push(error));
		const received: string[] = [];
		const failure = new Error('listener failed');

		listeners.add(() => {
			throw failure;
		});
		listeners.add((value) => received.push(value));

		expect(() => listeners.emit('signed-out')).not.toThrow();
		expect(received).toEqual(['signed-out']);
		expect(errors).toEqual([failure]);
	});

	it('rethrows listener errors in a microtask when no handler is configured', () => {
		const queued = captureMicrotasks();
		const listeners = new ListenerSet<string>();
		const failure = new Error('listener failed');
		const received: string[] = [];
		listeners.add(() => {
			throw failure;
		});
		listeners.add((value) => received.push(value));

		listeners.emit('value');

		expect(received).toEqual(['value']);
		expect(queued).toHaveLength(1);
		expect(() => queued[0]?.()).toThrow(failure);
	});

	it('does not call a listener that an earlier listener unsubscribed', () => {
		const listeners = new ListenerSet<number>();
		const calls: string[] = [];
		const second = () => calls.push('second');
		let subscription: { unsubscribe: () => void } | undefined;

		listeners.add(() => {
			calls.push('first');
			subscription?.unsubscribe();
		});
		subscription = listeners.add(second);

		listeners.emit(1);
		expect(calls).toEqual(['first']);
		expect(listeners.size).toBe(1);
	});

	it('defers listeners added during an emit to the next emit', () => {
		const listeners = new ListenerSet<number>();
		const late: number[] = [];
		listeners.add(() => {
			if (listeners.size === 1) listeners.add((value) => late.push(value));
		});

		listeners.emit(1);
		expect(late).toEqual([]);
		listeners.emit(2);
		expect(late).toEqual([2]);
	});

	it('supports unsubscribe and clear', () => {
		const listeners = new ListenerSet<number>();
		const received: number[] = [];
		const { unsubscribe } = listeners.add((value) => received.push(value));
		listeners.add(() => {});
		expect(listeners.size).toBe(2);

		unsubscribe();
		listeners.emit(1);
		expect(received).toEqual([]);

		listeners.clear();
		expect(listeners.size).toBe(0);
	});
});

describe('reportListenerError', () => {
	it('passes the error to the handler', () => {
		const queued = captureMicrotasks();
		const handler = vi.fn();
		const failure = new Error('boom');

		reportListenerError(failure, handler);

		expect(handler).toHaveBeenCalledWith(failure);
		expect(queued).toHaveLength(0);
	});

	it('rethrows asynchronously when the handler itself throws', () => {
		const queued = captureMicrotasks();
		const handlerFailure = new Error('handler failed');

		expect(() =>
			reportListenerError(new Error('boom'), () => {
				throw handlerFailure;
			})
		).not.toThrow();

		expect(queued).toHaveLength(1);
		expect(() => queued[0]?.()).toThrow(handlerFailure);
	});
});
