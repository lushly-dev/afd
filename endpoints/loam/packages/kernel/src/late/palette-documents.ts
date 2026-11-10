/**
 * @fileoverview The palette's document rows (documents specification, 8.2): title search over every active
 * record, as `palette-search`'s `kind: 'document'` rows, in the `late` chunk. One `PaletteIndex` over the
 * titles, built from the store on the first query that needs it and again after any record is written,
 * since only `check.put` writes an active one. **Each result is filtered through `decideAccess` at query
 * time,** for the caller's actor, so a sign-out or a change of members never shows an old actor's titles,
 * and what it says of a document's place is read then too.
 */

import type { DocumentRecordV1 } from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';
import { createPaletteIndex, type PaletteIndex, type PaletteItem } from '../palette-index.js';
import type { AccessActorV1 } from '../scope/access.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import { DOCUMENT_TABLE } from './document-types.js';

export interface DocumentRows {
	/** A record changed: the next query reads the store again. */
	changed(): void;
	/** The active documents `actor` may read whose title matches `query`, best first, at most `limit`. */
	search(query: string, actor: AccessActorV1, limit: number): Promise<PaletteItem[]>;
}

export function createDocumentRows(
	store: DataAdapter,
	scope: ScopeRuntime,
	titleOf: (type: string) => string | undefined
): DocumentRows {
	let built: Promise<{ index: PaletteIndex; records: Map<string, DocumentRecordV1> }> | undefined;
	/** Raised by every write: a build that began before one is not answered from. */
	let generation = 0;
	const build = async () => {
		const records = new Map(
			(await store.list<DocumentRecordV1>(DOCUMENT_TABLE)).data
				.filter((record) => record.workspace === scope.workspace.id && record.status === 'active')
				.map((record) => [record.id, record])
		);
		const entries = [...records.values()].map((record) => ({
			name: record.id,
			title: record.title,
			description: '',
		}));
		return { index: createPaletteIndex(entries, ['title']), records };
	};
	return {
		changed() {
			generation++;
			built = undefined;
		},
		async search(query, actor, limit) {
			if (query.trim() === '') return [];
			// A failed read is tried again at the next query, rather than kept; a write during a build builds again,
			// so a title just restricted, renamed or trashed never shows from the older read.
			let index: PaletteIndex;
			let records: Map<string, DocumentRecordV1>;
			for (;;) {
				const at = generation;
				built ??= build().catch((cause) => {
					built = undefined;
					throw cause;
				});
				const held = built;
				({ index, records } = await held);
				if (at === generation) break;
				if (built === held) built = undefined;
			}
			const rows: PaletteItem[] = [];
			for (const item of index.search(query, index.size)) {
				const record = records.get(item.name) as DocumentRecordV1;
				if (!scope.allows(actor, record.scope)) continue;
				const project =
					record.scope.project === undefined ? undefined : scope.projects.get(record.scope.project);
				rows.push({
					...item,
					kind: 'document',
					description: `${titleOf(record.type) ?? 'Document'} in ${project ? project.name : 'the workspace'}`,
				});
				if (rows.length === limit) break;
			}
			return rows;
		},
	};
}
