import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JournalEntry } from '@lushly-dev/afd-core';
import { serializeJournal } from '@lushly-dev/afd-core';
import type { ReplayReport } from '@lushly-dev/afd-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCli } from '../cli.js';
import {
	importServerFor,
	loadReplayTarget,
	REPLAY_SETUP_EXIT_CODE,
	ReplaySetupError,
	readJournalFile,
	runReplay,
} from './replay.js';
import { formatDifference, formatDiffValue, printReplayReport } from './replay-output.js';

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'afd-cli-replay-'));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(dir, { recursive: true, force: true });
});

function entry(seq: number, data: unknown, command = 'echo'): JournalEntry {
	return {
		seq,
		timestamp: '2026-01-01T00:00:00.000Z',
		command,
		input: { value: data },
		contextDigest: { hash: 'sha256:0' },
		result: { success: true, data },
		durationMs: 0,
	};
}

async function writeJournal(text: string, name = 'journal.jsonl'): Promise<string> {
	const path = join(dir, name);
	await writeFile(path, text);
	return path;
}

/** A registry module whose `echo` command returns its input value. */
async function writeEchoModule(body?: string): Promise<string> {
	const path = join(dir, `registry-${Math.random().toString(36).slice(2)}.mjs`);
	await writeFile(
		path,
		body ??
			`export default () => ({
	async execute(name, input) {
		if (name === 'boom') throw new Error('handler blew up');
		return { success: true, data: input.value };
	},
});`
	);
	return path;
}

const baseOptions = {
	export: 'default',
	ignore: [] as string[],
	maxEntries: 100,
	maxLineBytes: 10_000,
	format: 'json' as const,
};

function captureLog(): () => string {
	const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
	return () => log.mock.calls.map((call) => call.join(' ')).join('\n');
}

describe('readJournalFile', () => {
	it('parses a journal, skipping blank lines', async () => {
		const path = await writeJournal(`${serializeJournal([entry(1, 'a')])}\n\n`);
		expect((await readJournalFile(path)).map((e) => e.seq)).toEqual([1]);
	});

	it('rejects a line over the line limit before parsing it', async () => {
		const path = await writeJournal(serializeJournal([entry(1, 'x'.repeat(200))]));
		await expect(readJournalFile(path, { maxLineBytes: 100 })).rejects.toThrow(
			'Journal line 1 is over the 100-byte line limit'
		);
	});

	it('rejects more entries than the limit', async () => {
		const path = await writeJournal(
			serializeJournal([entry(1, 'a'), entry(2, 'b'), entry(3, 'c')])
		);
		await expect(readJournalFile(path, { maxEntries: 2 })).rejects.toThrow(
			'Journal has more than 2 entries'
		);
	});

	it('rejects a file over the size limit', async () => {
		const path = await writeJournal(serializeJournal([entry(1, 'a')]));
		await expect(readJournalFile(path, { maxFileBytes: 10 })).rejects.toThrow(
			'over the 10-byte limit'
		);
	});

	it('reports the parser error for a line that is not a journal entry', async () => {
		const path = await writeJournal('{"seq":1}\n');
		const error = await readJournalFile(path).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ReplaySetupError);
		expect((error as Error).message).toBe('Journal line 1 is not a journal entry');
	});

	it('rejects a directory with a suggestion', async () => {
		const error = await readJournalFile(dir).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ReplaySetupError);
		expect((error as Error).message).toContain('is not a regular file');
	});

	it('reports a missing file', async () => {
		await expect(readJournalFile(join(dir, 'missing.jsonl'))).rejects.toThrow(
			'Cannot read journal'
		);
	});
});

