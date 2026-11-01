/// <reference lib="dom" preserve="true" />
/**
 * A DataAdapter over IndexedDB, for browsers, web workers and webviews.
 *
 * Import it from `@lushly-dev/local-db/indexeddb`. The root entry does not load it.
 */

import {
	asRow,
	assertValidName,
	DataAdapterError,
	parseBatchPath,
	queryRows,
	type Row,
	recordId,
	requireId,
	rolledBack,
	UPSERT_TABLES,
} from './adapter-support.js';
import type {
	BatchOperation,
	BatchOperationResult,
	BatchResult,
	DataAdapter,
	HealthStatus,
	ListResult,
	QueryParams,
} from './types.js';

/** Options for {@link IndexedDbAdapter}. */
export interface IndexedDbAdapterOptions {
	/** The database name. Adapters with the same name (in one origin) share their data. */
	name: string;
	/** The factory to open the database with. Default: `globalThis.indexedDB`. */
	indexedDB?: IDBFactory;
}

/** What the `records` object store holds: one value per record, keyed by `[table, id]`. */
interface StoredRecord {
	table: string;
	id: string;
	row: Row;
}

/** The database schema version. The upgrade from 0 creates the store and its index. */
const DB_VERSION = 1;
const STORE = 'records';
const TABLE_INDEX = 'table';

function storageError(error: unknown, action: string): DataAdapterError {
	if (error instanceof DataAdapterError) return error;
	const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	return new DataAdapterError(500, `IndexedDB failed to ${action}: ${reason}`, 'STORAGE_ERROR');
}

/** The result of one request, or a `STORAGE_ERROR` when it fails. */
function settle<T>(request: IDBRequest<T>, action: string): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(storageError(request.error, action));
	});
}

/**
 * A {@link DataAdapter} over IndexedDB. It passes the same contract suite as `MemoryAdapter`
 * and `HttpAdapter` (`runDataAdapterContract` in `@lushly-dev/local-db/testing`).
 *
 * The adapter owns its database, `name`: one object store, `records`, keyed by `[table, id]`,
 * with an index on `table`, so any table name works. The database opens on the first call; a
 * database of that name that another program created is refused with `STORAGE_ERROR`.
 *
 * Each call is one IndexedDB transaction, so `batch()` is atomic: a failed operation aborts the
 * transaction and no write is applied. `list()` without `sort` returns records in ID order.
 * Records are stored as JSON copies (`Date`s become ISO strings).
 *
 * When another connection asks to upgrade or delete the database, the adapter closes its
 * connection and reopens it on the next call.
 *
 * Failures reject with a `DataAdapterError`: 400 and 404 as for every adapter,
 * `STORAGE_UNAVAILABLE` (503) when there is no IndexedDB, and `STORAGE_ERROR` (500) when
 * IndexedDB fails (for example, when the quota is exceeded).
 *
 * @example
 * ```ts
 * import { IndexedDbAdapter } from '@lushly-dev/local-db/indexeddb';
 *
 * const db = new IndexedDbAdapter({ name: 'my-app-store' });
 * await db.update('settings', 'theme', { value: 'dark' });
 * ```
 */
export class IndexedDbAdapter implements DataAdapter {
	/** The database name. */
	readonly name: string;
	private readonly factory: IDBFactory | undefined;
	private connection: Promise<IDBDatabase> | undefined;

	constructor(options: IndexedDbAdapterOptions) {
		if (typeof options?.name !== 'string' || options.name === '') {
			throw new DataAdapterError(
				400,
				'IndexedDbAdapter needs a nonempty database name',
				'INVALID_NAME'
			);
		}
		this.name = options.name;
		this.factory = options.indexedDB;
	}

	async get<T>(table: string, id: string): Promise<T | null> {
		assertValidName('table', table);
		assertValidName('record id', id);
		const stored = await this.transact('readonly', (store) =>
			settle<StoredRecord | undefined>(store.get([table, id]), 'read a record')
		);
		return stored ? (stored.row as T) : null;
	}

	async list<T>(table: string, params?: QueryParams): Promise<ListResult<T>> {
		assertValidName('table', table);
		const rows = await this.transact('readonly', (store) => readTable(store, table));
		const { rows: data, total } = queryRows(rows, params);
		return { data: data as T[], total };
	}

