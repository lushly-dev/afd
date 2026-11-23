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
import type { StoreOrderV1 } from '../journal-order.js';
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
	/**
	 * The bytes this record was charged against `storeBytes` (phase 4 specification, section 11), so an overwrite or a
	 * delete refunds what was charged, whatever the row holds now. Absent on a row written before step 10.
	 */
	bytes?: number;
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
	/** Told of each read and write the call issues, for the journal's order (#1936). */
	order?: StoreOrderV1;
	/** Checked inside `quota.write`'s serialized commit step right before writing (#876). */
	beforeCommit?: () => void;
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
	/** When `store-usage-settle` last counted the table, which stage B does again a day later (14). */
	countedAt?: number;
}

export const storeUsageId = (workspace: string, instance: string): string =>
	`${workspace}/${instance}`;

/** The bytes a record counts against `storeBytes`: its key and value as JSON. */
export const recordBytes = (key: string, value: unknown): number => jsonBytes({ key, value });

/**
 * What a held record was charged: its own `bytes`, else (a row from before step 10) its JSON measured now; one with no
 * JSON form, which no write since step 10 can leave, counts 0 rather than blocking every later write.
 */
function chargedOf(record: AppStoreRecord): number {
	if (typeof record.bytes === 'number' && Number.isFinite(record.bytes) && record.bytes >= 0)
		return record.bytes;
	const bytes = recordBytes(record.key, record.value);
	return Number.isFinite(bytes) ? bytes : 0;
}

/**
 * Whether a held record counts against `workspace`: written there, or a phase 1 row with no workspace. A store's record
 * id has no workspace part (phase 2's D77, one workspace per deployment), so a row another workspace wrote in the same
 * browser's store is never charged or refunded here (the trust review's R1).
 */
const ours = (record: AppStoreRecord, workspace: string): boolean =>
	record.workspace === undefined || record.workspace === workspace;

/** Most milliseconds a usage row is trusted before stage B counts its table again (the trust review's 13 and 14). */
export const USAGE_RECOUNT_MS = 86_400_000;

/**
 * The `store` grant's quota (section 11). Every write of one instance runs after the one before it has ended, so its
 * check, its record and its count are one step against the current row: two writes never both take the last place.
 */
