/**
 * The bell's unread read (10.3) against a real kernel, with a confirmation whose mounted preview is 64 KiB
 * (`PREVIEW_MAX_BYTES`, #2801): the kernel lists it bounded, so the bell counts and announces it. Before the bound, a
 * person's list kept the preview whole and refused the page (`OUTPUT_BUDGET_EXCEEDED`), and the bell read 0.
 */

import { createScopedWorkspace, NOTIFICATION_TABLE } from '@lushly-dev/loam-kernel/testing';
import type { NotificationV1 } from '@lushly-dev/loam-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchInbox } from './inbox-bell.js';

// The browser's `reportError`, which Node lacks: a read that throws fails the test.
vi.stubGlobal('reportError', (error: unknown) => {
	throw error;
});

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of disposals.splice(0)) await dispose();
});

/** Until `check` holds, or a second has passed. */
async function until(check: () => boolean): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

describe('the bell with a 64 KiB preview waiting (#2801)', () => {
	it('counts the confirmation that waits, read with { limit: 1, unread: true }', async () => {
		const { kernel, store } = await createScopedWorkspace({ empty: true });
		disposals.push(() => kernel.dispose());
		// Every read the bell makes, and its answer.
		const reads: Array<Promise<{ success: boolean }>> = [];
		const call = kernel.call.bind(kernel);
		vi.spyOn(kernel, 'call').mockImplementation(((name: string, input?: unknown) => {
			const answer = call(name, input);
			if (name === 'notification-list') {
				expect(input).toEqual({ limit: 1, unread: true });
				reads.push(answer as never);
			}
			return answer;
		}) as typeof kernel.call);
		// A notice of the shell's own, to learn whose inbox and which scope the session's are.
		const pushed = await call<{ notification: NotificationV1 }>('notification-push', {
			title: 'Hello',
		});
		expect(pushed.success, JSON.stringify(pushed.error)).toBe(true);
		const own = pushed.data?.notification as NotificationV1;
		const shell = { kernel, unread: 0, announcement: '' };
		watchInbox(shell, kernel);
		await until(() => reads.length === 1);
		await reads[0];
		expect(shell.unread).toBe(1);
		// The confirmation, written to the store as the kernel's gate raises one, its preview whole and newest.
		const confirmation = {
			...own,
			id: 'ntf_zzzzzzzzzzzzzzzz',
			kind: 'confirmation',
			source: 'shell',
			title: 'Send the reply set',
			createdAt: own.createdAt + 1,
			confirmation: {
				command: 'mail-replyset-send',
				caller: 'agent:copilot',
				input: {},
				header: 'Requested by the copilot for you',
				prompt: 'Send these replies?',
				title: 'Send',
				expiresAt: own.createdAt + 600_000,
				state: 'pending',
				preview: {
					command: 'mail-replyset-preview',
					digest: 'd'.repeat(43),
					labels: 'per-part',
					data: { text: 'x'.repeat(64 * 1024 - 11) },
				},
			},
		};
		await store.create(NOTIFICATION_TABLE, confirmation as never);
		// The person reads their notice: a mutation of the inbox, so the bell reads again.
		const marked = await kernel.call('notification-read', { notification: own.id });
		expect(marked.success, JSON.stringify(marked.error)).toBe(true);
		await until(() => reads.length === 2);
		const answer = await reads[1];
		expect(answer?.success, JSON.stringify(answer)).toBe(true);
		// The confirmation is the one unread notice: counted, never a refusal read as 0.
		expect(shell.unread).toBe(1);
	});
});
