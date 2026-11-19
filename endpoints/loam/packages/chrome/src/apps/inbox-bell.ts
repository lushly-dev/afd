/**
 * @fileoverview The title bar's inbox button, kept (phase 4 specification, 10.3 and 15): the person's unread count,
 * read with `notification-list` after stage B and after each call that may change it, and a new notice announced in
 * the shell's own live region with the keyboard path to it. A chunk of its own, which the shell loads after stage B
 * whether or not the deployment has apps (the reviews' item 8), so first paint holds only the button.
 *
 * A change of person or of access clears the count before it is read again, and a refused read leaves it at zero, so
 * nothing of one person's or one scope's shows for another (the reviews' item 4). A muted app's notice is counted but
 * never announced (3.7), nor is one whose mute or reading cannot be checked; a toast that landed in the inbox is not
 * announced again, since the toast region announced the toast.
 */

import type { KernelEventV4, LoamKernelV5 } from '@lushly-dev/loam-kernel';
import type { NotificationV1 } from '@lushly-dev/loam-sdk';
import { accessChanged, ownerWords } from '../inbox/inbox-words.js';

/** Where the person finds a notice from an announcement (15): the title bar's button, or the palette. */
export const INBOX_KEYBOARD_PATH = 'Open it from Inbox in the title bar, or from the palette.';

/** What the watch reads and writes of the shell. */
export interface InboxBellShell {
	readonly kernel: LoamKernelV5 | null;
	unread: number;
	announcement: string;
}

/**
 * Whether a call may have changed the person's unread count: a mutation, never the list's own read, which would read
 * again for ever.
 */
export const touchesInbox = (event: KernelEventV4): boolean =>
	event.success &&
	event.mutation &&
	(event.command.startsWith('notification-') || event.command === 'toast-show');

/** Keep `shell.unread` and announce new notices; returns its stop. */
export function watchInbox(shell: InboxBellShell, kernel: LoamKernelV5): () => void {
	let reads = 0;
	/** The newest notice seen, so each is announced once, and none present when the watch began. */
	let newest: string | undefined;
	let started = false;

	async function read(event?: KernelEventV4): Promise<void> {
		const mine = ++reads;
		const listed = await kernel.call<{ notifications: NotificationV1[]; unread: number }>(
			'notification-list',
			{ limit: 1, unread: true }
		);
		if (mine !== reads) return;
		if (!listed.success || !listed.data) {
			shell.unread = 0;
			return;
		}
		shell.unread = listed.data.unread;
		const [top] = listed.data.notifications;
		const fresh = started && top !== undefined && top.id !== newest;
		newest = top?.id ?? newest;
		started = true;
		if (!fresh || event?.command !== 'notification-push') return;
		if (top.kind === 'notice' && top.source !== 'shell' && !top.source.startsWith('agent:')) {
			const muted = await kernel.call<{ value: unknown }>('setting-get', {
				section: 'loam.notifications',
				key: 'muted',
			});
			// A newer read, or a mute that cannot be checked: nothing is said.
			if (mine !== reads || !muted.success || !Array.isArray(muted.data?.value)) return;
			if (muted.data.value.includes(top.source)) return;
		}
		const from = ownerWords(top.from);
		shell.announcement = `New notice${from ? ` ${from.charAt(0).toLowerCase()}${from.slice(1)}` : ''}: ${top.title}. ${INBOX_KEYBOARD_PATH}`;
	}

	void read().catch(reportError);
	return kernel.subscribe((event) => {
		if (accessChanged(event)) {
			// Nothing of the person or scope before stays while the count is read again; and no announcement of theirs.
			reads++;
			shell.unread = 0;
			started = false;
			newest = undefined;
			void read().catch(reportError);
		} else if (touchesInbox(event)) void read(event).catch(reportError);
	});
}
