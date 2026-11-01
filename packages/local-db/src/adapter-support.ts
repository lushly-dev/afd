/**
 * Rules shared by every adapter, so `MemoryAdapter`, `HttpAdapter` and `IndexedDbAdapter` behave
 * the same.
 */

import type { QueryParams } from './types.js';

/**
 * Error thrown by adapters. `status` follows HTTP: 400 for an invalid table or record name,
 * 404 for a missing record, and the response status for other HTTP failures.
 */
export class DataAdapterError extends Error {
	/** HTTP-style status of the failure. */
	readonly status: number;
	/**
	 * Machine-readable code: `NOT_FOUND`, `INVALID_NAME`, `INVALID_PATH`,
	 * `INVALID_BATCH_OPERATION`, `CONFLICT`, `HTTP_<status>`, or, from `IndexedDbAdapter`,
	 * `STORAGE_UNAVAILABLE` and `STORAGE_ERROR`.
	 */
	readonly code: string;

	constructor(status: number, message: string, code = codeForStatus(status)) {
		super(message);
		this.name = 'DataAdapterError';
		this.status = status;
		this.code = code;
	}
}

function codeForStatus(status: number): string {
	if (status === 404) return 'NOT_FOUND';
	if (status === 409) return 'CONFLICT';
	return `HTTP_${status}`;
}

/**
 * Tables whose `update()` creates a missing record (HTTP `PUT`). `update()` of a missing record
 * in any other table rejects with a 404 `DataAdapterError` (HTTP `PATCH`).
 */
export const UPSERT_TABLES: ReadonlySet<string> = new Set([
	'settings',
	'flags',
	'feature_flags',
	'feature_data',
	'keyboard_shortcuts',
]);

/**
 * Reject names that cannot be one URL path segment: the empty string, `.` and `..` (URL
 * normalization would drop them or climb out of the base path). Any other string is a valid
 * table or record name; `HttpAdapter` percent-encodes it.
 *
 * @throws DataAdapterError with status 400
 */
export function assertValidName(
	kind: 'table' | 'record id',
	value: unknown
): asserts value is string {
	if (typeof value !== 'string' || value === '' || value === '.' || value === '..') {
		throw new DataAdapterError(
			400,
			`Invalid ${kind} ${JSON.stringify(value)}: use a nonempty string other than "." and ".."`,
			'INVALID_NAME'
		);
	}
}

/**
 * A detached copy of a JSON value, exactly as it would travel over HTTP: `Date`s become ISO
 * strings and `undefined` properties disappear.
 */
export function jsonCopy<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/** A stored record. */
export type Row = Record<string, unknown>;

/** `QueryParams` keys that control the list rather than filter it. */
const RESERVED_QUERY_KEYS = new Set(['limit', 'offset', 'sort', 'order']);

function compareSortValues(a: unknown, b: unknown): number {
	if (typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b)) {
		if (a < b) return -1;
		if (a > b) return 1;
		return 0;
	}

	const aValue = a == null ? '' : String(a);
	const bValue = b == null ? '' : String(b);
	return aValue.localeCompare(bValue);
}

/**
 * Filter (exact match on the string form of each non-reserved param), sort and paginate `rows`
 * as `DataAdapter.list()` does. `total` counts the filtered rows before pagination.
 */
export function queryRows(rows: Row[], params?: QueryParams): { rows: Row[]; total: number } {
	let selected = rows;
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			if (RESERVED_QUERY_KEYS.has(key) || value === undefined) continue;
			selected = selected.filter((row) => String(row[key]) === String(value));
		}
	}

	const total = selected.length;

	if (params?.sort) {
		const sortKey = params.sort;
		const order = params.order === 'desc' ? -1 : 1;
		selected = [...selected].sort((a, b) => compareSortValues(a[sortKey], b[sortKey]) * order);
	}

	const offset = params?.offset ?? 0;
	const limit = params?.limit ?? selected.length;
	return { rows: selected.slice(offset, offset + limit), total };
}

/** The ID `create()` stores a record under: its `id`, `name` or `key`, or a new UUID. */
export function recordId(record: Row): string {
	const id = String(record.id ?? record.name ?? record.key ?? crypto.randomUUID());
	assertValidName('record id', id);
	return id;
}

/** A JSON copy of `value` when it is an object, otherwise an empty record. */
export function asRow(value: unknown): Row {
	return typeof value === 'object' && value !== null ? jsonCopy(value as Row) : {};
}

/** Split a batch path `/<table>[/<id>]` into its percent-decoded table and record ID. */
export function parseBatchPath(path: unknown): { table: string; id: string | undefined } {
	if (typeof path !== 'string') {
		throw new DataAdapterError(400, 'Batch operation path must be a string', 'INVALID_PATH');
	}
	const [first = '', ...rest] = path.replace(/^\/+/, '').split('/');
	try {
		const id = rest.length > 0 ? decodeURIComponent(rest.join('/')) : undefined;
		return { table: decodeURIComponent(first), id: id === '' ? undefined : id };
	} catch {
		throw new DataAdapterError(400, `Malformed batch path ${JSON.stringify(path)}`, 'INVALID_PATH');
	}
}

/** The record ID of a batch path, which `PUT`, `PATCH` and `DELETE` need. */
export function requireId(method: string, id: string | undefined): string {
	if (id === undefined) {
		throw new DataAdapterError(400, `${method} needs a /<table>/<id> path`, 'INVALID_PATH');
	}
	return id;
}

/** The result every operation but the failed one reports when a batch is rolled back. */
export function rolledBack(failedIndex: number): { status: number; error: string } {
	return {
		status: 424,
		error: `Not applied: operation ${failedIndex} failed, so the batch was rolled back`,
	};
}
