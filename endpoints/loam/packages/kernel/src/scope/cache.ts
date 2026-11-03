/**
 * @fileoverview The project and workspace-app caches (phase 2 specification, 4.1 and 4.3): each a
 * `Map` loaded by one `list` at stage A and written through by the late commands, so a call costs no
 * store read. A second writer is phase 6's concern, and this interface is the seam.
 */

import type { DataAdapter } from '@lushly-dev/local-db';

export interface RecordCache<T extends { id: string }> {
	load(store: DataAdapter): Promise<void>;
	get(id: string): T | undefined;
	all(): T[];
	/** Write through: the late commands' store functions call it after their write. */
	put(record: T): void;
}

export function createRecordCache<T extends { id: string }>(table: string): RecordCache<T> {
	const held = new Map<string, T>();
	return {
		async load(store) {
			held.clear();
			const { data } = await store.list<T>(table);
			for (const record of data) held.set(record.id, record);
		},
		get: (id) => held.get(id),
		all: () => [...held.values()],
		put(record) {
			held.set(record.id, record);
		},
	};
}
