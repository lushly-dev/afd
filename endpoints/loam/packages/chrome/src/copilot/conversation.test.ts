/**
 * The copilot panel's conversation without the DOM (phase 5 specification, 3.2): a message goes through
 * `copilot-message-send` alone, and a reset, as a change of person makes, leaves the previous person's thread drawn
 * nowhere, whatever its client still reports.
 */

import type { PanelEventV1 } from '@lushly-dev/loam-kernel/copilot';
import { describe, expect, it, vi } from 'vitest';
import {
	CopilotConversation,
	DESKTOP_KEY_MISSING_NOTICE,
	DESKTOP_NO_MODEL_NOTICE,
	NO_MODEL_NOTICE,
} from './conversation.js';

function fakes(providers = 1) {
	const calls: Array<{ name: string; input: unknown }> = [];
	const listeners = new Set<(event: PanelEventV1) => void>();
	const runs: string[] = [];
	const kernel = {
		async call<T>(name: string, input?: unknown) {
			calls.push({ name, input });
			if (name === 'copilot-provider-list')
				return {
					success: true,
					data: {
						providers: Array.from({ length: providers }, () => ({
							id: 't',
							kind: 'test',
							model: 'm',
						})),
					} as T,
				};
			if (name === 'copilot-session-start')
				return { success: true, data: { session: { id: 'cps_0000000000000001' } } as T };
			if (name === 'copilot-message-send')
				return { success: true, data: { turn: { seq: 1 } } as T };
			return { success: true, data: {} as T };
		},
	};
	const host = {
		subscribe(_session: string, listener: (event: PanelEventV1) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		expectRun(_session: string, runId: string) {
			runs.push(runId);
		},
	};
	const drawn: Array<readonly unknown[]> = [];
	const notices: string[] = [];
	const view = {
		messages: (messages: readonly unknown[]) => drawn.push(messages),
		status: () => {},
		notice: (text: string) => notices.push(text),
	};
	const emit = (event: Record<string, unknown>) => {
		for (const listener of [...listeners]) listener({ runId: runs.at(-1) ?? '', event });
	};
	return { kernel, host, view, calls, listeners, runs, drawn, notices, emit };
}

describe('the copilot panel’s conversation', () => {
	it('sends the person’s text through copilot-message-send alone, and draws the run’s events', async () => {
		const made = fakes();
		const conversation = new CopilotConversation(made.kernel, made.host, made.view);
		void conversation.submit('Hello');
		await vi.waitFor(() => expect(made.runs).toHaveLength(1));
		expect(made.calls.find((call) => call.name === 'copilot-message-send')?.input).toEqual({
			session: 'cps_0000000000000001',
			text: 'Hello',
			wait: false,
		});
		const runId = made.runs[0];
		made.emit({ type: 'RUN_STARTED', runId, threadId: 'cps_0000000000000001' });
		made.emit({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' });
		made.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hi there' });
		made.emit({ type: 'TEXT_MESSAGE_END', messageId: 'm1' });
		made.emit({ type: 'RUN_FINISHED', runId, threadId: 'cps_0000000000000001' });
		await vi.waitFor(() => expect(JSON.stringify(made.drawn.at(-1))).toContain('Hi there'));
	});

	it('draws nothing of the previous person’s thread after a reset, whatever its client still reports', async () => {
		const made = fakes();
		const conversation = new CopilotConversation(made.kernel, made.host, made.view);
		void conversation.submit('Secret plans');
		await vi.waitFor(() => expect(made.runs).toHaveLength(1));
		const runId = made.runs[0];
		made.emit({ type: 'RUN_STARTED', runId, threadId: 'cps_0000000000000001' });
		made.emit({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' });
		made.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'About the secret' });
		await vi.waitFor(() => expect(JSON.stringify(made.drawn.at(-1))).toContain('About the secret'));
		const before = made.drawn.length;
		conversation.reset();
		expect(made.drawn.at(-1)).toEqual([]);
		expect(conversation.session).toBeNull();
		// The kernel's stop reaches the old client as RUN_FINISHED, with more text queued behind it.
		made.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: ' and more' });
		made.emit({ type: 'RUN_FINISHED', runId, threadId: 'cps_0000000000000001' });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(made.drawn.slice(before + 1)).toEqual([]);
		expect(made.drawn.at(-1)).toEqual([]);
		expect(made.listeners.size).toBe(0);
	});

	it('says no model is set up, and where, when none is configured (job 8)', async () => {
		const made = fakes(0);
		const conversation = new CopilotConversation(made.kernel, made.host, made.view);
		await conversation.checkProviders();
		expect(made.notices).toEqual([NO_MODEL_NOTICE]);
		expect(NO_MODEL_NOTICE).toContain('loam.deployment.toml');
	});

	it('uses desktop setup suggestions on desktop for missing provider and missing API key (amendment 8.3)', async () => {
		const empty = fakes(0);
		const desktopConv = new CopilotConversation(empty.kernel, empty.host, empty.view, {
			desktop: true,
		});
		await desktopConv.checkProviders();
		expect(empty.notices).toEqual([DESKTOP_NO_MODEL_NOTICE]);
		expect(DESKTOP_NO_MODEL_NOTICE).toContain('Copilot Models…');

		const live = fakes(1);
		const liveDesktop = new CopilotConversation(live.kernel, live.host, live.view, {
			desktop: true,
		});
		void liveDesktop.submit('Hello');
		await vi.waitFor(() => expect(live.runs).toHaveLength(1));
		live.emit({
			type: 'RUN_ERROR',
			runId: live.runs[0],
			threadId: 'cps_0000000000000001',
			message: 'The turn failed: COPILOT_KEY_MISSING',
		});
		await vi.waitFor(() => expect(live.notices).toContain(DESKTOP_KEY_MISSING_NOTICE));
	});
});
