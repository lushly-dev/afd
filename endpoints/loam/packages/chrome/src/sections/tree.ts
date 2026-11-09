/**
 * @fileoverview `loam-tree` (phase 2 specification, 7.2 and 7.4; documents specification, 8.1): a tree over
 * `violet-tree`, as `loam-list` is over the listbox, with the same loading, empty and error states. It is an
 * app's `tree` sidebar, in place of `loam-list`'s indented rows, and the documents section's sidebar. APG's
 * tree view pattern is `violet-tree`'s: one Tab stop, Up and Down, Right to open or enter, Left to close or
 * leave, Home, End and type-ahead, Enter or Space to choose. A press makes the pressed row active at
 * `mousedown`, so nothing moves a row out from under the pointer (#712); `violet-tree` was read and tested
 * for that fault and does not have it.
 *
 * Its rows are built with the DOM API, by id, and updated in place, so a re-read keeps focus; every title is
 * text, never markup. A choice is `LIST_SELECT_EVENT`, as a list's, with how it was made: a press, or Enter.
 * With `menu` set, each row it gives actions has a pointer's `More` button, which is for the pointer alone, and
 * Shift+F10 or the context-menu key on the row, which `aria-keyshortcuts` names; Tab in the menu closes it
 * and moves on; a row that leaves while focused hands focus to the next, else the previous, else its
 * branch. A choice is
 * `TREE_ACTION_EVENT`. Its chunk is the `documents` chunk's, which an app's tree sidebar loads too.
 */

import { attr, css, FASTElement, html, observable, Updates } from '@lushly-dev/fast-element';
import '@lushly-dev/violet-elements/dist/tree/violet-tree.js';
import type { VioletTree } from '@lushly-dev/violet-elements/dist/tree/violet-tree.js';
import type { VioletTreeItem } from '@lushly-dev/violet-elements/dist/tree-item/violet-tree-item.js';

/** One node of a tree: an app's `tree` command returns these (7.4), and the documents sidebar builds them. */
export interface LoamTreeNode {
	id: string;
	title: string;
	description?: string;
	children?: LoamTreeNode[];
	/** A branch whose children are read when it opens. */
	lazy?: boolean;
	/** Its icon, `system/<name>`. */
	icon?: string;
}

/** A failed read, as a failure's message and suggestion. */
export interface LoamTreeFailure {
	message: string;
	suggestion?: string;
}

/** Dispatched with the chosen id, as `loam-list`'s is, and `how`: a press, or Enter. */
export const TREE_SELECT_EVENT = 'loam-list-select';
/** A row's action, chosen from its menu: `{ id, action }`. */
export const TREE_ACTION_EVENT = 'loam-tree-action';
/** A branch opened or closed: `{ id, expanded }`. */
export const TREE_EXPAND_EVENT = 'loam-tree-expand';

const template = html<LoamTree>`
	<div
		class="group"
		role="${(x) => (x.heading ? 'region' : null)}"
		aria-labelledby="${(x) => (x.heading ? 'heading' : null)}"
	>
		<h3 id="heading" ?hidden="${(x) => !x.heading}">${(x) => x.heading}</h3>
		<div class="failure" role="alert" ?hidden="${(x) => x.failure === null}">
			<p>${(x) => x.failure?.message}</p>
			<p class="suggestion">${(x) => x.failure?.suggestion ?? ''}</p>
		</div>
		<p class="empty" ?hidden="${(x) => x.failure !== null || x.items.length > 0}">
			${(x) => (x.busy ? 'Loading…' : x.emptyMessage)}
		</p>
		<violet-tree
			aria-label="${(x) => x.label}"
			?hidden="${(x) => x.failure !== null || x.items.length === 0}"
		></violet-tree>
		<div class="menu" role="menu" popover="auto" aria-label="${(x) => x.menuLabel}"></div>
	</div>
`;

