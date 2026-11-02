import { readFileSync } from 'node:fs';
import type { JournalEntry } from '@lushly-dev/afd-core';
import {
	diffJournals,
	recordSession,
	replayKernel,
	SESSION_50,
} from '@lushly-dev/loam-kernel/testing';
import { describe, expect, it } from 'vitest';

const FIXTURE = new URL('../specimens/fixtures/session-50.journal.json', import.meta.url);

describe("E2's committed journal fixture", () => {
	const committed = JSON.parse(readFileSync(FIXTURE, 'utf8')) as JournalEntry[];

	it('is SESSION_50 as recorded now (run session:record when this fails)', async () => {
		const { entries } = await recordSession(SESSION_50);
		const diff = diffJournals(committed, entries);
		expect(diff.firstDifference).toBeUndefined();
		expect(diff.equal).toBe(true);
		expect(committed).toHaveLength(SESSION_50.length);
	});

	it('replays with zero differences', async () => {
		const { report } = await replayKernel(committed);
		expect(report.diverged).toBe(false);
	});
});
