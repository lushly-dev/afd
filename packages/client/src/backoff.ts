/**
 * @fileoverview Reconnection backoff shared by `McpClient` and `createReconnectingHandoff()`.
 */

/** Random jitter added to every delay, so clients that lost the same server spread out. */
const MAX_JITTER_MS = 100;

/**
 * Exponential backoff with jitter and a cap: `base * 2^(attempt - 1)` plus up to 100 ms of
 * jitter, never more than `maxMs`.
 *
 * @param attempt - Attempt number, starting at 1
 * @param baseMs - Delay before the first attempt
 * @param maxMs - Upper bound for any delay
 */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
	const exponential = baseMs * 2 ** Math.max(0, attempt - 1);
	return Math.max(0, Math.min(exponential + Math.random() * MAX_JITTER_MS, maxMs));
}

/** A delay that can be cut short: `cancel()` resolves the pending `wait()` at once. */
export class CancellableDelay {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private resolvePending: (() => void) | null = null;

	wait(ms: number): Promise<void> {
		this.cancel();
		return new Promise((resolve) => {
			this.resolvePending = resolve;
			this.timer = setTimeout(() => {
				this.timer = null;
				this.resolvePending = null;
				resolve();
			}, ms);
		});
	}

	cancel(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		const resolve = this.resolvePending;
		this.resolvePending = null;
		resolve?.();
	}
}
