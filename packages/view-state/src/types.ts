import type { DataAdapter } from '@lushly-dev/local-db';

export interface ViewStateHandler<T extends Record<string, unknown> = Record<string, unknown>> {
	get: () => T;
	set: (partial: Partial<T>) => void;
}

export interface ViewStateEntry {
	id: string;
	state: Record<string, unknown>;
}

export interface ViewStateRegistryOptions {
	/** Optional persistence adapter (from @lushly-dev/local-db). */
	adapter?: DataAdapter;
	/** Table name for persistence. Default: 'settings' */
	table?: string;
	/** Category filter for persistence. Default: 'view-state' */
	category?: string;
	/** Debounce interval for batched writes in ms. Default: 300 */
	debounceMs?: number;
}

export interface PersistedViewState {
	id: string;
	category: string;
	value: Record<string, unknown>;
	updatedAt: string;
}
