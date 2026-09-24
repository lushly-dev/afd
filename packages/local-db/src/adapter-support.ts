/**
 * Rules shared by every adapter, so `MemoryAdapter` and `HttpAdapter` behave the same.
 */

/**
 * Error thrown by adapters. `status` follows HTTP: 400 for an invalid table or record name,
 * 404 for a missing record, and the response status for other HTTP failures.
 */
export class DataAdapterError extends Error {
	/** HTTP-style status of the failure. */
	readonly status: number;
	/** Machine-readable code: `NOT_FOUND`, `INVALID_NAME`, `CONFLICT` or `HTTP_<status>`. */
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
