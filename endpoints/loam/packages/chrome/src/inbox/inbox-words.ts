/**
 * @fileoverview What the inbox and the title bar's count share (phase 4 specification, 10.3, 6.6): a notice's owner
 * line in words, and which calls change whose inbox may be read. Its own module, so the count's chunk loads none of
 * the inbox's.
 */

import type { KernelEvent } from '@lushly-dev/loam-kernel';
import type { NotificationV1 } from '@lushly-dev/loam-sdk';

/** Whose a notice is, in words (6.6): the kernel's owner line, as a toast's reads; nothing for the shell's own. */
export const ownerWords = (from: NotificationV1['from']): string =>
	!from
		? ''
		: from.kind === 'app'
			? `From ${from.title}`
			: `From ${from.agent}, for ${from.person ?? 'you'}`;

/**
 * A change of person, or of what they may enter (the reviews' item 4): the inbox and its count are read again, and
 * nothing read before stays on screen meanwhile.
 */
export const accessChanged = (event: KernelEvent): boolean =>
	event.actorChanged === true ||
	(event.success &&
		event.mutation &&
		/^(auth-|session-|member-|project-(update|archive|restore)$|workspace-app-set$|agent-member-)/.test(
			event.command
		));