	async create<T>(table: string, data: Partial<T>): Promise<T> {
		assertValidName('table', table);
		const record = asRow(data);
		const row = { ...record, id: recordId(record) };
		await this.transact('readwrite', (store) => put(store, table, row));
		return row as T;
	}

	async update<T>(table: string, id: string, patch: Partial<T>): Promise<T> {
		assertValidName('table', table);
		assertValidName('record id', id);
		const upsert = UPSERT_TABLES.has(table);
		return (await this.transact('readwrite', (store) =>
			updateRow(store, table, id, patch, upsert)
		)) as T;
	}

	async remove(table: string, id: string): Promise<void> {
		assertValidName('table', table);
		assertValidName('record id', id);
		await this.transact('readwrite', (store) =>
			settle(store.delete([table, id]), 'delete a record')
		);
	}

	/** Run the operations in order in one transaction, all or nothing (see `DataAdapter.batch()`). */
	async batch(operations: BatchOperation[]): Promise<BatchResult> {
		return this.transact('readwrite', async (store, rollback) => {
			const results: BatchOperationResult[] = [];
			for (const [index, operation] of operations.entries()) {
				const result = await runOperation(store, operation);
				const readMiss = operation?.method === 'GET' && result.status === 404;
				if (result.status >= 400 && !readMiss) {
					rollback();
					return {
						results: operations.map((_, other) => (other === index ? result : rolledBack(index))),
						summary: { total: operations.length, success: 0, failed: operations.length },
					};
				}
				results.push(result);
			}
			return {
				results,
				summary: { total: operations.length, success: operations.length, failed: 0 },
			};
		});
	}

	/** `status: 'ok'`, the database schema version, and the number of nonempty tables. */
	async health(): Promise<HealthStatus> {
		const tables = await this.transact('readonly', countTables);
		return { status: 'ok', version: DB_VERSION, tables, uptime: 0 };
	}

	/** Close the connection. The next call opens it again. */
	async close(): Promise<void> {
		const connection = this.connection;
		this.connection = undefined;
		if (connection) (await connection.catch(() => undefined))?.close();
	}

	/**
	 * Close the connection and delete the database with every record in it. Other adapters on
	 * the same database close their connections when asked, so the deletion is not blocked.
	 */
	async destroy(): Promise<void> {
		await this.close();
		await settle(this.indexedDB().deleteDatabase(this.name), 'delete the database');
	}

	private indexedDB(): IDBFactory {
		const factory = this.factory ?? globalThis.indexedDB;
		if (!factory) {
			throw new DataAdapterError(
				503,
				'IndexedDB is not available here. Pass `indexedDB` (for example from fake-indexeddb in Node.js), or use MemoryAdapter.',
				'STORAGE_UNAVAILABLE'
			);
		}
		return factory;
	}

	private open(): Promise<IDBDatabase> {
		if (this.connection) return this.connection;
		const opening = new Promise<IDBDatabase>((resolve, reject) => {
			const request = this.indexedDB().open(this.name, DB_VERSION);
			request.onupgradeneeded = () => {
				const store = request.result.createObjectStore(STORE, { keyPath: ['table', 'id'] });
				store.createIndex(TABLE_INDEX, 'table');
			};
			request.onsuccess = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE)) {
					db.close();
					reject(
						new DataAdapterError(
							500,
							`IndexedDB database ${JSON.stringify(this.name)} was not created by IndexedDbAdapter (it has no "${STORE}" store). Use another name.`,
							'STORAGE_ERROR'
						)
					);
					return;
				}
				const forget = () => {
					if (this.connection === opening) this.connection = undefined;
				};
				db.onversionchange = () => {
					db.close();
					forget();
				};
				db.onclose = forget;
				resolve(db);
			};
			request.onerror = () => reject(storageError(request.error, 'open the database'));
		});
		this.connection = opening;
		// A failed open is retried by the next call.
		opening.catch(() => {
			if (this.connection === opening) this.connection = undefined;
		});
		return opening;
	}

	/**
	 * Run `work` in one transaction and return its result once the transaction commits. `work`
	 * may await only requests on `store`, or the transaction commits early. When `work` throws,
	 * or calls `rollback`, the transaction is aborted and nothing it wrote is kept.
	 */
	private async transact<T>(
		mode: IDBTransactionMode,
		work: (store: IDBObjectStore, rollback: () => void) => Promise<T>
	): Promise<T> {
		const db = await this.open();
		let transaction: IDBTransaction;
		try {
			transaction = db.transaction(STORE, mode);
		} catch (error) {
			throw storageError(error, 'start a transaction');
		}
		let rolledBackOnPurpose = false;
		const finished = new Promise<void>((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onabort = () =>
				rolledBackOnPurpose
					? resolve()
					: reject(storageError(transaction.error ?? 'aborted', 'commit'));
		});
		const abort = () => {
			rolledBackOnPurpose = true;
			try {
				transaction.abort();
			} catch {
				// Already finished or aborted by a failed request.
			}
		};
		let result: T;
		try {
			result = await work(transaction.objectStore(STORE), abort);
		} catch (error) {
			abort();
			await finished;
			throw error;
		}
		await finished;
		return result;
	}
}

