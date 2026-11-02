/**
 * @fileoverview The `store` grant: a key-value namespace per instance over the kernel's `DataAdapter`,
 * table `app-<instance>` (phase 1 specification, 4.3). The kernel fills everything in a record but its
 * key and value.
 */

import type { Actor } from '@lushly-dev/afd-core';
import type { AppStoreV1 } from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';

/** One stored value, with the fields the architecture's section 7 gives a record. */
export interface AppStoreRecord {
	id: string;
	key: string;
	value: unknown;
	app: string;
	instance: string;
	actor: Actor | null;
	updatedAt: number;
	scope: null;
}

export interface AppStoreOptions {
	adapter: DataAdapter;
	app: string;
	instance: string;
	/** The command's clock, so a replay reproduces `updatedAt`. */
	now(): number;
	actor?: Actor;
}

/** A key the adapter can hold as an id: any nonempty string but `.` and `..`, which are refused. */
function checked(key: unknown): string {
	if (typeof key !== 'string' || key === '' || key === '.' || key === '..') {
		throw new TypeError('A store key is a nonempty string other than "." and ".."');
	}
	return key;
}

export function createAppStore(options: AppStoreOptions): AppStoreV1 {
	const { adapter, app, instance } = options;
	const table = `app-${instance}`;
	return {
		async get<T = unknown>(key: string): Promise<T | undefined> {
			const record = await adapter.get<AppStoreRecord>(table, checked(key));
			return record ? (record.value as T) : undefined;
		},
		async put(key, value) {
			const id = checked(key);
			const record: AppStoreRecord = {
				id,
				key: id,
				value,
				app,
				instance,
				actor: options.actor ?? null,
				updatedAt: options.now(),
				scope: null,
			};
			// A batch's PUT upserts; `update` does so only in the adapter's named tables.
			const { summary } = await adapter.batch([
				{ method: 'PUT', path: `/${table}/${encodeURIComponent(id)}`, body: record },
			]);
			if (summary.failed > 0) throw new Error(`The store could not write '${id}'`);
		},
		async delete(key) {
			await adapter.remove(table, checked(key));
		},
		async list(prefix) {
			const { data } = await adapter.list<AppStoreRecord>(table);
			return data
				.filter((record) => prefix === undefined || record.key.startsWith(prefix))
				.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
				.map((record) => ({ key: record.key, value: record.value }));
		},
	};
}
