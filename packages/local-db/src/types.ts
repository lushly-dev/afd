/**
 * @lushly-dev/local-db — Async data adapter with swappable backends.
 *
 * Core types and the DataAdapter interface that all backends implement.
 * Consumers depend on this interface — never on a specific storage engine.
 */

/** Query parameters for list operations. */
export interface QueryParams {
	limit?: number;
	offset?: number;
	sort?: string;
	order?: 'asc' | 'desc';
	[key: string]: string | number | boolean | undefined;
}

/** Result shape for list operations. */
export interface ListResult<T> {
	data: T[];
	total: number;
}

/** A single operation in a batch request. */
export interface BatchOperation {
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	path: string;
	body?: unknown;
}

/** Result of a single batch operation. */
export interface BatchOperationResult {
	status: number;
	data?: unknown;
	error?: string;
}

/** Aggregate result of a batch execution. */
export interface BatchResult {
	results: BatchOperationResult[];
	summary: { total: number; success: number; failed: number };
}

/** Server health status. */
export interface HealthStatus {
	status: string;
	version: number;
	tables: number;
	uptime: number;
}

/**
 * Async data adapter — the stable contract between application and storage.
 *
 * Implementations:
 * - `MemoryAdapter` — in-memory Maps, for unit tests
 * - `HttpAdapter` — fetch-based, for REST API backends (SQLite, Postgres, etc.)
 * - Custom adapters can wrap IndexedDB, Firestore, Cosmos DB, etc.
 */
export interface DataAdapter {
	/** Get a single record by ID. Returns null if not found. */
	get<T>(table: string, id: string): Promise<T | null>;

	/** List records with optional filtering and pagination. */
	list<T>(table: string, params?: QueryParams): Promise<ListResult<T>>;

	/** Create a new record. Returns the created record. */
	create<T>(table: string, data: Partial<T>): Promise<T>;

	/** Update an existing record by ID. Returns the updated record. */
	update<T>(table: string, id: string, patch: Partial<T>): Promise<T>;

	/** Delete a record by ID. */
	remove(table: string, id: string): Promise<void>;

	/** Execute multiple operations atomically. */
	batch(operations: BatchOperation[]): Promise<BatchResult>;

	/** Check backend health. */
	health(): Promise<HealthStatus>;
}
