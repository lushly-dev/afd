/**
 * @fileoverview A person's actions on the editor area's tabs and Mod+S (documents specification, 5.4, 5.5 and
 * 5.8), each turned into a command, apart from the controller (`editor.ts`) so it stays under the file-size
 * limit. In the `editor` chunk.
 */

import type { LoamKernelV2 } from '@lushly-dev/loam-kernel';
import type { LoamShell } from '../elements/shell.js';
import { LoamEditorFrame } from './editor-frame.js';
import type { EditorGroupAction } from './editor-group.js';

/** What a tab's action reads of the controller. */
export interface ActionHost {
	kernel: LoamKernelV2;
	/** The tab to focus once the strip renders, and whether focus then goes into its editor. */
	focus(tab: string, editor: boolean): void;
	isActive(tab: string): boolean;
	sync(): Promise<void>;
	close(tab: string): Promise<boolean>;
	keepFocus(group: string, tab: string): void;
	tabs(group: string): Array<{ id: string; pinned: boolean }>;
	/** The visit of the scope rendered: each change of scope is a new one. */
	visit(): number;
	document(tab: string): string | undefined;
}

export async function runAction(
	action: EditorGroupAction & { group: string },
	host: ActionHost
): Promise<void> {
	const { kernel } = host;
	const { tab } = action;
	switch (action.action) {
		case 'activate':
			host.focus(tab, action.focus === true);
			if (host.isActive(tab)) await host.sync();
			else await kernel.call('editor-activate', { tab });
			return;
		case 'close':
			await host.close(tab);
			return;
		case 'pin':
		case 'unpin':
			host.keepFocus(action.group, tab);
			await kernel.call('editor-pin', { tab, pinned: action.action === 'pin' });
			return;
		case 'close-others': {
			const visit = host.visit();
			for (const other of host.tabs(action.group)) {
				// Not past a change of scope, whose tabs are another scope's.
				if (visit !== host.visit()) return;
				if (other.id !== tab && !other.pinned && !(await host.close(other.id))) return;
			}
			return;
		}
		case 'beside': {
			const document = host.document(tab);
			if (document) await kernel.call('document-open', { document, group: 'beside' });
			return;
		}
		case 'new-group':
			// Focus follows the tab into its new group, from wherever the menu was opened in the strip.
			host.keepFocus(action.group, tab);
			await kernel.call('editor-move', { tab, group: 'new' });
			return;
	}
}

/** The editor Mod+S saves: the one holding focus, which may be in another group than the active one, else `active`. */
export const saveTarget = (event: KeyboardEvent, active: LoamEditorFrame | undefined) =>
	(event.composedPath().find((node) => node instanceof LoamEditorFrame) as
		| LoamEditorFrame
		| undefined) ?? active;

/** A person who asked to save hears that it did, politely, through the shell's live region. */
export function announce(shell: LoamShell, frame: LoamEditorFrame): void {
	shell.announcement = '';
	requestAnimationFrame(() => {
		shell.announcement = `${frame.title} saved`;
	});
}
