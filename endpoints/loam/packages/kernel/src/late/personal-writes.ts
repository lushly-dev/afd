/**
 * @fileoverview A `provider` deployment's view-state writes, each under its person's record id (phase 3
 * specification, 4.5): first paint's `personalStore` reads, and stage B, where the first write happens,
 * attaches these (13).
 */

import type { DataAdapter } from '@lushly-dev/local-db';
import type { PersonalStore } from '../scope/personal.js';

/** Give `personal` its writes over `store`, each record under `personal.key(id)`, answered under `id`. */
export function personalWrites(personal: PersonalStore, store: DataAdapter): void {
	const { key } = personal;
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
