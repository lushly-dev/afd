/**
 * @fileoverview A view editor's move where the browser has no `moveBefore` (documents specification, 5.6;
 * Status, step 12's deviation 7), in a chunk of its own that loads only then: moving its frame would reload its
 * view and lose a draft, which only the person's Discard may (step 10's deviation 16). The controller holds the
 * frame where it is; this saves it first, on the person's own move alone. Saved, the frame moves, and its view
 * shows what it saved. Not saved, the chrome moves the tab back, as it repairs another's close of an unsaved
 * tab: to the group it left, or, when that group went with it, to a new one, which this frame's held group
 * becomes, so nothing moves and the tab keeps its draft and its mark; a `danger` toast says why. Where that move
 * back is refused too, the tab's new group shows `loam-editor-held` in its place: Move back, or Save, which saves
 * the draft and moves the editor to its tab (the final re-check's S-1).
 */

import { css, FASTElement, html, Observable, observable } from '@lushly-dev/fast-element';
import type { LoamKernelV3 } from '@lushly-dev/loam-kernel';
import type { LoamEditorFrame } from './editor-frame.js';
import type { LoamEditorGroup } from './editor-group.js';
import type { Life, notSaved, place } from './editor-parts.js';

export interface ViewMove {
	frame: LoamEditorFrame;
	/** The group its frame is in, which its tab left. */
	from: LoamEditorGroup;
	life: Life;
	kernel: LoamKernelV3;
	/** Its save, which only the person's own move asks for: another's never saves the person's draft (T-S2). */
	save(): Promise<boolean>;
	/** Whether the person moved it, by the tab's menu, or chose Save in its placeholder. */
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
	/** The controller's, passed so this chunk parts no chunk of the editor's. */
	place: typeof place;
	notSaved: typeof notSaved;
}

export async function moveAfterSave(move: ViewMove): Promise<void> {
	const { frame, life, kernel, place, notSaved } = move;
	// Saved again while an edit landed during the save, so the move never reloads what no save wrote (S3).
	let before = life.edits;
	let saved = move.person && (await move.save());
	while (saved && life.edits !== before && move.live()) {
		before = life.edits;
		saved = await move.save();
	}
	life.moving = false;
	if (!move.live()) return;
	const into = move.into();
	if (saved && into) {
		// A reload the controller makes on purpose, with every edit saved: invariant 15 knows it by these two.
		life.reloads = (life.reloads ?? 0) + 1;
		life.savedEdits = before;
		place(frame, into);
	} else if (!saved) {
		const back = await moveBack(move);
		await kernel.call(
			'toast-show',
			notSaved(
				frame.title,
				new Error(
					!back
						? 'its tab could not go back to its group, so its changes are held there: move it back, or save it'
						: move.person
							? 'it stays in its group, since a move would lose its changes in this browser'
							: "it stays in its group, since another's move would lose its unsaved changes in this browser"
				)
			)
		);
		// A move back refused: the frame stays where it is, its draft kept, and the tab's group shows a placeholder
		// until the tab moves, which saves first or is refused again; never moved unsaved (N2, S-1).
		if (!back) {
			if (into?.isConnected) hold(move, into);
			return;
		}
	}
	await move.sync();
}

/**
 * The tab back to its frame's group, or, when that group went with it, to a new one, which the frame's held
 * group becomes; whether it moved.
 */
async function moveBack(move: ViewMove): Promise<boolean> {
	const { frame, from, kernel } = move;
	const kept = !!move.state()?.groups.some((group) => group.id === from.group);
	const back = await kernel.call<{ group: string }>(
		'editor-move',
		{ tab: frame.tab, group: kept ? from.group : 'new' },
		{ scope: frame.record?.scope }
	);
	if (back.success && !kept && back.data) {
		from.hidden = false;
		delete from.dataset.held;
		from.group = back.data.group;
		move.holding.delete(from);
		move.groups.set(back.data.group, from);
	}
	return back.success;
}

