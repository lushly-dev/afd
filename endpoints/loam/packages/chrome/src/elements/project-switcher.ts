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

const template = html<LoamProjectSwitcher>`
	<button
		class="entry"
		type="button"
		aria-haspopup="${(x) => (x.variant === 'tabbar' ? 'dialog' : 'listbox')}"
		aria-expanded="${(x) => String(x.expanded)}"
		aria-label="${(x) => x.accessibleName}"
		@click="${(x) => x.press()}"
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
		padding: var(--size-space-xs);
		border-radius: var(--radius-sm);
	}
	:host([project]:not([project=''])) .icon {
		background: var(--color-control-selected-background);
		color: var(--color-control-selected-foreground);
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

	press(): void {
		this.dispatchEvent(new CustomEvent(SWITCHER_OPEN_EVENT, { bubbles: true, composed: true }));
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