const styles = css`
	:host {
		display: block;
		--violet-tree-indent-step: var(--space-inline-md);
		--violet-tree-row-padding-inline: var(--space-inline-md);
	}
	:host([hidden]),
	[hidden] {
		display: none !important;
	}
	h3 {
		margin: 0 0 var(--space-stack-xs);
		color: var(--color-text-secondary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--weight-semibold);
	}
	:host([heading]:not([heading=''])) {
		margin-block-end: var(--space-stack-md);
	}
	p {
		margin: 0;
		color: var(--color-text-secondary);
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	.failure p {
		color: var(--color-state-danger-text);
	}
	.failure .suggestion {
		margin-block-start: var(--space-stack-xs);
		color: var(--color-text-secondary);
	}
	violet-tree-item::part(row) {
		color: var(--color-text-primary);
		border-inline-start: var(--size-space-xs) solid transparent;
		border-radius: var(--radius-md);
		box-shadow: none;
		transition: background-color var(--duration-fast) var(--easing-standard);
	}
	violet-tree-item::part(row):hover {
		background: var(--color-surface-subtle);
	}
	/* Selected: the control colors and a start-edge bar, since color alone is not enough. */
	violet-tree-item[selected]::part(row) {
		border-inline-start-color: var(--color-control-selected-foreground);
		background: var(--color-control-selected-background);
		color: var(--color-control-selected-foreground);
		box-shadow: none;
	}
	violet-tree-item:focus-visible::part(row) {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: calc(-1 * var(--shell-size-focus));
		box-shadow: none;
	}
	/* The chevron turns at once: only opacity and color move (design.md, motion). */
	violet-tree-item::part(toggle-icon) {
		transition: none;
	}
	violet-tree-item::part(meta) {
		color: var(--color-text-secondary);
	}
	.label {
		overflow-wrap: anywhere;
	}
	.more {
		min-inline-size: var(--size-target-compact);
		min-block-size: var(--size-target-compact);
		padding: 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		font: inherit;
		cursor: pointer;
	}
	.more:hover {
		background: var(--color-action-secondary-hover);
		color: var(--color-text-primary);
	}
	.menu {
		position-area: block-end span-inline-end;
		margin: 0;
		padding: var(--size-space-xs);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: var(--color-surface-floating);
		box-shadow: var(--shadow-floating);
		color: var(--color-text-primary);
	}
	.menu:popover-open {
		display: grid;
	}
	.menu button {
		min-block-size: var(--size-target-natural);
		padding-inline: var(--space-inline-md);
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-primary);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.menu button:hover {
		background: var(--color-surface-subtle);
	}
	.menu button:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: calc(-1 * var(--shell-size-focus));
	}
	@media (prefers-reduced-motion: reduce) {
		violet-tree-item::part(row) {
			transition: none;
		}
	}
	@media (forced-colors: active) {
		h3,
		p,
		.failure p,
		.failure .suggestion,
		violet-tree-item::part(meta) {
			color: CanvasText;
		}
		violet-tree-item::part(row) {
			color: ButtonText;
		}
		violet-tree-item[selected]::part(row) {
			border-inline-start-color: Highlight;
			background: Highlight;
			color: HighlightText;
		}
		violet-tree-item[selected]::part(meta) {
			color: HighlightText;
		}
		violet-tree-item:focus-visible::part(row),
		.menu button:focus-visible {
			outline-color: Highlight;
		}
		.menu {
			border-color: CanvasText;
		}
		.more,
		.menu button {
			color: ButtonText;
		}
	}
`;

/** One row's actions, in its menu. */
export interface TreeMenuItem {
	action: string;
	label: string;
}

export class LoamTree extends FASTElement {
	declare label: string;
	/** A dual-scope app's sidebar has two trees, each a `region` with this heading (7.4). */
	declare heading: string;
	/** The level its command runs at, which a selection in it carries. */
	level?: 'workspace' | 'project';
	/** The scope it was made in, which its command reads, as a queued read after a change of scope does. */
	scope?: { workspace: string; project?: string };
	/** Made before a change of scope: it reads nothing more, and what it selects is ignored (7.6). */
	stale = false;
	declare emptyMessage: string;
	declare items: LoamTreeNode[];
	declare selected: string | null;
	declare failure: LoamTreeFailure | null;
	declare busy: boolean;
	declare menuLabel: string;
	/** A row's actions, or none: with this set, each row has a menu. */
	menu: ((id: string) => TreeMenuItem[]) | null = null;
	/** Whether choosing a branch selects it, as an app's tree does; otherwise it opens or closes. */
	branchesSelect = true;
	/** Which branches are open, by id, kept across re-reads. */
	readonly expanded = new Set<string>();
	#viaKey = false;
	#menuFor: string | null = null;
	#rendering = false;

