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
 *
 * Both built-in adapters pass the same contract suite: records are JSON copies (never live
 * references to stored data), table names are arbitrary strings except `''`, `.` and `..`
 * (rejected with a 400 `DataAdapterError`), and failures reject with a `DataAdapterError`
 * whose `status` follows HTTP.
 */
export interface DataAdapter {
	/** Get a single record by ID. Returns null if not found. */
	get<T>(table: string, id: string): Promise<T | null>;

	/** List records with optional filtering and pagination. */
	list<T>(table: string, params?: QueryParams): Promise<ListResult<T>>;

	/** Create a new record. Returns the created record. */
	create<T>(table: string, data: Partial<T>): Promise<T>;

	/**
	 * Merge a patch into an existing record by ID. Returns the updated record. A missing record
	 * rejects with a 404 `DataAdapterError`, except in the upsert tables (`settings`, `flags`,
	 * `feature_flags`, `feature_data`, `keyboard_shortcuts`), where it is created.
	 */
	update<T>(table: string, id: string, patch: Partial<T>): Promise<T>;

	/** Delete a record by ID. Deleting a missing record succeeds. */
	remove(table: string, id: string): Promise<void>;

	/**
	 * Execute multiple operations atomically, in order. Paths are `/<table>` or
	 * `/<table>/<id>` with percent-encoded segments; `PUT` upserts and `PATCH` needs an existing
	 * record.
	 *
	 * If every operation succeeds, all writes are applied. If any fails (status 400 or above,
	 * except a `GET` of a missing record, which reports 404 with `data: null`), execution stops
	 * and no write is applied: the failed operation keeps its status and error, every other
	 * operation reports `424` (Failed Dependency), and the summary counts all operations as
	 * failed.
	 */
	batch(operations: BatchOperation[]): Promise<BatchResult>;

	/** Check backend health. */
	health(): Promise<HealthStatus>;
}