export interface StoreQuota {
	/** The bytes `instance` holds in `workspace`: its row's, or counted from its table when it has none. */
	used(instance: string, workspace: string): Promise<number>;
	/** `instance`'s row in `workspace`, or undefined for none: its bytes and when its table was last counted. */
	stored(
		instance: string,
		workspace: string
	): Promise<{ used: number; countedAt?: number } | undefined>;
	/** Count `instance`'s table afresh: every scope's records of `workspace`, each by what it was charged. */
	count(instance: string, workspace: string): Promise<number>;
	/** Write the rows `store-usage-settle` names (section 11's internal command), counted at `now`. */
	settle(
		workspace: string,
		rows: ReadonlyArray<{ instance: string; used: number }>,
		now: number
	): Promise<void>;
	/**
	 * Write `id`'s record, or remove it with `next` undefined, with the instance's count in one batch. A write that would
	 * take the count past `storeBytes` rejects `QUOTA_EXCEEDED` with `details: { kind: 'store', limit, used }`. `issued`
	 * is told right before the batch is sent, once the quota's own reads are done: a read issued before it cannot have
	 * seen the write (#1936). It is not told of a write refused, or of a delete of nothing.
	 */
	write(
		instance: string,
		scope: ScopeV1,
		id: string,
		next: AppStoreRecord | undefined,
		now: number,
		issued?: () => void,
		beforeCommit?: () => void
	): Promise<void>;
	/**
	 * Charge `bytes` to `instance` in turn with its writes, `commit` writing whatever the charge pays for with the usage
	 * row's operation in its own batch: a document's content, created by the shell (the trust review's 3).
	 */
	charge(
		instance: string,
		workspace: string,
		bytes: number,
		now: number,
		commit: (usage: BatchOperation) => Promise<void>
	): Promise<void>;
	/** Refund `bytes`, after the shell deleted what they paid for (a document's content on expiry). */
	refund(instance: string, workspace: string, bytes: number, now: number): Promise<void>;
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
	async function count(instance: string, workspace: string): Promise<number> {
		const { data } = await adapter.list<AppStoreRecord>(table(instance));
		return data.reduce((sum, record) => sum + (ours(record, workspace) ? chargedOf(record) : 0), 0);
	}
	async function stored(instance: string, workspace: string) {
		const row = await adapter.get<StoreUsageRowV1>(
			STORE_USAGE_TABLE,
			storeUsageId(workspace, instance)
		);
		return row && row.workspace === workspace && typeof row.used === 'number'
			? {
					used: row.used,
					...(typeof row.countedAt === 'number' ? { countedAt: row.countedAt } : {}),
				}
			: undefined;
	}
	async function used(instance: string, workspace: string): Promise<number> {
		return (await stored(instance, workspace))?.used ?? count(instance, workspace);
	}
	const usageRow = (
		workspace: string,
		instance: string,
		bytes: number,
		now: number,
		countedAt?: number
	): BatchOperation => {
		const id = storeUsageId(workspace, instance);
		const row: StoreUsageRowV1 = {
			id,
			workspace,
			instance,
			used: Math.max(0, bytes),
			updatedAt: now,
			...(countedAt !== undefined ? { countedAt } : {}),
		};
		return { method: 'PUT', path: `/${STORE_USAGE_TABLE}/${encodeURIComponent(id)}`, body: row };
	};
	const quotaExceeded = (instance: string, held: number, after: number, now: number) => {
		const limit = (limits?.values() ?? LIMIT_DEFAULTS).storeBytes;
		if (after <= limit) return undefined;
		limits?.refused(instance, 'storeBytes', now);
		return new LoamKernelError({
			code: 'QUOTA_EXCEEDED',
			message: `This app's store would hold ${after} bytes, over its ${limit}`,
			suggestion:
				'Delete what this app no longer needs, or ask an owner to raise loam.limits.storeBytes',
			details: { kind: 'store', limit, used: held },
		});
	};
	const batch = async (operations: BatchOperation[], what: string) => {
		const { summary } = await adapter.batch(operations);
		if (summary.failed > 0) throw new Error(`The store could not write ${what}`);
	};
	return {
		used,
		stored,
		count,
		settle: (workspace, rows, now) =>
			Promise.all(
				rows.map((row) =>
					serial(row.instance, () =>
						batch([usageRow(workspace, row.instance, row.used, now, now)], 'its usage')
					)
				)
			).then(() => undefined),
		write: (instance, scope, id, next, now, issued, beforeCommit) =>
			serial(instance, async () => {
				beforeCommit?.();
				const before = await adapter.get<AppStoreRecord>(table(instance), id);
				// Refunded only what this workspace was charged for the row (R1).
				const old = before && ours(before, scope.workspace) ? chargedOf(before) : 0;
				const bytes = next ? recordBytes(next.key, next.value) : 0;
				const row = await stored(instance, scope.workspace);
				const held = row?.used ?? (await count(instance, scope.workspace));
				const after = held - old + bytes;
				// Only a write that grows past the limit is refused: a smaller one, or a delete, always lands.
				const refused = bytes > old ? quotaExceeded(instance, held, after, now) : undefined;
				if (refused) throw refused;
				if (!next && !before) return;
				beforeCommit?.();
				const path = `/${table(instance)}/${encodeURIComponent(id)}`;
				issued?.();
				await batch(
					[
						// Every field written whole, `bytes` among them, so a store that merges a PUT into the row it holds keeps
						// nothing of the old value's charge.
						next ? { method: 'PUT', path, body: { ...next, bytes } } : { method: 'DELETE', path },
						usageRow(scope.workspace, instance, after, now, row?.countedAt),
					],
					`'${next?.key ?? id}'`
				);
			}),
		charge: (instance, workspace, bytes, now, commit) =>
			serial(instance, async () => {
				const row = await stored(instance, workspace);
				const held = row?.used ?? (await count(instance, workspace));
				const refused = bytes > 0 ? quotaExceeded(instance, held, held + bytes, now) : undefined;
				if (refused) throw refused;
				await commit(usageRow(workspace, instance, held + bytes, now, row?.countedAt));
			}),
		refund: (instance, workspace, bytes, now) =>
			serial(instance, async () => {
				const held = await stored(instance, workspace);
				// With no row, the next read counts the table, which no longer holds what was deleted.
				if (held === undefined) return;
				await batch(
					[usageRow(workspace, instance, held.used - bytes, now, held.countedAt)],
					'its usage'
				);
			}),
	};
}

/**
 * The JSON form a value is stored as, so what is counted is what is kept (section 11): a value with none (a cycle, a
 * `BigInt`, a function, `undefined` itself) is refused before anything is counted, with `VALIDATION_ERROR`, as the
 * handler frame refuses such a request (the trust review's R2).
 */
function asStored(value: unknown): unknown {
	let json: string | undefined;
	try {
		json = JSON.stringify(value);
	} catch {
		json = undefined;
	}
	if (json === undefined) {
		throw new LoamKernelError({
			code: 'VALIDATION_ERROR',
			message: 'A stored value needs a JSON form',
			suggestion: 'Store JSON values: no cycle, no BigInt, no function, and not undefined',
		});
	}
	return JSON.parse(json);
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
			const id = storeRecordId(scopeNow(), checked(key));
			options.order?.read();
			const record = await adapter.get<AppStoreRecord>(table, id);
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
			await quota.write(
				instance,
				scope,
				id,
				record,
				options.now(),
				options.order?.wrote,
				options.beforeCommit
			);
		},
		async delete(key) {
			const scope = scopeNow();
			const id = storeRecordId(scope, checked(key));
			writable();
			await quota.write(
				instance,
				scope,
				id,
				undefined,
				options.now(),
				options.order?.wrote,
				options.beforeCommit
			);
		},
		async list(prefix) {
			const scope = scopeNow();
			options.order?.read();
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
