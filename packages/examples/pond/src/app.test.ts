import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJournal, serializeJournalEntry } from '@lushly-dev/afd-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPond, PondReplayError } from './app.js';
import type { Fish } from './pond.js';

let dir: string;
let journalPath: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'afd-pond-'));
	journalPath = join(dir, 'pond.jsonl');
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function journalLines(): Promise<number> {
	return parseJournal(await readFile(journalPath, 'utf8')).length;
}

describe('the pond rebuilt from its journal', () => {
	it('is the pond that wrote it, though the calls read the real clock and Math.random', async () => {
		const first = await openPond({ journalPath });
		expect(first.replay.entries).toEqual([]);
		await first.run('pond-stock', { species: 'koi', count: 3 });
		await first.run('pond-stock', { species: 'minnow', count: 5 });
		await first.run('pond-tick', { days: 4 });
		const netted = await first.run('pond-net', { id: 'fish-2' });
		expect(netted.success).toBe(true);
		await first.run('pond-tick', { days: 2 });
		const written = first.pond.snapshot();

		const second = await openPond({ journalPath });
		expect(second.replay).toMatchObject({ same: 5, diverged: false });
		expect(second.pond.snapshot()).toEqual(written);

		// The rebuilt pond carries on, and its new calls go to the same journal.
		await second.run('pond-stock', { species: 'perch' });
		const third = await openPond({ journalPath });
		expect(third.pond.snapshot()).toEqual(second.pond.snapshot());
		expect(third.replay.same).toBe(6);
	});

	it('journals neither reads nor refused calls, since neither changed the pond', async () => {
		const { run } = await openPond({ journalPath });
		await run('pond-stock', { species: 'koi', count: 2 });
		expect((await run('pond-status')).success).toBe(true);
		const missing = await run('pond-net', { id: 'fish-99' });
		expect(missing.error).toMatchObject({ code: 'NOT_FOUND', suggestion: expect.any(String) });
		for (let i = 0; i < 3; i++) await run('pond-stock', { species: 'minnow', count: 50 });
		// 152 fish, room for 48.
		const full = await run('pond-stock', { species: 'koi', count: 50 });
		expect(full.error).toMatchObject({ code: 'POND_FULL', details: { room: 48 } });
		expect(await journalLines()).toBe(4);
	});

	it('records calls made without waiting in the order they changed the pond', async () => {
		const first = await openPond({ journalPath });
		await Promise.all([
			first.run('pond-stock', { species: 'koi', count: 2 }),
			first.run('pond-net', { id: 'fish-1' }),
			first.run('pond-tick'),
			first.run('pond-stock', { species: 'perch', count: 1 }),
		]);
		const second = await openPond({ journalPath });
		expect(second.pond.snapshot()).toEqual(first.pond.snapshot());
		expect(second.pond.fish.has('fish-1')).toBe(false);
	});

	it('refuses to open when an entry replays to a different result', async () => {
		const first = await openPond({ journalPath });
		await first.run('pond-stock', { species: 'koi', count: 3 });
		await first.run('pond-tick', { days: 2 });

		// Drop the second entry's tape, as if its handler had read Math.random() directly: replay
		// has no recorded values to give it, so the fish grow differently.
		const entries = parseJournal(await readFile(journalPath, 'utf8'));
		const [stocked, ticked] = entries;
		if (!stocked || !ticked) throw new Error('expected two entries');
		const { tape: _dropped, ...untaped } = ticked;
		await writeFile(
			journalPath,
			`${serializeJournalEntry(stocked)}\n${serializeJournalEntry(untaped)}\n`
		);

		const error = await openPond({ journalPath }).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(PondReplayError);
		const report = (error as PondReplayError).report;
		expect(report.entries.map((entry) => entry.status)).toEqual(['same', 'different']);
		const paths = report.entries[1]?.differences?.map((difference) => difference.path);
		expect(paths).toContain('data.stateDigest');
	});

	it('replays a call that reads more values than the default tape keeps', async () => {
		const first = await openPond({ journalPath });
		for (let i = 0; i < 4; i++) await first.run('pond-stock', { species: 'minnow', count: 50 });
		const long = await first.run('pond-tick', { days: 30 });
		expect(long.success).toBe(true);
		const [, , , , ticked] = parseJournal(await readFile(journalPath, 'utf8'));
		expect(ticked?.tape?.random.length).toBeGreaterThan(1000);
		expect(ticked?.tape?.truncated).toBeUndefined();
		const second = await openPond({ journalPath });
		expect(second.pond.snapshot()).toEqual(first.pond.snapshot());
	});

	it('stops taking calls once a change could not be journaled', async () => {
		const first = await openPond({ journalPath });
		await first.run('pond-stock', { species: 'koi' });
		await chmod(journalPath, 0o444);
		try {
			const lost = await first.run('pond-stock', { species: 'minnow' });
			expect(lost.error).toMatchObject({ code: 'JOURNAL_WRITE_FAILED' });
			const after = await first.run('pond-status');
			expect(after.error).toMatchObject({ code: 'JOURNAL_WRITE_FAILED' });
		} finally {
			await chmod(journalPath, 0o644);
		}
		// Reopened, the pond is what the journal holds: the unrecorded minnow is gone.
		const second = await openPond({ journalPath });
		expect(second.pond.snapshot().fish.map((fish: Fish) => fish.species)).toEqual(['koi']);
	});
});
