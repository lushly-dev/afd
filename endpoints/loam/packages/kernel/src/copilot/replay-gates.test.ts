/**
 * #2118, #2325: a copilot call a replay answers from its record still runs the gates, as any other agent's does
 * (#1936). Its entry journals the copilot's `trace`, `copilotSession` and `turn`, which the replay restores to the
 * call's context, so the enforcement gate decides it again with the same trace: an `ask` raises its confirmation
 * again, and the person's answer to it replays. The session's taint sources the gate read are journaled with it
 * (`taint`), so a confirmation the taint asked for replays with the same reason, sources and chain.
 *
 * A replay has no model or copilot runner, so `copilot-*` entries are answered from the record (#2325), allowing
 * the full journal to replay directly without stripping or renumbering.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import type { CommandContext, JournalEntry, JournalRecord } from '@lushly-dev/afd-core';
import { MemoryJournalSink, success } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { NotificationV1 } from '@lushly-dev/loam-sdk';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import * as z from 'zod/mini';
import { p5Base, type SeededKernel } from '../../scenarios/seeds.js';
import { LoamKernelError } from '../errors.js';
import { RECORDED_TAINT } from '../journal-order.js';
import { redactJournalRecord } from '../journal-redact.js';
import { createKernelParts } from '../kernel.js';
import { createFixedEnvironment } from '../session.js';
import { nestedReplay, replayKernel } from '../testing.js';
import { createEnforcement } from './enforce.js';
import type { CopilotTurnV1 } from './types.js';

const seeded: SeededKernel[] = [];

const optionsOf = (made: SeededKernel) => ({
	...(made.deployment ? { deployment: made.deployment } : {}),
	...(made.ports ? { ports: made.ports } : {}),
});
afterEach(async () => {
	for (const each of seeded.splice(0)) await each.dispose();
});

describe('#2118, #2325: a recorded copilot call replays its gates', () => {
	it('asks again for a mounted tool the copilot called under an ask row, and replays the full journal including copilot-* entries', async () => {
		const made = await p5Base({
			provider: true,
			scripts: {
				go: [
					{ tools: [{ name: 'mailfix-thread-open', input: { thread: 'thr_1' } }] },
					{ text: 'Asked.' },
				],
			},
		});
		seeded.push(made);
		const { kernel, journal } = made;
		const row = await kernel.call('autonomy-set', {
			level: 'workspace',
			instance: 'mailfix',
			command: 'mailfix-thread-open',
			mode: 'ask',
		});
		expect(row.success, JSON.stringify(row.error)).toBe(true);
		const started = await kernel.call<{ session: { id: string } }>('copilot-session-start', {});
		const sent = await kernel.call<{ turn: CopilotTurnV1 }>('copilot-message-send', {
			session: started.data?.session.id,
			text: 'script:go',
		});
		const [call] = sent.data?.turn.calls ?? [];
		expect(call).toMatchObject({ command: 'mailfix-thread-open', mode: 'ask', outcome: 'pending' });
		const acted = await kernel.call('notification-act', {
			notification: (call as { notification?: string }).notification,
			answer: 'confirm',
		});
		expect(acted.data).toMatchObject({ state: 'confirmed' });

		const entries = await journal.read();
		const copilotSeqs = entries
			.filter(({ command }) => command.startsWith('copilot-'))
			.map(({ seq }) => seq);
		expect(copilotSeqs.length).toBeGreaterThanOrEqual(2);
		// The copilot's call, a mounted one the replay answers from its record, journaled with its trace.
		const asked = entries.find(
			(entry) =>
				entry.command === 'mailfix-thread-open' && entry.context?.confirmation === undefined
		);
		expect(asked?.context).toMatchObject({
			autonomy: 'ask',
			replay: 'recorded',
			copilotSession: started.data?.session.id,
			trace: { session: started.data?.session.id, turn: 1 },
		});
		// Replays the full journal directly, answering copilot-* from the record (#2325) while re-running the gates (#2118).
		const { report } = await replayKernel(entries, optionsOf(made));
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		for (const seq of copilotSeqs) expect(report.recorded).toContain(seq);
	});

	it('asks again under the taint the session had live, with its reason, sources and chain', async () => {
		const made = await p5Base({
			provider: true,
			mailfixb: true,
			scripts: {
				go: [
					{ tools: [{ name: 'mailfix-thread-open', input: { thread: 'thr_2' } }] },
					{ tools: [{ name: 'mailfixb-thread-list', input: {} }] },
					{ text: 'Asked.' },
				],
			},
		});
		seeded.push(made);
		const { kernel, journal } = made;
		await kernel.call('autonomy-set', {
			level: 'workspace',
			instance: 'mailfixb',
			command: 'mailfixb-thread-list',
			mode: 'act',
		});
		const started = await kernel.call<{ session: { id: string } }>('copilot-session-start', {});
		const sent = await kernel.call<{ turn: CopilotTurnV1 }>('copilot-message-send', {
			session: started.data?.session.id,
			text: 'script:go',
		});
		expect(sent.data?.turn.calls[1]).toMatchObject({ mode: 'ask', reason: 'taint' });
		const asked = async (on: typeof kernel) =>
			(
				await on.call<{ notifications: NotificationV1[] }>('notification-list', {
					kind: 'confirmation',
					body: true,
				})
			).data?.notifications.map((each) => each.confirmation?.asked);
		const live = await asked(kernel);
		expect(live).toEqual([expect.objectContaining({ reason: 'taint', sources: ['mailfix'] })]);
		const entries = await journal.read();
		expect(
			entries.find(({ command }) => command === 'mailfixb-thread-list')?.context
		).toMatchObject({
			autonomy: 'ask',
			taint: ['mailfix'],
		});
		const { report, kernel: replayed } = await replayKernel(entries, {
			...optionsOf(made),
			keep: true,
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		if (!replayed) throw new Error('replayKernel kept no kernel');
		try {
			// The confirmation as the replay raised it again, not only its id in the result.
			expect(await asked(replayed)).toEqual(live);
		} finally {
			await replayed.dispose();
		}
	});
});

describe('#2325: replay residuals', () => {
	it('re-runs a write nested inside a re-run notice action, keeps nested reads from record, and forwards taint', () => {
		const OUTER = {
			name: 'book-outer',
			mutation: true,
			inputSchema: z.object({ name: z.string() }),
		} as unknown as ZodCommandDefinition;
		const INNER_READ = {
			name: 'book-read',
			mutation: false,
			inputSchema: z.object({}),
		} as unknown as ZodCommandDefinition;
		const INNER_WRITE = {
			name: 'book-inner',
			mutation: true,
			inputSchema: z.object({ name: z.string() }),
		} as unknown as ZodCommandDefinition;
		const entry = (
			seq: number,
			traceId: string,
			command: string,
			input: unknown,
			result: unknown,
			context?: Record<string, unknown>
		): JournalEntry =>
			({
				seq,
				timestamp: '2026-11-24T00:00:00.000Z',
				traceId,
				command,
				input,
				contextDigest: { interface: 'palette' },
				...(context ? { context } : {}),
				result,
				durationMs: 1,
			}) as JournalEntry;
		const entries: JournalEntry[] = [
			entry(
				1,
				'loam-t-3',
				'book-read',
				{},
				{ success: true, data: { items: [] } },
				{ parent: 'loam-t-2' }
			),
			entry(
				2,
				'loam-t-4',
				'book-inner',
				{ name: 'Bob' },
				{ success: true, data: { wrote: true } },
				{ parent: 'loam-t-2', taint: ['mailfix'] }
			),
			entry(
				3,
				'loam-t-2',
				'book-outer',
				{ name: 'Bob' },
				{ success: true, data: { ok: true } },
				{ parent: 'loam-t-1' }
			),
			entry(
				4,
				'loam-t-1',
				'notification-act',
				{ notification: 'ntf_1', action: 'run' },
				{ success: true }
			),
		];
		const nested = nestedReplay(entries);
		const outer = nested.take('loam-t-1', 'book-outer', { name: 'Bob' }, OUTER);
		expect(outer && 'rerun' in outer).toBe(true);
		// A nested read inside a re-run notice action stays answered from record.
		const read = nested.take('loam-t-2', 'book-read', {}, INNER_READ);
		expect(read).toEqual({ success: true, data: { items: [] } });
		// A nested write inside a re-run notice action re-runs and carries its recorded taint.
		const inner = nested.take('loam-t-2', 'book-inner', { name: 'Bob' }, INNER_WRITE);
		expect(inner && 'rerun' in inner).toBe(true);
		if (inner && 'rerun' in inner) {
			expect(inner.rerun.traceId).toBe('loam-t-4');
			expect((inner.rerun.context as { taint?: unknown }).taint).toEqual(['mailfix']);
			inner.rerun.done({ success: true, data: { wrote: true } });
		}
		if (outer && 'rerun' in outer) outer.rerun.done({ success: true, data: { ok: true } });
		expect([...nested.problems.entries()]).toEqual([]);

		// A diverging nested write records a problem naming the nested write.
		const diverged = nestedReplay(entries);
		const outer2 = diverged.take('loam-t-1', 'book-outer', { name: 'Bob' }, OUTER);
		diverged.take('loam-t-2', 'book-read', {}, INNER_READ);
		const inner2 = diverged.take('loam-t-2', 'book-inner', { name: 'Bob' }, INNER_WRITE);
		if (inner2 && 'rerun' in inner2) inner2.rerun.done({ success: true, data: { wrote: false } });
		if (outer2 && 'rerun' in outer2) outer2.rerun.done({ success: true, data: { ok: true } });
		expect(diverged.problems.get('loam-t-4')).toContain("The nested write 'book-inner'");
	});

	it('calls rerun.done when a re-run nested action throws in registry.execute', async () => {
		const doneResults: unknown[] = [];
		const parts = await createKernelParts(
			{
				store: new MemoryAdapter(),
				storeKind: 'memory',
				journal: new MemoryJournalSink(),
				auth: new MockAuthAdapter(),
				environment: createFixedEnvironment(),
				host: 'test',
			},
			{
				replaying: true,
				answerNested: (_parent, name) =>
					name === 'layout-get'
						? {
								rerun: {
									traceId: 'loam-t-99',
									context: {},
									done: (result) => {
										doneResults.push(result);
									},
								},
							}
						: undefined,
			}
		);
		try {
			const pushed = await parts.kernel.call<{ notification: { id: string } }>(
				'notification-push',
				{
					title: 'Throw on rerun',
					action: { command: 'layout-get', label: 'Run', input: {} },
				}
			);
			expect(pushed.success, JSON.stringify(pushed.error)).toBe(true);
			const originalExecute = parts.registries.palette.execute.bind(parts.registries.palette);
			parts.registries.palette.execute = async (name, input, context) => {
				if (name === 'layout-get' && (context as { parent?: unknown }).parent !== undefined)
					throw new Error('boom during replay');
				return originalExecute(name, input, context);
			};
			await parts.kernel.call('notification-act', {
				notification: pushed.data?.notification.id,
			});
			expect(doneResults).toHaveLength(1);
			expect(doneResults[0]).toMatchObject({
				success: false,
				error: { code: 'COMMAND_EXECUTION_ERROR', message: 'boom during replay' },
			});
		} finally {
			await parts.kernel.dispose();
		}
	});

	it('marks an entry with contextOmitted taint unreplayable and stops replay there', async () => {
		const record = {
			timestamp: '2026-11-24T00:00:00.000Z',
			traceId: 'loam-t-1',
			command: 'mailfixb-thread-list',
			input: {},
			contextDigest: { interface: 'agent' },
			context: { autonomy: 'ask' },
			contextOmitted: ['taint'],
			result: { success: true, data: {} },
			durationMs: 1,
		} as unknown as JournalRecord;
		const redacted = redactJournalRecord(record) as JournalRecord & {
			unreplayable?: boolean;
			lossy?: boolean;
		};
		expect(redacted.unreplayable).toBe(true);
		expect(redacted.lossy).toBe(true);

		// Even an older journal entry with contextOmitted: ['taint'] and no unreplayable flag stops replay.
		const entry = { seq: 1, ...record } as unknown as JournalEntry;
		await expect(replayKernel([entry])).rejects.toThrowError(LoamKernelError);
		await expect(replayKernel([entry])).rejects.toMatchObject({
			code: 'REPLAY_ENTRY_TRUNCATED',
			details: { seq: 1, command: 'mailfixb-thread-list' },
		});
	});

	it('nestedGate journals taint live and uses RECORDED_TAINT on replay without calling live taintOf', async () => {
		let liveCalls = 0;
		const enforcement = createEnforcement({
			store: {} as never,
			workspace: 'ws',
			health: {} as never,
			resolve: async () => undefined,
			isMutation: () => true,
			isMounted: () => false,
			heldBy: () => undefined,
			preflight: () => undefined,
			journaled: () => true,
			declares: () => false,
			exempt: () => false,
			handOff: async () => undefined,
			instanceOf: () => 'book',
			taintOf: async () => {
				liveCalls++;
				return ['mailfix'];
			},
			labelsOf: () => undefined,
			holdsHttp: () => false,
			personOf: () => 'p1',
			now: () => 0,
			decided: () => {},
			nestedRaised: () => {},
			enterable: () => true,
			projectNotFound: () => ({
				success: false,
				error: { code: 'PROJECT_NOT_FOUND', message: '' },
			}),
			kernelFailure: (code, message, suggestion) => ({
				success: false,
				error: { code, message, suggestion },
			}),
		});

		const liveContext = {
			parent: 'loam-t-1',
			trace: { session: 'cop_1', turn: 1, call: 'c1' },
		} as unknown as CommandContext & { taint?: string[] };
		await enforcement.gate('book-write', {}, liveContext, async () => success({ ok: true }));
		expect(liveCalls).toBe(1);
		expect(liveContext.taint).toEqual(['mailfix']);

		const replayContext = {
			parent: 'loam-t-1',
			trace: { session: 'cop_1', turn: 1, call: 'c1' },
			[RECORDED_TAINT]: ['mailfixb'],
		} as unknown as CommandContext & { taint?: string[] };
		await enforcement.gate('book-write', {}, replayContext, async () => success({ ok: true }));
		expect(liveCalls).toBe(1);
		expect(replayContext.taint).toEqual(['mailfixb']);
	});
});
