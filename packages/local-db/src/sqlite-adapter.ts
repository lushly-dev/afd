/**
 * A DataAdapter over SQLite, through Node.js's `node:sqlite`, for servers and tools.
 *
 * Import it from `@lushly-dev/local-db/sqlite`. It needs Node.js 22.13 or later, where `node:sqlite`
 * needs no flag. The root entry and the browser entries do not load it.
 */

import type { DatabaseSync, StatementSync } from 'node:sqlite';
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

/** Options for {@link SqliteAdapter}. */
export interface SqliteAdapterOptions {
	/** The database file. Adapters on the same file share their data, across processes too. */
	path: string;
	/**
	 * How long, in milliseconds, a write waits for another connection's write to finish before it
	 * fails with `STORAGE_ERROR`. Default: 5000.
	 */
	busyTimeoutMs?: number;
}

/** The schema version, kept in `PRAGMA user_version`. */
const SCHEMA_VERSION = 1;

/** The one table: every record of every table, its value the record's JSON, keyed by `(tbl, id)`. */
const SCHEMA = `CREATE TABLE records (
	tbl TEXT NOT NULL,
	id TEXT NOT NULL,
	value TEXT NOT NULL,
	PRIMARY KEY (tbl, id)
) WITHOUT ROWID`;

type SqliteModule = { DatabaseSync: new (path: string, options?: object) => DatabaseSync };

/** `node:sqlite`, or `STORAGE_UNAVAILABLE` where it is missing (Node.js before 22.13 without a flag). */
function sqliteModule(): SqliteModule {
	const loaded = process.getBuiltinModule?.('node:sqlite') as SqliteModule | undefined;
	if (!loaded) {
		throw new DataAdapterError(
			503,
			'node:sqlite is not available here. SqliteAdapter needs Node.js 22.13 or later; use MemoryAdapter or HttpAdapter elsewhere.',
			'STORAGE_UNAVAILABLE'
		);
	}
	return loaded;
}

function storageError(error: unknown, action: string): DataAdapterError {
	if (error instanceof DataAdapterError) return error;
	const reason = error instanceof Error ? error.message : String(error);
	return new DataAdapterError(500, `SQLite failed to ${action}: ${reason}`, 'STORAGE_ERROR');
}

/**
 * A {@link DataAdapter} over a SQLite file. It passes the same contract suite as the other
 * adapters (`runDataAdapterContract` in `@lushly-dev/local-db/testing`).
 *
 * The adapter owns its database: one table, `records(tbl, id, value)`, keyed by `(tbl, id)`, with
 * each record's value its JSON, so any table name works. It opens the file on the first call and
 * refuses one that another program created (`STORAGE_ERROR`). The database runs in WAL mode with
 * `synchronous = FULL`, so a committed write survives a power loss, and every write, a batch
 * included, is one `BEGIN IMMEDIATE … COMMIT` transaction, rolled back on any failure. `list()`
 * reads the table's records and filters, sorts and paginates them as the other adapters do; without
 * `sort` it returns them in ID order.
 *
 * Failures reject with a `DataAdapterError`: 400 and 404 as for every adapter, `STORAGE_UNAVAILABLE`
 * (503) without `node:sqlite`, and `STORAGE_ERROR` (500) when SQLite fails, for example when another
 * connection holds the write lock past `busyTimeoutMs`.
 *
 * @example
 * ```ts
 * import { SqliteAdapter } from '@lushly-dev/local-db/sqlite';
 *
 * const db = new SqliteAdapter({ path: '/var/lib/app/data.sqlite' });
 * await db.update('settings', 'theme', { value: 'dark' });
 * db.close();
 * ```
 */
export class SqliteAdapter implements DataAdapter {
	/** The database file. */
	readonly path: string;
	private readonly busyTimeoutMs: number;
	private database: DatabaseSync | undefined;
	private statements: Statements | undefined;

	constructor(options: SqliteAdapterOptions) {
		if (typeof options?.path !== 'string' || options.path === '') {
			throw new DataAdapterError(400, 'SqliteAdapter needs a database path', 'INVALID_NAME');
		}
		const busyTimeoutMs = options.busyTimeoutMs ?? 5000;
		if (typeof busyTimeoutMs !== 'number' || !Number.isFinite(busyTimeoutMs) || busyTimeoutMs < 0) {
			throw new DataAdapterError(
				400,
				'SqliteAdapter needs busyTimeoutMs to be a finite number of milliseconds, 0 or more',
				'INVALID_NAME'
			);
		}
		this.path = options.path;
		this.busyTimeoutMs = Math.floor(busyTimeoutMs);
	}

