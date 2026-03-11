import type { DataAdapter } from '@lushly-dev/local-db';

/**
 * Batches rapid state changes into debounced adapter writes.
 * Internal module — not exported from the package.
 */
export class DebouncedPersistence {
	private pending = new Map<string, Record<string, unknown>>();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private destroyed = false;

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
		this.timer = setTimeout(() => this.flush(), this.debounceMs);
	}

	async flush(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.pending.size === 0) return;

		const entries = [...this.pending.entries()];
		this.pending.clear();

		for (const [id, value] of entries) {
			try {
				await this.adapter.update(this.table, id, {
					category: this.category,
					value,
					updatedAt: new Date().toISOString(),
				});
			} catch {
				try {
					await this.adapter.create(this.table, {
						id,
						category: this.category,
						value,
						updatedAt: new Date().toISOString(),
					});
				} catch (createErr) {
					console.warn(`[afd-view-state] Failed to persist "${id}":`, createErr);
				}
			}
		}
	}

	async destroy(): Promise<void> {
		this.destroyed = true;
		await this.flush();
	}
}
