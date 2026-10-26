import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JournalRecord } from './journal.js';
import { parseJournal } from './journal.js';
import { FileJournalSink } from './journal-file.js';

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempPath(name = 'journal.jsonl'): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'afd-journal-'));
	dirs.push(dir);
	return join(dir, 'nested', name);
}

function record(command: string): JournalRecord {
	return {
		timestamp: '2026-01-01T00:00:00.000Z',
		command,
		input: { command },
		contextDigest: { hash: 'sha256:00' },
		result: { success: true, data: command },
		durationMs: 0,
	};
}

describe('FileJournalSink', () => {
	it('creates the file and writes one JSON line per entry', async () => {
		const path = await tempPath();
		const sink = new FileJournalSink(path);
		await sink.append(record('a'));
		await sink.append(record('b'));

		const text = await readFile(path, 'utf8');
		expect(text.trim().split('\n')).toHaveLength(2);
		expect(parseJournal(text).map((entry) => [entry.seq, entry.command])).toEqual([
			[1, 'a'],
			[2, 'b'],
		]);
	});

	it('keeps concurrent appends in order', async () => {
		const sink = new FileJournalSink(await tempPath());
		const names = Array.from({ length: 20 }, (_, i) => `c${i}`);
		const stored = await Promise.all(names.map((name) => sink.append(record(name))));

		expect(stored.map((entry) => entry.seq)).toEqual(names.map((_, i) => i + 1));
		expect((await sink.read()).map((entry) => entry.command)).toEqual(names);
	});

	it('continues an existing file and reads ranges', async () => {
		const path = await tempPath();
		await new FileJournalSink(path).append(record('a'));
		const reopened = new FileJournalSink(path);
		expect((await reopened.append(record('b'))).seq).toBe(2);
		await reopened.append(record('c'));

		expect((await reopened.read({ from: 2, to: 2 })).map((entry) => entry.command)).toEqual(['b']);
	});

	it('reads a missing file as empty and rejects a corrupt one', async () => {
		const path = await tempPath();
		expect(await new FileJournalSink(path).read()).toEqual([]);

		await new FileJournalSink(path).append(record('a'));
		await writeFile(path, `${await readFile(path, 'utf8')}{oops\n`);
		const sink = new FileJournalSink(path);
		await expect(sink.read()).rejects.toThrow(/line 2/);
		// A failed append does not block later reads or appends.
		await expect(sink.append(record('b'))).rejects.toThrow(/line 2/);
		await expect(sink.read()).rejects.toThrow(/line 2/);
	});

	it('drops a torn last line and completes an unterminated entry', async () => {
		const path = await tempPath();
		await new FileJournalSink(path).append(record('a'));
		const complete = await readFile(path, 'utf8');
		await writeFile(path, `${complete}{"seq":2,"timest`);

		const torn = new FileJournalSink(path);
		expect((await torn.read()).map((entry) => entry.command)).toEqual(['a']);
		expect((await torn.append(record('b'))).seq).toBe(2);
		expect(await readFile(path, 'utf8')).toMatch(/^\{.*"a".*\}\n\{.*"b".*\}\n$/);

		await writeFile(path, complete.trimEnd());
		const unterminated = new FileJournalSink(path);
		expect((await unterminated.append(record('c'))).seq).toBe(2);
		expect(parseJournal(await readFile(path, 'utf8')).map((entry) => entry.command)).toEqual([
			'a',
			'c',
		]);
	});
});
