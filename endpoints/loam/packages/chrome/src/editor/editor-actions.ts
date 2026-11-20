/**
 * @fileoverview Mod+S's editor and where focus goes after a render (documents specification, 5.5 and 5.8),
 * apart from the controller (`editor.ts`) so it stays under the file-size limit, as plain functions over what
 * the controller passes. In the `editor` chunk.
 */

import { type AskedClose, hearAnswers } from '../elements/events.js';
import type { LoamShell } from '../elements/shell.js';
import { LoamEditorFrame } from './editor-frame.js';
import type { LoamEditorGroup } from './editor-group.js';
import { focusMain } from './editor-parts.js';

type EditorGroupsState = {
	activeGroup: string;
	groups: Array<{ id: string; active: string | null }>;
};

/** The editor a save asks: the one on `path`, which may be in another group than the active one, else the active group's. */
export function saveFrame(
	path: readonly EventTarget[],
	state: EditorGroupsState | null,
	frames: Map<string, LoamEditorFrame>
): LoamEditorFrame | undefined {
	const group = state?.groups.find((each) => each.id === state.activeGroup);
	const frame =
		(path.find((node) => node instanceof LoamEditorFrame) as LoamEditorFrame | undefined) ??
		(group?.active ? frames.get(group.active) : undefined);
	return frame?.state === 'ready' && frames.get(frame.tab) === frame ? frame : undefined;
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

/**
 * The close prompt's answer, to the close that waits for it (phase 4 specification, 7.3): only what the kernel accepted,
 * told by the shell's renderer, never an event a page's element could send (phase 4's step 4 review).
 */
export function hearModals(
	shell: LoamShell,
	modals: Map<string, (result: string, asked?: AskedClose) => void>,
	orphan: (asked: AskedClose, result: string) => void
): void {
	hearAnswers(shell, (overlayId, result, asked) => {
		const waiting = modals.get(overlayId);
		modals.delete(overlayId);
		// With what it asked about, which the waiting close checks against its own tab (step 6's third round, H).
		if (waiting) waiting(result, asked);
		// A close prompt no close of this page waits for: the person's own `editor-close`, from the palette (7.3).
		else if (asked !== undefined) orphan(asked, result);
	});
}

/** The frames whose save a request is running, and those asked again meanwhile. */
const asking = new WeakSet<LoamEditorFrame>();
const again = new WeakSet<LoamEditorFrame>();

/**
 * One save at a time per editor for Mod+S, in the page or from a view's frame, said when it lands; any requests
 * during it become one more save after it, so a Mod+S after a new edit always saves, and a view cannot flood.
 * That one asks again through the controller's `saveAsked`, which saves only the frame its tab still holds: a
 * closed tab's frame, its listener gone, saves nothing more and is never said to be saved (N-2).
 */
export function saveOnce(
	frame: LoamEditorFrame,
	save: () => Promise<boolean>,
	shell: LoamShell
): void {
	if (asking.has(frame)) {
		again.add(frame);
		return;
	}
	asking.add(frame);
	void save()
		.then((saved) => saved && announce(shell, frame))
		.finally(() => {
			asking.delete(frame);
			if (again.delete(frame)) frame.listener?.saveAsked(frame);
		});
}
