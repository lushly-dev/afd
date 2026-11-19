/**
 * @fileoverview The title bar's inbox button, kept (phase 4 specification, 10.3 and 15): the person's unread count,
 * read with `notification-list` after stage B and after each call that may change it, and a new notice announced in
 * the shell's live region with the keyboard path to it. In the `apps` chunk, which loads after first paint, so first
 * paint holds only the button.
 *
 * A muted app's notice is counted but never announced (3.7); a toast that landed in the inbox is not announced again,
 * since the toast region announced the toast.
 */

import type { KernelEventV4, LoamKernelV5 } from '@lushly-dev/loam-kernel';
import type { NotificationV1 } from '@lushly-dev/loam-sdk';
import type { LoamShell } from '../elements/shell.js';

/** Where the person finds a notice from an announcement (15): the title bar's button, or the palette. */
export const INBOX_KEYBOARD_PATH = 'Open it from Inbox in the title bar, or from the palette.';

/**
 * Whether a call may have changed the person's unread count, or whose inbox it is: a mutation, never the list's own
 * read, which would read again for ever.
 */
export const touchesInbox = (event: KernelEventV4): boolean =>
	event.actorChanged === true ||
	(event.success &&
		event.mutation &&
		(event.command.startsWith('notification-') ||
			event.command === 'toast-show' ||
			event.command.startsWith('auth-')));

/** Who left a notice, as an announcement says it (6.6): an app's title, an agent, or nothing for the shell. */
function fromWords(shell: LoamShell, source: string): string {
	if (source === 'shell') return '';
	if (source.startsWith('agent:')) return ` from an agent (${source.slice('agent:'.length)})`;
	const app = shell.appList.find((each) => each.instance === source);
	return ` from ${app?.title ?? source}`;
}

/** Keep `shell.unread` and announce new notices; returns its stop. */
export function watchInbox(
	shell: LoamShell,
	kernel: LoamKernelV5,
	announce: (text: string) => void
): () => void {
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
		if (!fresh || event?.command !== 'notification-push' || event.actorChanged) return;
		if (top.kind === 'notice' && top.source !== 'shell' && !top.source.startsWith('agent:')) {
			const muted = await kernel.call<{ value: unknown }>('setting-get', {
				section: 'loam.notifications',
				key: 'muted',
			});
			if (Array.isArray(muted.data?.value) && muted.data.value.includes(top.source)) return;
		}
		announce(`New notice${fromWords(shell, top.source)}: ${top.title}. ${INBOX_KEYBOARD_PATH}`);
	}

	void read().catch(reportError);
	return kernel.subscribe((event) => {
		if (touchesInbox(event)) void read(event).catch(reportError);
	});
}
