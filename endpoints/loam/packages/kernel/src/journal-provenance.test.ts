/**
 * The journal's provenance for its wrappers (phase 4's step 6, seventh round): a running wrapper's children are kept
 * whatever else is journaled meanwhile, released with the wrapper, and a wrapper past the bound is not tracked.
 */
import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import type { JournalRecord } from '@lushly-dev/afd-core';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { defineCommand, success, type ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createKernelParts, redactSafely } from './kernel.js';
import {
	createJournalProvenance,
	createJournalWrappers,
	observeGate,
	redactWrapped,
	TRACKED_WRAPPERS,
	type WrapperProvenance,
} from './late/journal-wrappers.js';
import { createFixedEnvironment } from './testing.js';

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

	it('(#2107) createJournalWrappers tracks only JOURNAL_WRAPPERS and injects provenance/redaction into redactSafely', async () => {
		const wrappers = createJournalWrappers((cmd) => cmd !== 'palette-search');
		expect(wrappers.begin('keeper-note', 't-plain')).toBe(false);
		expect(wrappers.begin('palette-run', 't-wrap')).toBe(true);
		wrappers.started('t-wrap', 'origin');
		wrappers.appended(entry({ origin: 't-wrap' }, { kept: 'from-sink' }));
		const redacted = redactSafely(
			{
				...entry({}, { leaked: 'live' }),
				command: 'palette-run',
				traceId: 't-wrap',
				input: { command: 'keeper-note', input: { text: 'ok' } },
			} as JournalRecord,
			(each) => each,
			() => true,
			wrappers.redact
		);
		expect(redacted.result.data).toEqual({ kept: 'from-sink' });
		wrappers.end('t-wrap');

		// Without late's wrapper callback (stage A), redactSafely applies own redaction and still fails closed on throws.
		const stageA = redactSafely(
			{ ...entry({}, { a: 1 }), command: 'appearance-get' } as JournalRecord,
			(each) => ({ ...each, input: { scrubbed: true } }),
			() => true
		);
		expect(stageA.input).toEqual({ scrubbed: true });
		const thrownWrap = redactSafely(
			{
				...entry({}, { secret: 'nope' }),
				command: 'palette-run',
				input: { secret: 'nope' },
			} as JournalRecord,
			(each) => each,
			() => true,
			() => {
				throw new Error('wrapper redaction failed');
			}
		) as unknown as {
			result: { error?: { code?: string } };
			unreplayable?: boolean;
			unredacted?: boolean;
		};
		expect(thrownWrap.result.error?.code).toBe('JOURNAL_REDACTION_FAILED');
		expect(thrownWrap.unreplayable).toBe(true);
		expect(thrownWrap.unredacted).toBe(true);
		expect(JSON.stringify(thrownWrap)).not.toContain('nope');
	});

	it('(#2107) observeGate calls onFinally on pass, refusal and throw, and skips when traceId is absent', async () => {
		const provenance = createJournalProvenance();
		const cleaned: string[] = [];
		const onFinally = (traceId: string) => cleaned.push(traceId);

		const passGate = observeGate(
			provenance,
			async (_name, _input, _ctx, next) => next(),
			onFinally
		);
		await passGate('a', {}, { traceId: 't-pass' }, async () => ({ success: true }));
		await passGate('a', {}, {}, async () => ({ success: true }));

		const refuseGate = observeGate(
			provenance,
			async () => ({ success: false, error: { code: 'UNAUTHORIZED', message: 'nope' } }),
			onFinally
		);
		await refuseGate('b', {}, { traceId: 't-refuse' }, async () => ({ success: true }));

		const throwGate = observeGate(
			provenance,
			async () => {
				throw new Error('boom');
			},
			onFinally
		);
		await expect(
			throwGate('c', {}, { traceId: 't-throw' }, async () => ({ success: true }))
		).rejects.toThrow('boom');

		expect(cleaned).toEqual(['t-pass', 't-refuse', 't-throw']);
	});

	it('(#2107) boot kernel keeps colliding wrapper-named host commands out of stage A and refuses them if late fails', async () => {
		const report = vi.fn();
		vi.stubGlobal('reportError', report);
		try {
			const journal = new MemoryJournalSink();
			const ran = vi.fn();
			const colliding = defineCommand({
				name: 'notification-push',
				description: 'Host command colliding with a wrapper-redacted shell command',
				input: z.object({
					title: z.string(),
					action: z.object({
						command: z.string(),
						label: z.string(),
						input: z.record(z.string(), z.unknown()),
					}),
				}),
				handler: async (input) => {
					ran(input);
					return success({ ok: true });
				},
			}) as unknown as ZodCommandDefinition;

			const parts = await createKernelParts({
				store: new MemoryAdapter(),
				storeKind: 'memory',
				host: 'test',
				journal,
				auth: new MockAuthAdapter(),
				environment: createFixedEnvironment(),
				boot: { generation: 'boot-1', workspace: { id: 'w1', name: 'W1' }, apps: [] },
				commands: [colliding],
			});
			// Before stage B: mcpOptions stays undefined, setAppCommands also withholds wrapper names, and calling them waits for stage B.
			parts.setAppCommands([colliding]);
			expect(parts.registries.palette.hasCommand('notification-push')).toBe(false);
			expect(parts.mcpOptions()).toBeUndefined();
			const secret = 'hunter-stage-a-secret';
			const payload = {
				title: 'Sign in',
				action: {
					command: 'auth-sign-in',
					label: 'Sign in',
					input: { email: 'ada@example.com', password: secret },
				},
			};
			// Queued behind startApps(), which rejects the duplicate name into lateFailure without running the host handler.
			const duringStartup = await parts.kernel.call('notification-push', payload);
			expect(duringStartup.success).toBe(false);
			expect(duringStartup.error?.code).toBe('LATE_COMMANDS_UNAVAILABLE');
			expect(parts.kernel.lateFailure?.code).toBe('LATE_COMMANDS_UNAVAILABLE');
			expect(parts.mcpOptions()).toBeUndefined();

			// After late failure: setAppCommands still withholds wrapper names, and calls never run or journal secrets.
			parts.setAppCommands([colliding]);
			expect(parts.registries.palette.hasCommand('notification-push')).toBe(false);
			const afterFailure = await parts.kernel.call('notification-push', payload);
			expect(afterFailure.success).toBe(false);
			expect(afterFailure.error?.code).toBe('LATE_COMMANDS_UNAVAILABLE');
			expect(ran).not.toHaveBeenCalled();

			const entries = await journal.read();
			expect(JSON.stringify(entries)).not.toContain(secret);
			await parts.kernel.dispose();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('(#2107) boot kernel transitions cleanly from stage A to stage B with wrapper redaction and mcpOptions', async () => {
		const journal = new MemoryJournalSink();
		const flakey = defineCommand({
			name: 'probe-throw',
			description: 'Throws once to verify stage-A thrownTraces cleanup',
			input: z.object({ fail: z.boolean() }),
			handler: async (input) => {
				if (input.fail) throw new Error('stage-a-boom');
				return success({ ok: true });
			},
		}) as unknown as ZodCommandDefinition;

		const parts = await createKernelParts({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			host: 'test',
			journal,
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			boot: { generation: 'boot-2', workspace: { id: 'w1', name: 'W1' }, apps: [] },
			commands: [flakey],
		});
		expect(parts.mcpOptions()).toBeUndefined();

		// Stage A throw is caught and marked lossy; next call is clean (thrownTraces did not leak).
		const thrown = await parts.kernel.call('probe-throw', { fail: true });
		expect(thrown.success).toBe(false);
		const ok = await parts.kernel.call('probe-throw', { fail: false });
		expect(ok.success).toBe(true);

		// Stage B installs wrappers and rebuilds registries + mcpOptions.
		await parts.kernel.startApps();
		await parts.kernel.appsReady;
		expect(parts.mcpOptions()).toBeDefined();

		const secret = 'hunter-stage-b-secret';
		await parts.kernel.call('palette-run', {
			command: 'auth-sign-in',
			input: { email: 'ada@example.com', password: secret },
		});
		const entries = await journal.read();
		expect(JSON.stringify(entries)).not.toContain(secret);
		expect(entries.some((e) => e.command === 'palette-run')).toBe(true);
		const throwEntry = entries.find(
			(e) => e.command === 'probe-throw' && (e.input as { fail?: boolean }).fail === true
		) as unknown as { lossy?: boolean; unreplayable?: boolean } | undefined;
		expect(throwEntry?.lossy).toBe(true);
		const okEntry = entries.find(
			(e) => e.command === 'probe-throw' && (e.input as { fail?: boolean }).fail === false
		) as unknown as { lossy?: boolean; unreplayable?: boolean } | undefined;
		expect(okEntry?.lossy).toBeUndefined();

		await parts.kernel.dispose();
	});
});
