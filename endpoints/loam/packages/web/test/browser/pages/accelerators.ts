/** A1 to A3's page (phase 0 specification, 8.2): the operations on the reference workspace. */
import { createPaletteIndex } from '@lushly-dev/loam-kernel';
import {
	createReferenceWorkspace,
	diffJournals,
	recordSession,
	replayKernel,
} from '@lushly-dev/loam-kernel/testing';

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

	return {
		a1: { queries: times.length, entries: palette.commands.length, p95Ms: percentile(times, 95) },
		a2: { entries: first.entries.length, totalMs: replayMs, diverged: replay.report.diverged },
		a3: {
			entries: [first.entries.length, second.entries.length],
			totalMs: diffMs,
			equal: diff.equal,
		},
	};
}

(window as unknown as { loamAccelerators: typeof measure }).loamAccelerators = measure;
