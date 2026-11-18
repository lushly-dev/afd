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
import '@lushly-dev/violet-elements/dist/conversation/violet-conversation-thread.js';
import '@lushly-dev/violet-elements/dist/conversation/violet-message.js';
import '@lushly-dev/violet-elements/dist/conversation/violet-message-text.js';
import '@lushly-dev/violet-elements/dist/conversation/violet-chat-composer.js';
import type { UIMessage } from '@tanstack/ai-client';
import {
	CopilotConversation,
	type CopilotPanelHostV1,
	type CopilotPanelKernelV1,
} from './conversation.js';

export {
	type CopilotPanelHostV1,
	type CopilotPanelKernelV1,
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

/** The panel: one session at a time, started on the first message, over a {@link CopilotConversation}. */
export class LoamCopilotPanel extends FASTElement {
	declare notice: string;
	declare status: 'ready' | 'streaming';
	declare empty: boolean;
	declare unavailable: boolean;
	kernel: CopilotPanelKernelV1 | null = null;
	host: CopilotPanelHostV1 | null = null;
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
			this.#conversation = new CopilotConversation(this.kernel, this.host, {
				messages: (messages) => this.render(messages),
				status: (status) => {
					this.status = status;
				},
				notice: (text, unavailable) => {
					this.notice = text;
					if (unavailable !== undefined) this.unavailable = unavailable;
				},
			});
		return this.#conversation;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		void this.#ensure()?.checkProviders();
	}

	async submit(text: string): Promise<void> {
		await this.#ensure()?.submit(text);
	}

	stop(): void {
		this.#conversation?.stop();
	}

	/** Forget the session and its thread, as a change of person does: the next person never sees it (3.2). */
	reset(): void {
		this.#conversation?.reset();
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
