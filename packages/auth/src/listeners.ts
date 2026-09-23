/**
 * @fileoverview Listener fan-out with per-listener error isolation
 *
 * Shared by every adapter and by SessionSync so that one throwing subscriber
 * cannot stop later subscribers from seeing a state change (for example a
 * sign-out), and cannot make the operation that triggered the change reject.
 */

/**
 * Receives an error thrown by a subscriber. When no handler is configured the
 * error is rethrown in a microtask, so it still reaches the host's uncaught
 * error reporting (`window.onerror`, `process.on('uncaughtException')`).
 */
export type ListenerErrorHandler = (error: unknown) => void;

/**
 * Report a subscriber error without interrupting the caller.
 *
 * The error goes to `onListenerError` when one is given. If there is none, or
 * the handler itself throws, the error is rethrown asynchronously.
 */
export function reportListenerError(error: unknown, onListenerError?: ListenerErrorHandler): void {
	let unhandled = error;
	if (onListenerError) {
		try {
			onListenerError(error);
			return;
		} catch (handlerError) {
			unhandled = handlerError;
		}
	}
	queueMicrotask(() => {
		throw unhandled;
	});
}

/**
 * A set of subscribers that are each called in isolation.
 */
export class ListenerSet<T> {
	private readonly listeners = new Set<(value: T) => void>();
	private readonly onListenerError: ListenerErrorHandler | undefined;

	constructor(onListenerError?: ListenerErrorHandler) {
		this.onListenerError = onListenerError;
	}

	get size(): number {
		return this.listeners.size;
	}

	add(listener: (value: T) => void): { unsubscribe: () => void } {
		this.listeners.add(listener);
		return {
			unsubscribe: () => {
				this.listeners.delete(listener);
			},
		};
	}

	/**
	 * Call every subscriber with `value`. A subscriber that throws is reported
	 * and skipped; the remaining subscribers still run and `emit` never throws.
	 */
	emit(value: T): void {
		// Iterate a snapshot so a subscriber added during this emit waits for the
		// next one, and re-check membership so a subscriber removed by an earlier
		// one is not called.
		for (const listener of Array.from(this.listeners)) {
			if (!this.listeners.has(listener)) continue;
			try {
				listener(value);
			} catch (error) {
				reportListenerError(error, this.onListenerError);
			}
		}
	}

	clear(): void {
		this.listeners.clear();
	}
}
