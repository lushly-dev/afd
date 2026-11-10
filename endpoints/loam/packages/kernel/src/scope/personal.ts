/**
 * @fileoverview A person's records (phase 3 specification, 4.5; D94): in `provider` mode several people
 * may share a browser profile, so `loam.scope`, `loam.apps`, `loam.editor[@<project>]` and
 * `loam.layout.<owner>[@<project>]` are stored per person, with the suffix `~<person>`, and `loam.persona`
 * is in both modes. In first paint, since stage A reads a person's `loam.scope` (13).
 */

import type { DataAdapter } from '@lushly-dev/local-db';

/** The key of a person's records while no one is signed in: defaults only (4.5). */
export const SIGNED_OUT_PERSON = 'signed-out';

/** A person's record id: `id~<person>`, or `id~signed-out` with no person (4.5). */
export const personalRecordId = (id: string, person: string | undefined): string =>
	`${id}~${person ?? SIGNED_OUT_PERSON}`;

/**
 * The view-state records `provider` mode keeps per person; the rest, as `loam.appearance`, are the
 * profile's. A suffixed id matches too, so another person's row is recognized as one.
 */
const PERSONAL = /^loam\.(scope|apps|editor|layout)($|[.@~])/;

/** The view-state store of a `provider` deployment, with the key it reads and writes each record under. */
export interface PersonalStore extends DataAdapter {
	key(id: string): string;
}

/**
 * The view-state store of a `provider` deployment: each personal record is read under
 * {@link personalRecordId} for the person signed in at that moment, and listed back under its own id, so
 * the registry, the commands and the chrome name `loam.scope` as before. Another person's rows, and a
 * `local` deployment's unsuffixed ones, are never listed. Nothing migrates: `local` keeps phase 2's ids.
 *
 * First paint holds what stage A reads, `get` and `list`. Nothing writes a view-state record before stage
 * B, so the writes, `create`, `update` and `remove`, are `late/`'s `personalWrites`, which attaches them
 * (13); a write before it would throw, and the registry reports a failed write. The registry calls nothing
 * else of a store.
 */
export function personalStore(store: DataAdapter, person: () => string | undefined): PersonalStore {
	const key = (id: string) => (PERSONAL.test(id) ? personalRecordId(id, person()) : id);
	return {
		key,
		get: async (table: string, id: string) => {
			const row = await store.get<object>(table, key(id));
			return row && { ...row, id };
		},
		async list(table: string, params?: Parameters<DataAdapter['list']>[1]) {
			const listed = await store.list<{ id: string }>(table, params);
			const suffix = personalRecordId('', person());
			// Another person's row, or a `local` deployment's unsuffixed one, is not this person's record.
			const data = listed.data.flatMap((row) =>
				!PERSONAL.test(row.id)
					? [row]
					: row.id.endsWith(suffix)
						? [{ ...row, id: row.id.slice(0, -suffix.length) }]
						: []
			);
			// Filtered, so the store's own paging no longer describes it: the rows and their count.
			return { data, total: data.length };
		},
	} as unknown as PersonalStore;
}
