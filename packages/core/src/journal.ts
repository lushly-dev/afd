/**
 * @fileoverview The command journal: an ordered, append-only record of executed commands.
 *
 * A journal records each command call (name, input, essential context and result) so it can
 * be audited, replayed to reproduce a session, or turned into a regression test. The server
 * package records entries with `createJournalMiddleware()` and replays them with
 * `replayJournal()`. On disk, a journal is JSON Lines: one {@link JournalEntry} per line (see
 * `spec/journal.md`).
 *
 * Journals never store secrets from the command context: an entry keeps the actor, the
 * interface and the trace ID, plus a hash over those values and the names (never the values)
 * of the other context keys.
 *
 * This module is browser-safe. The file sink, which needs `node:fs`, is in
 * `@lushly-dev/afd-core/journal-file`.
 */

import { type Actor, isActor } from './actor.js';
import type { CommandContext } from './commands.js';
import type { CommandResult } from './result.js';

/**
 * The clock readings and random numbers a command's handler took from `context.clock` and
 * `context.random`, in the order it took them. Replay feeds them back so the handler sees
 * the same time and the same random numbers.
 */
export interface JournalTape {
	/** Each `context.clock.now()` reading, in epoch milliseconds. */
	clock: number[];
	/** Each `context.random.next()` value. */
	random: number[];
	/** Set when the handler read more values than the recorder keeps; replay cannot restore the rest. */
	truncated?: boolean;
}

/**
 * The parts of the command context a journal keeps besides the actor and trace ID.
 *
 * The allowlist is the actor ({@link JournalEntry.actor}), the interface (here) and the trace
 * ID ({@link JournalEntry.traceId}). Nothing else from the context is stored.
 */
export interface JournalContextDigest {
	/**
	 * `sha256:` and the hex SHA-256 of the canonical JSON of the actor, the interface, the
	 * trace ID and the sorted names of the context's other keys. Names only, never their
	 * values, so an auth token or a session never reaches the journal, not even hashed.
	 * Two calls with the same digest had the same allowlisted values and the same context shape.
	 */
	hash: string;
	/** The interface that invoked the command (`context.interface`). */
	interface?: string;
}

/**
 * One executed command in a journal.
 *
 * Optional fields that are not set are omitted, never `null`.
 */
export interface JournalEntry {
	/** Position in the journal, from 1, assigned by the sink. Increasing; gaps are allowed. */
	seq: number;
	/** When the command started, as an ISO 8601 string from `context.clock`. */
	timestamp: string;
	/** `context.traceId`, when the call had one. */
	traceId?: string;
	/** The command name. */
	command: string;
	/** The validated input the handler received. */
	input: unknown;
	/** Who called: `kind`, and `id`, `label` and `onBehalfOf` when set. No other actor field is kept. */
	actor?: Actor;
	/** The context hash and the allowlisted interface. */
	contextDigest: JournalContextDigest;
	/** The command result, metadata included. */
	result: CommandResult;
	/** Wall time of the call through the rest of the middleware chain, from `context.clock`. */
	durationMs: number;
	/** The clock and random values the handler read, for replay. Omitted when it read none. */
	tape?: JournalTape;
}

/** An entry before the sink assigns its {@link JournalEntry.seq}. */
export type JournalRecord = Omit<JournalEntry, 'seq'>;

/** A range of entries to read, by `seq`. Both bounds are inclusive. */
export interface JournalRange {
	/** First `seq` to include. Default: the start of the journal. */
	from?: number;
	/** Last `seq` to include. Default: the end of the journal. */
	to?: number;
}

/**
 * Storage for a journal: append entries and read them back in order.
 *
 * The sink assigns `seq`, so a journal reopened after a restart continues its numbering.
 * Implementations: {@link MemoryJournalSink} here, and `FileJournalSink` (JSON Lines) in
 * `@lushly-dev/afd-core/journal-file`.
 */
export interface JournalSink {
	/** Append `record` with the next `seq` and return the stored entry. */
	append(record: JournalRecord): Promise<JournalEntry>;
	/** Entries in `range`, in `seq` order. */
	read(range?: JournalRange): Promise<JournalEntry[]>;
}

/** Entries of `entries` (in `seq` order) that fall in `range`. */
export function selectJournalRange(
	entries: readonly JournalEntry[],
	range: JournalRange = {}
): JournalEntry[] {
	const from = range.from ?? Number.NEGATIVE_INFINITY;
	const to = range.to ?? Number.POSITIVE_INFINITY;
	return entries.filter((entry) => entry.seq >= from && entry.seq <= to);
}

/**
 * A journal held in memory, for tests and short-lived sessions.
 *
 * @example
 * ```typescript
 * const sink = new MemoryJournalSink();
 * const server = createMcpServer({ commands, middleware: [createJournalMiddleware(sink)] });
 * // ...
 * const entries = await sink.read();
 * ```
 */
export class MemoryJournalSink implements JournalSink {
	private readonly entries: JournalEntry[] = [];

	/** @param initial - Entries to start from, e.g. a journal parsed with {@link parseJournal}. */
	constructor(initial: readonly JournalEntry[] = []) {
		this.entries.push(...[...initial].sort((a, b) => a.seq - b.seq));
	}

