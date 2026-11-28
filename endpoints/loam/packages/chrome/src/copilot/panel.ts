/**
 * @fileoverview `loam-copilot-panel` (phase 5 specification, 3.2 and step 1): a FAST element over TanStack AI's
 * `ChatClient`, with Violet's conversation components, in the shell's panel part. It loads when the panel first
 * opens, never in first paint.
 *
 * - **A message reaches the runtime only through `copilot-message-send`**, a human command the panel calls on the
 *   palette interface; the client's own copy of the history is never sent (3.2). Stopping is `copilot-turn-stop`.
 * - **It draws only text and tool-call parts**, from the events the kernel's panel half forwards, which has already
 *   dropped every interrupt, `CUSTOM` event and approval state. A tool call is a line of text naming the command and
 *   its state, with no button. (`violet-tool-call-card` imports the settings icon first paint holds, which would part
 *   it into a chunk of its own.)
 * - **Approval and suggestion cards come from the kernel's records alone** (step 3, `cards.ts`): `copilot-session-get`
 *   after each turn ends, after each answer, and while a turn waits on the person; their buttons answer a person's own
 *   press, on the palette interface.
 * - **The model's text is text**: every value is set as a text node, never as markup.
 * - Lists are built with the DOM API, by id, so this chunk imports nothing of first paint but FAST's `css`, `html`
 *   and `observable`.
 */

import { css, FASTElement, html, observable } from '@lushly-dev/fast-element';
import '@lushly-dev/violet-elements/conversation-thread/define';
import '@lushly-dev/violet-elements/message/define';
import '@lushly-dev/violet-elements/message-text/define';
import '@lushly-dev/violet-elements/chat-composer/define';
import '@lushly-dev/violet-elements/approval-card/define';
import '@lushly-dev/violet-elements/button/define';
import type { UIMessage } from '@tanstack/ai-client';
import { renderCards, type SessionRecordsV1 } from './cards.js';
import {
	CopilotConversation,
	type CopilotPanelHostV1,
	type CopilotPanelKernelV1,
} from './conversation.js';

export {
	type CopilotPanelHostV1,
	type CopilotPanelKernelV1,
	DESKTOP_KEY_MISSING_NOTICE,
	DESKTOP_NO_MODEL_NOTICE,
	NO_MODEL_NOTICE,
} from './conversation.js';

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
		<div class="cards" role="region" aria-label="Waiting for you" hidden></div>
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
		gap: var(--violet-space-stack-group);
		box-sizing: border-box;
		block-size: 100%;
		padding: var(--violet-space-layout-panel);
		font-size: var(--violet-type-body-size);
		line-height: var(--violet-type-body-line);
		font-weight: var(--violet-type-body-weight);
		color: var(--violet-color-text-primary);
	}
	/* The thread scrolls itself, in a focusable log; a scroller here would be a second, unfocusable one. */
	.thread {
		flex: 1;
		min-block-size: 0;
	}
	.notice,
	.empty,
	.tool,
	.taint {
		margin: 0;
		color: var(--violet-color-text-secondary);
	}
	/* The cards wait below the thread, above the composer; a long set scrolls in a focusable region of its own. */
	.cards {
		display: flex;
		flex-direction: column;
		gap: var(--violet-space-stack-group);
		max-block-size: 50%;
		overflow-y: auto;
	}
	.card p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.card-title {
		font-weight: var(--violet-type-label-weight);
	}
	.card-input {
		white-space: pre-wrap;
		font-family: var(--violet-font-family-mono);
	}
	.card-why,
	.card-ended {
		color: var(--violet-color-text-secondary);
	}
	.suggestion {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--violet-space-stack-tight);
		padding: var(--violet-space-stack-group) var(--violet-space-inline-group);
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-control);
		background: var(--violet-color-surface-card);
	}
	[hidden] {
		display: none;
	}
