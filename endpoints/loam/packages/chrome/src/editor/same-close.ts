/**
 * @fileoverview Whether a close prompt's answer is about the tab a close holds (phase 4 specification, 7.3; step 6's third
 * round, H), and the close prompt a tab's close asks, apart from the editor's elements so a unit reaches both.
 */

import type { LoamKernelV5 } from '@lushly-dev/loam-kernel';
import type { AskedClose } from '../elements/events.js';

/** The tab a close holds: its id, the scope it is shown in, and its document, as the page knows them. */
export interface ShownClose {
	tab: string;
	scope: { workspace: string; project?: string } | undefined;
	document: string | undefined;
}

/**
 * Whether a close prompt's answer is about `shown` (phase 4's 7.3; step 6's third round, H): its tab, scope and document
 * all present and the same, since a tab id repeats per project and a closed tab can keep its mark. A missing one never
 * matches.
 */
export function sameClose(asked: AskedClose, shown: ShownClose): boolean {
	return (
		asked.scope !== undefined &&
		asked.document !== undefined &&
		shown.scope !== undefined &&
		shown.document !== undefined &&
		asked.tab === shown.tab &&
		asked.document === shown.document &&
		asked.scope.workspace === shown.scope.workspace &&
		asked.scope.project === shown.scope.project
	);
}

/** The close prompt's words and answers (phase 4 specification, 7.3): Save the default, Discard the danger, Cancel. */
export const CLOSE_PROMPT = {
	title: 'Save your changes?',
	body: 'This tab has changes that are not saved. Closing without saving loses them.',
	actions: [
		{ id: 'save', label: 'Save', tone: 'primary', default: true },
		{ id: 'discard', label: 'Discard', tone: 'danger' },
		{ id: 'cancel', label: 'Cancel' },
	],
} as const;

/**
 * The close prompt (phase 4 specification, 7.3; A-P2-1): the person's own `editor-close` of a dirty tab, which the kernel
 * answers by opening its prompt, Save (the default), Discard or Cancel; its answer by `modals`. `closed` when the kernel
 * held the tab clean and closed it. A draft whose tab the kernel no longer holds, as when an agent closed it while its
 * save ran, is asked the same in the shell's own modal, the person's gesture's, which only they answer (6.5).
 */
export async function askClose(
	kernel: LoamKernelV5,
	modals: Map<string, (result: string, asked?: AskedClose) => void>,
	tab: string,
	scope: { scope: { workspace: string; project?: string } } | undefined,
	shown: ShownClose
): Promise<'save' | 'discard' | 'cancel' | 'closed'> {
	const asked = await kernel.call('editor-close', { tab }, scope);
	if (asked.success) return 'closed';
	let prompt = (asked.error?.details as { prompt?: { overlayId: string } } | undefined)?.prompt;
	// Only a tab the kernel no longer holds is asked in the shell's own modal; any other refusal keeps the tab.
	if (!prompt && asked.error?.code !== 'EDITOR_TAB_UNKNOWN') return 'cancel';
	// The kernel's prompt names its tab, scope and document; the page's own modal, for a draft the kernel no longer holds,
	// names none, and asks of this page's draft alone.
	const own = !prompt;
	if (!prompt) {
		const opened = await kernel.call<{ overlayId: string }>('modal-open', CLOSE_PROMPT);
		prompt = opened.data;
	}
	if (!prompt) return 'cancel';
	const { overlayId } = prompt;
	const [result, about] = await new Promise<[string, AskedClose | undefined]>((resolve) =>
		modals.set(overlayId, (answer, closing) => resolve([answer, closing]))
	);
	if (result !== 'save' && result !== 'discard') return 'cancel';
	// Saved or discarded only where what it asked about is the tab this close holds (step 6's third round, H).
	return own || (about !== undefined && sameClose(about, shown)) ? result : 'cancel';
}
