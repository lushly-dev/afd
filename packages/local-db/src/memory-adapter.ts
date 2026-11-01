import {
	asRow,
	assertValidName,
	DataAdapterError,
	jsonCopy,
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

/** How to undo one write of a failed batch. */
interface UndoEntry {
	table: string;
	id: string;
	/** The row the key held before the write, if any. */
	previous: Row | undefined;
	/** The write created the table. */
	createdTable: boolean;
}

/**
 * In-memory DataAdapter backed by nested Maps.
 *
 * Useful for unit tests, SSR, and environments without a server. It follows the same contract
 * as `HttpAdapter`: records are stored and returned as JSON copies, `update()` of a missing
 * record rejects with a 404 `DataAdapterError` (except in the upsert tables), and `batch()` is
 * atomic. Supports filtering, sorting and pagination.
 */
export class MemoryAdapter implements DataAdapter {
	private tables = new Map<string, Map<string, Row>>();

	constructor(initialData?: Record<string, Record<string, unknown>[]>) {
		if (initialData) {
			for (const [table, rows] of Object.entries(initialData)) {
				assertValidName('table', table);
				const map = new Map<string, Row>();
				for (const row of rows) {
					const copy = asRow(row);
					const id = recordId(copy);
					map.set(id, { ...copy, id });
				}
				this.tables.set(table, map);
			}
		}
	}

	async get<T>(table: string, id: string): Promise<T | null> {
		const row = this.readRow(table, id);
		return row ? (jsonCopy(row) as T) : null;
	}

	async list<T>(table: string, params?: QueryParams): Promise<ListResult<T>> {
		assertValidName('table', table);
		const { rows, total } = queryRows([...(this.tables.get(table)?.values() ?? [])], params);
		return { data: jsonCopy(rows) as T[], total };
	}

	async create<T>(table: string, data: Partial<T>): Promise<T> {
		return jsonCopy(this.createRow(table, data)) as T;
	}

	async update<T>(table: string, id: string, patch: Partial<T>): Promise<T> {
		return jsonCopy(this.updateRow(table, id, patch, UPSERT_TABLES.has(table))) as T;
	}

	async remove(table: string, id: string): Promise<void> {
		this.removeRow(table, id);
	}

	/**
	 * Run the operations in order, all or nothing (see `DataAdapter.batch()`). Operations run
	 * synchronously, so no other call can interleave with a batch.
	 */
	async batch(operations: BatchOperation[]): Promise<BatchResult> {
		const undo: UndoEntry[] = [];
		const results: BatchOperationResult[] = [];

		for (const [index, operation] of operations.entries()) {
			const result = this.runOperation(operation, undo);
			const readMiss = operation?.method === 'GET' && result.status === 404;
			if (result.status >= 400 && !readMiss) {
				this.rollback(undo);
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
	}

	async health(): Promise<HealthStatus> {
		return { status: 'ok', version: 0, tables: this.tables.size, uptime: 0 };
	}

	/** Clear all data (useful in test teardown). */
	clear(): void {
		this.tables.clear();
	}

	/** Get the number of records in a table. */
	count(table: string): number {
		return this.tables.get(table)?.size ?? 0;
	}

	// ─── Synchronous storage operations (no live references leave these) ───────

	private readRow(table: string, id: string): Row | undefined {
		assertValidName('table', table);
		assertValidName('record id', id);
		return this.tables.get(table)?.get(id);
	}

	/** Store `row` under `id`, or delete it when `row` is undefined, recording how to undo it. */
	private write(table: string, id: string, row: Row | undefined, undo?: UndoEntry[]): void {
		let map = this.tables.get(table);
		undo?.push({ table, id, previous: map?.get(id), createdTable: !map && row !== undefined });
		if (row === undefined) {
			map?.delete(id);
			return;
		}
		if (!map) {
			map = new Map();
			this.tables.set(table, map);
		}
		map.set(id, row);
	}

	private createRow(table: string, data: unknown, undo?: UndoEntry[]): Row {
		assertValidName('table', table);
		const record = asRow(data);
		const id = recordId(record);
		const row = { ...record, id };
		this.write(table, id, row, undo);
		return row;
	}

	private updateRow(
		table: string,
		id: string,
		patch: unknown,
		upsert: boolean,
		undo?: UndoEntry[]
	): Row {
		const existing = this.readRow(table, id);
		if (!existing && !upsert) {
			throw new DataAdapterError(
				404,
				`Record ${JSON.stringify(id)} not found in table ${JSON.stringify(table)}`
			);
		}
		const row = { ...existing, ...asRow(patch), id };
		this.write(table, id, row, undo);
		return row;
	}

	private removeRow(table: string, id: string, undo?: UndoEntry[]): void {
		if (this.readRow(table, id)) this.write(table, id, undefined, undo);
	}

	private runOperation(operation: BatchOperation, undo: UndoEntry[]): BatchOperationResult {
		try {
			if (typeof operation !== 'object' || operation === null) {
				throw new DataAdapterError(
					400,
					'Batch operation must be an object',
					'INVALID_BATCH_OPERATION'
				);
			}
			const { table, id } = parseBatchPath(operation.path);
			switch (operation.method) {
				case 'GET': {
					if (id === undefined) {
						assertValidName('table', table);
						const rows = [...(this.tables.get(table)?.values() ?? [])];
						return { status: 200, data: jsonCopy({ data: rows, total: rows.length }) };
					}
					const row = this.readRow(table, id);
					return row ? { status: 200, data: jsonCopy(row) } : { status: 404, data: null };
				}
				case 'POST':
					return { status: 201, data: jsonCopy(this.createRow(table, operation.body, undo)) };
				case 'PUT':
				case 'PATCH': {
					const targetId = requireId(operation.method, id);
					const upsert = operation.method === 'PUT';
					const row = this.updateRow(table, targetId, operation.body, upsert, undo);
					return { status: 200, data: jsonCopy(row) };
				}
				case 'DELETE':
					this.removeRow(table, requireId('DELETE', id), undo);
					return { status: 204 };
				default:
					return { status: 400, error: `Unknown method: ${String(operation.method)}` };
			}
		} catch (err) {
			if (err instanceof DataAdapterError) return { status: err.status, error: err.message };
			return { status: 500, error: err instanceof Error ? err.message : String(err) };
		}
	}

	private rollback(undo: UndoEntry[]): void {
		for (let index = undo.length - 1; index >= 0; index--) {
			const entry = undo[index];
			if (!entry) continue;
			if (entry.createdTable) {
				this.tables.delete(entry.table);
				continue;
			}
			const map = this.tables.get(entry.table);
			if (entry.previous === undefined) map?.delete(entry.id);
			else map?.set(entry.id, entry.previous);
		}
	}
}

/** Convenience factory for creating a MemoryAdapter. */
export function createMemoryAdapter(
	initialData?: Record<string, Record<string, unknown>[]>
): MemoryAdapter {
	return new MemoryAdapter(initialData);
}
