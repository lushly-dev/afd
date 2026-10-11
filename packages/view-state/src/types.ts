export interface ViewStateHandler<T extends Record<string, unknown> = Record<string, unknown>> {
	get: () => T;
	set: (partial: Partial<T>) => void;
	/**
	 * Replace the complete state. When provided, view-state commands can
	 * restore snapshots exactly, including removing keys added by a mutation.
	 */
	replace?: (state: T) => void;
}

export interface ViewStateEntry {
	id: string;
	state: Record<string, unknown>;
}

export interface ViewStateRegistryOptions {
	/** Optional persistence adapter. Structurally compatible with @lushly-dev/local-db DataAdapter. */
	adapter?: {
		get<T>(table: string, id: string): Promise<T | null>;
		list<T>(
			table: string,
			params?: {
				limit?: number;
				offset?: number;
				sort?: string;
				order?: 'asc' | 'desc';
				[key: string]: string | number | boolean | undefined;
			}
		): Promise<{ data: T[]; total: number }>;
		create<T>(table: string, data: Partial<T>): Promise<T>;
		update<T>(table: string, id: string, patch: Partial<T>): Promise<T>;
		remove(table: string, id: string): Promise<void>;
		batch(
			operations: {
				method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
				path: string;
				body?: unknown;
			}[]
		): Promise<{
			results: { status: number; data?: unknown; error?: string }[];
			summary: { total: number; success: number; failed: number };
		}>;
		health(): Promise<{ status: string; version: number; tables: number; uptime: number }>;
	};
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
