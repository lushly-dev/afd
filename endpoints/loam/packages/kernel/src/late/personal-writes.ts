/**
 * @fileoverview A `provider` deployment's view-state writes, each under its person's record id (phase 3
 * specification, 4.5): first paint's `personalStore` reads, and stage B, where the first write happens,
 * attaches these (13).
 */

import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { PersonalStore } from '../scope/personal.js';

/**
 * Give `personal` its writes over `store`. A record's key is fixed when the registry queues its write, by
 * its `set` or `replace`, not when the debounced write is flushed, so a change made as one person is never
 * stored as the next person's (the step 1 review's I1). The scope's `auth-*` commands flush before they run,
 * so no write is pending when the person changes by a command.
 */
export function personalWrites(
	personal: PersonalStore,
	store: DataAdapter,
	viewState: Pick<ViewStateRegistry, 'set' | 'replace'>
): void {
	const queued = new Map<string, string>();
	for (const method of ['set', 'replace'] as const) {
		const write = viewState[method].bind(viewState) as (id: string, value: object) => object;
		Object.assign(viewState, {
			[method]: (id: string, value: object) => {
				queued.set(id, personal.key(id));
				return write(id, value);
			},
		});
	}
	const key = (id: string) => queued.get(id) ?? personal.key(id);
	Object.assign(personal, {
		create: (table: string, data: { id: string }) =>
			store.create(table, { ...data, id: key(data.id) }),
		update: async (table: string, id: string, patch: object) => ({
			...(await store.update<object>(table, key(id), patch)),
			id,
		}),
		remove: (table: string, id: string) => store.remove(table, key(id)),
	});
}
