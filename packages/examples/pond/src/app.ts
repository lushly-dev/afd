/**
 * @fileoverview The event-sourced host: the journal is the pond's only stored state.
 *
 * Every successful call of a command that changes the pond is appended to a JSON Lines file by
 * `createJournalMiddleware` and a `FileJournalSink`. On start, a fresh pond is built by
 * replaying that file with `replayJournal`, which hands each call the clock readings and
 * random values its tape recorded. The replay also compares each result with the recorded one,
 * so a handler that is not deterministic is caught on start instead of silently giving a
 * different pond.
 *
 * This is an application architecture built on the journal; AFD does not require it.
 */

import {
	type Clock,
	type CommandContext,
	type CommandResult,
	failure,
	type RandomSource,
} from '@lushly-dev/afd-core';
import { FileJournalSink } from '@lushly-dev/afd-core/journal-file';
import {
	createDirectRegistry,
	createJournalMiddleware,
	type ReplayReport,
	replayJournal,
} from '@lushly-dev/afd-server';
import { createPondCommands } from './commands.js';
import { MAX_RANDOM_READS, Pond } from './pond.js';

export interface OpenPondOptions {
	/** The journal file. Created on the first change; continued when it exists. */
	journalPath: string;
	/** The clock for new calls. Default: the system clock. Replay never reads it. */
	clock?: Clock;
	/** The random source for new calls. Default: `Math.random()`. Replay never reads it. */
	random?: RandomSource;
}

export interface OpenedPond {
	/** The rebuilt pond. Read it; change it only through {@link OpenedPond.run}. */
	pond: Pond;
	/** How the journal replayed: every entry `same` when the pond was rebuilt faithfully. */
	replay: ReplayReport;
	/** Run a command. Calls run one at a time, in the order they were made. */
	run<T = unknown>(name: string, input?: unknown): Promise<CommandResult<T>>;
}

/** The journal does not replay to the results it recorded, so the rebuilt pond cannot be trusted. */
export class PondReplayError extends Error {
	constructor(
		readonly journalPath: string,
		readonly report: ReplayReport
	) {
		const first = report.entries.find((entry) => entry.status !== 'same');
		super(
			`The journal ${journalPath} did not replay: entry ${first?.seq} (${first?.command}) was ${first?.status}` +
				(first?.notes?.length ? ` (${first.notes.join('; ')})` : '')
		);
		this.name = 'PondReplayError';
	}
}

function stale(error: Error): CommandResult<never> {
	return failure({
		code: 'JOURNAL_WRITE_FAILED',
		message: `The journal could not be written (${error.message}), so the pond in memory is ahead of it`,
		suggestion:
			'Fix the journal file or its directory, then open the pond again to rebuild it from the journal',
		retryable: false,
	});
}

/**
 * Open the pond kept in `journalPath`: replay its journal into a fresh pond, then record every
 * new change to the same file.
 *
 * @throws PondReplayError when an entry replays to a different result than it recorded
 */
export async function openPond(options: OpenPondOptions): Promise<OpenedPond> {
	const pond = new Pond();
	const commands = createPondCommands(pond);
	// Only commands that change the pond are journaled; reads add nothing to rebuild from.
	const mutations = new Set(commands.filter((command) => command.mutation).map((c) => c.name));
	const sink = new FileJournalSink(options.journalPath);
	// A failed append leaves the pond ahead of its journal: the change would be lost on restart.
	let journalError: Error | undefined;
	const journal = createJournalMiddleware(sink, {
		filter: (name) => mutations.has(name),
		// The default keeps 1000 reads per call; a long tick on a full pond reads more, and a
		// truncated tape cannot be replayed.
		maxTapeReads: MAX_RANDOM_READS,
		onError: (error) => {
			journalError ??= error;
		},
	});
	// The journal goes last in the list, so the tape holds only what the handler read.
	const registry = createDirectRegistry(commands, { middleware: [journal] });

	// The journal middleware records nothing while replayJournal runs the same registry.
	const entries = await sink.read();
	const replay = await replayJournal(registry, entries, { stopOnDivergence: true });
	if (replay.diverged) throw new PondReplayError(options.journalPath, replay);

	const context = (): CommandContext => ({
		...(options.clock ? { clock: options.clock } : {}),
		...(options.random ? { random: options.random } : {}),
	});
	// One call at a time: the journal's order must be the order the pond changed in.
	let queue: Promise<unknown> = Promise.resolve();
	const run = <T>(name: string, input: unknown = {}): Promise<CommandResult<T>> => {
		const call = queue.then(async (): Promise<CommandResult<T>> => {
			if (journalError) return stale(journalError);
			const result = await registry.execute<T>(name, input, context());
			// This call changed the pond but was not recorded: say so instead of reporting success.
			if (journalError) return stale(journalError);
			return result;
		});
		queue = call.catch(() => {});
		return call;
	};

	return { pond, replay, run };
}