describe('loadReplayTarget', () => {
	it('calls a factory export, sync or async', async () => {
		const sync = await loadReplayTarget(await writeEchoModule());
		expect(await sync.execute('echo', { value: 1 })).toEqual({ success: true, data: 1 });
		const asyncPath = await writeEchoModule(
			'export const make = async () => ({ execute: async () => ({ success: true }) });'
		);
		const target = await loadReplayTarget(asyncPath, 'make');
		expect(await target.execute('x', {})).toEqual({ success: true });
	});

	it('accepts a registry object export', async () => {
		const path = await writeEchoModule(
			'export default { execute: async () => ({ success: true, data: "object" }) };'
		);
		expect(await (await loadReplayTarget(path)).execute('x', {})).toMatchObject({ data: 'object' });
	});

	it.each([
		['a missing export', 'export const other = 1;', 'has no "default" export'],
		['a non-registry export', 'export default { run() {} };', 'is not a registry'],
		['a throwing factory', 'export default () => { throw new Error("no db"); };', 'threw: no db'],
		['a module that fails to import', 'throw new Error("bad module");', 'Cannot import'],
	])('rejects %s', async (_label, body, message) => {
		const path = await writeEchoModule(body);
		await expect(loadReplayTarget(path)).rejects.toThrow(message);
	});
});

describe('importServerFor', () => {
	it("prefers the module's own afd-server, falling back to the CLI's", async () => {
		const own = join(dir, 'node_modules', '@lushly-dev', 'afd-server');
		await mkdir(own, { recursive: true });
		await writeFile(
			join(own, 'package.json'),
			JSON.stringify({ exports: { '.': { import: './entry.mjs' } } })
		);
		await writeFile(join(own, 'entry.mjs'), 'export const marker = "own copy";');
		await mkdir(join(dir, 'app'));
		const server = (await importServerFor(join(dir, 'app', 'registry.mjs'))) as unknown as {
			marker?: string;
		};
		expect(server.marker).toBe('own copy');

		const fallback = await importServerFor(join(tmpdir(), 'no-such-dir', 'registry.mjs'));
		expect(typeof fallback.replayJournal).toBe('function');
	});
});

describe('runReplay', () => {
	it('returns 0 and prints the JSON report when every entry is the same', async () => {
		const output = captureLog();
		const journal = await writeJournal(serializeJournal([entry(1, 'a'), entry(2, 'b')]));
		const code = await runReplay(journal, { ...baseOptions, module: await writeEchoModule() });
		expect(code).toBe(0);
		const report = JSON.parse(output()) as ReplayReport;
		expect(report).toMatchObject({ same: 2, different: 0, errors: 0, diverged: false });
	});

	it('returns 1 on a difference or an error, and honours --ignore and the seq range', async () => {
		const output = captureLog();
		const recorded = entry(2, 'b');
		recorded.result = { success: true, data: 'recorded' };
		const journal = await writeJournal(
			serializeJournal([entry(1, 'a'), recorded, entry(3, null, 'boom')])
		);
		const module = await writeEchoModule();

		expect(await runReplay(journal, { ...baseOptions, module })).toBe(1);
		const report = JSON.parse(output()) as ReplayReport;
		expect(report.entries.map((e) => e.status)).toEqual(['same', 'different', 'error']);
		expect(report.entries[1]?.differences).toEqual([
			{ path: 'data', kind: 'changed', recorded: 'recorded', replayed: 'b' },
		]);

		expect(await runReplay(journal, { ...baseOptions, module, ignore: ['data'], to: 2 })).toBe(0);
	});

	it('stops at the first divergence with --stop-on-divergence', async () => {
		const output = captureLog();
		const first = entry(1, 'a');
		first.result = { success: true, data: 'other' };
		const journal = await writeJournal(serializeJournal([first, entry(2, 'b')]));
		const code = await runReplay(journal, {
			...baseOptions,
			module: await writeEchoModule(),
			stopOnDivergence: true,
		});
		expect(code).toBe(1);
		expect(JSON.parse(output())).toMatchObject({ different: 1, skipped: 1 });
	});

	it('returns the setup exit code with a JSON error for a bad journal, range or module', async () => {
		const output = captureLog();
		const journal = await writeJournal(serializeJournal([entry(1, 'a')]));
		const module = await writeEchoModule();

		expect(await runReplay(join(dir, 'missing.jsonl'), { ...baseOptions, module })).toBe(
			REPLAY_SETUP_EXIT_CODE
		);
		expect(await runReplay(journal, { ...baseOptions, module, from: 5 })).toBe(
			REPLAY_SETUP_EXIT_CODE
		);
		expect(await runReplay(journal, { ...baseOptions, module, from: 3, to: 2 })).toBe(
			REPLAY_SETUP_EXIT_CODE
		);
		expect(await runReplay(journal, { ...baseOptions, module: join(dir, 'missing.mjs') })).toBe(
			REPLAY_SETUP_EXIT_CODE
		);
		expect(output()).toContain('"code": "REPLAY_SETUP_FAILED"');
		expect(output()).toContain('No journal entries in the --from/--to range');
	});

	it('prints setup errors with a suggestion in text mode', async () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const journal = await writeJournal('');
		const code = await runReplay(journal, {
			...baseOptions,
			format: 'text',
			module: await writeEchoModule(),
		});
		expect(code).toBe(REPLAY_SETUP_EXIT_CODE);
		const text = errors.mock.calls.map((call) => call.join(' ')).join('\n');
		expect(text).toContain('has no entries');
		expect(text).toContain('Suggestion: Check the journal file and the seq range');
	});
});

