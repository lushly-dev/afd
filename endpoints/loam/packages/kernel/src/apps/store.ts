/**
 * @fileoverview The `store` grant: a key-value namespace per instance over the kernel's `DataAdapter`,
 * table `app-<instance>` (phase 1 specification, 4.3), keyed by scope in one function (phase 2
 * specification, section 5; D77). The kernel fills everything in a record but its key and value.
 */

import type { Actor } from '@lushly-dev/afd-core';
import type { AppStoreV1, ScopeV1 } from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';
import { LoamKernelError } from '../errors.js';
import { rowProject, scopeKeyOf, storeRecordId } from '../scope/store-id.js';

/** One stored value, with the fields the architecture's section 7 gives a record. */
export interface AppStoreRecord {
	id: string;
	key: string;
	value: unknown;
	app: string;
	instance: string;
	/** The workspace it was written in (phase 2 specification, 4). */
	workspace?: string;
	/** `null` reads as `local` (4). */
	actor: Actor | null;
	updatedAt: number;
	/** A phase 1 row's `null` reads as the workspace. */
	scope: ScopeV1 | null;
	/** `w`, or `p:<project>`: a string, so `queryRows` can filter on it. Absent on a phase 1 row. */
	scopeKey?: string;
}

export interface AppStoreOptions {
	adapter: DataAdapter;
	app: string;
	instance: string;
	/** The call's effective scope, or the active scope at each operation for the port's own store. */
	scope: ScopeV1 | (() => ScopeV1);
	/** The command's clock, so a replay reproduces `updatedAt`. */
	now(): number;
	actor?: Actor;
	/** The call is a query: `put` and `delete` reject with `STORE_WRITE_IN_QUERY` (5). */
	readOnly?: boolean;
}

export { scopeKeyOf, storeRecordId } from '../scope/store-id.js';

/**
 * A key the adapter can hold as an id: any nonempty string but `.` and `..`, and none starting `p~`,
 * which would name another scope's record (phase 2 specification, 13).
 */
export function checked(key: unknown): string {
	if (
		typeof key !== 'string' ||
		key === '' ||
		key === '.' ||
		key === '..' ||
		key.startsWith('p~')
	) {
		throw new TypeError(
			'A store key is a nonempty string other than "." and "..", not starting "p~"'
		);
	}
	return key;
}

/** The refusal of a write under a query: a boundary in a frame, a contract for a native handler. */
export const storeWriteInQuery = (): LoamKernelError =>
	new LoamKernelError({
		code: 'STORE_WRITE_IN_QUERY',
		message: 'A query cannot write to the store',
		suggestion: 'Declare `store-write` on the command, which makes it a mutation',
	});

export function createAppStore(options: AppStoreOptions): AppStoreV1 {
	const { adapter, app, instance } = options;
	const table = `app-${instance}`;
	const scopeNow = (): ScopeV1 =>
		typeof options.scope === 'function' ? options.scope() : options.scope;
	const writable = (): void => {
		if (options.readOnly) throw storeWriteInQuery();
	};
	return {
		async get<T = unknown>(key: string): Promise<T | undefined> {
			const record = await adapter.get<AppStoreRecord>(
				table,
				storeRecordId(scopeNow(), checked(key))
			);
			return record ? (record.value as T) : undefined;
		},
		async put(key, value) {
			const scope = scopeNow();
			const id = storeRecordId(scope, checked(key));
			writable();
			const record: AppStoreRecord = {
				id,
				key,
				value,
				app,
				instance,
				workspace: scope.workspace,
				actor: options.actor ?? null,
				updatedAt: options.now(),
				scope,
				scopeKey: scopeKeyOf(scope),
			};
			// A batch's PUT upserts; `update` does so only in the adapter's named tables.
			const { summary } = await adapter.batch([
				{ method: 'PUT', path: `/${table}/${encodeURIComponent(id)}`, body: record },
			]);
			if (summary.failed > 0) throw new Error(`The store could not write '${key}'`);
		},
		async delete(key) {
			const id = storeRecordId(scopeNow(), checked(key));
			writable();
			await adapter.remove(table, id);
		},
		async list(prefix) {
			const scope = scopeNow();
			// A phase 1 row has no `scopeKey`, so workspace level reads the table and drops every `p~` id.
			const { data } = await adapter.list<AppStoreRecord>(
				table,
				scope.project === undefined ? undefined : { scopeKey: scopeKeyOf(scope) }
			);
			// Filtered again here, by the id the kernel built: the adapter's `where` alone is not the boundary.
			return data
				.filter(
					(record) =>
						rowProject(record.id) === scope.project &&
						(prefix === undefined || record.key.startsWith(prefix))
				)
				.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
				.map((record) => ({ key: record.key, value: record.value }));
		},
	};
}
