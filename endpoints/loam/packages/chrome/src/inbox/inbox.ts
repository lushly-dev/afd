/**
 * @fileoverview The `inbox` chunk (phase 4 specification, 10.3 and 15), loaded when main first shows the inbox, at
 * `/<workspace>[/p/<project>]/~/inbox[/<notice>]`: `loam-inbox`, the person's notices, newest first, with any
 * confirmation waiting for them first (step 6 raises them; until then none is). Each notice says who left it (6.6) and
 * when, offers its action, its link, Mark read and Archive; "Mark all read" and "Archive all" act on every one but a
 * confirmation waiting for an answer. A path names a notice to open the inbox at, as a sticky toast's "Open inbox"
 * does (6.7).
 *
 * Every read and write is a command: `notification-list`, `-read`, `-archive` and `-act`. Native controls with a
 * constructable sheet, tokens only, as the settings section's are, so the chunk needs nothing of FAST's.
 */

import type { KernelEventV4, LoamKernelV5 } from '@lushly-dev/loam-kernel';
import type { NotificationV1 } from '@lushly-dev/loam-sdk';
import type { LoamShell } from '../elements/shell.js';
import { accessChanged, ownerWords } from './inbox-words.js';

interface Answer<T = unknown> {
	success: boolean;
	data?: T;
	error?: { message?: string; suggestion?: string };
}

type Page = { notifications: NotificationV1[]; cursor: string | null; unread: number };

const PAGE = 50;

/** An element whose text is always text. */
function el(
	tag: string,
	attributes: Record<string, string> = {},
	...children: Array<Node | string>
) {
	const element = document.createElement(tag);
	for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
	element.append(...children);
	return element;
}

/** A failure in words: its message and what to do, never a code alone. */
const failed = (answer: Answer): string =>
	[answer.error?.message ?? 'That did not work', answer.error?.suggestion]
		.filter(Boolean)
		.join('. ');

/** A time as the person's locale writes it. */
const when = (value: number): string => {
	try {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(value)
		);
	} catch {
		return '';
	}
};

/** A confirmation waiting for the person's answer, which sorts first (10.3) and no "all" hides (R10). */
const waiting = (notice: NotificationV1): boolean =>
	notice.kind === 'confirmation' &&
	(notice.confirmation as { state?: unknown } | undefined)?.state === 'pending';

const STYLES = `
	:host {
		display: block;
		color: var(--color-text-primary);
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	h1,
	h2,
	p {
		margin: 0;
	}
	h1 {
		font-size: var(--type-title-md-size);
		line-height: var(--type-title-md-line);
		font-weight: var(--type-title-md-weight);
	}
	h2 {
		font-size: var(--type-title-sm-size);
		line-height: var(--type-title-sm-line);
		font-weight: var(--type-label-sm-weight);
	}
	.section,
	.notice {
		display: grid;
		gap: var(--space-stack-sm);
	}
	.section {
		gap: var(--space-stack-md);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-inline-sm);
	}
	ul {
		display: grid;
		gap: var(--space-stack-sm);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.notice {
		padding: var(--size-space-md);
		border: 1px solid var(--color-border-subtle);
		border-inline-start: var(--size-space-xs) solid transparent;
		border-radius: var(--radius-md);
		background: var(--color-surface-card);
	}
	.notice[data-unread] {
		border-inline-start-color: var(--color-action-primary-background);
	}
	.notice[data-unread] h2 {
		font-weight: var(--weight-semibold);
	}
	.notice:focus-visible,
	h1:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: var(--shell-size-focus);
	}
	.notice[data-target] {
		border-color: var(--color-focus-ring);
	}
	.meta,
	.empty {
		color: var(--color-text-secondary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
	.body {
		overflow-wrap: anywhere;
		white-space: pre-line;
	}
	.status:empty {
		display: none;
	}
	.action {
		min-block-size: var(--size-target-natural);
		padding-inline: var(--size-space-md);
		border: 1px solid var(--color-action-secondary-border);
		border-radius: var(--radius-md);
		background: var(--color-action-secondary-background);
		color: var(--color-action-secondary-text);
		font: inherit;
		cursor: pointer;
	}
	.action:hover {
		background: var(--color-action-secondary-hover);
	}
	.action[aria-disabled='true'] {
		cursor: progress;
		opacity: 0.6;
	}
	.action.primary {
		border-color: var(--color-action-primary-background);
		background: var(--color-action-primary-background);
		color: var(--color-action-primary-text);
	}
	.action:focus-visible,
	a:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: var(--shell-size-focus);
	}
	a {
		color: inherit;
		font-weight: var(--weight-semibold);
	}
	@media (forced-colors: active) {
		.notice[data-unread] {
			border-inline-start-color: Highlight;
		}
		.action {
			border-color: ButtonText;
			background: ButtonFace;
			color: ButtonText;
		}
	}
`;