`;

/** The panel: one session at a time, started on the first message, over a {@link CopilotConversation}. */
export class LoamCopilotPanel extends FASTElement {
	declare notice: string;
	declare status: 'ready' | 'streaming';
	declare empty: boolean;
	declare unavailable: boolean;
	kernel: CopilotPanelKernelV1 | null = null;
	host: CopilotPanelHostV1 | null = null;
	desktop = false;
	#conversation: CopilotConversation | null = null;

	constructor() {
		super();
		this.notice = '';
		this.status = 'ready';
		this.empty = true;
		this.unavailable = false;
	}

	/** The session's id, once the first message started one. */
	get session(): string | null {
		return this.#conversation?.session ?? null;
	}

	#ensure(): CopilotConversation | null {
		if (!this.#conversation && this.kernel)
			this.#conversation = new CopilotConversation(
				this.kernel,
				this.host,
				{
					messages: (messages) => this.render(messages),
					status: (status) => {
						this.status = status;
						if (status === 'ready') void this.refresh();
					},
					notice: (text, unavailable) => {
						this.notice = text;
						if (unavailable !== undefined) this.unavailable = unavailable;
					},
				},
				{ desktop: this.desktop }
			);
		return this.#conversation;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		void this.#ensure()?.checkProviders();
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		clearTimeout(this.#timer);
	}

	async submit(text: string): Promise<void> {
		await this.#ensure()?.submit(text);
	}

	stop(): void {
		this.#conversation?.stop();
	}

	#reads = 0;
	#polls = 0;
	/** The turn the allowance is for. */
	#polled = 0;
	/** The one pending read: a new one replaces it, so reads never pile up. */
	#timer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Read the session's records and draw its cards (6.2): the kernel's, never the runtime's word. While a turn waits on
	 * the person or runs on after their answer, read again shortly, so its continuation's cards and end are drawn.
	 */
	async refresh(): Promise<void> {
		const region = this.shadowRoot?.querySelector<HTMLElement>('.cards');
		const session = this.session;
		if (!region || !this.kernel) return;
		const mine = ++this.#reads;
		if (!session) {
			renderCards(region, null, this.kernel, () => {});
			return;
		}
		// The page that holds the latest turn (at most 20 a read): an older one's cards never hide a newer one's (B15).
		const latest = this.#conversation?.turn ?? 0;
		const read = await this.kernel.call<SessionRecordsV1>('copilot-session-get', {
			session,
			from: Math.max(1, latest - 19),
		});
		if (mine !== this.#reads || session !== this.session) return;
		const records = read.success && read.data ? read.data : null;
		renderCards(region, records, this.kernel, () => {
			this.#polls = 0;
			void this.refresh();
		});
		const last = records?.turns.at(-1);
		// A fresh allowance for each turn (the re-check's improvement): a later turn's wait is read as long as its own.
		if (last && last.seq !== this.#polled) {
			this.#polled = last.seq;
			this.#polls = 0;
		}
		const waiting = records?.confirmations.some((card) => card.state === 'pending') === true;
		const live = last?.state === 'waiting' || last?.state === 'running' || waiting;
		// For as long as a confirmation may wait, 10 minutes, and a little past (N3): an answer in the inbox shows here.
		if (live && this.#polls < 330) {
			this.#polls += 1;
			clearTimeout(this.#timer);
			this.#timer = setTimeout(() => void this.refresh(), 2_000);
		}
	}

	/** Forget the session and its thread, as a change of person does: the next person never sees it (3.2). */
	reset(): void {
		this.#conversation?.reset();
		this.#reads += 1;
		this.#polls = 0;
		this.#polled = 0;
		clearTimeout(this.#timer);
		const region = this.shadowRoot?.querySelector<HTMLElement>('.cards');
		if (region && this.kernel) renderCards(region, null, this.kernel, () => {});
		this.unavailable = false;
		void this.#conversation?.checkProviders();
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
