import { DebouncedPersistence } from './persistence.js';
import type {
	PersistedViewState,
	ViewStateEntry,
	ViewStateHandler,
	ViewStateRegistryOptions,
} from './types.js';

/**
 * Take a snapshot that is independent from a handler's mutable state.
 * structuredClone preserves nested values and cyclic objects where supported;
 * the fallback keeps the registry usable for legacy states containing values
 * that structuredClone cannot copy (for example, functions).
 */
function cloneState<T>(state: T): T {
	try {
		return structuredClone(state);
	} catch {
		return cloneRecord(state, new WeakMap<object, unknown>());
	}
}

function cloneRecord<T>(value: T, seen: WeakMap<object, unknown>): T {
	if (value === null || typeof value !== 'object') return value;

	const objectValue = value as object;
	const existing = seen.get(objectValue);
	if (existing !== undefined) return existing as T;

	if (value instanceof Date) {
		return new Date(value.getTime()) as T;
	}
	if (Array.isArray(value)) {
		const copy: unknown[] = [];
		seen.set(objectValue, copy);
		for (const item of value) copy.push(cloneRecord(item, seen));
		return copy as T;
	}

	const copy: Record<string, unknown> = {};
	seen.set(objectValue, copy);
	for (const [key, item] of Object.entries(value)) {
		copy[key] = cloneRecord(item, seen);
	}
	return copy as T;
}

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
	private readonly adapter: ViewStateRegistryOptions['adapter'];
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
		return cloneState(handler.get());
	}

	/** Check whether a handler can replace its complete state. */
	supportsReplace(id: string): boolean {
		return typeof this.handlers.get(id)?.replace === 'function';
	}

	/** Apply partial state. Returns a detached previous state snapshot. */
	set(id: string, partial: Partial<Record<string, unknown>>): Record<string, unknown> {
		const handler = this.handlers.get(id);
		if (!handler) {
			throw new Error(`View state "${id}" is not registered`);
		}
		const previous = cloneState(handler.get());
		handler.set(cloneState(partial));
		if (this.persistence) {
			this.persistence.schedule(id, cloneState(handler.get()));
		}
		return previous;
	}

	/**
	 * Replace complete state. Throws when the registered handler only supports
	 * the legacy partial merge operation.
	 */
	replace(id: string, state: Record<string, unknown>): Record<string, unknown> {
		const handler = this.handlers.get(id);
		if (!handler) {
			throw new Error(`View state "${id}" is not registered`);
		}
		if (!handler.replace) {
			throw new Error(`View state "${id}" does not support complete replacement`);
		}

		const previous = cloneState(handler.get());
		handler.replace(cloneState(state));
		if (this.persistence) {
			this.persistence.schedule(id, cloneState(handler.get()));
		}
		return previous;
	}

	/** List all registered view states. */
	list(): ViewStateEntry[] {
		return [...this.handlers.entries()].map(([id, handler]) => ({
			id,
			state: cloneState(handler.get()),
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
					handler.set(cloneState(record.value));
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
