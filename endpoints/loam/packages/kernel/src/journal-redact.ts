/**
 * @fileoverview The kernel's own journal rule for an entry, before any app's: a sign-in's password, and a unit's
 * (phase 5 specification, 7.3). Nothing of a unit is stored: a submit's entry, known by the `~unit` its copilot trace's
 * call ends with, keeps neither its input nor its result's data, message or code; and a copilot call whose result marks
 * a unit keeps its input but not its result's data, which holds the unit's parts and instructions. Both are never
 * replayed as if whole. First paint imports it, so it imports types alone.
 */

import type { JournalRecord } from '@lushly-dev/afd-core';

/** The `call` of a unit's submit's trace ends with this (the `late-copilot` chunk's `UNIT_TRACE_SUFFIX`). */
const UNIT_SUBMIT = '~unit';

const unitSubmit = (record: JournalRecord): boolean => {
	const call = (record.context?.trace as { call?: unknown } | undefined)?.call;
	return typeof call === 'string' && call.endsWith(UNIT_SUBMIT);
};

const marked = (value: unknown): boolean =>
	typeof value === 'object' && value !== null && Object.hasOwn(value, 'dev.loam/unit');

/**
 * A copilot call whose result carries a unit's marker, whatever then became of it: in its own data (the port's call, or
 * a stored outcome answered again, which keeps it there), or in a stored outcome `confirmation-get` returns. The
 * inbox's reads are never journaled.
 */
const unitResult = (record: JournalRecord): boolean => {
	if (record.context?.trace === undefined) return false;
	const data = (record.result as { data?: { result?: { data?: unknown } } } | undefined)?.data;
	return marked(data) || marked(data?.result?.data);
};

/**
 * Remove `input.password` from an `auth-sign-in` record, a unit's text from its submit's (7.3), and mark a thrown
 * error caught by the journal (`threw === true`) lossy so a replay stops there instead of diverging (#2300). A handler
 * that explicitly returns a `COMMAND_EXECUTION_ERROR` failure without throwing stays replayable.
 */
export function redactJournalRecord(record: JournalRecord, threw = false): JournalRecord {
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