	async append(record: JournalRecord): Promise<JournalEntry> {
		const last = this.entries[this.entries.length - 1];
		const entry: JournalEntry = { seq: (last?.seq ?? 0) + 1, ...record };
		this.entries.push(entry);
		return entry;
	}

	async read(range?: JournalRange): Promise<JournalEntry[]> {
		return selectJournalRange(this.entries, range);
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT DIGEST
// ═══════════════════════════════════════════════════════════════════════════════

/** The context keys a journal keeps the values of. */
const ALLOWLISTED_KEYS = new Set(['actor', 'interface', 'traceId']);

/** `actor` with only the four {@link Actor} fields, or undefined when it is not an actor. */
export function journalActor(actor: unknown): Actor | undefined {
	if (!isActor(actor)) return undefined;
	return {
		kind: actor.kind,
		...(actor.id !== undefined ? { id: actor.id } : {}),
		...(actor.label !== undefined ? { label: actor.label } : {}),
		...(actor.onBehalfOf !== undefined ? { onBehalfOf: actor.onBehalfOf } : {}),
	};
}

/** JSON with object keys sorted at every level, so equal values give equal text. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortKeys(value)) ?? 'null';
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === 'object' && !(value instanceof Date)) {
		const record = value as Record<string, unknown>;
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(record).sort()) sorted[key] = sortKeys(record[key]);
		return sorted;
	}
	return value;
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The {@link JournalContextDigest} of `context`.
 *
 * The hash covers the actor (its four fields), the interface, the trace ID and the sorted
 * names of every other key whose value is not `undefined`. Values outside the allowlist are
 * only checked for `undefined`; they never enter the hash or the digest.
 */
export async function createContextDigest(context: CommandContext): Promise<JournalContextDigest> {
	const actor = journalActor(context.actor);
	const iface = typeof context.interface === 'string' ? context.interface : undefined;
	const traceId = typeof context.traceId === 'string' ? context.traceId : undefined;
	const keys = Object.keys(context)
		.filter((key) => !ALLOWLISTED_KEYS.has(key) && context[key] !== undefined)
		.sort();
	const hash = await sha256Hex(
		canonicalJson({
			actor: actor ?? null,
			interface: iface ?? null,
			keys,
			traceId: traceId ?? null,
		})
	);
	return { hash: `sha256:${hash}`, ...(iface !== undefined ? { interface: iface } : {}) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// JSON LINES
// ═══════════════════════════════════════════════════════════════════════════════

function isFiniteNumberArray(value: unknown): value is number[] {
	return Array.isArray(value) && value.every((item) => Number.isFinite(item));
}

function isTape(value: unknown): value is JournalTape {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const tape = value as Record<string, unknown>;
	return (
		isFiniteNumberArray(tape.clock) &&
		isFiniteNumberArray(tape.random) &&
		(tape.truncated === undefined || typeof tape.truncated === 'boolean')
	);
}

/** Whether `value` has the shape of a {@link JournalEntry}. */
export function isJournalEntry(value: unknown): value is JournalEntry {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const entry = value as Record<string, unknown>;
	const digest = entry.contextDigest as Record<string, unknown> | null | undefined;
	const result = entry.result as Record<string, unknown> | null | undefined;
	return (
		Number.isSafeInteger(entry.seq) &&
		(entry.seq as number) >= 1 &&
		typeof entry.timestamp === 'string' &&
		(entry.traceId === undefined || typeof entry.traceId === 'string') &&
		typeof entry.command === 'string' &&
		'input' in entry &&
		(entry.actor === undefined || isActor(entry.actor)) &&
		!!digest &&
		typeof digest === 'object' &&
		typeof digest.hash === 'string' &&
		(digest.interface === undefined || typeof digest.interface === 'string') &&
		!!result &&
		typeof result === 'object' &&
		typeof result.success === 'boolean' &&
		Number.isFinite(entry.durationMs) &&
		(entry.tape === undefined || isTape(entry.tape))
	);
}

/** One JSON Lines line for `entry`, without the trailing newline. */
export function serializeJournalEntry(entry: JournalEntry): string {
	// JSON.stringify escapes newlines inside strings, so the line holds the whole entry.
	return JSON.stringify(entry);
}

/** A JSON Lines journal for `entries`: one line each, every line ending in `\n`. */
export function serializeJournal(entries: readonly JournalEntry[]): string {
	return entries.map((entry) => `${serializeJournalEntry(entry)}\n`).join('');
}

/**
 * The entries of a JSON Lines journal, in file order. Blank lines are skipped; `\r\n` line
 * endings are accepted.
 *
 * @throws SyntaxError naming the line when a line is not JSON or not a {@link JournalEntry}
 */
export function parseJournal(text: string): JournalEntry[] {
	const entries: JournalEntry[] = [];
	const lines = text.split('\n');
	for (let index = 0; index < lines.length; index++) {
		const line = (lines[index] ?? '').replace(/\r$/, '');
		if (line.trim() === '') continue;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch (error) {
			throw new SyntaxError(
				`Journal line ${index + 1} is not valid JSON: ${(error as Error).message}`
			);
		}
		if (!isJournalEntry(value)) {
			throw new SyntaxError(`Journal line ${index + 1} is not a journal entry`);
		}
		entries.push(value);
	}
	return entries;
}
