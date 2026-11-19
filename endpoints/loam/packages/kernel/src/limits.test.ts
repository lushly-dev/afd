/**
 * The kernel's limits object (phase 4 specification, section 11): the call rate's burst and refill, the hour's
 * refusal counts and the owners' notice seam, and the journal sink's bound on a whole entry.
 */

import type { JournalRecord } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { CALL_BURST, takeCall } from './apps/call-rate.js';
import { countRefusals } from './late/limit-commands.js';
import { createKernelLimits, LIMIT_DEFAULTS, REFUSAL_WINDOW_MS } from './limits.js';

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
		expect(countRefusals(limits.recent('probe', 0)).inputBytes).toBe(0);
		expect(limits.values().storeBytes).toBe(1_048_576);
	});
});

describe('refusals in the hour (section 11)', () => {
	it('counts each limit, forgets those an hour old, and tells the seam the first in an hour', () => {
		const limits = createKernelLimits();
		const told: string[] = [];
		limits.notify = ({ instance, limit, at }) => told.push(`${instance}:${limit}@${at}`);
		limits.refused('probe', 'inputBytes', 1_000);
		limits.refused('probe', 'callsPerSecond', 2_000);
		limits.refused('probe', 'callsPerSecond', 3_000);
		expect(countRefusals(limits.recent('probe', 3_000))).toEqual({
			messageBytes: 0,
			inputBytes: 1,
			callsPerSecond: 2,
			storeBytes: 0,
			journalEntryBytes: 0,
		});
		expect(told).toEqual(['probe:inputBytes@1000']);
		const later = 1_000 + REFUSAL_WINDOW_MS;
		expect(countRefusals(limits.recent('probe', later)).inputBytes).toBe(0);
		expect(countRefusals(limits.recent('probe', later)).callsPerSecond).toBe(2);
		limits.refused('probe', 'storeBytes', 3_000 + REFUSAL_WINDOW_MS);
		expect(told).toEqual([
			'probe:inputBytes@1000',
			`probe:storeBytes@${3_000 + REFUSAL_WINDOW_MS}`,
		]);
	});

	it('returns detached values', () => {
		const limits = createKernelLimits();
		const values = limits.values();
		values.inputBytes = 1;
		expect(limits.values().inputBytes).toBe(LIMIT_DEFAULTS.inputBytes);
	});
});

describe('the journal entry bound (section 11)', () => {
	it('keeps an entry within journalEntryBytes whole', () => {
		const limits = createKernelLimits();
		const kept = record({ text: 'small' });
		expect(limits.bound(kept, () => 'probe')).toBe(kept);
	});

	it('truncates one over it on the whole entry, marks it unreplayable, and counts it for the instance', () => {
		const limits = createKernelLimits();
		limits.set({ ...LIMIT_DEFAULTS, inputBytes: 65_536, journalEntryBytes: 262_144 });
		// Input and result each under the bound, the whole entry over it.
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
		expect(countRefusals(limits.recent('probe', Date.parse(big.timestamp))).journalEntryBytes).toBe(
			1
		);
		// A failure keeps its code and the start of its message.
		const failed = limits.bound(
			record(
				{ text: 'x'.repeat(300_000) },
				{ result: { success: false, error: { code: 'X', message: 'm'.repeat(5_000) } } }
			),
			() => undefined
		);
		expect(failed.result.error).toEqual({ code: 'X', message: 'm'.repeat(1_000) });
	});

	it('drops the context too when the rest alone is still over the bound', () => {
		const limits = createKernelLimits();
		limits.set({ ...LIMIT_DEFAULTS, inputBytes: 65_536, journalEntryBytes: 262_144 });
		const bounded = limits.bound(
			record({}, { context: { note: 'c'.repeat(300_000) } }),
			() => undefined
		);
		expect(bounded.context).toBeUndefined();
		expect(JSON.stringify(bounded).length).toBeLessThan(262_144);
	});
});
