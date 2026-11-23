/**
 * @fileoverview Journal middleware: records each accepted command call to a `JournalSink`.
 *
 * Server middleware runs after lookup, exposure and input validation, so a call rejected
 * there never reaches it and is never recorded. See `replayJournal()` in
 * `journal-replay.ts` for playing a journal back.
 */

import type {
	Clock,
	CommandContext,
	CommandMiddleware,
	CommandResult,
	JournalEntry,
	JournalRecord,
	JournalSink,
	JournalTape,
	RandomSource,
} from '@lushly-dev/afd-core';
import {
	createContextDigest,
	executionFailure,
	journalActor,
	systemClock,
	systemRandom,
} from '@lushly-dev/afd-core';
import { JOURNALED_CONTEXT_FIELDS } from './context-fields.js';
import { EFFECTIVE_OUTPUT_BUDGET } from './output-budget.js';

/** Most bytes of UTF-8 canonical JSON a journaled context field value may take (`spec/journal.md`). */
export const MAX_JOURNAL_CONTEXT_BYTES = 4096;

/** JSON with object keys sorted at every level, as the journal hashes it. */
function canonicalJson(value: unknown): string {
	const sort = (item: unknown): unknown => {
		if (Array.isArray(item)) return item.map(sort);
		if (item && typeof item === 'object') {
			const record = item as Record<string, unknown>;
			return Object.fromEntries(
				Object.keys(record)
					.sort()
					.map((key) => [key, sort(record[key])])
			);
		}
		return item;
	};
	return JSON.stringify(sort(JSON.parse(JSON.stringify(value) ?? 'null'))) ?? 'null';
}

/**
 * The values of the context fields `names` (those declared `journal: true`) that `context` has,
 * as an entry keeps them. A value over {@link MAX_JOURNAL_CONTEXT_BYTES} of canonical JSON is left
 * out and its name listed in `contextOmitted`. Both members are omitted when empty.
 */
export function journalContextFields(
	context: CommandContext,
	names: readonly string[]
): Pick<JournalEntry, 'context' | 'contextOmitted'> {
	const kept: Record<string, unknown> = {};
	const omitted: string[] = [];
	for (const name of [...new Set(names)].sort()) {
		const value = context[name];
		if (value === undefined) continue;
		const json = canonicalJson(value);
		if (new TextEncoder().encode(json).length > MAX_JOURNAL_CONTEXT_BYTES) omitted.push(name);
		else kept[name] = JSON.parse(json);
	}
	return {
		...(Object.keys(kept).length > 0 ? { context: kept } : {}),
		...(omitted.length > 0 ? { contextOmitted: omitted } : {}),
	};
}

/**
 * Context key `replayJournal()` sets on each replayed call. The first journal middleware that
 * finds it rewinds the replay tape at its own position, so readings by middleware outside it do
 * not shift what the handler gets, and spends the marker so nested calls and inner journals do
 * not rewind again. No journal middleware records during replay. Only `replayJournal()` sets it.
 *
 * A registered symbol (`Symbol.for`), so separately loaded copies of afd-server agree on it: a
 * globally installed `afd replay` marks calls that a project's own copy of the journal
 * middleware recognizes. Any code can therefore name it, but setting it only stops recording
 * and rewinds a tape the caller would have to supply itself.
 */
export const JOURNAL_REPLAY: unique symbol = Symbol.for('@lushly-dev/afd-server/journal-replay');

/** A marker that does nothing: what nested calls and inner journal middleware see. */
const SPENT_REPLAY: JournalReplayMarker = { rewind() {}, end() {} };

/** On a recording clock: the clock it wraps, for timing that must stay off the tape. */
const UNTAPED = Symbol('afd.journal.untaped');

/** The clock under any recording wrappers, so a journal's own timing lands on no tape. */
function untaped(clock: Clock): Clock {
	let current: Clock & { [UNTAPED]?: Clock } = clock;
	while (current[UNTAPED]) current = current[UNTAPED];
	return current;
}

/** The value under {@link JOURNAL_REPLAY}. */
export interface JournalReplayMarker {
	/** Restart the replay clock and random source from the first recorded value. */
	rewind(): void;
	/** The handler is done: readings after this (by outer middleware) are not tape overruns. */
	end(): void;
}

/** Commands not recorded unless `filter` says otherwise: the auth commands take passwords and return sessions. */
function defaultFilter(commandName: string): boolean {
	return !commandName.startsWith('auth-');
}

