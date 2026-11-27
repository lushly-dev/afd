/**
 * @fileoverview The `inbox` chunk (phase 4 specification, 10.3 and 15), loaded when main first shows the inbox, at
 * `/<workspace>[/p/<project>]/~/inbox[/<notice>]`: `loam-inbox`, the person's notices, newest first, with any
 * confirmation waiting for them first. Each notice says who left it (6.6) and when, offers its action, its link, Mark
 * read and Archive; "Mark all read" and "Archive all" act on every one but a confirmation waiting for an answer. A
 * confirmation (7.2, step 6) shows the shell's header, the app's text and the input, and Confirm and Decline, each
 * naming the command (15); one that ended says how, "Declined automatically" with how many calls the window refused.
 * A path names a notice to open the inbox at, as a sticky toast's "Open inbox" does (6.7).
 *
 * Every read and write is a command: `notification-list`, `-read`, `-archive` and `-act`. Native controls with a
 * constructable sheet, tokens only, as the settings section's are, so the chunk needs nothing of FAST's.
 */

import type { KernelEvent, LoamKernel } from '@lushly-dev/loam-kernel';
import type { ConfirmationRecordV1, NotificationV1 } from '@lushly-dev/loam-sdk';
import type { LoamShell } from '../elements/shell.js';
import { previewWords } from '../preview-words.js';
import { cutWords } from './inbox-cut.js';
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

/** A confirmation's input as text, one line per field, never markup (7.2). */
const inputWords = (input: unknown): string => {
	if (input === undefined) return '';
	if (input === null || typeof input !== 'object' || Array.isArray(input))
		return JSON.stringify(input) ?? '';
	const entries = Object.entries(input as Record<string, unknown>);
	return entries.length === 0
		? 'No input'
		: entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
};