	async get<T>(table: string, id: string): Promise<T | null> {
		assertValidName('table', table);
		assertValidName('record id', id);
		return this.read(
			'read a record',
			(statements) => (readRow(statements, table, id) as T | undefined) ?? null
		);
	}

	async list<T>(table: string, params?: QueryParams): Promise<ListResult<T>> {
		assertValidName('table', table);
		const rows = this.read('read a table', (statements) => readTable(statements, table));
		const { rows: data, total } = queryRows(rows, params);
		return { data: data as T[], total };
	}

	async create<T>(table: string, data: Partial<T>): Promise<T> {
		assertValidName('table', table);
		const record = asRow(data);
		const row = { ...record, id: recordId(record) };
		this.transact('write a record', (statements) => writeRow(statements, table, row));
		return row as T;
	}

	async update<T>(table: string, id: string, patch: Partial<T>): Promise<T> {
		assertValidName('table', table);
		assertValidName('record id', id);
		const upsert = UPSERT_TABLES.has(table);
		return this.transact('update a record', (statements) =>
			updateRow(statements, table, id, patch, upsert)
		) as T;
	}

	async remove(table: string, id: string): Promise<void> {
		assertValidName('table', table);
		assertValidName('record id', id);
		this.transact('delete a record', (statements) => statements.remove.run(table, id));
	}

