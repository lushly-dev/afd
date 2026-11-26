/**
 * @fileoverview The kernel's own journal rule for an entry, before any app's: a sign-in's password, and a unit's
 * (phase 5 specification, 7.3). Nothing of a unit is stored: a submit's entry, known by the `~unit` its copilot trace's
 * call ends with, keeps neither its input nor its result's data, message or code; and a copilot call whose result marks
 * a unit keeps its input but not its result's data, which holds the unit's parts and instructions. Both are never
 * replayed as if whole. First paint imports it, so it imports types alone.
 */

import type { JournalRecord } from '@lushly-dev/afd-core';

/** `replayJournal`'s mark (afd-server's `JOURNAL_REPLAY`, a registered symbol): the journal rewinds the tape there. */
export const JOURNAL_REPLAY = Symbol.for('@lushly-dev/afd-server/journal-replay');

/** The `call` of a unit's submit's trace ends with this (the `late-copilot` chunk's `UNIT_TRACE_SUFFIX`). */
const UNIT_SUBMIT = '~unit';

const unitSubmit = (record: JournalRecord): boolean => {
	const call = (record.context?.trace as { call?: unknown } | undefined)?.call;
	return typeof call === 'string' && call.endsWith(UNIT_SUBMIT);
};

const marked = (value: unknown): boolean =>
	typeof value === 'object' && value !== null && Object.hasOwn(value, 'dev.loam/unit');

/**
 * Commands the one journal middleware always leaves out: `palette-search` runs per keystroke, and `scope-get` and
 * `section-get` at every re-read of the rail, reading memory and writing nothing, so an empty shell's boot
 * journals no more than it did (phase 2 specification, 4.3). `editor-selection-set` runs per selection
 * change, holds what a replay need not reproduce, and is a query (documents specification, 5.4).
 * `persona-list` is the shell's read of the active persona, the same way (phase 3 specification, 6.3).
 * `trust-record-snapshot` is phase 6's snapshot (its 6.1), read after every routed call and refresh.
 * (`notification-list` is filtered per caller by {@link journalsCommand}: unjournaled for the shell's own read,
 * journaled for agents and apps, #2105.)
 */
export const UNJOURNALED_COMMANDS: readonly string[] = Object.freeze([
	'shell-focus-next',
	'shell-focus-previous',
	'shell-save',
	'shell-project-switcher',
	'workspace-export',
	'storage-persistence-get',
	'palette-search',
	'scope-get',
	'section-get',
	'editor-selection-set',
	'persona-list',
	'trust-record-snapshot',
]);

/** Context fields the per-caller journal filter reads (#2105). */
export interface JournalFilterContext {
	readonly interface?: unknown;
	readonly actor?: { readonly kind?: unknown } | undefined;
	readonly caller?: unknown;
}

/**
 * Whether the journal records a call of `command` in `context` (#2105): every command outside `unjournaled`
 * is recorded, and `notification-list` is recorded for an agent or an app (leaving out only the shell's own read).
 */
export function journalsCommand(
	command: string,
	context?: JournalFilterContext,
	unjournaled: readonly string[] = UNJOURNALED_COMMANDS
): boolean {
	if (command === 'notification-list') {
		return (
			context?.interface === 'agent' ||
			context?.interface === 'mcp' ||
			context?.actor?.kind === 'agent' ||
			typeof context?.caller === 'string'
		);
	}
	return !unjournaled.includes(command);
}

/** Whether a `notification-list` result carries a unit marker inside any listed confirmation outcome (#2105). */
const listedUnit = (data: unknown): boolean => {
	const notices = (data as { notifications?: unknown } | undefined)?.notifications;
	return (
		Array.isArray(notices) &&
		notices.some((notice) =>
			marked(
				(notice as { confirmation?: { result?: { data?: unknown } } } | null | undefined)
					?.confirmation?.result?.data
			)
		)
	);
};

/**
 * A copilot call whose result carries a unit's marker, whatever then became of it: in its own data (the port's call, or
 * a stored outcome answered again, which keeps it there), in a stored outcome `confirmation-get` returns, or in a
 * listed confirmation's outcome returned by a journaled `notification-list` (#2105).
 */
const unitResult = (record: JournalRecord): boolean => {
	if (record.context?.trace === undefined) return false;
	const data = (record.result as { data?: { result?: { data?: unknown } } } | undefined)?.data;
	return (
		marked(data) ||
		marked(data?.result?.data) ||
		(record.command === 'notification-list' && listedUnit(data))
	);
};

/**
 * Remove `input.password` from an `auth-sign-in` record, a unit's text from its submit's (7.3), and mark a thrown
 * error caught by the journal (`threw === true`) lossy so a replay stops there instead of diverging (#2300). A handler
 * that explicitly returns a `COMMAND_EXECUTION_ERROR` failure without throwing stays replayable.
 */
export function redactJournalRecord(
	record: JournalRecord,
	threw = false,
	secret: boolean | undefined = false
): JournalRecord {
	// A command that declares `secret` with no rule here for its secret (only `auth-sign-in`'s password has one) keeps
	// its entry, but neither its input nor its result.
	if (secret !== false && record.command !== 'auth-sign-in') {
		return {
			...record,
			input: {},
			result: { success: record.result.success },
			unreplayable: true,
			lossy: true,
		} as unknown as JournalRecord;
	}
	if (unitSubmit(record)) {
		const { result } = record;
		return {
			...record,
			input: {},
			// A server's own code could carry the text: a failure keeps the kernel's code alone.
			result: {
				success: result.success,
				...(result.success ? {} : { error: { code: 'UNIT_SUBMIT_FAILED', message: '' } }),
			},
			unreplayable: true,
			lossy: true,
		} as unknown as JournalRecord;
	}
	if (unitResult(record)) {
		return {
			...record,
			result: { success: record.result.success, data: { 'dev.loam/unit': 'withheld' } },
			unreplayable: true,
			lossy: true,
		} as unknown as JournalRecord;
	}
	let clean = record;
	if (record.command === 'auth-sign-in') {
		const input = record.input;
		if (typeof input === 'object' && input !== null && 'password' in input) {
			const { password: _password, ...rest } = input as Record<string, unknown>;
			clean = { ...record, input: rest };
		}
	}
	// A handler or store throw caught by the journal as `COMMAND_EXECUTION_ERROR` cannot be reproduced by a healthy
	// replay store, while a deterministic refusal explicitly returned by a handler stays replayable (#2300).
	if (
		threw &&
		clean.result?.success === false &&
		clean.result.error?.code === 'COMMAND_EXECUTION_ERROR'
	) {
		return { ...clean, unreplayable: true, lossy: true } as unknown as JournalRecord;
	}
	// A taint list over the journal's 4 KB context limit is omitted into `contextOmitted`; replay cannot reconstruct the
	// gate's taint decision without it, so mark the entry unreplayable (#2325).
	if (clean.contextOmitted?.includes('taint')) {
		return { ...clean, unreplayable: true, lossy: true } as unknown as JournalRecord;
	}
	return clean;
}
