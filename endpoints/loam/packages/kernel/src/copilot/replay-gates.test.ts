/**
 * #2118: a copilot call a replay answers from its record still runs the gates, as any other agent's does (#1936). Its
 * entry journals the copilot's `trace`, `copilotSession` and `turn`, which the replay restores to the call's context,
 * so the enforcement gate decides it again with the same trace: an `ask` raises its confirmation again, and the
 * person's answer to it replays. The session's taint sources the gate read are journaled with it (`taint`), so a
 * confirmation the taint asked for replays with the same reason, sources and chain.
 *
 * A replay has no model, so a journal's `copilot-*` entries do not replay yet: this replays the calls the copilot made
 * and what the person did with them, renumbered without the copilot's own entries.
 */

import type { JournalEntry } from '@lushly-dev/afd-core';
import type { NotificationV1 } from '@lushly-dev/loam-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { p5Base, type SeededKernel } from '../../scenarios/seeds.js';
import { replayKernel } from '../testing.js';
import type { CopilotTurnV1 } from './types.js';

const seeded: SeededKernel[] = [];

/** The journal without the copilot's own entries, which a replay with no model cannot run, renumbered. */
const withoutCopilot = (entries: readonly JournalEntry[]) =>
	entries
		.filter(({ command }) => !command.startsWith('copilot-'))
		.map((entry, index) => ({ ...entry, seq: index + 1 }) as JournalEntry);
const optionsOf = (made: SeededKernel) => ({
	...(made.deployment ? { deployment: made.deployment } : {}),
	...(made.ports ? { ports: made.ports } : {}),
});
afterEach(async () => {
	for (const each of seeded.splice(0)) await each.dispose();
});

describe('#2118: a recorded copilot call replays its gates', () => {
	it('asks again for a mounted tool the copilot called under an ask row, and replays the person’s confirm', async () => {
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

		const entries = withoutCopilot(await journal.read());
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
		// Before #2118 the replay answered it whole, so no confirmation was raised and its prompt diverged.
		const { report } = await replayKernel(entries, optionsOf(made));
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
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
		const entries = withoutCopilot(await journal.read());
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
