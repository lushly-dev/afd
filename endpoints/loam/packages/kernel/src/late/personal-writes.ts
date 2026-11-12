/**
 * @fileoverview A `provider` deployment's view-state writes, each under its person's record id (phase 3
 * specification, 4.5): first paint's `personalStore` reads, and stage B, where the first write happens,
 * attaches these (13).
 */

import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { PersonalStore } from '../scope/personal.js';

/** A queued write's key while a person leaves: stored under no one's (phase 3 specification, 4.4). */
const DROPPED = '';

/**
 * Give `personal` its writes over `store`. A record's key is fixed when the registry queues its write, by
 * its `set` or `replace`, not when the debounced write is flushed, so a change made as one person is never
 * stored as the next person's (the step 1 review's I1). The scope's `auth-*` commands flush before they run,
 * so no write is pending when the person changes by a command. The returned `quiet` runs `fn` with each write
 * it queues dropped: what a change of person does to the shell's records in memory, after the adapter already
 * names the next person, is neither the leaving person's change nor the next one's (4.4). From here on every
 * read and write is keyed by `person`, the person the shell is for (4.4; the review of step 2's B2).
 */
export function personalWrites(
	personal: PersonalStore,
	store: DataAdapter,
	viewState: Pick<ViewStateRegistry, 'set' | 'replace'>,
	person: () => string | undefined
): (fn: () => void) => void {
	// First paint's key tells a person's record from the profile's: it suffixes only theirs (4.5).
	const firstKey = personal.key;
	const isPersonal = (id: string) => firstKey(id) !== id;
	// `personalRecordId`'s shape, for `person`: the one the shell is for, never the adapter's live one, so a
	// change of person reads and writes the next person's records only once it is settled (4.4). Held equal to
	// `personalRecordId` by a unit.
	const suffix = () => `~${person() ?? 'signed-out'}`;
	const keyOf = (id: string) => (isPersonal(id) ? `${id}${suffix()}` : id);
	const queued = new Map<string, string>();
	let quiet = false;
	for (const method of ['set', 'replace'] as const) {
		const write = viewState[method].bind(viewState) as (id: string, value: object) => object;
		Object.assign(viewState, {
			[method]: (id: string, value: object) => {
				queued.set(id, quiet ? DROPPED : keyOf(id));
				return write(id, value);
			},
		});
	}
	const key = (id: string) => queued.get(id) ?? keyOf(id);
	Object.assign(personal, {
		key: keyOf,
		get: async (table: string, id: string) => {
			const row = await store.get<object>(table, keyOf(id));
			return row && { ...row, id };
		},
		async list(table: string, params?: Parameters<DataAdapter['list']>[1]) {
			const listed = await store.list<{ id: string }>(table, params);
			const own = suffix();
			// Another person's row, or a `local` deployment's unsuffixed one, is not this person's record.
			const data = listed.data.flatMap((row) =>
				!isPersonal(row.id)
					? [row]
					: row.id.endsWith(own)
						? [{ ...row, id: row.id.slice(0, -own.length) }]
						: []
			);
			return { data, total: data.length };
		},
		create: (table: string, data: { id: string }) =>
			key(data.id) === DROPPED ? data : store.create(table, { ...data, id: key(data.id) }),
		update: async (table: string, id: string, patch: object) =>
			key(id) === DROPPED
				? { ...patch, id }
				: { ...(await store.update<object>(table, key(id), patch)), id },
		remove: async (table: string, id: string) => {
			if (key(id) !== DROPPED) await store.remove(table, key(id));
		},
	});
	return (fn) => {
		quiet = true;
		try {
			fn();
		} finally {
			quiet = false;
		}
	};
}