/** `loam-inbox` (10.3): the person's notices, newest first, a waiting confirmation first. */
export class LoamInbox extends HTMLElement {
	kernel: LoamKernelV5 | null = null;
	/** The shell's base, for a notice's link (documents specification, 9.1). */
	base = '/';
	#notices: NotificationV1[] = [];
	#cursor: string | null = null;
	#unread = 0;
	#target: string | undefined;
	#reads = 0;
	#list: HTMLElement;
	#status: HTMLElement;
	#count: HTMLElement;
	#more: HTMLElement;
	#unsubscribe: (() => void) | null = null;
	/** The notices whose action the person's press is running now. */
	#acting = new Set<string>();

	constructor() {
		super();
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(STYLES);
		const root = this.attachShadow({ mode: 'open' });
		root.adoptedStyleSheets = [sheet];
		this.#count = el('p', { class: 'meta' });
		this.#status = el('p', { class: 'status', role: 'status' });
		this.#list = el('ul', { 'aria-label': 'Notices' });
		this.#more = this.#button('Show more', () => this.#read(true));
		this.#more.hidden = true;
		root.append(
			el(
				'section',
				{ class: 'section', 'aria-labelledby': 'inbox-heading' },
				el('h1', { id: 'inbox-heading', tabindex: '-1' }, 'Inbox'),
				this.#count,
				el(
					'div',
					{ class: 'row' },
					this.#button('Mark all read', () =>
						this.#write('notification-read', { all: true }, (data) => `Marked ${data.read} read`)
					),
					this.#button('Archive all', () =>
						this.#write(
							'notification-archive',
							{ all: true },
							(data) => `Archived ${data.archived}`
						)
					)
				),
				this.#status,
				this.#list,
				this.#more
			)
		);
	}

	connectedCallback(): void {
		this.#unsubscribe ??=
			this.kernel?.subscribe((event: KernelEventV4) => {
				// A change of person or of what they may enter (the reviews' item 4): nothing read before shows, then the
				// list is read again for whoever it is now.
				if (accessChanged(event)) {
					this.#clear();
					void this.#read();
					return;
				}
				// A mutation that may change the list, never the list's own read, which would read again for ever.
				if (
					event.success &&
					event.mutation &&
					(event.command.startsWith('notification-') || event.command === 'toast-show')
				)
					void this.#read();
			}) ?? null;
	}

	/** Forget every notice shown: a change of person or access, or a read refused, leaves none of them on screen. */
	#clear(): void {
		this.#reads++;
		this.#notices = [];
		this.#cursor = null;
		this.#unread = 0;
		this.#render();
	}

	disconnectedCallback(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
	}

	focusHeading(): void {
		this.shadowRoot?.querySelector<HTMLElement>('h1')?.focus();
	}

	/** Show the inbox, at the notice `path` names when it does (6.7), past the first page too (the reviews' item 7). */
	async show(path: string): Promise<void> {
		this.#target = path === '' ? undefined : path;
		await this.#read();
		const target = this.#target;
		if (target === undefined) return;
		const find = () => this.#list.querySelector<HTMLElement>(`[data-id="${CSS.escape(target)}"]`);
		if (!find() && this.kernel) {
			const one = (await this.kernel.call<Page>('notification-list', {
				notification: target,
				body: true,
			})) as Answer<Page>;
			const found = one.success ? one.data?.notifications[0] : undefined;
			if (found && !this.#notices.some((each) => each.id === found.id)) {
				this.#notices = [...this.#notices, found];
				this.#render();
			}
		}
		const item = find();
		if (!item) {
			this.#say('That notice is no longer in your inbox');
			return;
		}
		item.scrollIntoView({ block: 'nearest' });
		item.focus();
	}

	#say(text: string): void {
		this.#status.textContent = text;
	}

	#button(label: string, run: () => unknown, primary = false): HTMLElement {
		const made = el(
			'button',
			{ type: 'button', class: primary ? 'action primary' : 'action' },
			label
		);
		made.addEventListener('click', () => void run());
		return made;
	}

	/** Read the first page again, or with `more` the next one after it. */
	async #read(more = false): Promise<void> {
		const kernel = this.kernel;
		if (!kernel) return;
		const mine = ++this.#reads;
		const answer = (await kernel.call<Page>('notification-list', {
			body: true,
			limit: PAGE,
			...(more && this.#cursor ? { cursor: this.#cursor } : {}),
		})) as Answer<Page>;
		if (mine !== this.#reads) return;
		if (!answer.success || !answer.data) {
			// Refused: what was read before may be another person's or out of reach now, so none of it stays.
			this.#clear();
			this.#say(failed(answer));
			return;
		}
		const { notifications, cursor, unread } = answer.data;
		this.#notices = more ? [...this.#notices, ...notifications] : notifications;
		this.#cursor = cursor;
		this.#unread = unread;
		this.#render();
	}

	#render(): void {
		const focused = (this.shadowRoot?.activeElement as HTMLElement | null)?.closest?.('[data-id]');
		const keep = focused?.getAttribute('data-id');
		const ordered = [...this.#notices.filter(waiting), ...this.#notices.filter((n) => !waiting(n))];
		this.#count.textContent = this.#unread === 0 ? 'Nothing unread' : `${this.#unread} unread`;
		this.#list.replaceChildren(
			...(ordered.length === 0
				? [
						el(
							'li',
							{ class: 'empty' },
							'No notices. What apps, agents and the shell leave for you shows here.'
						),
					]
				: ordered.map((notice) => this.#item(notice)))
		);
		this.#more.hidden = this.#cursor === null;
		if (keep) this.#list.querySelector<HTMLElement>(`[data-id="${CSS.escape(keep)}"]`)?.focus();
	}

	/** Who left a notice (6.6), the kernel's owner line as a toast shows it; nothing for the shell's own. */
	#from(notice: NotificationV1): string {
		return ownerWords(notice.from);
	}

	#item(notice: NotificationV1): HTMLElement {
		const unread = notice.readAt === undefined;
		const heading = el('h2', {}, notice.title);
		const meta = [
			waiting(notice) ? 'Waiting for your answer' : unread ? 'Unread' : '',
			this.#from(notice),
			when(notice.createdAt),
			notice.state === 'done'
				? 'Done'
				: notice.state === 'acting'
					? 'Running, or ran with no outcome recorded'
					: '',
		].filter(Boolean);
		const actions = el('div', { class: 'row' });
		const item = el(
			'li',
			{
				class: 'notice',
				tabindex: '-1',
				'data-id': notice.id,
				'aria-label': `${notice.title}${unread ? ', unread' : ''}`,
				...(unread ? { 'data-unread': '' } : {}),
				...(notice.id === this.#target ? { 'data-target': '' } : {}),
			},
			heading,
			el('p', { class: 'meta' }, meta.join(' · ')),
			...(notice.body ? [el('p', { class: 'body' }, notice.body)] : []),
			actions
		);
		if (notice.action && notice.state === undefined && notice.kind === 'notice') {
			const { label } = notice.action;
			const run = this.#button(
				label,
				async () => {
					// Once: the button says it is busy while the call runs, and a second press does nothing.
					if (this.#acting.has(notice.id)) return;
					this.#acting.add(notice.id);
					run.setAttribute('aria-disabled', 'true');
					try {
						await this.#write(
							'notification-act',
							{ notification: notice.id },
							() => `${label}: done`
						);
					} finally {
						this.#acting.delete(notice.id);
						run.removeAttribute('aria-disabled');
					}
				},
				true
			);
			if (this.#acting.has(notice.id)) run.setAttribute('aria-disabled', 'true');
			actions.append(run);
		}
		if (notice.link) void this.#link(actions, notice);
		if (unread && !waiting(notice))
			actions.append(
				this.#button('Mark read', () =>
					this.#write('notification-read', { notification: notice.id }, () => 'Marked read')
				)
			);
		if (!waiting(notice))
			actions.append(
				this.#button('Archive', () =>
					this.#write('notification-archive', { notification: notice.id }, () => 'Archived')
				)
			);
		return item;
	}

	/** A notice's link (10.1), formed as a toast's is, in the `overlays` chunk. */
	async #link(actions: HTMLElement, notice: NotificationV1): Promise<void> {
		const kernel = this.kernel;
		if (!kernel || !notice.link) return;
		const { toastHref } = await import('../apps/overlays.js');
		// A resource link (10.1), an app's route or a document's anchor too: the same guards form it, or none.
		const href = await toastHref(kernel, this.base, notice.link as never);
		if (!href) return;
		const link = el('a', { href, 'aria-label': `Open: ${notice.title}` }, 'Open');
		actions.prepend(link);
	}

	async #write(
		name: string,
		input: Record<string, unknown>,
		said: (data: Record<string, number>) => string
	): Promise<void> {
		const answer = (await this.kernel?.call<Record<string, number>>(name, input)) as
			| Answer<Record<string, number>>
			| undefined;
		if (!answer) return;
		this.#say(answer.success ? said(answer.data ?? {}) : failed(answer));
		await this.#read();
	}
}