/** Convenience factory for creating an {@link IndexedDbAdapter}. */
export function createIndexedDbAdapter(options: IndexedDbAdapterOptions): IndexedDbAdapter {
	return new IndexedDbAdapter(options);
}

// ─── Operations inside one transaction ─────────────────────────────────────────

async function readTable(store: IDBObjectStore, table: string): Promise<Row[]> {
	const stored = await settle<StoredRecord[]>(
		store.index(TABLE_INDEX).getAll(table),
		'list a table'
	);
	return stored.map((entry) => entry.row);
}

async function put(store: IDBObjectStore, table: string, row: Row & { id: string }): Promise<void> {
	const value: StoredRecord = { table, id: row.id, row };
	await settle(store.put(value), 'write a record');
}

async function updateRow(
	store: IDBObjectStore,
	table: string,
	id: string,
	patch: unknown,
	upsert: boolean
): Promise<Row> {
	const existing = await settle<StoredRecord | undefined>(store.get([table, id]), 'read a record');
	if (!existing && !upsert) {
		throw new DataAdapterError(
			404,
			`Record ${JSON.stringify(id)} not found in table ${JSON.stringify(table)}`
		);
	}
	const row = { ...existing?.row, ...asRow(patch), id };
	await put(store, table, row);
	return row;
}

function countTables(store: IDBObjectStore): Promise<number> {
	return new Promise((resolve, reject) => {
		let count = 0;
		const request = store.index(TABLE_INDEX).openKeyCursor(null, 'nextunique');
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) return resolve(count);
			count++;
			cursor.continue();
		};
		request.onerror = () => reject(storageError(request.error, 'count tables'));
	});
}

async function runOperation(
	store: IDBObjectStore,
	operation: BatchOperation
): Promise<BatchOperationResult> {
	try {
		if (typeof operation !== 'object' || operation === null) {
			throw new DataAdapterError(
				400,
				'Batch operation must be an object',
				'INVALID_BATCH_OPERATION'
			);
		}
		const { table, id } = parseBatchPath(operation.path);
		assertValidName('table', table);
		switch (operation.method) {
			case 'GET': {
				if (id === undefined) {
					const rows = await readTable(store, table);
					return { status: 200, data: { data: rows, total: rows.length } };
				}
				assertValidName('record id', id);
				const stored = await settle<StoredRecord | undefined>(
					store.get([table, id]),
					'read a record'
				);
				return stored ? { status: 200, data: stored.row } : { status: 404, data: null };
			}
			case 'POST': {
				const record = asRow(operation.body);
				const row = { ...record, id: recordId(record) };
				await put(store, table, row);
				return { status: 201, data: row };
			}
			case 'PUT':
			case 'PATCH': {
				const targetId = requireId(operation.method, id);
				assertValidName('record id', targetId);
				const upsert = operation.method === 'PUT';
				return {
					status: 200,
					data: await updateRow(store, table, targetId, operation.body, upsert),
				};
			}
			case 'DELETE': {
				const targetId = requireId('DELETE', id);
				assertValidName('record id', targetId);
				await settle(store.delete([table, targetId]), 'delete a record');
				return { status: 204 };
			}
			default:
				return { status: 400, error: `Unknown method: ${String(operation.method)}` };
		}
	} catch (err) {
		if (err instanceof DataAdapterError) return { status: err.status, error: err.message };
		return { status: 500, error: err instanceof Error ? err.message : String(err) };
	}
}
