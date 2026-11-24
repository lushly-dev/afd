/**
 * @fileoverview The send slice's logic, apart from its element so a test can drive it with a scripted client
 * (the plugin's specification, 13.1). It reads a thread through the mounted `mail` instance, keeps the reply
 * as an engine draft, and sends that draft by the revision it last showed. The person's confirmation is
 * Loam's, not this file's: `mail-draft-send` is held for a person, so the kernel asks in the slot with
 * `mail-draft-show`'s preview, and this call's promise settles once they answer (phase 5, 7.2).
 */

import type { CommandResult } from '@lushly-dev/loam-sdk';

/** The part of the app's client this file uses. */
export interface MailClient {
	call<T = unknown>(name: string, input?: unknown): Promise<CommandResult<T>>;
}

/**
 * One message of `mail-thread-open`'s page, the fields the slice shows. `content` is mail's own text, which the
 * engine labels `"trust": "content"` (its section 5.1): the view shows it as text, never as markup.
 */
export interface ThreadMessage {
	message: number;
	/** Milliseconds since 1970. */
	date: number;
	content: {
		trust?: string;
		sender?: { name?: string | null; address?: string | null } | null;
		subject?: string | null;
		snippet?: string | null;
	};
}

interface ThreadPage {
	thread: number;
	messages: ThreadMessage[];
	nextCursor: string | null;
}

/** The fields of `mail-draft-show`, `-create` and `-update`'s result the slice reads. */
interface DraftData {
	draft: number;
	revision: number;
	state: string;
	from?: string | null;
	content: {
		to?: string[];
		cc?: string[];
		bcc?: string[];
		subject?: string;
		body?: string;
		snippet?: string;
	};
}

export type Phase = 'empty' | 'loading' | 'ready' | 'saving' | 'sending' | 'sent' | 'failed';

export interface Notice {
	tone: 'info' | 'success' | 'danger';
	text: string;
}

/** A thread's pages are read to its end, so the reply answers its newest message; this many at most. */
export const MOST_PAGES = 20;
const PAGE = 200;

/**
 * Errors that say the draft changed since the person saw it. The engine's `DRAFT_CHANGED` (an update) and
 * `PREVIEW_CHANGED` (a read or send by a stale revision), and the kernel's `MOUNT_PREVIEW_CHANGED` (the preview's
 * digest moved while the person looked). A stale revision in Loam's own preview read reaches the app as the kernel's
 * `MOUNT_APPROVAL_UNAVAILABLE` instead, so after any refused send the slice reads the draft again to tell.
 */
const CHANGED = new Set(['PREVIEW_CHANGED', 'MOUNT_PREVIEW_CHANGED', 'DRAFT_CHANGED']);

/** Addresses as the person typed them, split on commas, semicolons and spaces. */
export function addressesOf(text: string): string[] {
	return text
		.split(/[\s,;]+/)
		.map((address) => address.trim())
		.filter((address) => address.length > 0);
}

/** A thread's id in the route, `thread/<id>`. */
export function threadOfRoute(route: string | undefined): number | null {
	const found = /^thread\/(\d{1,15})$/.exec(route ?? '');
	return found ? Number(found[1]) : null;
}

/** "Re: " before a subject that does not already start with it. */
export function replySubject(subject: string | null | undefined): string {
	const text = (subject ?? '').trim();
	if (text.length === 0) return 'Re:';
	return /^re:/i.test(text) ? text : `Re: ${text}`;
}

/**
 * The refusal's message, which is written for a person. Its suggestion is not shown: the engine writes those for
 * an agent or its terminal ("run mail-draft-send at a terminal"), which this view is not.
 */
const messageOf = (result: CommandResult<unknown>, fallback: string): string =>
	result.error?.message || fallback;

/** What reading the draft again found. */
type Reread = 'overtaken' | 'failed' | 'sent' | 'changed' | 'same';

export class Reply {
	readonly #client: MailClient;
	readonly #changed: () => void;
	/** Counts opens: an answer to a call made before the last open belongs to another thread and is dropped. */
	#epoch = 0;
	/** Each thread's draft this view made, so opening the thread again goes on with it. View state only. */
	readonly #drafts = new Map<number, number>();

	phase: Phase = 'empty';
	notice: Notice | null = null;
	thread: number | null = null;
	messages: ThreadMessage[] = [];
	/** True when the thread has more messages than the slice read. */
	cut = false;
	/** The message the reply answers: the thread's newest. */
	answers: number | null = null;
	to = '';
	subject = '';
	body = '';
	/**
	 * The draft as the engine last returned it, so its revision is the one the person saw. Its Cc and Bcc, which
	 * this slice does not edit, are shown read-only and saved as they are.
	 */
	draft: { id: number; revision: number; from: string | null; cc: string[]; bcc: string[] } | null =
		null;
	/** True when the fields hold what the draft holds. */
	saved = true;

	constructor(client: MailClient, changed: () => void = () => {}) {
		this.#client = client;
		this.#changed = changed;
	}

