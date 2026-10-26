/**
 * @fileoverview Replay command
 *
 * Replays a JSON Lines command journal (see `spec/journal.md`) against a fresh registry
 * loaded in-process from a module, and reports per entry whether the result is the same.
 *
 * Replay runs in-process only. Over MCP the CLI could not hand the server the recorded
 * clock, random values, actor or trace ID, so every time- or random-dependent result would
 * diverge, and the mutations would be re-run against a long-lived server's state.
 */

import { open, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type JournalEntry, parseJournal } from '@lushly-dev/afd-core';
import type { JournalReplayTarget, ReplayJournalOptions } from '@lushly-dev/afd-server';
import chalk from 'chalk';
import { type Command, InvalidArgumentError, Option } from 'commander';
import { type OutputFormat, printError } from '../output.js';
import { terminalText } from '../terminal.js';
import { collectValues } from './options.js';
import { printReplayReport } from './replay-output.js';

/** Default bounds on the journal file, so an untrusted file cannot exhaust memory. */
export const REPLAY_LIMITS = {
	/** Largest journal file read, in bytes. */
	maxFileBytes: 64 * 1024 * 1024,
	/** Longest journal line, in UTF-8 bytes. */
	maxLineBytes: 1024 * 1024,
	/** Most entries in the journal. */
	maxEntries: 10_000,
} as const;

/** Result paths always left out of the comparison: timing differs on every run. */
const ALWAYS_IGNORED = ['metadata.executionTimeMs'];

/** Exit code when the journal or the module could not be loaded, as opposed to diverging. */
export const REPLAY_SETUP_EXIT_CODE = 2;

/** An error with a recovery hint, reported before anything is replayed. */
export class ReplaySetupError extends Error {
	constructor(
		message: string,
		readonly suggestion: string
	) {
		super(message);
		this.name = 'ReplaySetupError';
	}
}

export interface JournalFileLimits {
	maxFileBytes?: number;
	maxLineBytes?: number;
	maxEntries?: number;
}

/**
 * Read and parse a JSON Lines journal, rejecting it before parsing when the file, a line or
 * the entry count exceeds `limits`.
 */
export async function readJournalFile(
	path: string,
	limits: JournalFileLimits = {}
): Promise<JournalEntry[]> {
	const maxFileBytes = limits.maxFileBytes ?? REPLAY_LIMITS.maxFileBytes;
	const maxLineBytes = limits.maxLineBytes ?? REPLAY_LIMITS.maxLineBytes;
	const maxEntries = limits.maxEntries ?? REPLAY_LIMITS.maxEntries;

	const text = await readBounded(path, maxFileBytes);
	const lines = text.split('\n');
	let count = 0;
	for (const [index, line] of lines.entries()) {
		if (line.trim() === '') continue;
		if (Buffer.byteLength(line, 'utf8') > maxLineBytes) {
			throw new ReplaySetupError(
				`Journal line ${index + 1} is over the ${maxLineBytes}-byte line limit`,
				'Raise --max-line-bytes if the journal is trusted'
			);
		}
		if (++count > maxEntries) {
			throw new ReplaySetupError(
				`Journal has more than ${maxEntries} entries`,
				'Raise --max-entries if the journal is trusted (--from/--to apply after this limit)'
			);
		}
	}

	try {
		return parseJournal(text);
	} catch (error) {
		throw new ReplaySetupError(
			(error as Error).message,
			'Check that the file is a JSON Lines journal written by createJournalMiddleware'
		);
	}
}

/**
 * The text of the regular file at `path`, reading at most `maxBytes + 1` bytes, so a FIFO, a
 * device or a file that grows while it is read cannot exhaust memory.
 */
async function readBounded(path: string, maxBytes: number): Promise<string> {
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(path, 'r');
		if (!(await handle.stat()).isFile()) {
			throw new ReplaySetupError(`Journal ${path} is not a regular file`, 'Pass a journal file');
		}
		const buffer = Buffer.alloc(maxBytes + 1);
		let length = 0;
		while (length < buffer.length) {
			const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
			if (bytesRead === 0) break;
			length += bytesRead;
		}
		if (length > maxBytes) {
			throw new ReplaySetupError(
				`Journal ${path} is over the ${maxBytes}-byte limit`,
				'Replay a smaller journal'
			);
		}
		return buffer.toString('utf8', 0, length);
	} catch (error) {
		if (error instanceof ReplaySetupError) throw error;
		throw new ReplaySetupError(
			`Cannot read journal ${path}: ${(error as Error).message}`,
			'Check the journal path and its permissions'
		);
	} finally {
		await handle?.close();
	}
}