describe('afd replay invocation', () => {
	it('requires --module and rejects a non-integer --from while parsing', async () => {
		const program = createCli().exitOverride();
		for (const command of program.commands) command.exitOverride();
		vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		await expect(program.parseAsync(['replay', 'journal.jsonl'], { from: 'user' })).rejects.toThrow(
			"required option '-m, --module <path>' not specified"
		);
		await expect(
			program.parseAsync(['replay', 'journal.jsonl', '-m', 'r.mjs', '--from', '0'], {
				from: 'user',
			})
		).rejects.toThrow('Expected a positive integer.');
	});

	it('exits with the replay result', async () => {
		captureLog();
		const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
		const journal = await writeJournal(serializeJournal([entry(1, 'a')]));
		await createCli().parseAsync(
			['replay', journal, '--module', await writeEchoModule(), '--format', 'json'],
			{ from: 'user' }
		);
		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
	});
});

describe('replay text output', () => {
	const report: ReplayReport = {
		entries: [
			{ seq: 1, command: 'echo', status: 'same', recorded: { success: true } },
			{
				seq: 2,
				command: 'echo\x1b[2J',
				status: 'different',
				recorded: { success: true },
				differences: [
					{ path: 'data.a', kind: 'changed', recorded: 1, replayed: 2 },
					{ path: 'data.\x1b]0;x\x07', kind: 'changed', recorded: '\x9b2J', replayed: 'ok' },
					{ path: 'data.b', kind: 'added', replayed: 'new' },
					{ path: 'data.c', kind: 'removed', recorded: 'old' },
				],
				notes: ['random: the replay read 0 of 1 recorded values'],
			},
			{
				seq: 3,
				command: 'boom',
				status: 'error',
				recorded: { success: true },
				error: 'blew up\x1b[2J',
			},
		],
		same: 1,
		different: 1,
		errors: 1,
		diverged: true,
		skipped: 2,
	};

	it('lists entries that are not the same, with differences, errors, notes and a summary', () => {
		const output = captureLog();
		printReplayReport(report);
		const text = output();
		expect(text).not.toContain('#1 echo');
		for (const control of ['\x1b', '\x07', '\x9b']) expect(text).not.toContain(control);
		expect(text).toContain('✗ #2 echo');
		expect(text).toContain('~ data.a: 1 → 2');
		expect(text).toContain('+ data.b: "new"');
		expect(text).toContain('- data.c: "old"');
		expect(text).toContain('note: random: the replay read 0 of 1 recorded values');
		expect(text).toContain('! #3 boom error');
		expect(text).toContain('Error: blew up');
		expect(text).toContain(
			'✗ Replay diverged: 3 entries replayed, 1 same, 1 different, 1 error, 2 skipped'
		);
	});

	it('lists same entries with verbose', () => {
		const output = captureLog();
		printReplayReport(report, { verbose: true });
		expect(output()).toContain('✓ #1 echo same');
	});

	it('shortens long values and names the whole result', () => {
		expect(formatDiffValue('x'.repeat(200))).toHaveLength(81);
		expect(formatDiffValue(undefined)).toBe('undefined');
		expect(formatDifference({ path: '', kind: 'changed', recorded: 1, replayed: 2 })).toContain(
			'(result)'
		);
	});
});
