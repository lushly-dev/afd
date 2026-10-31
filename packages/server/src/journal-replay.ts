/**
 * @fileoverview Replay a command journal against a registry and diff the results.
 *
 * Replay restores the clock and random values each call read (its tape) and reports, per
 * entry, whether the result is the same. It does not make handlers deterministic: any other
 * nondeterminism (I/O, global state, `Date.now()` read directly) shows up as divergence.
 */

import type {
	Clock,
	CommandContext,
	CommandResult,
	JournalEntry,
	RandomSource,
} from '@lushly-dev/afd-core';
import { fixedClock, journalActor, seededRandom } from '@lushly-dev/afd-core';
import { JOURNAL_REPLAY, type JournalReplayMarker } from './journal.js';

/** Anything that executes commands by name: `createMcpServer()`, `createDirectRegistry()`, the core registry. */
export interface JournalReplayTarget {
	execute(name: string, input: unknown, context?: CommandContext): Promise<CommandResult>;
	/**
	 * The context fields the target declares. When given, a recorded field it no longer declares
	 * is dropped with a note; when absent, every recorded field is restored.
	 */
	readonly contextFields?: readonly { name: string }[];
}

/** Options for {@link replayJournal}. */
export interface ReplayJournalOptions {
	/**
	 * Extra context for each call, e.g. a fresh database. Its values win over the restored
	 * trace ID, actor, interface, clock and random source.
	 */
	context?: CommandContext | ((entry: JournalEntry) => CommandContext);
	/**
	 * Exact result paths left out of the comparison, with everything under them, such as
	 * `metadata`, `metadata.executionTimeMs` or `data.items[0].updatedAt` (no wildcards).
	 * Default: `['metadata.executionTimeMs']`.
	 */
	ignore?: readonly string[];
	/**
	 * Seed for random numbers an entry has no recorded values for (no tape, or more reads
	 * than the tape holds). Entry `seq` is appended, so each entry gets its own sequence.
	 * Default `'afd-replay'`.
	 */
	seed?: string;
	/** Stop after the first entry that is not `same`. Default `false`. */
	stopOnDivergence?: boolean;
	/** Most differences listed per entry. Default 100. */
	maxDifferences?: number;
}

/** How a replayed entry compares with the recording. */
export type ReplayStatus = 'same' | 'different' | 'error';

/** One difference between the recorded and the replayed result. */
export interface ReplayDifference {
	/** Where, e.g. `data.title` or `data.items[2]`. Empty for the whole result. */
	path: string;
	/** `changed`: both have a value. `added`: only the replay has one. `removed`: only the recording. */
	kind: 'changed' | 'added' | 'removed';
	/** The recorded value. Absent for `added`. */
	recorded?: unknown;
	/** The replayed value. Absent for `removed`. */
	replayed?: unknown;
}

/** The outcome of replaying one entry. */
export interface ReplayEntryReport {
	seq: number;
	command: string;
	status: ReplayStatus;
	/** The result in the journal. */
	recorded: CommandResult;
	/** The result of the replay. Absent when `status` is `error`. */
	replayed?: CommandResult;
	/** Present when `status` is `different`. */
	differences?: ReplayDifference[];
	/** Why the replay threw. Present when `status` is `error`. */
	error?: string;
	/** What replay could not restore, e.g. a tape that ran out. Hints for a divergence. */
	notes?: string[];
}

/** The outcome of {@link replayJournal}. */
export interface ReplayReport {
	/** One report per replayed entry, in `seq` order. */
	entries: ReplayEntryReport[];
	same: number;
	different: number;
	errors: number;
	/** Whether any entry was not `same`. */
	diverged: boolean;
	/** Entries not replayed because `stopOnDivergence` stopped the run. */
	skipped: number;
}

const DEFAULT_IGNORE = ['metadata.executionTimeMs'];
const DEFAULT_MAX_DIFFERENCES = 100;

/** A replay source: what was read from the tape, and a way to start it over. */
interface TapeSource {
	/** Start over from the first value: the journal middleware calls this at its own position. */
	rewind(): void;
	/** How many tape values were read since the last rewind. */
	used(): number;
	/** Whether more values were read than the tape holds, before {@link TapeSource.end}. */
	overran(): boolean;
	/** Stop counting reads: later ones come from middleware outside the journal's position. */
	end(): void;
}

