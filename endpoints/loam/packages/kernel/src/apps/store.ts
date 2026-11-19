/**
 * @fileoverview The `store` grant: a key-value namespace per instance over the kernel's `DataAdapter`,
 * table `app-<instance>` (phase 1 specification, 4.3), keyed by scope in one function (phase 2
 * specification, section 5; D77). The kernel fills everything in a record but its key and value. Each instance's
 * records are held to `loam.limits.storeBytes` (phase 4 specification, section 11), counted in the `store-usage` table.
 */

import type { Actor } from '@lushly-dev/afd-core';
import type { AppStoreV1, ScopeV1 } from '@lushly-dev/loam-sdk';
import type { BatchOperation, DataAdapter } from '@lushly-dev/local-db';
import { LoamKernelError } from '../errors.js';
import { jsonBytes, type KernelLimits, LIMIT_DEFAULTS } from '../limits.js';
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
	/** The instance's quota (phase 4 specification, section 11); absent, one of its own with the defaults. */
	quota?: StoreQuota;
}

/** The table of each instance's stored bytes (phase 4 specification, 1 and 11): one row per workspace and instance. */
export const STORE_USAGE_TABLE = 'store-usage';

/** A row of {@link STORE_USAGE_TABLE}, keyed by workspace (#1614), so two workspaces in one store never share one. */
export interface StoreUsageRowV1 {
	id: string;
	workspace: string;
	instance: string;
	/** The UTF-8 bytes of each record's `{ key, value }` as JSON, summed over every scope. */
	used: number;
	updatedAt: number;
}

export const storeUsageId = (workspace: string, instance: string): string =>
	`${workspace}/${instance}`;

/** The bytes a record counts against `storeBytes`: its key and value as JSON. */
const recordBytes = (key: string, value: unknown): number => jsonBytes({ key, value });

/**
 * The `store` grant's quota (section 11). Every write of one instance runs after the one before it has ended, so its
 * check, its record and its count are one step against the current row: two writes never both take the last place.
 */
export interface StoreQuota {
	/** The bytes `instance` holds in `workspace`: its row's, or counted from its table when it has none. */
	used(instance: string, workspace: string): Promise<number>;
	/** The bytes `instance`'s row holds in `workspace`, or undefined for none. */
	stored(instance: string, workspace: string): Promise<number | undefined>;
	/** Count `instance`'s table afresh, every scope's records. */
	count(instance: string): Promise<number>;
	/** Write the rows `store-usage-settle` names (section 11's internal command). */
	settle(
		workspace: string,
		rows: ReadonlyArray<{ instance: string; used: number }>,
		now: number
	): Promise<void>;
	/**
	 * Write `id`'s record, or remove it with `next` undefined, with the instance's count in one batch. A write that would
	 * take the count past `storeBytes` rejects `QUOTA_EXCEEDED` with `details: { kind: 'store', limit, used }`.
	 */
	write(
		instance: string,
		scope: ScopeV1,
		id: string,
		next: AppStoreRecord | undefined,
		now: number
	): Promise<void>;
}

export function createStoreQuota(adapter: DataAdapter, limits?: KernelLimits): StoreQuota {
	const chains = new Map<string, Promise<unknown>>();
	const serial = <T>(instance: string, work: () => Promise<T>): Promise<T> => {
		const run = (chains.get(instance) ?? Promise.resolve()).then(work, work);
		chains.set(
			instance,
			run.catch(() => undefined)
		);
		return run;
	};
	const table = (instance: string) => `app-${instance}`;
	async function count(instance: string): Promise<number> {
		const { data } = await adapter.list<AppStoreRecord>(table(instance));
		return data.reduce((sum, record) => sum + recordBytes(record.key, record.value), 0);
	}
	async function stored(instance: string, workspace: string): Promise<number | undefined> {
		const row = await adapter.get<StoreUsageRowV1>(
			STORE_USAGE_TABLE,
			storeUsageId(workspace, instance)
		);
		return row && row.workspace === workspace && typeof row.used === 'number'
			? row.used
			: undefined;
	}
	async function used(instance: string, workspace: string): Promise<number> {
		return (await stored(instance, workspace)) ?? count(instance);
	}
	const usageRow = (
		workspace: string,
		instance: string,
		bytes: number,
		now: number
	): BatchOperation => {
		const id = storeUsageId(workspace, instance);
		const row: StoreUsageRowV1 = {
			id,
			workspace,
			instance,
			used: Math.max(0, bytes),
			updatedAt: now,
		};
		return { method: 'PUT', path: `/${STORE_USAGE_TABLE}/${encodeURIComponent(id)}`, body: row };
	};
	return {
		used,
		stored,
		count,
		settle: (workspace, rows, now) =>
			Promise.all(
				rows.map((row) =>
					serial(row.instance, async () => {
						const { summary } = await adapter.batch([
							usageRow(workspace, row.instance, row.used, now),
						]);
						if (summary.failed > 0) throw new Error('The store could not write its usage');
					})
				)
			).then(() => undefined),
		write: (instance, scope, id, next, now) =>
			serial(instance, async () => {
				const before = await adapter.get<AppStoreRecord>(table(instance), id);
				const old = before ? recordBytes(before.key, before.value) : 0;
				const bytes = next ? recordBytes(next.key, next.value) : 0;
				const held = await used(instance, scope.workspace);
				const after = held - old + bytes;
				const limit = (limits?.values() ?? LIMIT_DEFAULTS).storeBytes;
				// Only a write that grows past the limit is refused: a smaller one, or a delete, always lands.
				if (bytes > old && after > limit) {
					limits?.refused(instance, 'storeBytes', now);
					throw new LoamKernelError({
						code: 'QUOTA_EXCEEDED',
						message: `This app's store would hold ${after} bytes, over its ${limit}`,
						suggestion:
							'Delete what this app no longer needs, or ask an owner to raise loam.limits.storeBytes',
						details: { kind: 'store', limit, used: held },
					});
				}
				const path = `/${table(instance)}/${encodeURIComponent(id)}`;
				if (!next && !before) return;
				const { summary } = await adapter.batch([
					next ? { method: 'PUT', path, body: next } : { method: 'DELETE', path },
					usageRow(scope.workspace, instance, after, now),
				]);
				if (summary.failed > 0) throw new Error(`The store could not write '${next?.key ?? id}'`);
			}),
	};
}

/**
 * The JSON form a value is stored as, so what is counted is what is kept (section 11): a value with none (a cycle, a
 * `BigInt`) is refused, since its size cannot be counted.
 */
function asStored(value: unknown): unknown {
	let json: string | undefined;
	try {
		json = JSON.stringify(value);
	} catch {
		throw new TypeError('A stored value needs a JSON form: no cycle and no BigInt');
	}
	return json === undefined ? value : JSON.parse(json);
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
	const quota = options.quota ?? createStoreQuota(adapter);
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
				value: asStored(value),
				app,
				instance,
				workspace: scope.workspace,
				actor: options.actor ?? null,
				updatedAt: options.now(),
				scope,
				scopeKey: scopeKeyOf(scope),
			};
			// A batch's PUT upserts; `update` does so only in the adapter's named tables. The count lands in the same batch.
			await quota.write(instance, scope, id, record, options.now());
		},
		async delete(key) {
			const scope = scopeNow();
			const id = storeRecordId(scope, checked(key));
			writable();
			await quota.write(instance, scope, id, undefined, options.now());
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
