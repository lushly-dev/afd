/**
 * @fileoverview The shell's limits (phase 4 specification, section 11; D124), as the kernel holds them from boot: the
 * five values, enforced with their defaults until `late-settings` reads the workspace's `loam.limits` and whether or not
 * it ever does (fail closed); the refusals each instance met in the last hour; and the journal sink's bound on a whole
 * entry. First paint holds it, since the journal does, and holds only that: the call rate is the `apps` chunk's
 * (`apps/call-rate.ts`), and the section, its writes and `limit-usage-get` are `late-settings`' (`late/limit-commands.ts`).
 */

import type { JournalRecord } from '@lushly-dev/afd-core';

/** The five keys of `loam.limits`, in section 11's order. */
export const LIMIT_KEYS = Object.freeze([
	'messageBytes',
	'inputBytes',
	'callsPerSecond',
	'storeBytes',
	'journalEntryBytes',
] as const);

export type LimitKeyV1 = (typeof LIMIT_KEYS)[number];
export type LimitValuesV1 = Record<LimitKeyV1, number>;

/**
 * Section 11's defaults: what the kernel enforces from boot. `late/setting-sections.ts` repeats them; a unit holds them
 * equal.
 */
export const LIMIT_DEFAULTS: Readonly<LimitValuesV1> = Object.freeze({
	messageBytes: 1_048_576,
	inputBytes: 262_144,
	callsPerSecond: 50,
	storeBytes: 26_214_400,
	journalEntryBytes: 1_048_576,
});

/** The window `limit-usage-get` counts refusals over, and the owner notice's: an hour. */
export const REFUSAL_WINDOW_MS = 3_600_000;

/** The UTF-8 bytes of a value's JSON, as every limit counts them. */
export const jsonBytes = (value: unknown): number =>
	new TextEncoder().encode(JSON.stringify(value) ?? '').length;

/** A refusal of an instance by one limit, at a time on the call's clock (section 11). */
export interface LimitRefusalV1 {
	instance: string;
	limit: LimitKeyV1;
	at: number;
}

export interface KernelLimits {
	/** The values in force, a detached copy. */
	values(): LimitValuesV1;
	/** `late-settings`' read of the workspace's values: only whole numbers inside section 11's bounds reach here. */
	set(values: LimitValuesV1): void;
	/** Count a refusal of `instance` by `limit`; the first in an hour is told through {@link KernelLimits.notify}. */
	refused(instance: string, limit: LimitKeyV1, now: number): void;
	/** `instance`'s refusals in the hour before `now`, oldest first, detached. */
	recent(instance: string, now: number): LimitRefusalV1[];
	/** The seam for the owners' notice (section 11): step 5's inbox fills it. */
	notify?: (refusal: LimitRefusalV1) => void;
	/** Whether a replay runs: its refusals are the journal's, so the call rate takes nothing then. */
	paused(): boolean;
	/** Each instance's call rate, which the `apps` chunk keeps here so a reload forgets it with the counts. */
	readonly rates: Map<string, { tokens: number; at: number }>;
	/** The record as the journal keeps it: one over `journalEntryBytes` truncated and marked `unreplayable`. */
	bound(
		record: JournalRecord,
		instance: (record: JournalRecord) => string | undefined
	): JournalRecord;
	/** Forget the rates and the counts, as a reload does. */
	reset(): void;
}

export function createKernelLimits(paused: () => boolean = () => false): KernelLimits {
	let values: LimitValuesV1 = { ...LIMIT_DEFAULTS };
	const rates = new Map<string, { tokens: number; at: number }>();
	const seen = new Map<string, LimitRefusalV1[]>();
	const recent = (instance: string, now: number) =>
		(seen.get(instance) ?? []).filter(
			(refusal) => refusal.at > now - REFUSAL_WINDOW_MS && refusal.at <= now
		);
	const limits: KernelLimits = {
		values: () => ({ ...values }),
		set(next) {
			values = { ...next };
		},
		refused(instance, limit, now) {
			const kept = recent(instance, now);
			const refusal = { instance, limit, at: now };
			seen.set(instance, [...kept, refusal]);
			if (kept.length === 0) limits.notify?.({ ...refusal });
		},
		recent: (instance, now) => recent(instance, now).map((refusal) => ({ ...refusal })),
		paused,
		rates,
		bound(record, instance) {
			const bytes = jsonBytes(record);
			const max = values.journalEntryBytes;
			if (bytes <= max) return record;
			const { input: _input, result, tape: _tape, ...kept } = record;
			const error = result.error;
			const truncated = {
				...kept,
				input: {},
				// The code, and the start of the message: never the data.
				result: {
					success: result.success,
					...(error
						? { error: { code: error.code, message: String(error.message).slice(0, 1_000) } }
						: {}),
				},
				unreplayable: true,
				bytes,
			} as JournalRecord;
			const owner = instance(record);
			if (owner !== undefined)
				limits.refused(owner, 'journalEntryBytes', Date.parse(record.timestamp) || 0);
			// A context too large to keep still keeps the entry in bounds.
			if (jsonBytes(truncated) <= max) return truncated;
			const { context: _context, ...bare } = truncated;
			return bare as JournalRecord;
		},
		reset() {
			rates.clear();
			seen.clear();
		},
	};
	return limits;
}
