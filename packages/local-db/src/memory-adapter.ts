import type {
	BatchOperation,
	BatchResult,
	DataAdapter,
	HealthStatus,
	ListResult,
	QueryParams,
} from './types.js';

/**
 * In-memory DataAdapter backed by nested Maps.
 *
 * Useful for unit tests, SSR, and environments without a server.
 * Supports filtering, sorting, pagination, and batch operations.
 */
export class MemoryAdapter implements DataAdapter {
	private tables = new Map<string, Map<string, Record<string, unknown>>>();

	constructor(initialData?: Record<string, Record<string, unknown>[]>) {
		if (initialData) {
			for (const [table, rows] of Object.entries(initialData)) {
				const map = new Map<string, Record<string, unknown>>();
				for (const row of rows) {
					const id = String(row['id'] ?? row['name'] ?? row['key'] ?? crypto.randomUUID());
					map.set(id, { ...row, id });
				}
				this.tables.set(table, map);
			}
		}
	}

	private getTable(table: string): Map<string, Record<string, unknown>> {
		if (!this.tables.has(table)) {
			this.tables.set(table, new Map());
		}
		return this.tables.get(table)!;
	}

	async get<T>(table: string, id: string): Promise<T | null> {
		const row = this.getTable(table).get(id);
		return (row as T | undefined) ?? null;
	}

	async list<T>(table: string, params?: QueryParams): Promise<ListResult<T>> {
		const map = this.getTable(table);
		let rows = [...map.values()];

		// Filter by params (exact match on string/number/boolean values)
		if (params) {
			for (const [key, value] of Object.entries(params)) {
				if (['limit', 'offset', 'sort', 'order'].includes(key)) continue;
				if (value === undefined) continue;
				rows = rows.filter((row) => String(row[key]) === String(value));
			}
		}

		const total = rows.length;

		// Sort
		if (params?.sort) {
			const sortKey = params.sort;
			const order = params.order === 'desc' ? -1 : 1;
			rows.sort((a, b) => {
				const aVal = String(a[sortKey] ?? '');
				const bVal = String(b[sortKey] ?? '');
				return aVal.localeCompare(bVal) * order;
			});
		}

		// Paginate
		const offset = params?.offset ?? 0;
		const limit = params?.limit ?? rows.length;
		rows = rows.slice(offset, offset + limit);

		return { data: rows as T[], total };
	}

	async create<T>(table: string, data: Partial<T>): Promise<T> {
		const map = this.getTable(table);
		const record = data as Record<string, unknown>;
		const id = String(record['id'] ?? record['name'] ?? record['key'] ?? crypto.randomUUID());
		const row = { ...record, id };
		map.set(id, row);
		return row as T;
	}

	async update<T>(table: string, id: string, patch: Partial<T>): Promise<T> {
		const map = this.getTable(table);
		const existing = map.get(id) ?? { id };
		const updated = { ...existing, ...patch };
		map.set(id, updated);
		return updated as T;
	}

	async remove(table: string, id: string): Promise<void> {
		this.getTable(table).delete(id);
	}

	async batch(operations: BatchOperation[]): Promise<BatchResult> {
		const results = [];
		let success = 0;
		let failed = 0;

		for (const op of operations) {
			try {
				// Parse path: /table/id or /table
				const parts = op.path.replace(/^\//, '').split('/');
				const table = parts[0]!;
				const id = parts.slice(1).join('/');

				switch (op.method) {
					case 'GET':
						if (id) {
							const row = await this.get(table, id);
							results.push({ status: row ? 200 : 404, data: row });
						} else {
							const list = await this.list(table);
							results.push({ status: 200, data: list });
						}
						break;
					case 'POST':
						results.push({ status: 201, data: await this.create(table, (op.body ?? {}) as Record<string, unknown>) });
						break;
					case 'PUT':
					case 'PATCH':
						results.push({ status: 200, data: await this.update(table, id, (op.body ?? {}) as Record<string, unknown>) });
						break;
					case 'DELETE':
						await this.remove(table, id);
						results.push({ status: 204 });
						break;
					default:
						results.push({ status: 400, error: `Unknown method: ${op.method}` });
						failed++;
						continue;
				}
				success++;
			} catch (err) {
				failed++;
				results.push({ status: 500, error: err instanceof Error ? err.message : String(err) });
			}
		}

		return { results, summary: { total: operations.length, success, failed } };
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
		return this.getTable(table).size;
	}
}

/** Convenience factory for creating a MemoryAdapter. */
export function createMemoryAdapter(
	initialData?: Record<string, Record<string, unknown>[]>,
): MemoryAdapter {
	return new MemoryAdapter(initialData);
}