/** How a confirmation that is no longer waiting ended (7.2), in words. */
const endedWords = (record: NonNullable<NotificationV1['confirmation']>): string => {
	const again =
		record.declinedAgain !== undefined && record.declinedAgain > 0
			? ` · Declined automatically ${record.declinedAgain === 1 ? 'once' : `${record.declinedAgain} times`}`
			: '';
	switch (record.state) {
		case 'confirmed':
			return 'Confirmed';
		case 'declined':
			return `${record.reason === 'access' ? 'Declined: access changed before it could run' : 'Declined'}${again}`;
		case 'expired':
			return 'Expired: no one answered within 10 minutes';
		case 'withdrawn':
			return 'Withdrawn by whoever asked';
		default:
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
		color: var(--violet-color-text-primary);
		font-size: var(--violet-type-body-size);
		line-height: var(--violet-type-body-line);
	}
	h1,
	h2,
	p {
		margin: 0;
	}
	h1 {
		font-size: var(--violet-type-heading-page-size);
		line-height: var(--violet-type-heading-page-line);
		font-weight: var(--violet-type-heading-page-weight);
	}
	h2 {
		font-size: var(--violet-type-heading-section-size);
		line-height: var(--violet-type-heading-section-line);
		font-weight: var(--violet-type-label-weight);
	}
	.section,
	.notice {
		display: grid;
		gap: var(--violet-space-stack-group);
	}
	.section {
		gap: var(--violet-space-stack-section);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--violet-space-inline-tight);
	}
	ul {
		display: grid;
		gap: var(--violet-space-stack-group);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.notice {
		padding: var(--violet-space-inline-group);
		border: 1px solid var(--violet-color-border-subtle);
		border-inline-start: var(--violet-space-inline-hairline) solid transparent;
		border-radius: var(--violet-radius-control);
		background: var(--violet-color-surface-card);
	}
	.notice[data-unread] {
		border-inline-start-color: var(--violet-color-action-primary-background);
	}
	.notice[data-unread] h2 {
		font-weight: var(--violet-weight-semibold);
	}
	.notice:focus-visible,
	h1:focus-visible {
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: var(--violet-shell-size-focus);
	}
	.notice[data-target] {
		border-color: var(--violet-color-focus-ring);
	}
	.meta,
	.empty {
		color: var(--violet-color-text-secondary);
		font-size: var(--violet-type-label-size);
		line-height: var(--violet-type-label-line);
	}
	.body {
		overflow-wrap: anywhere;
		white-space: pre-line;
	}
	.status:empty {
		display: none;
	}
	.action {
		min-block-size: var(--violet-size-target-natural);
		padding-inline: var(--violet-space-inline-group);
		border: 1px solid var(--violet-color-action-secondary-border);
		border-radius: var(--violet-radius-control);
		background: var(--violet-color-action-secondary-background);
		color: var(--violet-color-action-secondary-text);
		font: inherit;
		cursor: pointer;
	}
	.action:hover {
		background: var(--violet-color-action-secondary-hover);
	}
	.action[aria-disabled='true'] {
		cursor: progress;
		opacity: 0.6;
	}
	.action.primary {
		border-color: var(--violet-color-action-primary-background);
		background: var(--violet-color-action-primary-background);
		color: var(--violet-color-action-primary-text);
	}
	.action.danger {
		border-color: var(--violet-color-action-danger-background);
		background: var(--violet-color-action-danger-background);
		color: var(--violet-color-action-danger-text);
	}
	.action.danger:hover {
		background: var(--violet-color-action-danger-hover);
	}
	.action:focus-visible,
	a:focus-visible {
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: var(--violet-shell-size-focus);
	}
	a {
		color: inherit;
		font-weight: var(--violet-weight-semibold);
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
	kernel: LoamKernel | null = null;
	/** The shell's base, for a notice's link (documents specification, 9.1). */
	base = '/';
	#notices: NotificationV1[] = [];
	#cursor: string | null = null;
	#unread = 0;
	#target: string | undefined;
	#reads = 0;
	/** Moved by each clear: a read by id begun before it shows nothing after it. */
	#cleared = 0;
	#list: HTMLElement;
	#status: HTMLElement;
	#count: HTMLElement;
	#more: HTMLElement;
	#unsubscribe: (() => void) | null = null;
	/** The notices whose action the person's press is running now. */
	#acting = new Set<string>();
	/**
	 * A confirmation read whole by its id, where the list cut its input (the trust review's blocker 9) or its preview
	 * (#2801).
	 */
	#whole = new Map<string, ConfirmationRecordV1>();

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
			this.kernel?.subscribe((event: KernelEvent) => {
				// A change of person or of what they may enter (the reviews' item 4): nothing read before shows, then the
				// list is read again for whoever it is now.
				if (accessChanged(event)) {
					this.#clear();
					void this.#read();
					return;
				}
				// A mutation that may change the list, never the list's own read, which would read again for ever; or a call
				// that raised or ended a confirmation, which may itself have failed (7.2).
				if (
					event.inbox === true ||
					(event.success &&
						event.mutation &&
						(event.command.startsWith('notification-') || event.command === 'toast-show'))
				)
					void this.#read();
			}) ?? null;
	}

	/** Forget every notice shown: a change of person or access, or a read refused, leaves none of them on screen. */
	#clear(): void {
		this.#reads++;
		this.#cleared++;
		this.#notices = [];
		this.#whole.clear();
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
			const cleared = this.#cleared;
			const one = (await this.kernel.call<Page>('notification-list', {
				notification: target,
				body: true,
			})) as Answer<Page>;
			// A change of person or access since: the notice is theirs no longer (the reviews' item 4).
			if (cleared !== this.#cleared) return;
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

	#button(label: string, run: () => unknown, primary = false, trusted = false): HTMLElement {
		const made = el(
			'button',
			{ type: 'button', class: primary ? 'action primary' : 'action' },
			label
		);
		// A confirmation's answer is a person's own press alone (the trust review's blocker 1): a script's `click()` or a
		// dispatched event answers nothing.
		made.addEventListener('click', (event) => {
			if (!trusted || event.isTrusted) void run();
		});
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
		const asked = notice.kind === 'confirmation' ? notice.confirmation : undefined;
		const meta = [
			waiting(notice)
				? 'Waiting for your answer'
				: asked
					? endedWords(asked)
					: unread
						? 'Unread'
						: '',
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
			// A confirmation's header is the shell's, above the app's own words (7.2).
			...(asked ? [el('p', { class: 'meta' }, asked.header)] : []),
			heading,
			el('p', { class: 'meta' }, meta.join(' · ')),
			...(notice.body ? [el('p', { class: 'body' }, notice.body)] : []),
			...(asked
				? [
						el('p', { class: 'body' }, asked.prompt),
						el(
							'p',
							{ class: 'body input' },
							this.#cutInput(notice)
								? `The input is too long to list (${(asked.input as { bytes: number }).bytes} bytes)${waiting(notice) ? ': show it before you answer' : ''}`
								: inputWords(this.#whole.get(notice.id)?.input ?? asked.input)
						),
						// A released mounted command's preview, as text (phase 5 specification, 7.2); a list cuts a long one (#2801).
						...previewWords(this.#whole.get(notice.id)?.preview ?? asked.preview).map((line) =>
							el('p', { class: 'body preview' }, line)
						),
						...(this.#cutPreview(notice)
							? [
									el(
										'p',
										{ class: 'body preview' },
										`The preview is too long to list (${asked.preview?.bytes} bytes)${waiting(notice) ? ': show it before you answer' : ''}`
									),
								]
							: []),
					]
				: []),
			actions
		);
		if (asked && waiting(notice)) {
			// Confirm and Decline name the command (15); only the person's press answers, as `notification-act`.
			const answer = (given: 'confirm' | 'decline') => async () => {
				if (this.#acting.has(notice.id)) return;
				this.#acting.add(notice.id);
				try {
					await this.#write(
						'notification-act',
						{ notification: notice.id, answer: given },
						(data) => `${notice.title}: ${(data as unknown as { state?: string }).state ?? given}`
					);
				} finally {
					this.#acting.delete(notice.id);
				}
			};
			const decline = this.#button('Decline', answer('decline'), false, true);
			decline.setAttribute('aria-label', `Decline ${notice.title}`);
			// The person sees the whole input and preview before Confirm is offered (blocker 9, #2801): read by its id, as a
			// list never shows a long one.
			const cut = cutWords(asked, this.#whole.has(notice.id));
			if (cut) {
				const show = this.#button(`Show the full ${cut}`, () => this.#readWhole(notice.id));
				show.setAttribute('aria-label', `Show the full ${cut} of ${notice.title}`);
				actions.append(decline, show);
			} else {
				const confirm = this.#button('Confirm', answer('confirm'), !asked.danger, true);
				confirm.setAttribute('aria-label', `Confirm ${notice.title}`);
				if (asked.danger) confirm.classList.add('danger');
				actions.append(decline, confirm);
			}
		}
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

	/** Whether a list cut this confirmation's input, and its whole input is not read yet (10.2, blocker 9). */
	#cutInput(notice: NotificationV1): boolean {
		return cutWords(notice.confirmation, this.#whole.has(notice.id)).includes('input');
	}

	/** Whether a list cut this confirmation's preview, and its whole preview is not read yet (#2801). */
	#cutPreview(notice: NotificationV1): boolean {
		return cutWords(notice.confirmation, this.#whole.has(notice.id)).includes('preview');
	}

	/** Read one confirmation by its id, whose input and preview come whole, then show it. */
	async #readWhole(id: string): Promise<void> {
		const cleared = this.#cleared;
		const answer = (await this.kernel?.call<Page>('notification-list', {
			notification: id,
			body: true,
		})) as Answer<Page> | undefined;
		// A change of person or access since: nothing of theirs is kept (the reviews' item 4).
		if (cleared !== this.#cleared) return;
		const found = answer?.success ? answer.data?.notifications[0] : undefined;
		if (!found?.confirmation) {
			if (answer) this.#say(failed(answer));
			return;
		}
		this.#whole.set(id, found.confirmation);
		this.#render();
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
	const kernel = shell.kernel as LoamKernel;
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