/** Options for {@link createJournalMiddleware}. */
export interface JournalMiddlewareOptions {
	/**
	 * Also record calls that fail after validation: a failure result from the handler or from
	 * middleware inside this one (an auth or approval rejection), and a handler that throws
	 * (recorded as the `COMMAND_EXECUTION_ERROR` result the server returns outside devMode,
	 * without the exception message). Default `false`:
	 * only successful calls are recorded.
	 */
	recordFailures?: boolean;
	/**
	 * Record only the commands this returns `true` for. Default: every command except those
	 * named `auth-*` (`@lushly-dev/afd-auth`'s `auth-sign-in` takes a password). A custom
	 * filter replaces the default, so exclude `auth-*` in it too unless you redact them.
	 */
	filter?: (commandName: string) => boolean;
	/**
	 * Last look at each record before it is stored: return it (changed or not), or `undefined`
	 * to skip it. Use it to drop secrets from inputs or results, such as a password argument
	 * or an issued token. A redacted entry may no longer replay to the same result. When a secret
	 * is derived from `context.random` (a generated code or token), drop `record.tape` too:
	 * the recorded random values would rebuild it.
	 */
	redact?: (record: JournalRecord) => JournalRecord | undefined;
	/**
	 * Most clock readings and most random values kept per call, each. Past it the tape is
	 * marked `truncated` and replay cannot restore the rest. Default 1000.
	 */
	maxTapeReads?: number;
	/** Called when building or appending an entry fails. The command result is unaffected. */
	onError?: (error: Error) => void;
}

const DEFAULT_MAX_TAPE_READS = 1000;

/**
 * Error code recorded in a journal entry when a command's result could not be copied as JSON
 * (for example a throwing getter, circular reference or `bigint`). The command's live return
 * value is unaffected and the error is also reported to `onError`.
 */
export const JOURNAL_RESULT_UNSERIALIZABLE = 'JOURNAL_RESULT_UNSERIALIZABLE';

