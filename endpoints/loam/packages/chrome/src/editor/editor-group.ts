/**
 * @fileoverview `loam-editor-group`: one column of the editor area (documents specification, 5.8), a
 * hand-written `role="tablist"`, not `violet-tabs`, whose fixed trigger and panel pairing does not fit a
 * closable tab, and one tab panel holding the active tab's frame, slotted. Each tab is a `button` with
 * `role="tab"`: its icon, its title, `(preview)` and its unsaved mark in its name. Its close and menu buttons
 * are siblings of it, with `tabindex="-1"` and `aria-hidden`: a button inside a `tablist` fails axe's
 * `aria-required-children`, and inside a `tab` its `nested-interactive`, so the keyboard reaches both
 * actions from the tab itself, Delete closing it and Shift+F10 or the context-menu key opening its menu,
 * which `aria-keyshortcuts` names and the tab's description says; a press on either keeps focus where it
 * was. Arrow keys, Home and End move and activate, focus staying in the strip;
 * Enter or Space activates and moves focus to the editor. A press is an event, and the editor area runs the
 * command. The tabs are built with the DOM API, by id, so a tab keeps its button and its focus across
 * renders, and FAST's `repeat` stays out of this chunk, where it would part a shared chunk (2.4).
 */

import { attr, css, FASTElement, html, observable } from '@lushly-dev/fast-element';

/** One tab as the strip shows it. */
export interface EditorTabView {
	id: string;
	document: string;
	title: string;
	dirty: boolean;
	pinned: boolean;
	preview: boolean;
	active: boolean;
	/** The type's icon, from `ICONS_V1` (5.8); `system/document` when the type is unavailable. */
	icon?: string;
}

/** What a press asks for: the editor area runs it. */
export interface EditorGroupAction {
	action: 'activate' | 'close' | 'pin' | 'unpin' | 'close-others' | 'beside' | 'new-group';
	tab: string;
	/** Enter or Space: focus goes to the editor once the tab is active. */
	focus?: boolean;
}

export const EDITOR_GROUP_EVENT = 'loam-editor-group-action';

/** The deepest focused element, through shadow roots, or null on the page itself. */
function deepFocus(document: Document): HTMLElement | null {
	let active = document.activeElement;
	while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
	return active === document.body ? null : (active as HTMLElement | null);
}

/** A tab's accessible name: its title, then what its look says (5.3, 5.8). */
export const tabName = (tab: EditorTabView): string =>
	`${tab.title}${tab.preview ? ' (preview)' : ''}${tab.pinned ? ', pinned' : ''}${tab.dirty ? ', unsaved' : ''}`;

const template = html<LoamEditorGroup>`
	<span id="keys" hidden
		>${(x) => (x.mac ? 'Delete or Backspace closes the tab.' : 'Delete closes the tab.')} Shift+F10 opens its
		menu.</span
	>
	<div class="strip">
		<div class="tabs" role="tablist" aria-label="${(x) => x.label}"></div>
	</div>
	<div
		class="panel"
		id="panel"
		role="tabpanel"
		aria-labelledby="${(x) => (x.activeTab ? `tab-${x.activeTab.id}` : null)}"
		aria-label="${(x) => (x.activeTab ? null : x.label)}"
	>
		<slot></slot>
	</div>
	<div class="menu" role="menu" popover="auto" aria-label="Tab actions"
		@keydown="${(x, c) => x.menuKeydown(c.event as KeyboardEvent)}"
	>
		<button type="button" role="menuitem" tabindex="-1" data-action="pin" @click="${(x) => x.choose('pin')}">
			${(x) => (x.menuTab?.pinned ? 'Unpin' : 'Pin')}
		</button>
		<button type="button" role="menuitem" tabindex="-1" @click="${(x) => x.choose('close')}">Close</button>
		<button type="button" role="menuitem" tabindex="-1" @click="${(x) => x.choose('close-others')}">
			Close others
		</button>
		<button
			type="button"
			role="menuitem"
			tabindex="-1"
			?hidden="${(x) => x.compact}"
			@click="${(x) => x.choose('beside')}"
		>
			Open beside
		</button>
		<button type="button" role="menuitem" tabindex="-1" @click="${(x) => x.choose('new-group')}">
			Move to a new group
		</button>
	</div>
`;

