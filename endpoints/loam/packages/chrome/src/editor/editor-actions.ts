/**
 * @fileoverview Mod+S's editor and where focus goes after a render (documents specification, 5.5 and 5.8),
 * apart from the controller (`editor.ts`) so it stays under the file-size limit, as plain functions over what
 * the controller passes. In the `editor` chunk.
 */

import type { LoamShell } from '../elements/shell.js';
import { LoamEditorFrame } from './editor-frame.js';
import type { LoamEditorGroup } from './editor-group.js';
import { focusMain, isSave, MODAL_RESULT_EVENT } from './editor-parts.js';

/**
 * The editor Mod+S saves, its default prevented, or undefined to leave the chord to the browser (5.5): the one
 * holding focus, which may be in another group than the active one, else the active group's, ready and its
 * tab's, while the area shows.
 */
export function keyFrame(
	event: KeyboardEvent,
	mac: boolean,
	shows: boolean,
	state: { activeGroup: string; groups: Array<{ id: string; active: string | null }> } | null,
	frames: Map<string, LoamEditorFrame>
): LoamEditorFrame | undefined {
	if (event.defaultPrevented || !isSave(event, mac) || !shows) return undefined;
	const group = state?.groups.find((each) => each.id === state.activeGroup);
	const frame =
		(event.composedPath().find((node) => node instanceof LoamEditorFrame) as
			| LoamEditorFrame
			| undefined) ?? (group?.active ? frames.get(group.active) : undefined);
	if (frame?.state !== 'ready' || frames.get(frame.tab) !== frame) return undefined;
	event.preventDefault();
	return frame;
}

/** Every dirty editor's `save()`, not waited for, as on `pagehide` (5.5). */
export function saveAll(frames: LoamEditorFrame[]): void {
	for (const frame of frames) if (frame.dirty) void frame.save().catch(reportError);
}

/** A person who asked to save hears that it did, politely, through the shell's live region. */
export function announce(shell: LoamShell, frame: LoamEditorFrame): void {
	shell.announcement = '';
	requestAnimationFrame(() => {
		shell.announcement = `${frame.title} saved`;
	});
}

/**
 * Focus after a render (5.8): into the editor or onto the tab a person's action asked for; else, when what had
 * it went, as another's close or move takes a tab, to that tab in the group it moved to, or its group's active
 * tab, or main.
 */
export function settleFocus(
	shell: LoamShell,
	focus: { tab: string; editor: boolean } | null,
	frame: LoamEditorFrame | null | undefined,
	groups: LoamEditorGroup[],
	had: LoamEditorGroup | undefined,
	was: string | undefined,
	main: HTMLElement | null
): void {
	const groupOf = (tab?: string) =>
		groups.find((each) => each.tabs.some((held) => held.id === tab));
	const doc = shell.ownerDocument;
	if (focus) {
		if (focus.editor) frame?.focusEditor();
		else groupOf(focus.tab)?.tabButton(focus.tab)?.focus();
	} else if (had && doc.activeElement === doc.body) {
		const holder = groupOf(was);
		const to =
			holder && holder !== had
				? holder.tabButton(was as string)
				: had.isConnected && had.activeTab && had.tabButton(had.activeTab.id);
		if (to) to.focus();
		else if (main) focusMain(shell, main);
	}
}

/** The phase 1 modal's answer, to the close that waits for it (5.5). */
export function hearModals(
	shell: LoamShell,
	modals: Map<string, (result: 'confirm' | 'cancel') => void>
): void {
	shell.addEventListener(MODAL_RESULT_EVENT, (event) => {
		const { overlayId, result } = (
			event as CustomEvent<{ overlayId: string; result: 'confirm' | 'cancel' }>
		).detail;
		modals.get(overlayId)?.(result);
		modals.delete(overlayId);
	});
}

/** The frames whose save a request is running, so a view asking again meanwhile is not heard. */
const asking = new WeakSet<LoamEditorFrame>();

/** One save at a time per editor for Mod+S, in the page or from a view's frame, said when it lands. */
export function saveOnce(
	frame: LoamEditorFrame,
	save: () => Promise<boolean>,
	shell: LoamShell
): void {
	if (asking.has(frame)) return;
	asking.add(frame);
	void save()
		.then((saved) => saved && announce(shell, frame))
		.finally(() => asking.delete(frame));
}