	#set(phase: Phase, notice: Notice | null): void {
		this.phase = phase;
		this.notice = notice;
		this.#changed();
	}

	/** Opens a thread by id and sets a reply to its newest message, or goes on with the draft made for it. */
	async open(thread: number): Promise<void> {
		const epoch = ++this.#epoch;
		this.thread = thread;
		this.messages = [];
		this.cut = false;
		this.answers = null;
		this.draft = null;
		this.to = '';
		this.subject = '';
		this.body = '';
		this.saved = true;
		this.#set('loading', { tone: 'info', text: 'Opening the thread' });
		const messages: ThreadMessage[] = [];
		let cursor: string | null = null;
		for (let page = 0; page < MOST_PAGES; page++) {
			const input: Record<string, unknown> = { thread, limit: PAGE };
			if (cursor !== null) input.cursor = cursor;
			const read = await this.#client.call<ThreadPage>('mail-thread-open', input);
			if (this.#epoch !== epoch) return;
			if (!read.success || !read.data) {
				this.#set('failed', {
					tone: 'danger',
					text: messageOf(read, 'The thread could not be read'),
				});
				return;
			}
			messages.push(...read.data.messages);
			cursor = read.data.nextCursor;
			if (cursor === null) break;
		}
		const newest = messages.at(-1);
		if (!newest) {
			this.#set('failed', { tone: 'info', text: 'This thread has no messages to answer' });
			return;
		}
		this.messages = messages;
		this.cut = cursor !== null;
		this.answers = newest.message;
		this.to = newest.content.sender?.address ?? '';
		this.subject = replySubject(newest.content.subject);
		this.saved = false;
		const kept = this.#drafts.get(thread);
		if (kept !== undefined) {
			const shown = await this.#client.call<DraftData>('mail-draft-show', { draft: kept });
			if (this.#epoch !== epoch) return;
			const state = shown.success ? shown.data?.state : undefined;
			if (shown.success && shown.data && state === 'open') {
				this.#fill(shown.data);
				this.#set('ready', { tone: 'info', text: 'Your draft for this thread' });
				return;
			}
			if (shown.success && shown.data && (state === 'sending' || state === 'unknown')) {
				// A send that has not finished, or whose outcome is not known: shown as it went, and not sent again.
				this.#fill(shown.data);
				this.#set('sent', {
					tone: 'info',
					text: "This draft's send has not finished, or whether it went is not known",
				});
				return;
			}
			if (!shown.success && shown.error?.code !== 'DRAFT_NOT_FOUND') {
				// Not read, which may pass: offer no new reply, which would leave this draft behind. Opening again retries.
				this.#set('failed', {
					tone: 'danger',
					text: messageOf(shown, 'Your draft for this thread could not be read'),
				});
				return;
			}
			// Sent, discarded or gone since: the next save makes a new draft.
			this.#drafts.delete(thread);
		}
		this.#set('ready', null);
	}

	/** A field the person typed in. Refused while the draft is sending or sent: the view shows those read-only. */
	edit(field: 'to' | 'subject' | 'body', value: string): void {
		if (this[field] === value || this.phase === 'sending' || this.phase === 'sent') return;
		this[field] = value;
		this.saved = false;
		this.#changed();
	}

	#take(data: DraftData): void {
		this.draft = {
			id: data.draft,
			revision: data.revision,
			from: data.from ?? null,
			cc: data.content.cc ?? [],
			bcc: data.content.bcc ?? [],
		};
		if (this.thread !== null) this.#drafts.set(this.thread, data.draft);
	}

	#fill(data: DraftData): void {
		this.#take(data);
		this.to = (data.content.to ?? []).join(', ');
		this.subject = data.content.subject ?? '';
		this.body = data.content.body ?? data.content.snippet ?? '';
		this.saved = true;
	}

	/**
	 * Reads the draft again after a refusal, to tell a draft sent or changed elsewhere from another failure. Sets
	 * the phase and notice for every outcome but `same`, which leaves them to the caller.
	 */
	async #reread(epoch: number, id: number, revision: number): Promise<Reread> {
		const shown = await this.#client.call<DraftData>('mail-draft-show', { draft: id });
		if (this.#epoch !== epoch) return 'overtaken';
		if (!shown.success || !shown.data) {
			this.#set('ready', {
				tone: 'danger',
				text: messageOf(shown, 'The draft could not be read again'),
			});
			return 'failed';
		}
		if (shown.data.state === 'sent') {
			this.#fill(shown.data);
			this.#set('sent', { tone: 'info', text: 'This draft was already sent' });
			return 'sent';
		}
		if (shown.data.revision !== revision) {
			this.#fill(shown.data);
			this.#set('ready', {
				tone: 'danger',
				text: 'The draft changed since you looked. Check it and send again',
			});
			return 'changed';
		}
		return 'same';
	}

	/** Saves the fields as the draft: made on the first save, updated by its revision after. */
	async save(): Promise<boolean> {
		if (this.thread === null || this.phase !== 'ready') return false;
		if (this.saved && this.draft) return true;
		const epoch = this.#epoch;
		this.#set('saving', { tone: 'info', text: 'Saving the draft' });
		const typed = { to: this.to, subject: this.subject, body: this.body };
		const fields = { to: addressesOf(typed.to), subject: typed.subject, body: typed.body };
		const result = this.draft
			? await this.#client.call<DraftData>('mail-draft-update', {
					draft: this.draft.id,
					revision: this.draft.revision,
					...fields,
					cc: this.draft.cc,
					bcc: this.draft.bcc,
				})
			: await this.#client.call<DraftData>('mail-draft-create', {
					...(this.answers !== null ? { answers: this.answers } : {}),
					...fields,
				});
		if (this.#epoch !== epoch) return false;
		if (result.success && result.data) {
			this.#take(result.data);
			// What the person typed while it saved is not in the draft yet.
			this.saved =
				this.to === typed.to && this.subject === typed.subject && this.body === typed.body;
			this.#set('ready', { tone: 'info', text: 'Draft saved' });
			return true;
		}
		if (!this.draft) {
			this.#set('ready', {
				tone: 'danger',
				text: messageOf(result, 'The draft could not be saved'),
			});
			return false;
		}
		const { id } = this.draft;
		const shown = await this.#client.call<DraftData>('mail-draft-show', { draft: id });
		if (this.#epoch !== epoch) return false;
		if (shown.success && shown.data?.state === 'sent') {
			this.#fill(shown.data);
			this.#set('sent', { tone: 'info', text: 'This draft was already sent' });
			return false;
		}
		if (CHANGED.has(result.error?.code ?? '') && shown.success && shown.data) {
			// Changed elsewhere since this view saved it: keep what the person typed, take the new revision with its
			// Cc and Bcc (shown read-only), and let a second Save replace the other change on purpose.
			this.#take(shown.data);
			this.#set('ready', {
				tone: 'danger',
				text: 'The draft was changed elsewhere. Save again to replace that change with what you see here',
			});
			return false;
		}
		this.#set('ready', { tone: 'danger', text: messageOf(result, 'The draft could not be saved') });
		return false;
	}

	/**
	 * Sends the draft by the revision it last showed, saving first. It reads the draft by that revision first, as
	 * Loam's preview will, so a change made elsewhere shows here instead of as a refused confirmation. Loam asks the
	 * person in the slot; their answer settles the call.
	 */
	async send(): Promise<void> {
		const epoch = this.#epoch;
		if (!(await this.save()) || !this.draft || this.#epoch !== epoch) return;
		if (!this.saved) return; // Typed into while it saved: Send again sends what is shown.
		const { id, revision } = this.draft;
		this.#set('sending', { tone: 'info', text: 'Checking the draft' });
		const current = await this.#client.call<DraftData>('mail-draft-show', { draft: id, revision });
		if (this.#epoch !== epoch) return;
		if (!current.success || current.data?.state === 'sent') {
			if ((await this.#reread(epoch, id, revision)) === 'same')
				this.#set('ready', {
					tone: 'danger',
					text: messageOf(current, 'The draft could not be read'),
				});
			return;
		}
		if (current.data?.state === 'discarded') {
			// Nothing to confirm. What is on screen becomes a new draft at the next Save.
			this.draft = null;
			if (this.thread !== null) this.#drafts.delete(this.thread);
			this.saved = false;
			this.#set('ready', {
				tone: 'danger',
				text: 'This draft was discarded. Save to make a new draft of what you see, then send it',
			});
			return;
		}
		if (current.data && current.data.state !== 'open') {
			// A send already under way, or whose outcome is not known: shown as it went, and not sent again.
			this.#fill(current.data);
			this.#set('sent', {
				tone: 'info',
				text: "This draft's send has not finished, or whether it went is not known",
			});
			return;
		}
		this.#set('sending', { tone: 'info', text: 'Confirm the send in Loam to send it' });
		const result = await this.#client.call<{ state: string }>('mail-draft-send', {
			draft: id,
			revision,
		});
		if (this.#epoch !== epoch) return;
		if (result.success) {
			const copyFailed = (result.warnings ?? []).some(
				(warning) => warning.code === 'SENT_COPY_FAILED'
			);
			this.#set('sent', {
				tone: 'success',
				text: copyFailed ? 'Sent. Its copy could not be saved in your sent mail' : 'Sent',
			});
			return;
		}
		const code = result.error?.code ?? '';
		if (code === 'CONFIRMATION_DECLINED') {
			this.#set('ready', { tone: 'info', text: 'Not sent' });
			return;
		}
		if (code === 'CONFIRMATION_PENDING') {
			// Answered later from the inbox: the next Send, or a Save of an edit, reads the draft and finds it sent.
			this.#set('ready', { tone: 'info', text: 'Waiting for your answer in the inbox' });
			return;
		}
		if ((await this.#reread(epoch, id, revision)) === 'same')
			this.#set('ready', {
				tone: 'danger',
				text: messageOf(result, 'The reply could not be sent'),
			});
	}
}
