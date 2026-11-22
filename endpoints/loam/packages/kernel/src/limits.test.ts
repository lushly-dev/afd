/**
 * The kernel's limits object (phase 4 specification, section 11): the call rate's burst and refill, the hour's
 * refusal counts and the owners' notice seam, and the journal sink's bound on a whole entry.
 */

import type { JournalRecord } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { CALL_BURST, takeCall } from './apps/call-rate.js';
import {
	createKernelLimits,
	jsonBytes,
	LIMIT_DEFAULTS,
	measureJson,
	REFUSAL_WINDOW_MS,
	utf8Bytes,
} from './limits.js';

const record = (input: unknown, extra: Partial<JournalRecord> = {}): JournalRecord =>
	({
		timestamp: '2026-01-01T00:00:00.000Z',
		command: 'probe-put',
		input,
		contextDigest: { hash: 'h', interface: 'palette' },
		result: { success: true, data: { echoed: input } },
		durationMs: 1,
		tape: { clock: [1], random: [] },
		...extra,
	}) as unknown as JournalRecord;

describe('the call rate (section 11)', () => {
	it('allows the burst at once, then refills at callsPerSecond, per instance', () => {
		const limits = createKernelLimits();
		for (let i = 0; i < CALL_BURST; i++) expect(takeCall(limits, 'probe', 0)).toBeUndefined();
		expect(takeCall(limits, 'probe', 0)).toBe(20);
		// Another instance's rate is its own.
		expect(takeCall(limits, 'other', 0)).toBeUndefined();
		// 50 a second: one place every 20 ms.
		expect(takeCall(limits, 'probe', 20)).toBeUndefined();
		expect(takeCall(limits, 'probe', 20)).toBe(20);
		limits.set({ ...LIMIT_DEFAULTS, callsPerSecond: 5 });
		expect(takeCall(limits, 'probe', 20)).toBe(200);
	});

	it('takes nothing while a replay runs, whose refusals are its journal’s', () => {
		let replaying = true;
		const limits = createKernelLimits(() => replaying);
		for (let i = 0; i < CALL_BURST * 2; i++) expect(takeCall(limits, 'probe', 0)).toBeUndefined();
		replaying = false;
		expect(takeCall(limits, 'probe', 0)).toBeUndefined();
	});

	it('forgets the rates and counts on a reset, and keeps the values', () => {
		const limits = createKernelLimits();
		limits.set({ ...LIMIT_DEFAULTS, storeBytes: 1_048_576 });
		for (let i = 0; i <= CALL_BURST; i++) takeCall(limits, 'probe', 0);
		limits.refused('probe', 'inputBytes', 0);
		limits.reset();
		expect(takeCall(limits, 'probe', 0)).toBeUndefined();
		expect(limits.counts('probe', 0).inputBytes).toBe(0);
		expect(limits.values().storeBytes).toBe(1_048_576);
	});
});

describe("refusals in the hour (section 11; the trust review's 11)", () => {
	it('counts each limit per minute over the last 60, later ones included', () => {
		const limits = createKernelLimits();
		limits.refused('probe', 'inputBytes', 1_000);
		limits.refused('probe', 'callsPerSecond', 2_000);
		limits.refused('probe', 'callsPerSecond', 61_000);
		expect(limits.counts('probe', 61_000)).toEqual({
			messageBytes: 0,
			inputBytes: 1,
			callsPerSecond: 2,
			storeBytes: 0,
			journalEntryBytes: 0,
		});
		// No upper cutoff: a refusal at a later minute than `now` still counts.
		expect(limits.counts('probe', 0).callsPerSecond).toBe(2);
		// The first minute's bucket leaves the hour.
		const later = 60 * 60_000;
		expect(limits.counts('probe', later)).toMatchObject({ inputBytes: 0, callsPerSecond: 1 });
		expect(limits.counts('other', later).inputBytes).toBe(0);
	});

	it('tells the seam once an hour per instance, by its own last-notified time', () => {
		const limits = createKernelLimits();
		const told: string[] = [];
		limits.notify = ({ instance, limit, at }) => told.push(`${instance}:${limit}@${at}`);
		limits.refused('probe', 'inputBytes', 1_000);
		limits.refused('probe', 'storeBytes', 30 * 60_000);
		limits.refused('other', 'storeBytes', 30 * 60_000);
		// Its bucket gone from the hour does not make a refusal before the hour is out the first again.
		limits.refused('probe', 'callsPerSecond', 1_000 + REFUSAL_WINDOW_MS - 1);
		limits.refused('probe', 'callsPerSecond', 1_000 + REFUSAL_WINDOW_MS);
		expect(told).toEqual([
			'probe:inputBytes@1000',
			`other:storeBytes@${30 * 60_000}`,
			`probe:callsPerSecond@${1_000 + REFUSAL_WINDOW_MS}`,
		]);
	});

	it('keeps 100,000 refusals cheap and counted', () => {
		const limits = createKernelLimits();
		const start = performance.now();
		for (let i = 0; i < 100_000; i++) limits.refused('probe', 'callsPerSecond', i * 60);
		expect(performance.now() - start).toBeLessThan(2_000);
		// 1,000 refusals a minute over 100 minutes: the last 60 minutes hold 60,000 of them.
		const now = 100_000 * 60 - 60;
		expect(limits.counts('probe', now).callsPerSecond).toBe(60_000);
	});

	it('returns detached values', () => {
		const limits = createKernelLimits();
		const values = limits.values();
		values.inputBytes = 1;
		expect(limits.values().inputBytes).toBe(LIMIT_DEFAULTS.inputBytes);
	});
});