const styles = css`
	:host {
		position: relative;
		display: flex;
		flex-direction: column;
		min-inline-size: 0;
		min-block-size: 0;
		background: var(--color-surface-page);
	}
	:host([hidden]),
	[hidden] {
		display: none;
	}
	.strip {
		flex: none;
		overflow-x: auto;
		border-block-end: 1px solid var(--color-border-subtle);
		background: var(--color-surface-subtle);
	}
	.tabs {
		display: flex;
		inline-size: max-content;
	}
	.item {
		position: relative;
		display: inline-flex;
		align-items: center;
		border-inline-end: 1px solid var(--color-border-subtle);
	}
	.item:has([aria-selected='true']) {
		background: var(--color-surface-page);
	}
	/* The selected tab's mark is a bar on its block-end edge, never its color alone. */
	.item:has([aria-selected='true'])::after {
		content: '';
		position: absolute;
		inset-inline: 0;
		inset-block-end: 0;
		block-size: var(--size-space-xs);
		background: var(--color-control-selected-foreground);
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--size-space-xs);
		min-block-size: var(--size-target-natural);
		min-inline-size: var(--size-target-compact);
		margin: 0;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font: inherit;
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
		cursor: pointer;
		transition: background-color var(--duration-fast) var(--easing-standard);
	}
	.tab {
		max-inline-size: calc(var(--shell-size-sidebar-default) * 0.8);
		padding-inline: var(--space-inline-md) var(--size-space-xs);
		color: var(--color-text-primary);
	}
	.icon {
		flex: none;
	}
	.title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* A preview tab's title is italic, and its name says "(preview)" too (5.3). */
	.tab[data-preview] .title {
		font-style: italic;
	}
	.dirty {
		color: var(--color-text-secondary);
	}
	button:hover {
		background: var(--color-action-secondary-hover);
		color: var(--color-text-primary);
	}
	button:active {
		background: var(--color-action-secondary-pressed);
	}
	button:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: calc(var(--size-space-xs) * -1);
	}
	.panel {
		position: relative;
		display: flex;
		flex: 1 1 auto;
		min-block-size: 0;
		flex-direction: column;
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
		opacity: 1;
		transition: opacity var(--duration-fast) var(--easing-standard);
	}
	.menu:popover-open {
		display: grid;
	}
	.menu button {
		justify-content: start;
		padding-inline: var(--space-inline-md);
		color: var(--color-text-primary);
	}
	@media (prefers-reduced-motion: reduce) {
		button,
		.menu {
			transition: none;
		}
	}
	@media (forced-colors: active) {
		:host,
		.strip,
		.item,
		button {
			background: Canvas;
			color: CanvasText;
			border-color: CanvasText;
		}
		.item:has([aria-selected='true'])::after {
			background: Highlight;
		}
		button:focus-visible {
			outline-color: Highlight;
		}
		.menu {
			border-color: CanvasText;
		}
	}
`;

export class LoamEditorGroup extends FASTElement {
	declare tabs: EditorTabView[];
	declare label: string;
	/** The compact class: the menu has no `Open beside` (5.2). */
	declare compact: boolean;
	declare menuTab: EditorTabView | null;
	/** The group's id in the editor state. */
	group = '';
	/** Command is `Mod` here, and the key labelled delete sends Backspace, which closes a tab too. */
	declare mac: boolean;
	#menuFor: string | null = null;
	/** Where focus goes when the menu closes: the element that had it when a pointer opened it, or the tab. */
	#returnTo: HTMLElement | null = null;

	constructor() {
		super();
		this.tabs = [];
		this.label = 'Documents';
		this.compact = false;
		this.menuTab = null;
		this.mac = false;
	}

	/** The tab menu, by query: the `ref` directive would part a chunk of first paint (2.4). */
	get menu(): HTMLElement {
		return this.shadowRoot?.querySelector('.menu') as HTMLElement;
	}

