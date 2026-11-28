/**
 * @fileoverview The panel's conversation, without the DOM (phase 5 specification, 3.2): one session at a time over
 * TanStack AI's `ChatClient`, whose connection sends the person's new text through `copilot-message-send` and hears
 * the session's filtered events from the host. A reset, as a change of person makes, ends the client it had: its
 * subscription is detached, and anything it still reports is dropped, so the next person never sees the thread.
 */

import type { CopilotProviderV1, PanelEventV1 } from '@lushly-dev/loam-kernel/copilot';
import { ChatClient, type SubscribeConnectionAdapter, type UIMessage } from '@tanstack/ai-client';

/** What the panel calls: the kernel's palette interface, the person's. */
export interface CopilotPanelKernelV1 {
	call<T = unknown>(
		name: string,
		input?: unknown
	): Promise<{
		success: boolean;
		data?: T;
		error?: { code: string; message: string; suggestion?: string };
	}>;
}

/** The host's side the panel hears: a session's filtered events, and the run id its client chose. */
export interface CopilotPanelHostV1 {
	subscribe(session: string, listener: (event: PanelEventV1) => void): () => void;
	expectRun(session: string, runId: string): void;
}

/** The notice when no model is configured (4.1): what is missing and where to set it. */
export const NO_MODEL_NOTICE =
	'No model is set up for the copilot. Add a provider under [copilot] in loam.deployment.toml, then run deployment write.';

/** Desktop notice when no model is configured (phase 5 no-terminal amendment, 8.3). */
export const DESKTOP_NO_MODEL_NOTICE =
	'Open Loam → Copilot Models… (or click Configure model…) to add a model provider.';

/** Desktop notice when a configured provider's API key is missing (amendment, 8.3). */
export const DESKTOP_KEY_MISSING_NOTICE =
	'Open Loam → Copilot Models… to set the API key for this provider.';

/** What the conversation tells its view. */
export interface ConversationViewV1 {
	messages(messages: readonly UIMessage[]): void;
	status(status: 'ready' | 'streaming'): void;
	notice(text: string, unavailable?: boolean): void;
}

type TextPart = { type: string; content?: string };

export class CopilotConversation {
	/** The session's id, once the first message started one. */
	session: string | null = null;
	/** The latest turn this conversation sent, from 1; 0 before the first. */
	get turn(): number {
		return this.#turn;
	}
	#client: ChatClient | null = null;
	#turn = 0;
	/** Which client is current: a callback of an earlier one is dropped. */
	#generation = 0;
	#detach: (() => void) | null = null;
	readonly #desktop: boolean;

	constructor(
		private readonly kernel: CopilotPanelKernelV1,
		private readonly host: CopilotPanelHostV1 | null,
		private readonly view: ConversationViewV1,
		options?: { desktop?: boolean }
	) {
		this.#desktop = options?.desktop === true;
	}