describe("measuring JSON (section 11; R2, the trust review's 16)", () => {
	it('measures UTF-8, takes the fast paths, and puts a value with no JSON form over every limit', () => {
		expect(measureJson('é'.repeat(10), 22)).toMatchObject({ over: false });
		expect(measureJson('é'.repeat(10), 21)).toMatchObject({ over: true });
		expect(measureJson('x'.repeat(100), 10)).toMatchObject({ over: true });
		expect(measureJson({ a: 1 }, 1_000)).toMatchObject({ over: false, json: '{"a":1}' });
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		for (const value of [cycle, 1n, () => 1, Symbol('s')])
			expect(measureJson(value, Number.MAX_SAFE_INTEGER)).toMatchObject({
				over: true,
				unserializable: true,
			});
		expect(measureJson(undefined, 10)).toEqual({
			json: undefined,
			over: false,
			unserializable: false,
		});
		expect(jsonBytes(1n)).toBe(Infinity);
	});
});

describe("P4-E10: the journal entry bound (section 11; the trust review's 6)", () => {
	const tight = () => {
		const limits = createKernelLimits();
		limits.set({ ...LIMIT_DEFAULTS, inputBytes: 65_536, journalEntryBytes: 262_144 });
		return limits;
	};
	const kept = (entry: JournalRecord) =>
		// What the sink keeps, with its own `seq`.
		utf8Bytes(JSON.stringify({ seq: Number.MAX_SAFE_INTEGER, ...entry }));

	it('keeps an entry within journalEntryBytes whole', () => {
		const limits = createKernelLimits();
		const small = record({ text: 'small' });
		expect(limits.bound(small, () => 'probe')).toBe(small);
	});

	it('truncates one over it on the whole entry, marks it unreplayable, and counts it for the instance', () => {
		const limits = tight();
		const big = record({ text: 'x'.repeat(140_000) });
		const bounded = limits.bound(big, () => 'probe') as JournalRecord & {
			unreplayable?: boolean;
			bytes?: number;
		};
		expect(bounded).toMatchObject({
			command: 'probe-put',
			input: {},
			result: { success: true },
			unreplayable: true,
		});
		expect(bounded.result.data).toBeUndefined();
		expect(bounded.tape).toBeUndefined();
		expect(bounded.bytes).toBeGreaterThan(262_144);
		expect(limits.counts('probe', Date.parse(big.timestamp)).journalEntryBytes).toBe(1);
	});

	it("bounds every field it keeps, and never keeps an entry over the bound with the sink's seq", () => {
		const limits = tight();
		const huge = 'z'.repeat(300_000);
		const bounded = limits.bound(
			record({ text: huge }, {
				command: huge,
				traceId: huge,
				actor: { kind: 'agent', id: huge, label: huge },
				context: { caller: huge, note: huge },
				result: { success: false, error: { code: huge, message: huge } },
			} as Partial<JournalRecord>),
			() => undefined
		);
		expect(kept(bounded)).toBeLessThanOrEqual(262_144);
		expect(bounded.result.error).toEqual({ code: 'z'.repeat(128), message: 'z'.repeat(1_000) });
		expect(bounded.command).toHaveLength(256);
		// An entry just under the bound before the sink's seq is truncated, so with it it stays under.
		const edge = record({ text: 'x'.repeat(262_144 - 300) }, { result: { success: true } });
		expect(kept(limits.bound(edge, () => undefined))).toBeLessThanOrEqual(262_144);
	});

	it('truncates an entry with no JSON form rather than measuring it as 0 (R2)', () => {
		const limits = tight();
		const bounded = limits.bound(record({ n: 1n }), () => 'probe') as JournalRecord & {
			unreplayable?: boolean;
			bytes?: number;
		};
		expect(bounded).toMatchObject({ input: {}, unreplayable: true });
		expect(bounded.bytes).toBeUndefined();
		expect(() => JSON.stringify(bounded)).not.toThrow();
	});

	it('drops the context too when the rest alone is still over the bound', () => {
		const limits = tight();
		const bounded = limits.bound(
			record({}, { context: { note: 'c'.repeat(300_000) } }),
			() => undefined
		);
		expect(bounded.context).toBeUndefined();
		expect(kept(bounded)).toBeLessThan(262_144);
	});
});