const ELEMENT = 'loam-inbox';

/** Adopted by `loam-main` from this chunk, as the settings chunk's sheet is, so first paint does not grow. */
const MAIN_WITH_INBOX = `
	:host([data-section]) .landing {
		display: none;
	}
	:host([data-section][route='not-found']) .landing {
		display: grid;
	}
	:host([route='not-found']) ::slotted(loam-inbox) {
		display: none;
	}
`;

/** Follow the state: show, update or remove the inbox in main (10.3). */
export async function syncInbox(shell: LoamShell): Promise<void> {
	const kernel = shell.kernel as LoamKernelV5;
	const main = shell.shadowRoot?.querySelector<HTMLElement>('loam-main');
	if (!kernel || !main) return;
	const state = await shell.readState();
	const held = main.querySelector<LoamInbox>(ELEMENT);
	if (state.section !== 'inbox' || state.active !== null) {
		if (!held) return;
		held.remove();
		if (main.dataset.section === 'inbox') delete main.dataset.section;
		return;
	}
	if (!customElements.get(ELEMENT)) customElements.define(ELEMENT, LoamInbox);
	let inbox = held;
	const entering = !inbox;
	if (!inbox) {
		inbox = shell.ownerDocument.createElement(ELEMENT) as LoamInbox;
		inbox.kernel = kernel;
		inbox.base = shell.base;
		if (main.dataset.inboxReady === undefined && main.shadowRoot) {
			main.dataset.inboxReady = '';
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(MAIN_WITH_INBOX);
			main.shadowRoot.adoptedStyleSheets = [...main.shadowRoot.adoptedStyleSheets, sheet];
		}
		main.dataset.section = 'inbox';
		main.append(inbox);
	}
	await inbox.show(state.path);
	// Focus goes to the heading as the inbox opens, unless it opens at a notice, which takes it (15, 6.7).
	if (entering && state.path === '') inbox.focusHeading();
}
