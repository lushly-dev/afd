import { describe, expect, it } from 'vitest';
import type { CommandContext } from './commands.js';
import {
	createContextDigest,
	isJournalEntry,
	type JournalEntry,
	type JournalRecord,
	journalActor,
	MemoryJournalSink,
	parseJournal,
	serializeJournal,
	serializeJournalEntry,
} from './journal.js';

function record(command: string, overrides: Partial<JournalRecord> = {}): JournalRecord {
	return {
		timestamp: '2026-01-01T00:00:00.000Z',
		command,
		input: {},
		contextDigest: { hash: 'sha256:00' },
		result: { success: true, data: null },
		durationMs: 0,
		...overrides,
	};
}

describe('MemoryJournalSink', () => {
	it('assigns seq from 1 and reads ranges inclusively', async () => {
		const sink = new MemoryJournalSink();
		const first = await sink.append(record('a'));
		await sink.append(record('b'));
		await sink.append(record('c'));

		expect(first.seq).toBe(1);
		expect((await sink.read()).map((entry) => entry.command)).toEqual(['a', 'b', 'c']);
		expect((await sink.read({ from: 2 })).map((entry) => entry.seq)).toEqual([2, 3]);
		expect((await sink.read({ to: 2 })).map((entry) => entry.seq)).toEqual([1, 2]);
		expect((await sink.read({ from: 2, to: 2 })).map((entry) => entry.seq)).toEqual([2]);
	});

	it('continues the numbering of initial entries', async () => {
		const sink = new MemoryJournalSink([{ seq: 7, ...record('old') }]);
		expect((await sink.append(record('new'))).seq).toBe(8);
	});
});

describe('createContextDigest', () => {
	const secrets = {
		authToken: 'tok_live_SECRET',
		session: { userId: 'u1', accessToken: 'SESSION-SECRET' },
	};

	it('keeps the interface, and hashes the allowlist plus key names only', async () => {
		const context: CommandContext = {
			traceId: 't-1',
			interface: 'mcp',
			actor: { kind: 'human', id: 'u1' },
			...secrets,
		};
		const digest = await createContextDigest(context);

		expect(digest.interface).toBe('mcp');
		expect(digest.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(JSON.stringify(digest)).not.toMatch(/SECRET|u1|t-1/);
	});

	it('ignores the values of keys outside the allowlist', async () => {
		const base: CommandContext = { traceId: 't', authToken: 'one' };
		const same = await createContextDigest({ traceId: 't', authToken: 'two' });
		expect((await createContextDigest(base)).hash).toBe(same.hash);
	});

	it('changes with allowlisted values and with the context shape', async () => {
		const base = await createContextDigest({ traceId: 't', actor: { kind: 'agent' } });
		const otherTrace = await createContextDigest({ traceId: 'u', actor: { kind: 'agent' } });
		const otherActor = await createContextDigest({ traceId: 't', actor: { kind: 'human' } });
		const extraKey = await createContextDigest({
			traceId: 't',
			actor: { kind: 'agent' },
			session: {},
		});
		expect(new Set([base.hash, otherTrace.hash, otherActor.hash, extraKey.hash]).size).toBe(4);
	});
});

describe('journalActor', () => {
	it('keeps only the four actor fields', () => {
		const actor = { kind: 'human', id: 'u1', label: 'Ada', password: 'hunter2' };
		expect(journalActor(actor)).toEqual({ kind: 'human', id: 'u1', label: 'Ada' });
		expect(journalActor({ kind: 'robot' })).toBeUndefined();
		expect(journalActor(undefined)).toBeUndefined();
	});
});

describe('JSON Lines', () => {
	const entries: JournalEntry[] = [
		{ seq: 1, ...record('a', { input: { text: 'line one\nline two' } }) },
		{
			seq: 2,
			...record('b', {
				traceId: 't',
				actor: { kind: 'agent' },
				tape: { clock: [1, 2], random: [0.5] },
			}),
		},
	];

	it('writes one line per entry and parses it back', () => {
		const text = serializeJournal(entries);
		expect(text.split('\n')).toHaveLength(3);
		expect(text.endsWith('\n')).toBe(true);
		expect(parseJournal(text)).toEqual(entries);
		expect(serializeJournalEntry(entries[0] as JournalEntry)).not.toContain('\n');
	});

	it('accepts CRLF and blank lines', () => {
		const text = `\r\n${serializeJournal(entries).replaceAll('\n', '\r\n')}\r\n`;
		expect(parseJournal(text)).toEqual(entries);
	});

	it('names the line that is not JSON or not an entry', () => {
		const good = serializeJournalEntry(entries[0] as JournalEntry);
		expect(() => parseJournal(`${good}\n{not json`)).toThrow(/line 2 is not valid JSON/);
		expect(() => parseJournal(`${good}\n{"seq":2}`)).toThrow(/line 2 is not a journal entry/);
	});

	it('checks the entry shape', () => {
		const valid = entries[1] as JournalEntry;
		expect(isJournalEntry(valid)).toBe(true);
		expect(isJournalEntry({ ...valid, seq: 0 })).toBe(false);
		expect(isJournalEntry({ ...valid, actor: { kind: 'robot' } })).toBe(false);
		expect(isJournalEntry({ ...valid, tape: { clock: ['x'], random: [] } })).toBe(false);
		expect(isJournalEntry({ ...valid, result: {} })).toBe(false);
		const { input: _input, ...withoutInput } = valid;
		expect(isJournalEntry(withoutInput)).toBe(false);
	});
});
