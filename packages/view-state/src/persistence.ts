import type { DataAdapter } from '@lushly-dev/local-db';

/**
 * Whether an adapter error means the record does not exist yet: an HTTP 404
 * (`HttpAdapter` throws `Error('HTTP 404: ...')`), a `status`/`statusCode` of
 * 404, or a `code` ending in `NOT_FOUND`.
 */
function isNotFoundError(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	const { status, statusCode, code, message } = error as Record<string, unknown>;
	if (status === 404 || statusCode === 404) return true;
	if (typeof code === 'string' && /NOT_FOUND$/i.test(code)) return true;
	return typeof message === 'string' && /^HTTP 404\b/.test(message);
}

/**
 * Batches rapid state changes into debounced adapter writes.
 * Internal module — not exported from the package.
 *
 * Flushes are single-flight: each flush is chained after the previous one, so
 * writes for an ID never overlap and the last state scheduled is the last one
 * written, whatever order the network completes requests in. A flush requested
 * while another is running re-runs afterwards for the state that changed
 * meanwhile. `destroy()` waits for every queued flush.
 */
export class DebouncedPersistence {
	private pending = new Map<string, Record<string, unknown>>();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private destroyed = false;
	/** The end of the flush chain. Never rejects. */
	private tail: Promise<void> = Promise.resolve();
	/** A flush that is queued but has not taken its snapshot of `pending` yet. */
	private queued: Promise<void> | null = null;

	constructor(
		private readonly adapter: DataAdapter,
		private readonly table: string,
		private readonly category: string,
		private readonly debounceMs: number
	) {}

	schedule(id: string, state: Record<string, unknown>): void {
		if (this.destroyed) return;
		this.pending.set(id, state);
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.flush();
		}, this.debounceMs);
	}

	/**
	 * Write everything scheduled so far. Resolves once those writes, and any
	 * flush already running, have finished. Never rejects: failed writes are
	 * logged.
	 */
	flush(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		// A queued flush has not read `pending` yet, so it will include this state.
		if (this.queued) return this.queued;

		const run = this.tail.then(() => {
			this.queued = null;
			return this.drain();
		});
		this.queued = run;
		this.tail = run;
		return run;
	}

	async destroy(): Promise<void> {
		this.destroyed = true;
		await this.flush();
	}

	private async drain(): Promise<void> {
		const entries = [...this.pending.entries()];
		this.pending.clear();
		for (const [id, value] of entries) {
			await this.write(id, value);
		}
	}

	private async write(id: string, value: Record<string, unknown>): Promise<void> {
		const record = { category: this.category, value, updatedAt: new Date().toISOString() };
		try {
			await this.adapter.update(this.table, id, record);
			return;
		} catch (updateError) {
			if (!(await this.isMissing(id, updateError))) {
				console.warn(`[afd-view-state] Failed to persist "${id}":`, updateError);
				return;
			}
		}
		try {
			await this.adapter.create(this.table, { id, ...record });
		} catch (createError) {
			console.warn(`[afd-view-state] Failed to persist "${id}":`, createError);
		}
	}

	/**
	 * Whether a failed update failed because the record does not exist. When
	 * the error does not say so, ask the adapter: `get` returns null for a
	 * missing record.
	 */
	private async isMissing(id: string, updateError: unknown): Promise<boolean> {
		if (isNotFoundError(updateError)) return true;
		try {
			const existing = await this.adapter.get(this.table, id);
			return existing === null || existing === undefined;
		} catch {
			return false;
		}
	}
}
