/**
 * @fileoverview `loam-project-switcher`'s button (phase 2 specification, 7.2), in first paint: its list is
 * the `switcher` chunk's, loaded on the first press. A `button` with `aria-haspopup="listbox"`,
 * `aria-expanded`, and the name `Project: Atlas` or `Project: none`, its visible label the project's name
 * or `Project`. Its icon is the project's, on the selected colors when one is active. A press asks the shell
 * to open the list, which `RailBands` and the shell own.
 */

import { attr, css, FASTElement, html } from '@lushly-dev/fast-element';
import { entryBase } from './entry-styles.js';

export const SWITCHER_OPEN_EVENT = 'loam-switcher-open';

/** `SWITCHER_OPEN_EVENT`'s detail: `closing` when the press is a pointer's that began with the list open (#2883). */
export interface SwitcherOpenDetail {
	closing: boolean;
}

const template = html<LoamProjectSwitcher>`
	<button
		class="entry"
		type="button"
		aria-haspopup="${(x) => (x.variant === 'tabbar' ? 'dialog' : 'listbox')}"
		aria-expanded="${(x) => String(x.expanded)}"
		aria-label="${(x) => x.accessibleName}"
		@pointerdown="${(x) => x.pointerDown()}"
		@click="${(x, c) => x.press(c.event as MouseEvent)}"
	>
		<span class="icon"><violet-icon icon="${(x) => x.icon}" decorative></violet-icon></span>
		<span class="label">${(x) => x.project || 'Project'}</span>
	</button>
`;

const styles = css`
	:host {
		position: relative;
	}
	.entry {
		cursor: pointer;
	}
	.icon {
		display: inline-flex;
		padding: var(--violet-space-inline-hairline);
		border-radius: var(--violet-radius-inset);
	}
	:host([project]:not([project=''])) .icon {
		background: var(--violet-color-control-selected-background);
		color: var(--violet-color-control-selected-foreground);
	}
	@media (forced-colors: active) {
		:host([project]:not([project=''])) .icon {
			background: Highlight;
			color: HighlightText;
		}
	}
`;

export class LoamProjectSwitcher extends FASTElement {
	/** The active project's name, empty for none. */
	declare project: string;
	declare icon: string;
	declare expanded: boolean;
	declare variant: 'rail' | 'tabbar';

	constructor() {
		super();
		this.project = '';
		this.icon = 'system/folder';
		this.expanded = false;
		this.variant = 'rail';
	}

	/** Its accessible name. */
	get accessibleName(): string {
		return `Project: ${this.project || 'none'}`;
	}

	/** What the rail's tooltip says; the tab bar shows the label itself. */
	get tip(): string {
		return this.variant === 'rail' ? this.accessibleName : '';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute('role', 'listitem');
	}

	/** Whether the list was open when the pointer went down on the button, before that press closed it. */
	#openAtPointerDown = false;

	/** A pointer goes down on the button: its press closes the list, never reopens it (#2883). */
	pointerDown(): boolean {
		this.#openAtPointerDown = this.expanded;
		return true;
	}

	/**
	 * The button's press, or the shell's command's with no event. A pointer's click (its `detail` counts the clicks; a
	 * key's is 0) that went down on an open list is the press that closed it, however long it was held, so the shell
	 * does not open the list again. A key's press, and the command's, toggle it.
	 */
	press(event?: MouseEvent): void {
		const closing = event !== undefined && event.detail > 0 && this.#openAtPointerDown;
		this.#openAtPointerDown = false;
		this.dispatchEvent(
			new CustomEvent<SwitcherOpenDetail>(SWITCHER_OPEN_EVENT, {
				bubbles: true,
				composed: true,
				detail: { closing },
			})
		);
	}
}
attr({ attribute: 'project' })(LoamProjectSwitcher.prototype, 'project');
attr(LoamProjectSwitcher.prototype, 'icon');
attr({ mode: 'boolean' })(LoamProjectSwitcher.prototype, 'expanded');
attr(LoamProjectSwitcher.prototype, 'variant');

export const projectSwitcherDefinition = {
	name: 'loam-project-switcher',
	template,
	styles: [entryBase, styles],
} as const;
