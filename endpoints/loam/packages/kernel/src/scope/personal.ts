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

/**
 * The view-state store of a `provider` deployment: each personal record is read and written under
 * {@link personalRecordId} for the person signed in at that moment, and listed back under its own id, so
 * the registry, the commands and the chrome name `loam.scope` as before. Another person's rows, and a
 * `local` deployment's unsuffixed ones, are never listed. Nothing migrates: `local` keeps phase 2's ids.
 * Only the view-state registry is given it, so `batch` and `health` are the store's.
 */
export function personalStore(store: DataAdapter, person: () => string | undefined): DataAdapter {
	const key = (id: string) => (PERSONAL.test(id) ? personalRecordId(id, person()) : id);
	const as = (row: object | null, id: string) => row && { ...row, id };
	return {
		get: async (table: string, id: string) => as(await store.get(table, key(id)), id),
		update: async (table: string, id: string, patch: object) =>
			as(await store.update(table, key(id), patch), id),
		create: (table: string, data: { id: string }) =>
			store.create(table, { ...data, id: key(data.id) }),
		remove: (table: string, id: string) => store.remove(table, key(id)),
		async list(table: string, params?: Parameters<DataAdapter['list']>[1]) {
			const listed = await store.list<{ id: string }>(table, params);
			const suffix = personalRecordId('', person());
			const data = listed.data.flatMap((row) => {
				const id = row.id.slice(0, -suffix.length);
				// Unsuffixed, or another person's: not this person's record.
				return row.id.endsWith(suffix) && PERSONAL.test(id)
					? [{ ...row, id }]
					: PERSONAL.test(row.id)
						? []
						: [row];
			});
			return { ...listed, data, total: data.length };
		},
		batch: (operations: never) => store.batch(operations),
		health: () => store.health(),
	} as unknown as DataAdapter;
}