/** `value` as plain JSON (a copy), so the entry is what a JSON Lines file would hold. */
function toJson(value: unknown): unknown {
	const text = JSON.stringify(value);
	return text === undefined ? null : JSON.parse(text);
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function reportError(onError: ((error: Error) => void) | undefined, error: unknown): void {
	try {
		onError?.(toError(error));
	} catch {
		// A failing onError has nowhere left to report.
	}
}

function unserializableResult(): CommandResult {
	return {
		success: false,
		error: {
			code: JOURNAL_RESULT_UNSERIALIZABLE,
			message: 'The command result could not be serialized for the journal',
			suggestion: 'Return plain JSON-serializable values from the command handler',
			retryable: false,
		},
	};
}

type CopiedResult =
	| { ok: true; result: CommandResult }
	| { ok: false; result: CommandResult; error: unknown };

function copyResult(recorded: CommandResult): CopiedResult {
	try {
		const copy = toJson(recorded);
		if (
			copy &&
			typeof copy === 'object' &&
			!Array.isArray(copy) &&
			typeof (copy as { success?: unknown }).success === 'boolean'
		) {
			return { ok: true, result: copy as CommandResult };
		}
		return {
			ok: false,
			result: unserializableResult(),
			error: new TypeError('Command result did not serialize to a CommandResult object'),
		};
	} catch (error) {
		return { ok: false, result: unserializableResult(), error };
	}
}

/** A clock and random source that pass values through and write them to `tape`. */
function recordingSources(
	clock: Clock,
	random: RandomSource,
	tape: JournalTape,
	maxReads: number
): { clock: Clock; random: RandomSource } {
	const keep = (values: number[], value: number) => {
		if (values.length < maxReads) values.push(value);
		else tape.truncated = true;
	};
	const recordingClock: Clock & { [UNTAPED]: Clock } = {
		[UNTAPED]: clock,
		now() {
			const value = clock.now();
			keep(tape.clock, value);
			return value;
		},
	};
	return {
		clock: recordingClock,
		random: {
			...(random.seed !== undefined ? { seed: random.seed } : {}),
			next() {
				const value = random.next();
				keep(tape.random, value);
				return value;
			},
		},
	};
}

/**
 * Create a middleware that appends a `JournalEntry` to `sink` for each command call.
 *
 * Each entry holds the command, its validated input, the actor, the trace ID, a context
 * digest (a hash plus the interface; no other context value), the result and the duration.
 * It also holds the tape: every value the handler read from `context.clock` and
 * `context.random`, which `replayJournal()` feeds back. Place this middleware last in the
 * list, so the tape holds only what the handler (and the server's own timing) read, and so
 * the actor it records is the one auth middleware settled on.
 *
 * Appends are awaited, so entries are in call order for sequential calls, and sink latency is
 * added to each recorded call. Concurrent calls are appended in the order they finished: each
 * takes its turn as its command returns, and the context digest, which is asynchronous, never
 * reorders them. So an `append` that never settles holds every later recorded call, and a sink
 * whose `append` runs a command this middleware records would wait on itself. A sink error goes to `onError` and never changes the command
 * result. Commands named `auth-*` are not recorded unless `filter` allows them. During
 * `replayJournal()` this middleware records nothing; it restarts the replay tape at its position.
 *
 * @example
 * ```typescript
 * import { createJournalMiddleware, createMcpServer } from '@lushly-dev/afd-server';
 * import { MemoryJournalSink } from '@lushly-dev/afd-core';
 *
 * const journal = new MemoryJournalSink();
 * const server = createMcpServer({
 *   name: 'todo',
 *   version: '1.0.0',
 *   commands,
 *   middleware: [createAuthMiddleware(auth), createJournalMiddleware(journal)],
 * });
 * ```
 */
export function createJournalMiddleware(
	sink: JournalSink,
	options: JournalMiddlewareOptions = {}
): CommandMiddleware {
	const {
		recordFailures = false,
		filter = defaultFilter,
		redact = (record: JournalRecord) => record,
		maxTapeReads = DEFAULT_MAX_TAPE_READS,
		onError,
	} = options;
	/** Settles when the last call to finish has appended, or given up: the next one appends after it. */
	let turn: Promise<void> = Promise.resolve();

	return async (commandName, input, context, next) => {
		const replay = (context as Record<symbol, unknown>)[JOURNAL_REPLAY] as
			| JournalReplayMarker
			| undefined;
		if (replay) {
			replay.rewind();
			(context as Record<symbol, unknown>)[JOURNAL_REPLAY] = SPENT_REPLAY;
			try {
				return await next();
			} finally {
				replay.end();
			}
		}
		if (!filter(commandName)) return next();

		const clock = context.clock ?? systemClock;
		const random = context.random ?? systemRandom;
		// Read the immutable effective output budget captured by the execution engine before
		// middleware ran, so neither earlier middleware nor the handler mutating
		// `context.outputBudget` can alter the journaled value or context digest (B8).
		const rawEffectiveBudget =
			(context as unknown as Record<symbol, unknown>)[EFFECTIVE_OUTPUT_BUDGET] ??
			context.outputBudget;
		const effectiveOutputBudget =
			typeof rawEffectiveBudget === 'number' &&
			Number.isSafeInteger(rawEffectiveBudget) &&
			rawEffectiveBudget >= 1
				? rawEffectiveBudget
				: undefined;
		const tape: JournalTape = { clock: [], random: [] };
		// The same context object reaches the handler, so swapping its sources records what it reads.
		const recording = recordingSources(clock, random, tape, maxTapeReads);
		context.clock = recording.clock;
		context.random = recording.random;

		// This journal's own timing reads the clock under any outer journal's recorder.
		const timing = untaped(clock);
		const start = timing.now();
		let result: CommandResult | undefined;
		let thrown: { error: unknown } | undefined;
		try {
			result = await next();
		} catch (error) {
			thrown = { error };
		} finally {
			context.clock = clock;
			context.random = random;
		}
		const durationMs = Math.max(0, timing.now() - start);

		// What the server returns for a throw outside devMode, never the exception message.
		const recorded: CommandResult = result ?? executionFailure(thrown?.error, false);
		let shouldRecord: boolean;
		let successThrown: { error: unknown } | undefined;
		try {
			shouldRecord = Boolean(recorded.success) || recordFailures;
		} catch (error) {
			shouldRecord = true;
			successThrown = { error };
		}
		if (shouldRecord) {
			// Taken now, before any await, so entries keep the order calls finished in.
			const previous = turn;
			let done!: () => void;
			turn = new Promise((resolve) => {
				done = resolve;
			});
			try {
				const actor = journalActor(context.actor);
				const hasTape = tape.clock.length > 0 || tape.random.length > 0 || tape.truncated;
				const journaled = journalContextFields(
					context,
					((context as Record<symbol, unknown>)[JOURNALED_CONTEXT_FIELDS] as string[]) ?? []
				);
				const copied: CopiedResult = successThrown
					? { ok: false, result: unserializableResult(), error: successThrown.error }
					: copyResult(recorded);
				if (!copied.ok) reportError(onError, copied.error);
				const digestContext =
					context.outputBudget === effectiveOutputBudget
						? context
						: { ...context, outputBudget: effectiveOutputBudget };
				const record = redact({
					timestamp: new Date(start).toISOString(),
					...(typeof context.traceId === 'string' ? { traceId: context.traceId } : {}),
					command: commandName,
					input: toJson(input),
					...(actor ? { actor } : {}),
					contextDigest: await createContextDigest(digestContext, journaled),
					...journaled,
					...(effectiveOutputBudget !== undefined ? { outputBudget: effectiveOutputBudget } : {}),
					result: copied.result,
					durationMs,
					...(hasTape ? { tape } : {}),
				});
				await previous;
				if (record) await sink.append(record);
			} catch (error) {
				reportError(onError, error);
			} finally {
				// Never released before the call ahead has appended, even when this record failed to build.
				await previous;
				done();
			}
		}

		if (thrown) throw thrown.error;
		return recorded;
	};
}