/** Replays the recorded clock readings, then holds the last one. */
function tapeClock(readings: readonly number[], start: number): Clock & TapeSource {
	let index = 0;
	let last = start;
	let overran = false;
	let ended = false;
	return {
		now() {
			if (ended) return last;
			if (index < readings.length) last = readings[index++] as number;
			else overran = true;
			return last;
		},
		rewind() {
			index = 0;
			last = start;
			overran = false;
			ended = false;
		},
		end() {
			ended = true;
		},
		used: () => index,
		overran: () => overran,
	};
}

/** Replays the recorded random values, then continues with a source seeded with `seed`. */
function tapeRandom(values: readonly number[], seed: string): RandomSource & TapeSource {
	let index = 0;
	let overran = false;
	let fallback = seededRandom(seed);
	let ended = false;
	return {
		seed,
		next() {
			if (ended) return fallback.next();
			if (index < values.length) return values[index++] as number;
			overran = true;
			return fallback.next();
		},
		rewind() {
			index = 0;
			overran = false;
			ended = false;
			fallback = seededRandom(seed);
		},
		end() {
			ended = true;
		},
		used: () => index,
		overran: () => overran,
	};
}

/** What replay could not restore for `entry`, from how its tape was read. */
function tapeNotes(
	entry: JournalEntry,
	clock: TapeSource | undefined,
	random: TapeSource & { seed?: string }
): string[] {
	const { tape } = entry;
	if (!tape) return [];
	const notes: string[] = [];
	if (tape.truncated)
		notes.push('the recorded tape was truncated; values past it are not restored');
	if (clock?.overran()) {
		notes.push(
			`clock: the tape holds ${tape.clock.length} readings and the replay read more; later readings repeat the last one`
		);
	} else if (clock && clock.used() < tape.clock.length) {
		notes.push(`clock: the replay read ${clock.used()} of ${tape.clock.length} recorded readings`);
	}
	if (random.overran()) {
		notes.push(
			`random: the tape holds ${tape.random.length} values and the replay read more; later values come from seed '${random.seed}'`
		);
	} else if (random.used() < tape.random.length) {
		notes.push(`random: the replay read ${random.used()} of ${tape.random.length} recorded values`);
	}
	return notes;
}

