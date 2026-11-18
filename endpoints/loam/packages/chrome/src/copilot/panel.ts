/**
 * @fileoverview `loam-copilot-panel` (phase 5 specification, 3.2 and step 1): a FAST element over TanStack AI's
 * `ChatClient`, with Violet's conversation components, in the shell's panel part. It loads when the panel first
 * opens, never in first paint.
 *
 * - **A message reaches the runtime only through `copilot-message-send`**, a human command the panel calls on the
 *   palette interface; the client's own copy of the history is never sent (3.2). Stopping is `copilot-turn-stop`.
 * - **It draws only text and tool-call parts**, from the events the kernel's panel half forwards, which has already
 *   dropped every interrupt, `CUSTOM` event and approval state. A tool call is a line of text naming the command and
 *   its state, with no button: approval cards come from the kernel's records, in step 3. (`violet-tool-call-card`
 *   imports the settings icon first paint holds, which would part it into a chunk of its own, and bundles
 *   `violet-approval-card`; it returns with step 3's cards.)
 * - **The model's text is text**: every value is set as a text node, never as markup.
 * - Lists are built with the DOM API, by id, so this chunk imports nothing of first paint but FAST's `css`, `html`
 *   and `observable`.
 */

import { css, FASTElement, html, observable } from '@lushly-dev/fast-element';
import type { CopilotProviderV1, PanelEventV1 } from '@lushly-dev/loam-kernel/copilot';
import '@lushly-dev/violet-elements/dist/conversation/violet-conversation-thread.js';
import '@lushly-dev/violet-elements/dist/conversation/violet-message.js';
import '@lushly-dev/violet-elements/dist/conversation/violet-message-text.js';
import '@lushly-dev/violet-elements/dist/conversation/violet-chat-composer.js';
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

type Part = {
	type: string;
	content?: string;
	id?: string;
	name?: string;
	arguments?: string;
	state?: string;
	output?: unknown;
};

/** A tool-call part's state, in words: never an approval, which only the kernel's records draw (3.2). */
export function toolState(part: Part): 'Asked' | 'Running' | 'Done' | 'Failed' {
	if (part.state === 'error') return 'Failed';
	if (part.output !== undefined || part.state === 'complete') return 'Done';
	if (part.state === 'input-complete') return 'Running';
	return 'Asked';
}

const template = html<LoamCopilotPanel>`
	<section class="copilot" aria-label="Copilot">
		<p class="notice" role="status" ?hidden="${(x) => x.notice === ''}">${(x) => x.notice}</p>
		<violet-conversation-thread
			class="thread"
			?empty="${(x) => x.empty}"
			?busy="${(x) => x.status === 'streaming'}"
		>
			<p slot="empty" class="empty">Ask the copilot to do something with Loam’s commands.</p>
		</violet-conversation-thread>
		<violet-chat-composer
			class="composer"
			label="Message the copilot"
			placeholder="Ask the copilot…"
			status="${(x) => x.status}"
			?disabled="${(x) => x.unavailable}"
			@submit="${(x, c) => x.submit((c.event as CustomEvent<{ text: string }>).detail.text)}"
			@stop="${(x) => x.stop()}"
		></violet-chat-composer>
	</section>
`;

const styles = css`
	:host {
		display: block;
		block-size: 100%;
	}
	.copilot {
		display: flex;
		flex-direction: column;
		gap: var(--space-stack-sm);
		box-sizing: border-box;
		block-size: 100%;
		padding: var(--space-layout-sm);
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
		font-weight: var(--type-body-md-weight);
		color: var(--color-text-primary);
	}
	/* The thread scrolls itself, in a focusable log; a scroller here would be a second, unfocusable one. */
	.thread {
		flex: 1;
		min-block-size: 0;
	}
	.notice,
	.empty,
	.tool {
		margin: 0;
		color: var(--color-text-secondary);
	}
	[hidden] {
		display: none;
	}
`;

/** The panel: one session at a time, started on the first message. */
export class LoamCopilotPanel extends FASTElement {
	declare notice: string;
	declare status: 'ready' | 'streaming';
	declare empty: boolean;
	declare unavailable: boolean;
	kernel: CopilotPanelKernelV1 | null = null;
	host: CopilotPanelHostV1 | null = null;
	/** The session's id, once the first message started one. */
	session: string | null = null;
	#client: ChatClient | null = null;
	#turn = 0;

	constructor() {
		super();
		this.notice = '';
		this.status = 'ready';
		this.empty = true;
		this.unavailable = false;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		void this.checkProviders();
	}

	/** Says so when no model is configured (4.1, job 8). */
	async checkProviders(): Promise<void> {
		const listed = await this.kernel?.call<{ providers: CopilotProviderV1[] }>(
			'copilot-provider-list',
			{}
		);
		if (listed?.success && (listed.data?.providers.length ?? 0) === 0) {
			this.notice = NO_MODEL_NOTICE;
			this.unavailable = true;
		}
	}