/** Stand in for a held view editor in its tab's group, which now holds its tab but not its frame (S-1). */
function hold(move: ViewMove, group: LoamEditorGroup): void {
	if (!customElements.get(heldDefinition.name)) LoamEditorHeld.define(heldDefinition);
	move.life.refused = group.group;
	const held = group.ownerDocument.createElement(heldDefinition.name) as LoamEditorHeld;
	held.move = move;
	held.group = group;
	held.dataset.tab = move.frame.tab;
	group.append(held);
}

const template = html<LoamEditorHeld>`
	<div class="held" role="group" aria-label="${(x) => `${x.move?.frame.title ?? 'Document'}, held`}">
		<p role="status">${(x) => x.message}</p>
		<div class="actions">
			<button class="action" type="button" ?disabled="${(x) => x.busy}" @click="${(x) => x.back()}">
				Move back
			</button>
			<button class="action" type="button" ?disabled="${(x) => x.busy}" @click="${(x) => x.save()}">
				Save
			</button>
		</div>
	</div>
`;

const styles = css`
	:host {
		display: block;
		flex: 1 1 auto;
		padding: var(--space-layout-md);
		color: var(--color-text-primary);
	}
	:host([hidden]) {
		display: none;
	}
	.held {
		display: grid;
		justify-items: start;
		gap: var(--space-stack-md);
	}
	p {
		margin: 0;
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-inline-sm);
	}
	.action {
		min-block-size: var(--size-target-natural);
		padding-inline: var(--space-inline-md);
		border: 1px solid var(--color-action-secondary-border);
		border-radius: var(--radius-md);
		background: var(--color-action-secondary-background);
		color: var(--color-action-secondary-text);
		font: inherit;
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
		cursor: pointer;
	}
	.action:hover {
		background: var(--color-action-secondary-hover);
	}
	.action:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: var(--size-space-xs);
	}
	@media (forced-colors: active) {
		.action {
			background: ButtonFace;
			color: ButtonText;
			border-color: ButtonText;
		}
		.action:focus-visible {
			outline-color: Highlight;
		}
	}
`;

/**
 * `loam-editor-held`: shown while its tab is its group's active one, and gone once the tab leaves the group or
 * its frame is no longer held. Its words go into a live region once it is in the page, so they are announced.
 */
export class LoamEditorHeld extends FASTElement {
	declare message: string;
	declare busy: boolean;
	move?: ViewMove;
	group?: LoamEditorGroup;
	#watch = { handleChange: () => this.#check() };

	constructor() {
		super();
		this.message = '';
		this.busy = false;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		if (this.group) Observable.getNotifier(this.group).subscribe(this.#watch, 'tabs');
		this.#check();
		requestAnimationFrame(() => {
			this.message = `${this.move?.frame.title}'s unsaved changes are held in its other group. Move it back to keep editing, or save it here.`;
		});
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		if (this.group) Observable.getNotifier(this.group).unsubscribe(this.#watch, 'tabs');
	}

	#check(): void {
		const move = this.move as ViewMove;
		const tab = this.group?.tabs.find((each) => each.id === move.frame.tab);
		if (!tab || move.life.refused !== this.group?.group || !move.live()) this.remove();
		else this.hidden = !tab.active;
	}

	/** The tab back to its frame's group, where its editor is; refused, a toast says so and this stays. */
	async back(): Promise<void> {
		const move = this.move as ViewMove;
		this.busy = true;
		const moved = await moveBack(move);
		this.busy = false;
		if (!moved) {
			await move.kernel.call('toast-show', {
				message: `${move.frame.title} could not move back to its group: move another tab out of it first`,
				tone: 'danger',
			});
			return;
		}
		await move.sync();
		move.from.tabButton(move.frame.tab)?.focus();
	}

	/** The draft saved, as the person's own move saves it, and its editor moved to its tab. */
	async save(): Promise<void> {
		const move = this.move as ViewMove;
		const into = move.into();
		if (!into) return;
		move.life.refused = undefined;
		move.life.moving = true;
		this.remove();
		await moveAfterSave({ ...move, person: true });
		into.tabButton(move.frame.tab)?.focus();
	}
}
observable(LoamEditorHeld.prototype, 'message');
observable(LoamEditorHeld.prototype, 'busy');

const heldDefinition = { name: 'loam-editor-held', template, styles } as const;
