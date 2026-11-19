/**
 * @fileoverview The shell's limits (phase 4 specification, section 11; D124), as the kernel holds them from boot: the
 * five values, enforced with their defaults until `late-settings` reads the workspace's `loam.limits` and whether or not
 * it ever does (fail closed); each instance's refusals in the last hour; and the journal sink's bound on a whole entry.
 * First paint holds it, since the journal does, and holds only that: the call rate and the frame gate are the `apps`
 * chunk's, and the section, its writes and `limit-usage-get` are `late-settings`' (`late/limit-commands.ts`).
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

/** The refusals are counted per minute: 60 buckets make the hour (the trust review's 11). */
const MINUTE_MS = 60_000;
const MINUTES = REFUSAL_WINDOW_MS / MINUTE_MS;

/** Room the journal sink's own fields take after the bound (its `seq`), so a kept entry stays within the limit. */
export const SINK_MARGIN_BYTES = 256;

/** The UTF-8 bytes of a string. */
export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** A value measured against a limit: its JSON (absent for `undefined`, or for a value with none), and the verdict. */
export interface MeasuredV1 {
	json: string | undefined;
	/** Over the limit, or with no JSON form at all: such a value is over every limit (R2), never measured as 0. */
	over: boolean;
	/** The value has no JSON form: a cycle, a `BigInt`, a function. `undefined` itself is no value, and is not this. */
	unserializable: boolean;
}

/**
 * Measure `value`'s JSON against `max` UTF-8 bytes. A string longer than `max` is over whatever it holds, and one a third
 * of `max` or shorter is under, so only the rest is encoded (the trust review's 16).
 */
export function measureJson(value: unknown, max: number): MeasuredV1 {
	let json: string | undefined;
	try {
		json = JSON.stringify(value);
	} catch {
		return { json: undefined, over: true, unserializable: true };
	}
	if (json === undefined) {
		const none = value === undefined;
		return { json: undefined, over: !none, unserializable: !none };
	}
	const over = json.length > max ? true : json.length * 3 <= max ? false : utf8Bytes(json) > max;
	return { json, over, unserializable: false };
}

/** The UTF-8 bytes of a value's JSON, or `Infinity` for a value with none (R2). */
export function jsonBytes(value: unknown): number {
	try {
		const json = JSON.stringify(value);
		return json === undefined ? (value === undefined ? 0 : Infinity) : utf8Bytes(json);
	} catch {
		return Infinity;
	}
}

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
	/**
	 * Count a refusal of `instance` by `limit`, in its minute's bucket; told through {@link KernelLimits.notify} when no
	 * notice for the instance was told in the hour before.
	 */
	refused(instance: string, limit: LimitKeyV1, now: number): void;
	/** Each limit's refusals of `instance` in the 60 minutes up to `now`'s, later ones included. */
	counts(instance: string, now: number): Record<LimitKeyV1, number>;
	/** The seam for the owners' notice (section 11): step 5's inbox fills it. */
	notify?: (refusal: LimitRefusalV1) => void;
	/** Whether a replay runs: its refusals are the journal's, so the call rate takes nothing then. */
	paused(): boolean;
	/** Each instance's call rate, which the `apps` chunk keeps here so a reload forgets it with the counts. */
	readonly rates: Map<string, { tokens: number; at: number }>;
	/**
	 * The record as the journal keeps it: one over `journalEntryBytes`, less the sink's margin, or with no JSON form, is
	 * kept truncated and marked `unreplayable`, and is never kept over the bound.
	 */
	bound(
		record: JournalRecord,
		instance: (record: JournalRecord) => string | undefined
	): JournalRecord;
	/** Forget the rates and the counts, as a reload does. */
	reset(): void;
}

const zero = (): number[] => LIMIT_KEYS.map(() => 0);
const cut = (text: unknown, most: number): string => String(text).slice(0, most);

export function createKernelLimits(paused: () => boolean = () => false): KernelLimits {
	let values: LimitValuesV1 = { ...LIMIT_DEFAULTS };
	const rates = new Map<string, { tokens: number; at: number }>();
	/** By instance: counts per minute (at most 60 kept), and when its last notice was told. */
	const seen = new Map<string, { minutes: Map<number, number[]>; notified?: number }>();
	const limits: KernelLimits = {
		values: () => ({ ...values }),
		set(next) {
			values = { ...next };
		},
		refused(instance, limit, now) {
			const held = seen.get(instance) ?? { minutes: new Map<number, number[]>() };
			seen.set(instance, held);
			const minute = Math.floor(now / MINUTE_MS);
			const counts = held.minutes.get(minute) ?? zero();
			const index = LIMIT_KEYS.indexOf(limit);
			counts[index] = (counts[index] ?? 0) + 1;
			held.minutes.set(minute, counts);
			// Older than the hour, dropped: at most 60 buckets are kept, so a refusal costs O(60).
			if (held.minutes.size > MINUTES)
				for (const at of held.minutes.keys()) if (at <= minute - MINUTES) held.minutes.delete(at);
			const last = held.notified;
			if (last === undefined || now - last >= REFUSAL_WINDOW_MS || now < last) {
				held.notified = now;
				limits.notify?.({ instance, limit, at: now });
			}
		},
		counts(instance, now) {
			const minute = Math.floor(now / MINUTE_MS);
			const sum = zero();
			for (const [at, counts] of seen.get(instance)?.minutes ?? []) {
				if (at <= minute - MINUTES) continue;
				counts.forEach((count, index) => {
					sum[index] = (sum[index] as number) + count;
				});
			}
			return Object.fromEntries(LIMIT_KEYS.map((key, index) => [key, sum[index]])) as Record<
				LimitKeyV1,
				number
			>;
		},
		paused,
		rates,
		bound(record, instance) {
			const max = values.journalEntryBytes - SINK_MARGIN_BYTES;
			const measured = measureJson(record, max);
			if (!measured.over) return record;
			const owner = instance(record);
			if (owner !== undefined)
				limits.refused(owner, 'journalEntryBytes', Date.parse(record.timestamp) || 0);
			const { result, context, actor } = record;
			const error = result?.error;
			// Every field kept is bounded: the code, the message, the names and the actor's.
			const bare = {
				timestamp: cut(record.timestamp, 64),
				...(record.traceId !== undefined ? { traceId: cut(record.traceId, 256) } : {}),
				command: cut(record.command, 256),
				contextDigest: {
					hash: cut(record.contextDigest?.hash, 128),
					...(record.contextDigest?.interface !== undefined
						? { interface: cut(record.contextDigest.interface, 64) }
						: {}),
				},
				durationMs: Number(record.durationMs) || 0,
				input: {},
				result: {
					success: result?.success === true,
					...(error
						? { error: { code: cut(error.code, 128), message: cut(error.message, 1_000) } }
						: {}),
				},
				unreplayable: true,
				...(measured.json !== undefined ? { bytes: utf8Bytes(measured.json) } : {}),
			};
			const kept = [
				{
					...bare,
					...(actor
						? {
								actor: {
									kind: cut(actor.kind, 32),
									...(actor.id !== undefined ? { id: cut(actor.id, 256) } : {}),
								},
							}
						: {}),
					...(context ? { context } : {}),
				},
				{
					...bare,
					...(context?.caller !== undefined
						? { context: { caller: cut(context.caller, 64) } }
						: {}),
				},
				bare,
			].find((candidate) => !measureJson(candidate, max).over);
			// The last is bounded by construction, a few kilobytes, well under the least limit of 262,144.
			return (kept ?? bare) as unknown as JournalRecord;
		},
		reset() {
			rates.clear();
			seen.clear();
		},
	};
	return limits;
}