	async submit(text: string): Promise<void> {
		if (!this.kernel || text.trim() === '') return;
		if (!this.session) {
			const started = await this.kernel.call<{ session: { id: string } }>(
				'copilot-session-start',
				{}
			);
			if (!started.success || !started.data) return this.fail(started.error);
			this.session = started.data.session.id;
			this.#client = this.#clientFor(this.session);
		}
		this.notice = '';
		try {
			await this.#client?.sendMessage(text);
		} catch {
			// The notice already says why.
		}
	}

	stop(): void {
		void this.#client?.stop();
	}

	/** Forget the session and its thread, as a change of person does: the next person never sees it (3.2). */
	reset(): void {
		this.#client = null;
		this.session = null;
		this.#turn = 0;
		this.notice = '';
		this.unavailable = false;
		this.status = 'ready';
		this.render([]);
		void this.checkProviders();
	}

	fail(error?: { message: string; suggestion?: string }): void {
		this.status = 'ready';
		this.notice = error
			? `${error.message}. ${error.suggestion ?? ''}`.trim()
			: 'The copilot did not answer.';
	}

	#clientFor(session: string): ChatClient {
		const kernel = this.kernel as CopilotPanelKernelV1;
		const host = this.host;
		const turn = (seq?: number) => {
			if (seq !== undefined) this.#turn = seq;
			return this.#turn;
		};
		const connection: SubscribeConnectionAdapter = {
			subscribe(signal) {
				const queue: unknown[] = [];
				let wake: (() => void) | undefined;
				const unsubscribe = host?.subscribe(session, ({ event }) => {
					queue.push(event);
					wake?.();
				});
				return (async function* () {
					try {
						while (!signal?.aborted) {
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
						unsubscribe?.();
					}
				})();
			},
			send: async (messages, _data, _signal, run) => {
				// Only the person's new text crosses, through the human command (3.2).
				const last = [...(messages as UIMessage[])]
					.reverse()
					.find((message) => message.role === 'user');
				const text = (last?.parts ?? [])
					.map((part) => ((part as Part).type === 'text' ? ((part as Part).content ?? '') : ''))
					.join('');
				host?.expectRun(session, run.runId);
				this.status = 'streaming';
				const sent = await kernel.call<{ turn: { seq: number } }>('copilot-message-send', {
					session,
					text,
					wait: false,
				});
				if (!sent.success || !sent.data) {
					this.fail(sent.error);
					throw new Error(sent.error?.message ?? 'The copilot did not answer');
				}
				turn(sent.data.turn.seq);
			},
			cancelRun: async () => {
				if (turn() > 0) await kernel.call('copilot-turn-stop', { session, turn: turn() });
				this.status = 'ready';
			},
		};
		return new ChatClient({
			connection,
			threadId: session,
			onMessagesChange: (messages: UIMessage[]) => this.render(messages),
			onFinish: () => {
				this.status = 'ready';
			},
			onError: () => {
				this.status = 'ready';
			},
		} as never);
	}

	/** Rebuilds the thread from the client's messages, by the DOM API, every value as text. */
	render(messages: readonly UIMessage[]): void {
		const thread = this.shadowRoot?.querySelector('.thread');
		if (!thread) return;
		const doc = thread.ownerDocument;
		const built = messages.map((message) => {
			const item = doc.createElement('violet-message');
			item.setAttribute('message-role', message.role === 'user' ? 'user' : 'assistant');
			item.dataset.id = message.id;
			for (const part of message.parts as Part[]) {
				if (part.type === 'text') {
					const text = doc.createElement('violet-message-text');
					text.textContent = part.content ?? '';
					item.append(text);
				} else if (part.type === 'tool-call') {
					const line = doc.createElement('p');
					line.className = 'tool';
					line.dataset.toolCallId = part.id ?? '';
					const name = doc.createElement('code');
					name.textContent = part.name ?? '';
					const state = doc.createElement('span');
					state.className = 'tool-state';
					state.textContent = toolState(part);
					line.append('Command ', name, ': ', state);
					item.append(line);
				}
			}
			return item;
		});
		const empty = thread.querySelector('[slot="empty"]');
		thread.replaceChildren(...(empty ? [empty] : []), ...built);
		this.empty = built.length === 0;
	}
}

observable(LoamCopilotPanel.prototype, 'notice');
observable(LoamCopilotPanel.prototype, 'status');
observable(LoamCopilotPanel.prototype, 'empty');
observable(LoamCopilotPanel.prototype, 'unavailable');

export const COPILOT_PANEL_DEFINITION = { name: 'loam-copilot-panel', template, styles };
