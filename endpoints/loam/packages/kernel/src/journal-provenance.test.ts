/**
 * The journal's provenance for its wrappers (phase 4's step 6, seventh round): a running wrapper's children are kept
 * whatever else is journaled meanwhile, released with the wrapper, and a wrapper past the bound is not tracked.
 */
import type { JournalRecord } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { createJournalProvenance, observeGate, TRACKED_WRAPPERS } from './journal-provenance.js';
import { redactWrapped, type WrapperProvenance } from './kernel.js';

const entry = (context: Record<string, unknown>, data: unknown): JournalRecord =>
	({
		timestamp: '2027-01-01T00:00:00.000Z',
		command: 'x',
		input: {},
		contextDigest: { hash: 'h' },
		durationMs: 0,
		context,
		result: { success: true, data },
	}) as unknown as JournalRecord;

describe('the journal provenance', () => {
	it("(4) keeps a running wrapper's child through a burst of other entries, and releases it with the wrapper", () => {
		const provenance = createJournalProvenance();
		expect(provenance.begin('wrap-1')).toBe(true);
		provenance.appended(
			entry({ origin: 'wrap-1', confirmation: 'ntf_aaaaaaaaaaaaaaaa' }, { mine: true })
		);
		// A thousand children of calls that are no running wrapper, nested and by origin: none is kept, none evicts.
		for (let index = 0; index < 1_000; index++) {
			provenance.appended(entry({ parent: `other-${index}` }, { index }));
			provenance.appended(entry({ origin: `other-${index}` }, { index }));
		}
		expect(provenance.origin('wrap-1')?.data).toEqual({ mine: true });
		expect(provenance.run('ntf_aaaaaaaaaaaaaaaa')?.data).toEqual({ mine: true });
		expect(provenance.origin('other-1')).toBeUndefined();
		provenance.end('wrap-1');
		expect(provenance.tracked('wrap-1')).toBe(false);
		expect(provenance.run('ntf_aaaaaaaaaaaaaaaa')).toBeUndefined();
	});

	it('tracks at most its bound of running wrappers; another is untracked, never evicting one', () => {
		const provenance = createJournalProvenance();
		for (let index = 0; index < TRACKED_WRAPPERS; index++)
			expect(provenance.begin(`wrap-${index}`)).toBe(true);
		expect(provenance.begin('one-more')).toBe(false);
		expect(provenance.tracked('wrap-0')).toBe(true);
		expect(provenance.tracked('one-more')).toBe(false);
	});

	it("(Opus 3) drops an act's result its action's entry does not hold, a non-object one among them", () => {
		const tracked = (action: string, journals: boolean): WrapperProvenance => ({
			...createJournalProvenance(),
			tracked: () => true,
			// Its action started, its entry not held (eighth round).
			startedNested: () => true,
			nested: () => undefined,
			action: () => action,
			journals: () => journals,
		});
		const act = (data: unknown) =>
			({
				...entry({}, undefined),
				command: 'notification-act',
				traceId: 't-1',
				result: { success: true, data: { state: 'done', result: data } },
			}) as JournalRecord;
		// A journaled action whose entry is missing: the least of the act, lossy (eighth round), an object or not.
		const missing = redactWrapped(
			act({ a: 1 }),
			(each) => each,
			() => true,
			0,
			tracked('keeper-get', true)
		) as unknown as { result: { data?: unknown }; unreplayable?: boolean };
		expect(missing.result.data).toBeUndefined();
		expect(missing.unreplayable).toBe(true);
		// An unjournaled action: by its own rule when the result is an object, and dropped when it is not.
		expect(
			redactWrapped(
				act(5),
				(each) => each,
				() => true,
				0,
				tracked('notification-list', false)
			).result.data
		).toEqual({
			state: 'done',
		});
		expect(
			redactWrapped(
				act({ notifications: [] }),
				(each) => each,
				() => true,
				0,
				tracked('notification-list', false)
			).result.data
		).toEqual({ state: 'done', result: { notifications: [] } });
	});

	it("(#1672) drops a nested settle's act result, which no provenance vouches for, in a fill's target and a notice's action", () => {
		const settle = {
			settle: {
				id: 'ntf_aaaaaaaaaaaaaaaa',
				person: 'ada',
				command: 'notification-act',
				state: 'confirmed',
				result: { success: true, data: { state: 'done', result: { secret: 'kept?' } } },
			},
		};
		const nested = { command: 'prompt-settle', input: settle };
		for (const [command, input] of [
			['palette-run', nested],
			['notification-push', { title: 'x', action: { label: 'Go', ...nested } }],
		] as const) {
			const done = redactWrapped(
				{ ...entry({}, undefined), command, input, result: { success: true } } as JournalRecord,
				(each) => each,
				() => true
			);
			expect(JSON.stringify(done.input), command).not.toContain('kept?');
			// The act's own part stays: its state, never its action's result.
			expect(JSON.stringify(done.input), command).toContain('"data":{"state":"done"}');
		}
	});

	it('(#2253) observeGate records a gate refusal for a tracked wrapper without recording failures after next()', async () => {
		const provenance = createJournalProvenance();
		provenance.begin('act-1');
		const refused = observeGate(provenance, async () => ({
			success: false,
			error: {
				code: 'UNAUTHORIZED',
				message: 'Authentication required',
				suggestion: 'Sign in',
				retryable: false,
				details: { leaked: 'dropped' },
			},
		}));
		await refused('keeper-note', {}, { parent: 'act-1' }, async () => ({ success: true }));
		expect(provenance.gateRefusal('act-1')).toEqual({
			command: 'keeper-note',
			result: {
				success: false,
				error: {
					code: 'UNAUTHORIZED',
					message: 'Authentication required',
					suggestion: 'Sign in',
					retryable: false,
				},
			},
		});
		expect(provenance.nested('act-1')).toEqual({
			success: false,
			error: {
				code: 'UNAUTHORIZED',
				message: 'Authentication required',
				suggestion: 'Sign in',
				retryable: false,
			},
		});

		// Once `next()` has been called, a downstream failure (e.g. sink rejection) is never treated as a gate refusal.
		const provenance2 = createJournalProvenance();
		provenance2.begin('act-2');
		const passed = observeGate(provenance2, async (_name, _input, _ctx, next) => next());
		await passed('keeper-note', {}, { parent: 'act-2' }, async () => ({
			success: false,
			error: { code: 'UNAUTHORIZED', message: 'downstream' },
		}));
		expect(provenance2.nested('act-2')).toBeUndefined();
	});
});