/** `value` as plain JSON, so recorded and replayed results compare the same way. */
function toJson(value: unknown): unknown {
	const text = JSON.stringify(value);
	return text === undefined ? null : JSON.parse(text);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function childPath(path: string, key: string): string {
	return path === '' ? key : `${path}.${key}`;
}

/** Structural differences between two JSON values, skipping `ignore` paths. */
function diffJson(
	recorded: unknown,
	replayed: unknown,
	path: string,
	ignore: ReadonlySet<string>,
	out: ReplayDifference[],
	max: number
): void {
	if (out.length >= max || ignore.has(path)) return;
	if (Array.isArray(recorded) && Array.isArray(replayed)) {
		for (let i = 0; i < Math.max(recorded.length, replayed.length); i++) {
			const at = `${path}[${i}]`;
			if (i >= replayed.length) {
				if (!ignore.has(at) && out.length < max)
					out.push({ path: at, kind: 'removed', recorded: recorded[i] });
			} else if (i >= recorded.length) {
				if (!ignore.has(at) && out.length < max)
					out.push({ path: at, kind: 'added', replayed: replayed[i] });
			} else {
				diffJson(recorded[i], replayed[i], at, ignore, out, max);
			}
		}
		return;
	}
	if (isPlainObject(recorded) && isPlainObject(replayed)) {
		const keys = new Set([...Object.keys(recorded), ...Object.keys(replayed)]);
		for (const key of [...keys].sort()) {
			const at = childPath(path, key);
			if (!Object.hasOwn(replayed, key)) {
				if (!ignore.has(at) && out.length < max)
					out.push({ path: at, kind: 'removed', recorded: recorded[key] });
			} else if (!Object.hasOwn(recorded, key)) {
				if (!ignore.has(at) && out.length < max)
					out.push({ path: at, kind: 'added', replayed: replayed[key] });
			} else {
				diffJson(recorded[key], replayed[key], at, ignore, out, max);
			}
		}
		return;
	}
	if (recorded !== replayed) out.push({ path, kind: 'changed', recorded, replayed });
}

/**
 * Re-execute journal entries in `seq` order against `registry` and compare each result with
 * the recorded one.
 *
 * Each call gets the entry's trace ID, actor and interface, and a clock and random source
 * that return the values recorded on its tape. An entry without a tape gets a clock fixed at
 * its `timestamp` and a random source seeded with `${seed}:${seq}`. The registry should be
 * fresh (or reset to the state the recording started from): replay re-runs mutations. Give it
 * the same middleware as the recording server: a journal middleware in it lines the tape up
 * with the handler and records nothing during replay.
 *
 * @example
 * ```typescript
 * const entries = parseJournal(readFileSync('session.jsonl', 'utf8'));
 * const report = await replayJournal(createMcpServer({ name: 'todo', version: '1', commands }), entries);
 * if (report.diverged) console.log(report.entries.filter((entry) => entry.status !== 'same'));
 * ```
 */
export async function replayJournal(
	registry: JournalReplayTarget,
	entries: readonly JournalEntry[],
	options: ReplayJournalOptions = {}
): Promise<ReplayReport> {
	const ignore = new Set(options.ignore ?? DEFAULT_IGNORE);
	const seed = options.seed ?? 'afd-replay';
	const maxDifferences = options.maxDifferences ?? DEFAULT_MAX_DIFFERENCES;
	const ordered = [...entries].sort((a, b) => a.seq - b.seq);
	const report: ReplayReport = {
		entries: [],
		same: 0,
		different: 0,
		errors: 0,
		diverged: false,
		skipped: 0,
	};

	const declared = registry.contextFields
		? new Set(registry.contextFields.map((field) => field.name))
		: undefined;

	for (const [index, entry] of ordered.entries()) {
		const { tape } = entry;
		const fieldNotes: string[] = [];
		const restored: Record<string, unknown> = {};
		for (const [name, value] of Object.entries(entry.context ?? {})) {
			if (declared && !declared.has(name)) {
				fieldNotes.push(`context field '${name}' is no longer declared; replayed without it`);
			} else {
				restored[name] = value;
			}
		}
		for (const name of entry.contextOmitted ?? []) {
			fieldNotes.push(`context field '${name}' was too large to journal; replayed without it`);
		}
		const random = tapeRandom(tape?.random ?? [], `${seed}:${entry.seq}`);
		let clock: (Clock & TapeSource) | undefined;

		let outcome: ReplayEntryReport;
		try {
			// Inside the try: a bad timestamp or a throwing context factory fails this entry only.
			clock = tape ? tapeClock(tape.clock, Date.parse(entry.timestamp)) : undefined;
			const actor = journalActor(entry.actor);
			const extra =
				typeof options.context === 'function' ? options.context(entry) : options.context;
			const context: CommandContext = {
				...(entry.traceId !== undefined ? { traceId: entry.traceId } : {}),
				...(actor ? { actor } : {}),
				...(entry.contextDigest.interface !== undefined
					? { interface: entry.contextDigest.interface as CommandContext['interface'] }
					: {}),
				...restored,
				clock: clock ?? fixedClock(entry.timestamp),
				random,
				...extra,
			};
			// A journal middleware in the replayed chain rewinds the tape where it sits, so
			// middleware outside it does not shift the handler's readings.
			const marker: JournalReplayMarker = {
				rewind() {
					clock?.rewind();
					random.rewind();
				},
				end() {
					clock?.end();
					random.end();
				},
			};
			(context as Record<symbol, unknown>)[JOURNAL_REPLAY] = marker;

			const replayed = await registry.execute(entry.command, entry.input, context);
			const differences: ReplayDifference[] = [];
			diffJson(toJson(entry.result), toJson(replayed), '', ignore, differences, maxDifferences);
			outcome = {
				seq: entry.seq,
				command: entry.command,
				status: differences.length === 0 ? 'same' : 'different',
				recorded: entry.result,
				replayed,
				...(differences.length > 0 ? { differences } : {}),
			};
		} catch (error) {
			outcome = {
				seq: entry.seq,
				command: entry.command,
				status: 'error',
				recorded: entry.result,
				error: error instanceof Error ? error.message : String(error),
			};
		}

		const notes = [...fieldNotes, ...tapeNotes(entry, clock, random)];
		if (notes.length > 0) outcome.notes = notes;

		report.entries.push(outcome);
		if (outcome.status === 'same') report.same++;
		else if (outcome.status === 'different') report.different++;
		else report.errors++;

		if (outcome.status !== 'same') {
			report.diverged = true;
			if (options.stopOnDivergence) {
				report.skipped = ordered.length - index - 1;
				break;
			}
		}
	}
	return report;
}