	tabsChanged(): void {
		if (this.$fastController.isConnected) this.#renderTabs();
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.#renderTabs();
		// A light dismiss, a press outside the menu: focus goes back to its tab, as Escape takes it.
		this.menu.addEventListener('toggle', this.#onToggle);
	}

	override disconnectedCallback(): void {
		this.menu?.removeEventListener('toggle', this.#onToggle);
		super.disconnectedCallback();
	}

	#onToggle = (event: Event): void => {
		if ((event as ToggleEvent).newState !== 'closed' || this.#menuFor === null) return;
		const active = this.shadowRoot?.activeElement;
		if (!active || this.menu.contains(active)) this.#closeMenu();
		else this.#menuFor = null;
	};

	/**
	 * Close the menu, and focus goes back where it was: to the element that had it when a pointer opened the
	 * menu, or to the tab the keyboard opened it from (5.8).
	 */
	#closeMenu(): void {
		const tab = this.#menuFor;
		const back = this.#returnTo;
		this.#menuFor = null;
		this.#returnTo = null;
		if (this.menu.matches(':popover-open')) this.menu.hidePopover();
		if (back?.isConnected) back.focus();
		else if (tab !== null) this.tabButton(tab)?.focus();
	}

	/** Each tab's item, made once by id and updated in place, in the state's order. */
	#renderTabs(): void {
		const list = this.shadowRoot?.querySelector('.tabs');
		if (!list) return;
		const kept = new Map(
			[...list.children].map((item) => [
				(item as HTMLElement).dataset.tab as string,
				item as HTMLElement,
			])
		);
		const doc = this.ownerDocument;
		const button = (className: string, text: string) => {
			const made = doc.createElement('button');
			made.type = 'button';
			made.className = className;
			made.textContent = text;
			return made;
		};
		// Gone items first, so none sits between a kept one and its place; then a kept item moved keeps focus, which
		// `insertBefore` would drop to the page (`moveBefore` keeps it where the browser has it).
		const live = new Set(this.tabs.map((tab) => tab.id));
		for (const [id, item] of kept) {
			if (live.has(id)) continue;
			item.remove();
			kept.delete(id);
		}
		const focused = this.shadowRoot?.activeElement as HTMLElement | null;
		const move = (list as Element & { moveBefore?: (node: Node, child: Node | null) => void })
			.moveBefore;
		this.tabs.forEach((tab, index) => {
			let item = kept.get(tab.id);
			const existing = item !== undefined;
			kept.delete(tab.id);
			if (!item) {
				item = doc.createElement('span');
				item.className = 'item';
				item.dataset.tab = tab.id;
				const main = button('tab', '');
				main.id = `tab-${tab.id}`;
				main.dataset.tab = tab.id;
				main.setAttribute('role', 'tab');
				const icon = doc.createElement('violet-icon');
				icon.className = 'icon';
				icon.setAttribute('decorative', '');
				const title = doc.createElement('span');
				title.className = 'title';
				const dirty = doc.createElement('span');
				dirty.className = 'dirty';
				dirty.textContent = '●';
				main.append(icon, title, dirty);
				main.setAttribute('aria-describedby', 'keys');
				const close = button('close', '×');
				const more = button('more', '⋯');
				for (const each of [close, more]) {
					// For the pointer alone: hidden from assistive technology, out of the Tab order, and never
					// focused, as a press on a `tabindex="-1"` button would otherwise focus it.
					each.tabIndex = -1;
					each.setAttribute('aria-hidden', 'true');
					each.addEventListener('mousedown', (event) => event.preventDefault());
				}
				const id = tab.id;
				const current = () => this.tabs.find((each) => each.id === id) as EditorTabView;
				main.addEventListener('click', () => this.press({ action: 'activate', tab: id }));
				main.addEventListener('keydown', (event) => {
					if (!this.keydown(current(), event)) event.preventDefault();
				});
				main.addEventListener('contextmenu', (event) => this.openMenu(current(), event));
				close.addEventListener('click', () => this.press({ action: 'close', tab: id }));
				more.addEventListener('click', (event) => this.openMenu(current(), event));
				item.append(main, close, more);
			}
			const [main, close, more] = item.children as unknown as HTMLElement[];
			main?.setAttribute(
				'aria-keyshortcuts',
				this.mac ? 'Delete Backspace Shift+F10' : 'Delete Shift+F10'
			);
			main?.querySelector('.icon')?.setAttribute('icon', tab.icon ?? 'system/document');
			const title = main?.querySelector('.title') as HTMLElement;
			const dirty = main?.querySelector('.dirty') as HTMLElement;
			title.textContent = tab.title;
			dirty.hidden = !tab.dirty;
			main?.setAttribute('aria-selected', tab.active ? 'true' : 'false');
			main?.setAttribute('aria-label', tabName(tab));
			if (tab.active) main?.setAttribute('aria-controls', 'panel');
			else main?.removeAttribute('aria-controls');
			main?.toggleAttribute('data-preview', tab.preview);
			if (main) main.tabIndex = tab.active ? 0 : -1;
			close?.setAttribute('title', `Close ${tab.title}`);
			more?.setAttribute('title', `More for ${tab.title}`);
			const at = list.children[index] ?? null;
			if (at === item) return;
			if (existing && move) move.call(list, item, at);
			else list.insertBefore(item, at);
		});
		if (focused?.isConnected && this.shadowRoot?.activeElement !== focused) {
			focused.focus({ preventScroll: true });
		}
	}

	get activeTab(): EditorTabView | undefined {
		return this.tabs.find((tab) => tab.active);
	}

	press(action: EditorGroupAction): void {
		this.dispatchEvent(
			new CustomEvent(EDITOR_GROUP_EVENT, {
				detail: { ...action, group: this.group },
				bubbles: true,
				composed: true,
			})
		);
	}

	/** The tab button for `tab`, to focus it once the strip has rendered. */
	tabButton(tab: string): HTMLButtonElement | null {
		return (
			this.shadowRoot?.querySelector<HTMLButtonElement>(
				`button.tab[data-tab="${CSS.escape(tab)}"]`
			) ?? null
		);
	}