	/** Says so when no model is configured (4.1, job 8; desktop amendment 8.3). */
	async checkProviders(): Promise<void> {
		const listed = await this.kernel.call<{ providers: CopilotProviderV1[] }>(
			'copilot-provider-list',
			{}
		);
		if (listed.success && (listed.data?.providers.length ?? 0) === 0)
			this.view.notice(this.#desktop ? DESKTOP_NO_MODEL_NOTICE : NO_MODEL_NOTICE, true);
	}

	async submit(text: string): Promise<void> {
		if (text.trim() === '') return;
		if (!this.session) {
			const generation = this.#generation;
			const started = await this.kernel.call<{ session: { id: string } }>(
				'copilot-session-start',
				{}
			);
			if (generation !== this.#generation) return;
			if (!started.success || !started.data) return this.#fail(started.error);
			this.session = started.data.session.id;
			this.#client = this.#clientFor(this.session);
		}
		this.view.notice('');
		try {
			await this.#client?.sendMessage(text);
		} catch {
			// The notice already says why.
		}
	}

	stop(): void {
		void this.#client?.stop();
	}

	/**
	 * Forget the session and its thread, as a change of person does (3.2): the client it had is detached from the
	 * host, and any message, finish or error it still reports is dropped, so its thread is never drawn again.
	 */
	reset(): void {
		this.#generation += 1;
		this.#detach?.();
		this.#detach = null;
		this.#client = null;
		this.session = null;
		this.#turn = 0;
		this.view.notice('');
		this.view.status('ready');
		this.view.messages([]);
	}

	#fail(error?: { message: string; suggestion?: string }): void {
		this.view.status('ready');
		this.view.notice(
			error ? `${error.message}. ${error.suggestion ?? ''}`.trim() : 'The copilot did not answer.'
		);
	}

	#clientFor(session: string): ChatClient {
		const { kernel, host, view } = this;
		const desktop = this.#desktop;
		const generation = ++this.#generation;
		const current = () => generation === this.#generation;
		const subscriptions = new Set<() => void>();
		this.#detach = () => {
			for (const detach of [...subscriptions]) detach();
		};
		const turn = (seq?: number) => {
			if (seq !== undefined) this.#turn = seq;
			return this.#turn;
		};
		const connection: SubscribeConnectionAdapter = {
			subscribe(signal) {
				const queue: unknown[] = [];
				let wake: (() => void) | undefined;
				let detached = false;
				const unsubscribe = host?.subscribe(session, ({ event }) => {
					if (!current()) return;
					if (
						desktop &&
						event &&
						typeof event === 'object' &&
						(event as { type?: unknown }).type === 'RUN_ERROR'
					) {
						const ev = event as { code?: unknown; message?: unknown };
						if (
							ev.code === 'COPILOT_KEY_MISSING' ||
							(typeof ev.message === 'string' && ev.message.includes('COPILOT_KEY_MISSING'))
						) {
							view.notice(DESKTOP_KEY_MISSING_NOTICE);
						}
					}
					queue.push(event);
					wake?.();
				});
				const detach = () => {
					detached = true;
					unsubscribe?.();
					subscriptions.delete(detach);
					wake?.();
				};
				subscriptions.add(detach);
				return (async function* () {
					try {
						while (!signal?.aborted && !detached) {
							if (queue.length > 0) {
								yield queue.shift() as never;
								continue;
							}
							await new Promise<void>((resolve) => {
								wake = resolve;
								signal?.addEventListener('abort', () => resolve(), { once: true });
							});
							wake = undefined;
						}
					} finally {
						detach();
					}
				})();
			},
			send: async (messages, _data, _signal, run) => {
				// Only the person's new text crosses, through the human command (3.2).
				const last = [...(messages as UIMessage[])]
					.reverse()
					.find((message) => message.role === 'user');
				const text = (last?.parts ?? [])
					.map((part) =>
						(part as TextPart).type === 'text' ? ((part as TextPart).content ?? '') : ''
					)
					.join('');
				if (!current()) throw new Error('The conversation was reset');
				host?.expectRun(session, run.runId);
				this.view.status('streaming');
				const sent = await kernel.call<{ turn: { seq: number } }>('copilot-message-send', {
					session,
					text,
					wait: false,
				});
				if (!current()) throw new Error('The conversation was reset');
				if (!sent.success || !sent.data) {
					this.#fail(sent.error);
					throw new Error(sent.error?.message ?? 'The copilot did not answer');
				}
				turn(sent.data.turn.seq);
			},
			cancelRun: async () => {
				if (!current()) return;
				if (turn() > 0) await kernel.call('copilot-turn-stop', { session, turn: turn() });
				if (current()) this.view.status('ready');
			},
		};
		return new ChatClient({
			connection,
			threadId: session,
			onMessagesChange: (messages: UIMessage[]) => {
				if (current()) this.view.messages(messages);
			},
			onFinish: () => {
				if (current()) this.view.status('ready');
			},
			onError: () => {
				if (current()) this.view.status('ready');
			},
		} as never);
	}
}
