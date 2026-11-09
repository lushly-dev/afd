/**
 * A1 to A4's page (phase 0 specification, 8.2; documents specification, 9.3): the operations on the reference
 * workspace, A4 the link index's rebuild over its documents and links.
 */
import '../../../src/zod-jitless.js';
import { createPaletteIndex } from '@lushly-dev/loam-kernel/palette';
import {
	createDocumentIndex,
	createReferenceWorkspace,
	diffJournals,
	LINK_TABLE,
	recordSession,
	replayKernel,
} from '@lushly-dev/loam-kernel/testing';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { IndexedDbAdapter } from '@lushly-dev/local-db/indexeddb';

const percentile = (values: number[], p: number) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
};

async function measure() {
	const palette = createReferenceWorkspace({ seed: 'phase-0', size: 5_000 });
	const index = createPaletteIndex(palette.commands);
	for (const query of palette.queries.slice(0, 20)) index.search(query, 20);
	const times = palette.queries.map((query) => {
		const start = performance.now();
		index.search(query, 20);
		return performance.now() - start;
	});

	const journal = createReferenceWorkspace({ seed: 'phase-0', size: 10_000 });
	const first = await recordSession(journal.calls);
	const second = await recordSession(journal.calls, { start: Date.UTC(2027, 0, 1), seed: 'other' });

	let start = performance.now();
	const replay = await replayKernel(first.entries);
	const replayMs = performance.now() - start;

	start = performance.now();
	const diff = diffJournals(first.entries, second.entries);
	const diffMs = performance.now() - start;

	// A4: 2,000 documents and 20,000 links in a store, and the index built from them by one list (9.3).
	const linked = createReferenceWorkspace({
		seed: 'phase-2',
		size: 1,
		documents: 2_000,
		links: 20_000,
	});
	// Over IndexedDB, as the host keeps its store, the bound's reading; and over memory, a second reading.
	const timed = async (store: DataAdapter) => {
		await store.batch([
			...linked.documents.map((record) => ({
				method: 'PUT' as const,
				path: `/document/${record.id}`,
				body: record,
			})),
			...linked.links.map((link) => ({
				method: 'PUT' as const,
				path: `/${LINK_TABLE}/${link.id}`,
				body: link,
			})),
		]);
		const began = performance.now();
		const found = await createDocumentIndex(store).of(linked.documents[0]?.id as string);
		return { ms: performance.now() - began, found: found.out.length + found.in.length };
	};
	const linkedFirst = linked.documents[0]?.id as string;
	const indexed = await timed(new IndexedDbAdapter({ name: `loam-a4-${Date.now()}` }));
	const memory = await timed(new MemoryAdapter());

	return {
		a4: {
			documents: linked.documents.length,
			links: linked.links.length,
			totalMs: indexed.ms,
			memoryMs: memory.ms,
			found: indexed.found,
			expected:
				linked.links.filter((link) => link.from === linkedFirst || link.to === linkedFirst).length +
				linked.links.filter((link) => link.from === linkedFirst && link.to === linkedFirst).length,
		},
		a1: { queries: times.length, entries: palette.commands.length, p95Ms: percentile(times, 95) },
		a2: {
			entries: first.entries.length,
			totalMs: replayMs,
			diverged: replay.report.diverged,
		},
		a3: {
			entries: [first.entries.length, second.entries.length],
			totalMs: diffMs,
			equal: diff.equal,
		},
	};
}

(window as unknown as { loamAccelerators: typeof measure }).loamAccelerators = measure;