type ServerModule = typeof import('@lushly-dev/afd-server');

/**
 * The `@lushly-dev/afd-server` the module at `modulePath` would import, falling back to the
 * CLI's own copy. Since #441 every copy shares the replay marker (a registered symbol), so any
 * copy's `replayJournal()` works; using the registry's copy is a fallback for a project still on
 * an afd-server whose marker was private to its copy, whose journal middleware would otherwise
 * record the replayed calls.
 */
export async function importServerFor(modulePath: string): Promise<ServerModule> {
	let dir = dirname(resolve(modulePath));
	for (;;) {
		const packageDir = join(dir, 'node_modules', '@lushly-dev', 'afd-server');
		const entry = await readFile(join(packageDir, 'package.json'), 'utf8').then(
			(text) => {
				const manifest = JSON.parse(text) as {
					exports?: { '.'?: { import?: unknown } };
					main?: unknown;
				};
				const target = manifest.exports?.['.']?.import ?? manifest.main;
				return typeof target === 'string' ? target : undefined;
			},
			() => undefined
		);
		if (entry !== undefined) {
			return (await import(pathToFileURL(join(packageDir, entry)).href)) as ServerModule;
		}
		const parent = dirname(dir);
		if (parent === dir) return import('@lushly-dev/afd-server');
		dir = parent;
	}
}

function isReplayTarget(value: unknown): value is JournalReplayTarget {
	return (
		!!value &&
		(typeof value === 'object' || typeof value === 'function') &&
		typeof (value as { execute?: unknown }).execute === 'function'
	);
}

/**
 * Import `modulePath` and return a fresh registry from its `exportName` export: either a
 * registry (anything with `execute(name, input, context)`) or a function, possibly async,
 * that returns one. A factory is called once per replay, so the registry starts empty.
 */
export async function loadReplayTarget(
	modulePath: string,
	exportName = 'default'
): Promise<JournalReplayTarget> {
	let mod: Record<string, unknown>;
	try {
		mod = (await import(pathToFileURL(resolve(modulePath)).href)) as Record<string, unknown>;
	} catch (error) {
		throw new ReplaySetupError(
			`Cannot import ${modulePath}: ${(error as Error).message}`,
			'Pass a JavaScript module Node can import (build TypeScript first)'
		);
	}
	const exported = mod[exportName];
	if (exported === undefined) {
		throw new ReplaySetupError(
			`${modulePath} has no "${exportName}" export`,
			'Export a registry factory as default, or name it with --export'
		);
	}
	let target: unknown = exported;
	if (typeof exported === 'function' && !isReplayTarget(exported)) {
		try {
			target = await (exported as () => unknown)();
		} catch (error) {
			throw new ReplaySetupError(
				`The "${exportName}" factory in ${modulePath} threw: ${(error as Error).message}`,
				'Fix the factory so it returns a fresh registry'
			);
		}
	}
	if (!isReplayTarget(target)) {
		throw new ReplaySetupError(
			`The "${exportName}" export of ${modulePath} is not a registry`,
			'Export createMcpServer(...) or a function returning it: anything with execute(name, input, context)'
		);
	}
	return target;
}

interface ReplayCliOptions {
	module: string;
	export: string;
	ignore: string[];
	seed?: string;
	stopOnDivergence?: boolean;
	from?: number;
	to?: number;
	maxEntries: number;
	maxLineBytes: number;
	format: OutputFormat;
	verbose?: boolean;
}

function positiveInteger(value: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1) {
		throw new InvalidArgumentError('Expected a positive integer.');
	}
	return number;
}

/**
 * Register the replay command.
 */