	/** Run the operations in order in one transaction, all or nothing (see `DataAdapter.batch()`). */
	async batch(operations: BatchOperation[]): Promise<BatchResult> {
		return this.transact('run a batch', (statements, rollback) => {
			const results: BatchOperationResult[] = [];
			for (const [index, operation] of operations.entries()) {
				const result = runOperation(statements, operation);
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

	/** `status: 'ok'`, the schema version, and the number of nonempty tables. */
	async health(): Promise<HealthStatus> {
		const { tables } = this.read(
			'count its tables',
			(statements) => statements.countTables.get() as { tables: number }
		);
		return { status: 'ok', version: SCHEMA_VERSION, tables, uptime: 0 };
	}

	/** Close the database. The next call opens it again. */
	close(): void {
		const database = this.database;
		this.database = undefined;
		this.statements = undefined;
		database?.close();
	}

	private open(): Statements {
		if (this.statements) return this.statements;
		const { DatabaseSync } = sqliteModule();
		let database: DatabaseSync;
		try {
			database = new DatabaseSync(this.path, { timeout: this.busyTimeoutMs });
		} catch (error) {
			throw storageError(error, 'open the database');
		}
		try {
			// Set by `PRAGMA` too: the constructor's `timeout` arrived in Node.js 22.16.
			database.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs}`);
			// Decide ownership before WAL: switching a file to WAL is persistent, and a refused file
			// must be left as it was found.
			prepareSchema(database, this.path);
			database.exec('PRAGMA journal_mode = WAL');
			database.exec('PRAGMA synchronous = FULL');
			this.statements = prepare(database);
		} catch (error) {
			database.close();
			throw storageError(error, 'open the database');
		}
		this.database = database;
		return this.statements;
	}

	/** Run a read outside a transaction, its failures as `STORAGE_ERROR` like every write's. */
	private read<T>(action: string, work: (statements: Statements) => T): T {
		const statements = this.open();
		try {
			return work(statements);
		} catch (error) {
			throw storageError(error, action);
		}
	}

	/**
	 * Run `work` in one `BEGIN IMMEDIATE … COMMIT` transaction and return its result. When `work`
	 * throws, or calls `rollback`, the transaction is rolled back and nothing it wrote is kept.
	 */
	private transact<T>(
		action: string,
		work: (statements: Statements, rollback: () => void) => T
	): T {
		const statements = this.open();
		const database = this.database as DatabaseSync;
		try {
			database.exec('BEGIN IMMEDIATE');
		} catch (error) {
			throw storageError(error, action);
		}
		let rolledBackOnPurpose = false;
		try {
			const result = work(statements, () => {
				rolledBackOnPurpose = true;
			});
			database.exec(rolledBackOnPurpose ? 'ROLLBACK' : 'COMMIT');
			return result;
		} catch (error) {
			// A connection left inside a transaction would refuse every later `BEGIN`: close it, so
			// the next call opens the file again. The error reported stays the one `work` raised.
			if (!rollbackQuietly(database)) this.close();
			throw storageError(error, action);
		}
	}
}

/** Convenience factory for creating a {@link SqliteAdapter}. */
export function createSqliteAdapter(options: SqliteAdapterOptions): SqliteAdapter {
	return new SqliteAdapter(options);
}

// ─── The schema and its statements ─────────────────────────────────────────────

/**
 * Roll back without raising an error of its own, since SQLite may already have rolled the
 * transaction back (`SQLITE_FULL`, an I/O error). Returns whether the connection is now outside a
 * transaction; `isTransaction` is read where this Node.js has it.
 */
function rollbackQuietly(database: DatabaseSync): boolean {
	const inTransaction = () => (database as { isTransaction?: boolean }).isTransaction;
	if (inTransaction() === false) return true;
	try {
		database.exec('ROLLBACK');
		return true;
	} catch {
		// Without `isTransaction`, a failed ROLLBACK means no transaction was open.
		return inTransaction() !== true;
	}
}

/**
 * Creates the table in a new database, and refuses one the adapter did not create. It decides
 * inside its own write transaction, so two connections opening a new file at once create the
 * table once.
 */
function prepareSchema(database: DatabaseSync, path: string): void {
	const versionOf = () =>
		(database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
	if (versionOf() === SCHEMA_VERSION) return;
	database.exec('BEGIN IMMEDIATE');
	try {
		const version = versionOf();
		if (version === SCHEMA_VERSION) {
			database.exec('COMMIT');
			return;
		}
		const { count } = database
			.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table'")
			.get() as { count: number };
		if (version !== 0 || count !== 0) {
			throw new DataAdapterError(
				500,
				`SQLite database ${JSON.stringify(path)} was not created by SqliteAdapter (schema version ${version}, ${count} tables). Use another file.`,
				'STORAGE_ERROR'
			);
		}
		database.exec(SCHEMA);
		database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
		database.exec('COMMIT');
	} catch (error) {
		rollbackQuietly(database);
		throw error;
	}
}

interface Statements {
	get: StatementSync;
	table: StatementSync;
	put: StatementSync;
	remove: StatementSync;
	countTables: StatementSync;
}

function prepare(database: DatabaseSync): Statements {
	return {
		get: database.prepare('SELECT value FROM records WHERE tbl = ? AND id = ?'),
		table: database.prepare('SELECT value FROM records WHERE tbl = ? ORDER BY id'),
		put: database.prepare('INSERT OR REPLACE INTO records (tbl, id, value) VALUES (?, ?, ?)'),
		remove: database.prepare('DELETE FROM records WHERE tbl = ? AND id = ?'),
		countTables: database.prepare('SELECT count(DISTINCT tbl) AS tables FROM records'),
	};
}

// ─── Operations inside one transaction ─────────────────────────────────────────

function readRow(statements: Statements, table: string, id: string): Row | undefined {
	const found = statements.get.get(table, id) as { value: string } | undefined;
	return found ? (JSON.parse(found.value) as Row) : undefined;
}

function readTable(statements: Statements, table: string): Row[] {
	return (statements.table.all(table) as Array<{ value: string }>).map(
		({ value }) => JSON.parse(value) as Row
	);
}

function writeRow(statements: Statements, table: string, row: Row & { id: string }): void {
	statements.put.run(table, row.id, JSON.stringify(row));
}

function updateRow(
	statements: Statements,
	table: string,
	id: string,
	patch: unknown,
	upsert: boolean
): Row {
	const existing = readRow(statements, table, id);
	if (!existing && !upsert) {
		throw new DataAdapterError(
			404,
			`Record ${JSON.stringify(id)} not found in table ${JSON.stringify(table)}`
		);
	}
	const row = { ...existing, ...asRow(patch), id };
	writeRow(statements, table, row);
	return row;
}

function runOperation(statements: Statements, operation: BatchOperation): BatchOperationResult {
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
					const rows = readTable(statements, table);
					return { status: 200, data: { data: rows, total: rows.length } };
				}
				assertValidName('record id', id);
				const row = readRow(statements, table, id);
				return row ? { status: 200, data: row } : { status: 404, data: null };
			}
			case 'POST': {
				const record = asRow(operation.body);
				const row = { ...record, id: recordId(record) };
				writeRow(statements, table, row);
				return { status: 201, data: row };
			}
			case 'PUT':
			case 'PATCH': {
				const targetId = requireId(operation.method, id);
				assertValidName('record id', targetId);
				const upsert = operation.method === 'PUT';
				return {
					status: 200,
					data: updateRow(statements, table, targetId, operation.body, upsert),
				};
			}
			case 'DELETE': {
				const targetId = requireId('DELETE', id);
				assertValidName('record id', targetId);
				statements.remove.run(table, targetId);
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
