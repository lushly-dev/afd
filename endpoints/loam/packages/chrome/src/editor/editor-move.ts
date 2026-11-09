/**
 * @fileoverview A view editor's move where the browser has no `moveBefore` (documents specification, 5.6;
 * Status, step 12's deviation 7), in a chunk of its own that loads only then: moving its frame would reload its
 * view and lose a draft, which only the person's Discard may (step 10's deviation 16). The controller holds the
 * frame where it is; this saves it first. Saved, the frame moves, and its view shows what it saved. Refused, a
 * `danger` toast says why and the chrome moves the tab back, as it repairs another's close of an unsaved tab:
 * to the group it left, or, when that group went with it, to a new one, which this frame's held group becomes,
 * so nothing moves and the tab keeps its draft and its mark.
 */

import type { LoamKernelV2 } from '@lushly-dev/loam-kernel';
import type { LoamEditorFrame } from './editor-frame.js';
import type { LoamEditorGroup } from './editor-group.js';
import type { Life, notSaved, place } from './editor-parts.js';

export interface ViewMove {
	frame: LoamEditorFrame;
	/** The group its frame is in, which its tab left. */
	from: LoamEditorGroup;
	life: Life;
	kernel: LoamKernelV2;
	/** Its save, for the person's own move; another's answers false, so the person's draft is never saved by it. */
	save(): Promise<boolean>;
	/** Whether the person moved it, by the tab's menu. */
	person: boolean;
	/** Whether the frame is still its tab's, shown or parked. */
	live(): boolean;
	/** The group its tab is in now. */
	into(): LoamEditorGroup | undefined;
	/** The state rendered, and the controller's groups and the groups it holds. */
	state(): { groups: Array<{ id: string }> } | null;
	groups: Map<string, LoamEditorGroup>;
	holding: Set<HTMLElement>;
	sync(): Promise<void>;
	/** The controller's, passed so this chunk imports types alone and parts no chunk of the editor's. */
	place: typeof place;
	notSaved: typeof notSaved;
}

export async function moveAfterSave(move: ViewMove): Promise<void> {
	const { frame, from, life, kernel, place, notSaved } = move;
	const saved = await move.save();
	life.moving = false;
	if (!move.live()) return;
	const into = move.into();
	if (saved && into) place(frame, into);
	else if (!saved) {
		await kernel.call(
			'toast-show',
			notSaved(
				frame.title,
				new Error(
					move.person
						? 'it stays in its group, since a move would lose its changes in this browser'
						: "it stays in its group, since another's move would lose its unsaved changes in this browser"
				)
			)
		);
		const kept = !!move.state()?.groups.some((group) => group.id === from.group);
		const back = await kernel.call<{ group: string }>(
			'editor-move',
			{ tab: frame.tab, group: kept ? from.group : 'new' },
			{ scope: frame.record?.scope }
		);
		// A move back refused leaves the tab where it is, held no longer: the next render moves it, and nothing
		// asks again, since `moving` is clear and the save above already failed once.
		if (!back.success) {
			life.refused = true;
			return;
		}
		if (!kept && back.data) {
			from.hidden = false;
			delete from.dataset.held;
			from.group = back.data.group;
			move.holding.delete(from);
			move.groups.set(back.data.group, from);
		}
	}
	await move.sync();
}