export function registerReplayCommand(program: Command): void {
	program
		.command('replay')
		.description('Replay a command journal against a fresh in-process registry and diff results')
		.argument('<file>', 'JSON Lines journal (see spec/journal.md)')
		.requiredOption(
			'-m, --module <path>',
			'JavaScript module exporting a registry or a factory returning one'
		)
		.option('--export <name>', 'Export to use from --module', 'default')
		.option(
			'--ignore <path>',
			'Result path left out of the comparison, e.g. data.updatedAt (repeatable)',
			collectValues,
			[]
		)
		.option('--seed <seed>', 'Seed for random values an entry has no recording for')
		.option('--stop-on-divergence', 'Stop after the first entry that is not the same')
		.option('--from <seq>', 'First seq to replay', positiveInteger)
		.option('--to <seq>', 'Last seq to replay', positiveInteger)
		.option(
			'--max-entries <n>',
			'Most journal entries accepted',
			positiveInteger,
			REPLAY_LIMITS.maxEntries
		)
		.option(
			'--max-line-bytes <n>',
			'Longest journal line accepted, in bytes',
			positiveInteger,
			REPLAY_LIMITS.maxLineBytes
		)
		.addOption(
			new Option('-f, --format <format>', 'Output format').choices(['json', 'text']).default('text')
		)
		.option('-v, --verbose', 'Also list entries that replayed the same')
		.addHelpText(
			'after',
			`
Replay runs in-process: the CLI imports --module and replays each entry with
its recorded clock readings, random values, actor, interface and trace ID.
A factory export is called once, so the registry starts fresh; give it the
same middleware as the recording server. Replaying over MCP is not supported:
a remote server cannot be given the recorded clock and random values.

Replay executes the journal's commands against the module's real handlers:
replay only journals you trust, or give the registry fake dependencies.
--from/--to start from a fresh registry, so state from earlier entries is
missing and may cause divergence.

Exit codes: 0 every entry is the same, 1 an entry differed or threw (or the
command line was invalid), 2 the journal or the module could not be loaded.`
		)
		.action(async (file: string, options: ReplayCliOptions) => {
			const code = await runReplay(file, options);
			// Exit explicitly, since the loaded module may hold handles open, but only once
			// stdout has flushed: a large JSON report on a pipe would otherwise be cut off.
			process.stdout.write('', () => process.exit(code));
		});
}

/** Run a replay and print its report. Returns the process exit code. */
export async function runReplay(file: string, options: ReplayCliOptions): Promise<number> {
	let entries: JournalEntry[];
	let target: JournalReplayTarget;
	try {
		if (options.from !== undefined && options.to !== undefined && options.from > options.to) {
			throw new ReplaySetupError(
				`--from ${options.from} is after --to ${options.to}`,
				'Pass a range with --from <= --to'
			);
		}
		const all = await readJournalFile(file, {
			maxEntries: options.maxEntries,
			maxLineBytes: options.maxLineBytes,
		});
		const from = options.from ?? 1;
		const to = options.to ?? Number.POSITIVE_INFINITY;
		entries = all.filter((entry) => entry.seq >= from && entry.seq <= to);
		if (entries.length === 0) {
			throw new ReplaySetupError(
				all.length === 0
					? `Journal ${file} has no entries`
					: 'No journal entries in the --from/--to range',
				'Check the journal file and the seq range'
			);
		}
		target = await loadReplayTarget(options.module, options.export);
	} catch (error) {
		printSetupError(error, options.format);
		return REPLAY_SETUP_EXIT_CODE;
	}

	const replayOptions: ReplayJournalOptions = {
		ignore: [...ALWAYS_IGNORED, ...options.ignore],
		...(options.seed !== undefined ? { seed: options.seed } : {}),
		stopOnDivergence: options.stopOnDivergence === true,
	};
	const { replayJournal } = await importServerFor(options.module);
	const report = await replayJournal(target, entries, replayOptions);
	printReplayReport(report, { format: options.format, verbose: options.verbose });
	return report.diverged ? 1 : 0;
}

function printSetupError(error: unknown, format: OutputFormat): void {
	const message = error instanceof Error ? error.message : String(error);
	const suggestion = error instanceof ReplaySetupError ? error.suggestion : undefined;
	if (format === 'json') {
		console.log(
			JSON.stringify(
				{ error: { code: 'REPLAY_SETUP_FAILED', message, ...(suggestion ? { suggestion } : {}) } },
				null,
				2
			)
		);
		return;
	}
	printError(message);
	if (suggestion) console.error(chalk.dim('Suggestion:'), terminalText(suggestion));
}