	constructor() {
		super();
		this.label = 'Items';
		this.heading = '';
		this.emptyMessage = 'Nothing here yet.';
		this.items = [];
		this.selected = null;
		this.failure = null;
		this.busy = false;
		this.menuLabel = 'Actions';
	}

	get tree(): VioletTree {
		return this.shadowRoot?.querySelector('violet-tree') as VioletTree;
	}

	get #menu(): HTMLElement {
		return this.shadowRoot?.querySelector('.menu') as HTMLElement;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		const tree = this.tree;
		if (tree.dataset.wired) return;
		tree.dataset.wired = '';
		// Before the tree's own keydown: Enter chooses as a promotion (documents specification, 5.3).
		tree.addEventListener(
			'keydown',
			(event) => {
				this.#viaKey = event.key === 'Enter';
				const item = (event.composedPath() as Element[]).find(
					(node) => node.localName === 'violet-tree-item'
				);
				if (
					this.menu &&
					item &&
					((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu')
				) {
					event.preventDefault();
					event.stopImmediatePropagation();
					this.openMenu((item as HTMLElement).dataset.id as string, item as HTMLElement, true);
				}
			},
			{ capture: true }
		);
		tree.addEventListener('pointerdown', () => {
			this.#viaKey = false;
		});
		tree.addEventListener('change', (event) =>
			this.#chosen(event as CustomEvent<{ value: string }>)
		);
		tree.addEventListener('expanded-change', (event) => {
			const { value, expanded } = (event as CustomEvent<{ value: string; expanded: boolean }>)
				.detail;
			if (expanded) this.expanded.add(value);
			else this.expanded.delete(value);
			this.dispatchEvent(
				new CustomEvent(TREE_EXPAND_EVENT, { detail: { id: value, expanded }, bubbles: true })
			);
		});
		this.#menu.addEventListener('keydown', (event) => this.#menuKey(event));
		this.#menu.addEventListener('toggle', (event) => {
			if ((event as ToggleEvent).newState === 'closed') this.#menuClosed();
		});
		this.#render();
	}

	busyChanged(): void {
		if (this.busy) this.setAttribute('aria-busy', 'true');
		else this.removeAttribute('aria-busy');
	}

	itemsChanged(): void {
		this.#render();
	}

	selectedChanged(): void {
		if (this.$fastController?.isConnected && !this.#rendering) {
			this.tree.value = this.selected ?? '';
		}
	}

	#find(id: string, nodes = this.items): LoamTreeNode | undefined {
		for (const node of nodes) {
			if (node.id === id) return node;
			const found = node.children && this.#find(id, node.children);
			if (found) return found;
		}
		return undefined;
	}

	#chosen(event: CustomEvent<{ value: string }>): void {
		event.stopPropagation();
		if (this.#rendering) return;
		const id = event.detail?.value;
		const node = typeof id === 'string' ? this.#find(id) : undefined;
		if (!node) return;
		const how = this.#viaKey ? 'enter' : 'press';
		this.#viaKey = false;
		if (!this.branchesSelect && (node.children || node.lazy)) {
			// A branch opens or closes, and the selection stays where it was.
			const item = this.#item(node.id);
			if (item) {
				item.expanded = !item.expanded;
				item.dispatchEvent(
					new CustomEvent('expanded-change', {
						detail: { value: node.id, expanded: item.expanded },
						bubbles: true,
					})
				);
			}
			this.tree.value = this.selected ?? '';
			return;
		}
		this.selected = id;
		this.dispatchEvent(
			new CustomEvent(TREE_SELECT_EVENT, {
				detail: { id, level: this.level, how },
				bubbles: true,
				composed: true,
			})
		);
	}

	#item(id: string): VioletTreeItem | null {
		return (
			this.shadowRoot?.querySelector<VioletTreeItem>(
				`violet-tree-item[data-id="${CSS.escape(id)}"]`
			) ?? null
		);
	}

	/** Focus a row, as after a re-read that kept it. */
	focusItem(id: string): boolean {
		const item = this.#item(id);
		item?.focus();
		return item !== null;
	}

	/** The rows, made once by id and updated in place, in order, so a re-read keeps focus and openness. */
	#render(): void {
		if (!this.$fastController?.isConnected) return;
		this.#rendering = true;
		try {
			const focused = this.shadowRoot?.activeElement as HTMLElement | null;
			// The rows a person could reach before, in order, so a focused row that leaves hands focus on (A-B2).
			const before = this.#visible();
			const at = focused?.localName === 'violet-tree-item' ? before.indexOf(focused) : -1;
			this.#renderLevel(this.tree, this.items);
			this.tree.value = this.selected ?? '';
			if (focused?.isConnected && this.shadowRoot?.activeElement !== focused) {
				focused.focus({ preventScroll: true });
			} else if (at >= 0 && !focused?.isConnected) {
				// The next sibling that stays, else the previous, else the branch it was in: never a row of another
				// branch, which would take the person across the tree.
				const parent = (focused as HTMLElement).dataset.parent;
				const stays = (row: HTMLElement | undefined) =>
					row?.isConnected && row.dataset.parent === parent && this.#visible().includes(row);
				const next =
					before.slice(at + 1).find(stays) ??
					before.slice(0, at).reverse().find(stays) ??
					(parent === undefined ? undefined : this.#item(parent));
				next?.focus({ preventScroll: true });
			}
		} finally {
			this.#rendering = false;
		}
		void Updates.next().then(() => this.tree.handleSlotChange());
	}

	/** The rows reachable now: every row whose branches above it are open, in order. */
	#visible(): HTMLElement[] {
		const rows: HTMLElement[] = [];
		const walk = (parent: Element) => {
			for (const child of parent.children) {
				if (child.localName !== 'violet-tree-item') continue;
				rows.push(child as HTMLElement);
				if ((child as VioletTreeItem).expanded) walk(child);
			}
		};
		walk(this.tree);
		return rows;
	}

	#renderLevel(parent: Element, nodes: readonly LoamTreeNode[]): void {
		const doc = this.ownerDocument;
		const kept = new Map<string, VioletTreeItem>();
		for (const child of [...parent.children]) {
			if (child.localName === 'violet-tree-item') {
				kept.set((child as HTMLElement).dataset.id as string, child as VioletTreeItem);
			}
		}
		const live = new Set(nodes.map((node) => node.id));
		for (const [id, item] of kept) {
			if (!live.has(id)) {
				item.remove();
				kept.delete(id);
			}
		}
		const move = (parent as Element & { moveBefore?: (node: Node, child: Node | null) => void })
			.moveBefore;
		const items = () =>
			[...parent.children].filter((child) => child.localName === 'violet-tree-item');
		nodes.forEach((node, index) => {
			let item = kept.get(node.id);
			const existing = item !== undefined;
			if (!item) {
				item = doc.createElement('violet-tree-item') as VioletTreeItem;
				item.dataset.id = node.id;
				if (parent !== this.tree) item.dataset.parent = (parent as HTMLElement).dataset.id ?? '';
				item.value = node.id;
				const label = doc.createElement('span');
				label.className = 'label';
				const meta = doc.createElement('span');
				meta.className = 'meta';
				meta.slot = 'meta';
				item.append(label, meta);
				// Only a row with actions has the menu's button and its keys (A-S1).
				if ((this.menu?.(node.id).length ?? 0) > 0) {
					// For the pointer alone: hidden from assistive technology, out of the Tab order, never focused.
					const more = doc.createElement('button');
					more.type = 'button';
					more.className = 'more';
					more.textContent = '⋯';
					more.tabIndex = -1;
					more.slot = 'meta';
					more.setAttribute('aria-hidden', 'true');
					more.addEventListener('mousedown', (event) => event.preventDefault());
					more.addEventListener('click', (event) => {
						event.stopPropagation();
						this.openMenu(node.id, more, false);
					});
					item.append(more);
					item.setAttribute('aria-keyshortcuts', 'Shift+F10');
					item.addEventListener('contextmenu', (event) => {
						if (event.target !== item && !item?.contains(event.target as Node)) return;
						event.preventDefault();
						event.stopPropagation();
						this.openMenu(node.id, item as HTMLElement, false);
					});
				}
			}
			// By class, not by place: an icon is put first.
			const label = item.querySelector<HTMLElement>(':scope > .label');
			const meta = item.querySelector<HTMLElement>(':scope > .meta');
			if (label) label.textContent = node.title;
			if (meta) meta.textContent = node.description ?? '';
			let icon = item.querySelector<HTMLElement>(':scope > violet-icon');
			if (node.icon) {
				if (!icon) {
					icon = doc.createElement('violet-icon');
					icon.slot = 'start';
					icon.setAttribute('decorative', '');
					item.prepend(icon);
				}
				icon.setAttribute('icon', node.icon);
			} else icon?.remove();
			item.setAttribute(
				'aria-label',
				node.description ? `${node.title}, ${node.description}` : node.title
			);
			item.expandable = node.lazy === true;
			item.expanded = this.expanded.has(node.id);
			this.#renderLevel(item, node.children ?? []);
			const at = items()[index] ?? null;
			if (at === item) return;
			if (existing && move) move.call(parent, item, at);
			else parent.insertBefore(item, at);
		});
	}

	/** Open the row's menu; from the keyboard, focus goes to its first action, and back to the row. */
	openMenu(id: string, anchor: HTMLElement, keyboard: boolean): void {
		const actions = this.menu?.(id) ?? [];
		if (actions.length === 0) return;
		const menu = this.#menu;
		const doc = this.ownerDocument;
		this.#menuFor = id;
		const title = this.#find(id)?.title ?? '';
		this.menuLabel = `Actions for ${title}`;
		menu.replaceChildren(
			...actions.map(({ action, label }) => {
				const button = doc.createElement('button');
				button.type = 'button';
				button.setAttribute('role', 'menuitem');
				button.tabIndex = -1;
				button.dataset.action = action;
				button.textContent = label;
				button.addEventListener('click', () => this.#choose(action));
				return button;
			})
		);
		const name = `--loam-tree-menu-${Math.random().toString(36).slice(2, 8)}`;
		anchor.style.setProperty('anchor-name', name);
		menu.style.setProperty('position-anchor', name);
		menu.showPopover();
		if (keyboard || doc.activeElement !== null) {
			(menu.firstElementChild as HTMLElement | null)?.focus();
		}
	}

	#choose(action: string): void {
		const id = this.#menuFor;
		this.#closeMenu();
		if (id === null) return;
		this.dispatchEvent(
			new CustomEvent(TREE_ACTION_EVENT, { detail: { id, action }, bubbles: true })
		);
	}

	#menuKey(event: KeyboardEvent): void {
		const buttons = [...this.#menu.querySelectorAll<HTMLElement>('button')];
		const at = buttons.indexOf(this.shadowRoot?.activeElement as HTMLElement);
		const go = (index: number) => buttons[(index + buttons.length) % buttons.length]?.focus();
		switch (event.key) {
			case 'ArrowDown':
				go(at + 1);
				break;
			case 'ArrowUp':
				go(at - 1);
				break;
			case 'Home':
				go(0);
				break;
			case 'End':
				go(-1);
				break;
			case 'Escape':
				this.#closeMenu();
				break;
			case 'Tab': {
				// APG's menu: Tab closes it and moves on, from the row it opened on, so focus leaves the tree in
				// the Tab order rather than landing on the page.
				const id = this.#menuFor;
				this.#menuFor = null;
				this.#menu.hidePopover();
				if (id !== null) this.#item(id)?.focus();
				return;
			}
			default:
				return;
		}
		event.preventDefault();
	}

	/** Close the menu; focus goes back to its row. */
	#closeMenu(): void {
		const id = this.#menuFor;
		this.#menuFor = null;
		if (this.#menu.matches(':popover-open')) this.#menu.hidePopover();
		if (id !== null) this.#item(id)?.focus();
	}

	/** A light dismiss: focus that was in the menu goes back to its row. */
	#menuClosed(): void {
		const id = this.#menuFor;
		if (id === null) return;
		this.#menuFor = null;
		const active = this.shadowRoot?.activeElement;
		if (!active || this.#menu.contains(active)) this.#item(id)?.focus();
	}
}
attr(LoamTree.prototype, 'label');
attr(LoamTree.prototype, 'heading');
attr({ attribute: 'empty-message' })(LoamTree.prototype, 'emptyMessage');
observable(LoamTree.prototype, 'items');
observable(LoamTree.prototype, 'selected');
observable(LoamTree.prototype, 'failure');
observable(LoamTree.prototype, 'busy');
observable(LoamTree.prototype, 'menuLabel');

export const treeDefinition = { name: 'loam-tree', template, styles } as const;

let defined: Promise<unknown> | undefined;
/** Define `loam-tree` once; `violet-tree` defines itself and its items as its module loads. */
export function defineTree(): Promise<unknown> {
	defined ??= customElements.get(treeDefinition.name)
		? Promise.resolve()
		: Promise.resolve(LoamTree.define(treeDefinition));
	return defined;
}