	keydown(tab: EditorTabView, event: KeyboardEvent): boolean {
		const index = this.tabs.indexOf(tab);
		const step = (to: number) => {
			const target = this.tabs[(to + this.tabs.length) % this.tabs.length];
			if (target) this.press({ action: 'activate', tab: target.id });
		};
		switch (event.key) {
			case 'ArrowRight':
				step(index + (getComputedStyle(this).direction === 'rtl' ? -1 : 1));
				return false;
			case 'ArrowLeft':
				step(index + (getComputedStyle(this).direction === 'rtl' ? 1 : -1));
				return false;
			case 'Home':
				step(0);
				return false;
			case 'End':
				step(this.tabs.length - 1);
				return false;
			case 'Enter':
			case ' ':
				this.press({ action: 'activate', tab: tab.id, focus: true });
				return false;
			case 'Backspace':
				if (!this.mac) return true;
				this.press({ action: 'close', tab: tab.id });
				return false;
			case 'Delete':
				this.press({ action: 'close', tab: tab.id });
				return false;
			case 'ContextMenu':
				this.openMenu(tab, event);
				return false;
			case 'F10':
				if (event.shiftKey) {
					this.openMenu(tab, event);
					return false;
				}
				return true;
			default:
				return true;
		}
	}

	/** The tab's menu, anchored to it by CSS anchor positioning, set through CSSOM (design.md). */
	openMenu(tab: EditorTabView, event: Event): boolean {
		event.preventDefault();
		const item = this.shadowRoot?.querySelector<HTMLElement>(
			`.item[data-tab="${CSS.escape(tab.id)}"]`
		);
		if (!item) return false;
		for (const each of this.shadowRoot?.querySelectorAll<HTMLElement>('.item') ?? []) {
			each.style.removeProperty('anchor-name');
		}
		item.style.setProperty('anchor-name', '--loam-editor-tab');
		this.menu.style.setProperty('position-anchor', '--loam-editor-tab');
		this.menuTab = tab;
		this.#menuFor = tab.id;
		// Named before focus enters it, so a screen reader hears whose actions they are.
		this.menu.setAttribute('aria-label', `Actions for ${tab.title}`);
		// A pointer's menu gives focus back to what had it; the keyboard's, to the tab (APG Menu Button).
		this.#returnTo =
			event instanceof KeyboardEvent
				? null
				: ((this.shadowRoot?.activeElement as HTMLElement | null) ?? deepFocus(this.ownerDocument));
		this.menu.showPopover();
		this.#items()[0]?.focus();
		return false;
	}

	#items(): HTMLButtonElement[] {
		return [...this.menu.querySelectorAll<HTMLButtonElement>('button')].filter(
			(item) => !item.hidden
		);
	}

	menuKeydown(event: KeyboardEvent): boolean {
		const items = this.#items();
		const at = items.indexOf(this.shadowRoot?.activeElement as HTMLButtonElement);
		const move = (to: number) => items[(to + items.length) % items.length]?.focus();
		if (event.key === 'ArrowDown') move(at + 1);
		else if (event.key === 'ArrowUp') move(at - 1);
		else if (event.key === 'Home') move(0);
		else if (event.key === 'End') move(items.length - 1);
		else if (event.key === 'Escape') this.#closeMenu();
		else if (event.key === 'Tab') {
			// Tab moves on, as APG's menu has it: to the next stop after the tab, its editor; Shift+Tab to the tab.
			const tab = this.#menuFor;
			this.#menuFor = null;
			this.#returnTo = null;
			this.menu.hidePopover();
			const frame = [...this.children].find(
				(child) => child.localName === 'loam-editor-frame' && !(child as HTMLElement).hidden
			) as (HTMLElement & { focusEditor(): void }) | undefined;
			if (!event.shiftKey && frame) frame.focusEditor();
			else if (tab !== null) this.tabButton(tab)?.focus();
		} else return true;
		return false;
	}

	choose(action: 'pin' | 'close' | 'close-others' | 'beside' | 'new-group'): void {
		const tab = this.menuTab;
		this.#closeMenu();
		if (!tab) return;
		this.press({ action: action === 'pin' && tab.pinned ? 'unpin' : action, tab: tab.id });
	}
}
observable(LoamEditorGroup.prototype, 'tabs');
attr(LoamEditorGroup.prototype, 'label');
attr({ mode: 'boolean' })(LoamEditorGroup.prototype, 'compact');
observable(LoamEditorGroup.prototype, 'menuTab');
observable(LoamEditorGroup.prototype, 'mac');

export const editorGroupDefinition = { name: 'loam-editor-group', template, styles } as const;
