/**
 * @fileoverview Mail's main surface, the send slice (the plugin's specification, 13.1): a thread opened by id,
 * from its route `thread/<id>` or a field, and a reply to its newest message, saved as a draft and sent. What
 * came from mail is bound as text, which FAST never parses as markup, and sits under a label that says so.
 */

import { css, FASTElement, html, observable, repeat, when } from '@lushly-dev/fast-element';
import type { AppContextV1, LoamSurfaceElementV1 } from '@lushly-dev/loam-sdk';
import { type Notice, type Phase, Reply, type ThreadMessage, threadOfRoute } from './reply.js';

interface Field extends HTMLElement {
	value: string;
}

const typedValue = (event: Event): string => (event.target as Field | null)?.value ?? '';

/** A message's date, which the engine gives in milliseconds. */
const shownDate = (date: number): string => {
	const at = new Date(date);
	return Number.isNaN(at.getTime())
		? ''
		: at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const senderOf = (message: ThreadMessage): string => {
	const sender = message.content.sender;
	const name = sender?.name?.trim();
	const address = sender?.address ?? '';
	if (name && address) return `${name} <${address}>`;
	return name || address || 'Unknown sender';
};

const messageTemplate = html<ThreadMessage>`
	<li>
		<p class="sender" dir="auto">${(m) => senderOf(m)}</p>
		<p class="meta">${(m) => shownDate(m.date)}</p>
		<p class="subject" dir="auto">${(m) => m.content.subject ?? ''}</p>
		<p class="snippet" dir="auto">${(m) => m.content.snippet ?? ''}</p>
	</li>
`;

const mainTemplate = html<MailReply>`
	<h1>Mail</h1>
	<div class="row" role="group" aria-label="Open a thread">
		<violet-text-field
			class="thread-id"
			label="Thread"
			inputmode="numeric"
			autocomplete="off"
			:value="${(x) => x.threadText}"
			@input="${(x, c) => x.typeThread(typedValue(c.event))}"
		></violet-text-field>
		<violet-button
			class="open"
			appearance="secondary"
			?disabled="${(x) => x.busy}"
			@click="${(x) => x.openTyped()}"
			>Open</violet-button
		>
	</div>
	<p class="notice" role="status" data-tone="${(x) => x.notice?.tone ?? 'info'}">${(x) => x.noticeText}</p>
	${when(
		(x) => x.messages.length > 0,
		html<MailReply>`
			<section class="thread" aria-labelledby="thread-title">
				<p class="label">From mail, as received: the thread's subject, and each message's sender and text</p>
				<h2 id="thread-title" dir="auto">${(x) => x.messages[0]?.content.subject || 'No subject'}</h2>
				<ol class="messages">
					${repeat((x) => x.messages, messageTemplate)}
				</ol>
				${when(
					(x) => x.cut,
					html<MailReply>`<p class="meta">
						This thread is longer than the app reads, so the reply answers the last message shown
					</p>`
				)}
			</section>
			<section class="reply" aria-labelledby="reply-title" aria-busy="${(x) => String(x.busy)}">
				<h2 id="reply-title">Reply</h2>
				<violet-text-field
					class="to"
					?readonly="${(x) => x.locked}"
					label="To"
					supporting-text="Addresses, separated by commas"
					autocomplete="off"
					:value="${(x) => x.to}"
					@input="${(x, c) => x.type('to', typedValue(c.event))}"
				></violet-text-field>
				<violet-text-field
					class="subject"
					?readonly="${(x) => x.locked}"
					label="Subject"
					autocomplete="off"
					:value="${(x) => x.subject}"
					@input="${(x, c) => x.type('subject', typedValue(c.event))}"
				></violet-text-field>
				<violet-text-area
					class="body"
					?readonly="${(x) => x.locked}"
					label="Message"
					rows="8"
					:value="${(x) => x.body}"
					@input="${(x, c) => x.type('body', typedValue(c.event))}"
				></violet-text-area>
				${when(
					(x) => x.cc.length > 0,
					html<MailReply>`<violet-text-field
						class="cc"
						readonly
						label="Cc"
						supporting-text="Set elsewhere: this app sends it as it is"
						:value="${(x) => x.cc}"
					></violet-text-field>`
				)}
				${when(
					(x) => x.bcc.length > 0,
					html<MailReply>`<violet-text-field
						class="bcc"
						readonly
						label="Bcc"
						supporting-text="Set elsewhere: this app sends it as it is"
						:value="${(x) => x.bcc}"
					></violet-text-field>`
				)}
				<p class="meta">${(x) => x.draftLine}</p>
				<div class="row" role="group" aria-label="Reply actions">
					<violet-button
						class="save"
						appearance="secondary"
						?disabled="${(x) => x.busy || x.locked}"
						@click="${(x) => x.save()}"
						>Save draft</violet-button
					>
					<violet-button
						class="send"
						appearance="primary"
						?disabled="${(x) => x.busy || x.locked}"
						@click="${(x) => x.send()}"
						>Send</violet-button
					>
				</div>
			</section>
		`
	)}
`;

const mainStyles = css`
	:host {
		display: grid;
		gap: var(--violet-space-stack-section);
		align-content: start;
		padding: var(--violet-space-layout-page);
		color: var(--violet-color-text-primary);
		font-size: var(--violet-type-body-size);
		line-height: var(--violet-type-body-line);
	}
	h1,
	h2,
	p,
	ol {
		margin: 0;
	}
	h1 {
		font-family: var(--violet-font-family-heading);
		font-size: var(--violet-type-heading-section-size);
		line-height: var(--violet-type-heading-section-line);
		font-weight: var(--violet-type-heading-section-weight);
	}
	h2 {
		font-size: var(--violet-type-label-size);
		line-height: var(--violet-type-label-line);
		font-weight: var(--violet-type-label-weight);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--violet-space-inline-tight);
		align-items: end;
	}
	.thread,
	.reply {
		display: grid;
		gap: var(--violet-space-stack-group);
	}
	.messages {
		display: grid;
		gap: var(--violet-space-stack-tight);
		padding: 0;
		list-style: none;
	}
	.messages li {
		display: grid;
		padding: var(--violet-space-layout-panel);
		/* A card is a surface step with the card shadow, no drawn edge (Refined, D159); forced colors draws the border. */
		border: 1px solid transparent;
		border-radius: var(--violet-radius-control);
		background: var(--violet-color-surface-card);
		box-shadow: var(--violet-shadow-card);
	}
	.sender {
		font-size: var(--violet-type-label-size);
		line-height: var(--violet-type-label-line);
		font-weight: var(--violet-type-label-weight);
		overflow-wrap: anywhere;
	}
	.subject,
	.snippet {
		overflow-wrap: anywhere;
	}
	.meta,
	.label {
		color: var(--violet-color-text-secondary);
		font-size: var(--violet-type-caption-size);
		line-height: var(--violet-type-caption-line);
	}
	.notice[data-tone='danger'] {
		color: var(--violet-color-state-danger-text);
	}
	.notice[data-tone='success'] {
		color: var(--violet-color-state-success-text);
	}
	@media (forced-colors: active) {
		:host,
		.meta,
		.label,
		.notice[data-tone] {
			color: CanvasText;
		}
		.messages li {
			border-color: CanvasText;
			background: Canvas;
		}
	}
`;

export class MailReply extends FASTElement implements LoamSurfaceElementV1 {
	context?: AppContextV1;
	declare route?: string;
	declare phase: Phase;
	declare notice: Notice | null;
	declare messages: ThreadMessage[];
	declare cut: boolean;
	declare to: string;
	declare subject: string;
	declare body: string;
	declare draftLine: string;
	declare cc: string;
	declare bcc: string;
	declare threadText: string;
	#reply: Reply | undefined;

	constructor() {
		super();
		this.phase = 'empty';
		this.notice = null;
		this.messages = [];
		this.cut = false;
		this.to = '';
		this.subject = '';
		this.body = '';
		this.draftLine = '';
		this.cc = '';
		this.bcc = '';
		this.threadText = '';
	}

	get busy(): boolean {
		return this.phase === 'loading' || this.phase === 'saving' || this.phase === 'sending';
	}

	/**
	 * The reply's fields are read-only, and Save and Send off, while Loam asks the person to send it, once it is sent,
	 * and when the thread or its draft could not be read.
	 */
	get locked(): boolean {
		return this.phase === 'sending' || this.phase === 'sent' || this.phase === 'failed';
	}

	/** The notice, its tone said in words as well as color (state never rests on color alone). */
	get noticeText(): string {
		const notice = this.notice;
		if (!notice) return '';
		return notice.tone === 'danger' ? `Not done: ${notice.text}` : notice.text;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		const client = this.context?.client;
		if (client && !this.#reply) this.#reply = new Reply(client, () => this.#sync());
		void this.#follow();
	}

	routeChanged(): void {
		void this.#follow();
	}

	async #follow(): Promise<void> {
		const thread = threadOfRoute(this.route);
		if (thread === null || !this.#reply || this.#reply.thread === thread) return;
		this.threadText = String(thread);
		await this.#reply.open(thread);
	}

	#sync(): void {
		const reply = this.#reply;
		if (!reply) return;
		this.phase = reply.phase;
		this.notice = reply.notice;
		this.messages = reply.messages;
		this.cut = reply.cut;
		// Assigned only when they differ, so what the person is typing is never written back under the caret.
		if (this.to !== reply.to) this.to = reply.to;
		if (this.subject !== reply.subject) this.subject = reply.subject;
		if (this.body !== reply.body) this.body = reply.body;
		this.cc = reply.draft?.cc.join(', ') ?? '';
		this.bcc = reply.draft?.bcc.join(', ') ?? '';
		this.draftLine = !reply.draft
			? 'Not saved yet'
			: reply.saved
				? `Draft saved, from ${reply.draft.from ?? 'your account'}`
				: 'Changed since it was saved';
	}

	typeThread(value: string): void {
		this.threadText = value;
	}

	openTyped(): void {
		const thread = threadOfRoute(`thread/${this.threadText.trim()}`);
		if (thread === null || !this.#reply) {
			this.notice = { tone: 'danger', text: 'A thread is opened by its number' };
			return;
		}
		// The route follows, so the thread can be linked; a route that cannot move leaves the view as it is.
		this.context?.navigate?.(`thread/${thread}`)?.catch(() => undefined);
		void this.#reply.open(thread);
	}

	type(field: 'to' | 'subject' | 'body', value: string): void {
		this[field] = value;
		this.#reply?.edit(field, value);
	}

	save(): void {
		void this.#reply?.save();
	}

	send(): void {
		void this.#reply?.send();
	}
}
observable(MailReply.prototype, 'route');
observable(MailReply.prototype, 'phase');
observable(MailReply.prototype, 'notice');
observable(MailReply.prototype, 'messages');
observable(MailReply.prototype, 'cut');
observable(MailReply.prototype, 'to');
observable(MailReply.prototype, 'subject');
observable(MailReply.prototype, 'body');
observable(MailReply.prototype, 'draftLine');
observable(MailReply.prototype, 'cc');
observable(MailReply.prototype, 'bcc');
observable(MailReply.prototype, 'threadText');

export async function defineMailElements(context: AppContextV1): Promise<void> {
	const { registry } = context;
	await FASTElement.define(MailReply, {
		name: 'mail-reply',
		template: mainTemplate,
		styles: mainStyles,
		registry,
		shadowOptions: { mode: 'open' as const, customElementRegistry: registry },
	});
}
