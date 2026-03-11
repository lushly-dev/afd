import type { DataAdapter } from '@lushly-dev/local-db';
import { DebouncedPersistence } from './persistence.js';
import type {
	PersistedViewState,
	ViewStateEntry,
	ViewStateHandler,
	ViewStateRegistryOptions,
} from './types.js';

/**
 * Central registry for UI view state handlers.
 *
 * Components register get/set handlers by ID. The registry coordinates
 * reads, writes, persistence, and hydration — making every layout
 * decision accessible through the AFD command system.
 */
export class ViewStateRegistry {
	private handlers = new Map<string, ViewStateHandler>();
	private persistence: DebouncedPersistence | null = null;
	private readonly adapter: DataAdapter | undefined;
	private readonly table: string;
	private readonly category: string;

	constructor(options: ViewStateRegistryOptions = {}) {
		this.table = options.table ?? 'settings';
		this.category = options.category ?? 'view-state';
		this.adapter = options.adapter;

		if (options.adapter) {
			this.persistence = new DebouncedPersistence(
				options.adapter,
				this.table,
				this.category,
				options.debounceMs ?? 300
			);
		}
	}

	/** Register a view state handler. Throws if ID already registered. */
	register(id: string, handler: ViewStateHandler): void {
		if (this.handlers.has(id)) {
			throw new Error(`View state "${id}" is already registered`);
		}
		this.handlers.set(id, handler);
	}

	/** Remove a handler. No-op if unknown. */
	unregister(id: string): void {
		this.handlers.delete(id);
	}

	/** Check if a handler is registered. */
	has(id: string): boolean {
		return this.handlers.has(id);
	}

	/** Get current state for an ID. Returns null if not registered. */
	get(id: string): Record<string, unknown> | null {
		const handler = this.handlers.get(id);
		if (!handler) return null;
		return handler.get();
	}

	/** Apply partial state. Returns previous state for undo. Throws if not registered. */
	set(id: string, partial: Partial<Record<string, unknown>>): Record<string, unknown> {
		const handler = this.handlers.get(id);
		if (!handler) {
			throw new Error(`View state "${id}" is not registered`);
		}
		const previous = handler.get();
		handler.set(partial);
		if (this.persistence) {
			this.persistence.schedule(id, handler.get());
		}
		return previous;
	}

	/** List all registered view states. */
	list(): ViewStateEntry[] {
		return [...this.handlers.entries()].map(([id, handler]) => ({
			id,
			state: handler.get(),
		}));
	}

	/** Load persisted states from adapter and hydrate registered handlers. */
	async hydrate(): Promise<void> {
		if (!this.adapter) return;

		try {
			const result = await this.adapter.list<PersistedViewState>(this.table, {
				category: this.category,
			});
			for (const record of result.data) {
				const handler = this.handlers.get(record.id);
				if (handler && record.value) {
					handler.set(record.value);
				}
			}
		} catch (err) {
			console.warn('[afd-view-state] Hydration failed:', err);
		}
	}

	/** Immediately write all pending persistence. */
	async flush(): Promise<void> {
		if (this.persistence) {
			await this.persistence.flush();
		}
	}

	/** Flush pending writes and clear all handlers. */
	async destroy(): Promise<void> {
		if (this.persistence) {
			await this.persistence.destroy();
		}
		this.handlers.clear();
	}
}
