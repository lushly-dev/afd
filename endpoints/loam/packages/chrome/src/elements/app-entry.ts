/**
 * @fileoverview `loam-app-entry`: one app in the rail or the tab bar (phase 1 specification, 4.6), in
 * first paint, so the first frame lists the apps from their boot records (phase 2 specification, 2.2).
 * `ICONS_V1` registers with the app surfaces, after the first frame, so an entry the first frame draws has
 * an empty `icon` and a blank slot of the icon's size until then (2.4). A button with the app's icon, and
 * its label as visible text in the tab bar and as `aria-label` in the rail. The active entry has
 * `aria-current="page"`; a `failed` or `refused` one says "(unavailable)" and a press still opens it; a
 * `loading` one has `aria-busy="true"`. A `dimmed` one (7.1) is `aria-disabled`, stays in the Tab order,
 * describes itself with its `tip`, and a press does nothing but show that tip. Its tooltip is the rail's
 * `loam-tooltip`, which reads `tip` (7.5). `loam-section-entry` is the same shape for a section (7.2).
 * An `emphasized` entry, an app the active persona puts first, has a mark beside its icon, a system color in
 * forced colors, and says so in its description unless it is dimmed, which says why (phase 3 specification,
 * 6.2 and 14).
 */

import { attr, css, FASTElement, html, when } from '@lushly-dev/fast-element';
import { entryBase } from './entry-styles.js';

export const APP_OPEN_EVENT = 'loam-app-open';
export const SECTION_OPEN_EVENT = 'loam-section-open';

const UNAVAILABLE = new Set(['failed', 'refused']);

const template = html<LoamAppEntry>`
	<button
		class="entry"
		type="button"
		aria-label="${(x) => x.accessibleLabel}"
		aria-current="${(x) => (x.current ? 'page' : null)}"
		aria-busy="${(x) => (x.state === 'loading' ? 'true' : null)}"
		aria-disabled="${(x) => (x.dimmed ? 'true' : null)}"
		aria-describedby="${(x) => (x.dimmed ? 'why' : x.emphasized ? 'emphasis' : null)}"
		@click="${(x) => x.press()}"
	>
		<span class="icon">
			${when(
				(x) => x.icon !== '',
				html<LoamAppEntry>`<violet-icon
					icon="${(x) => (x.unavailable ? 'system/warning' : x.icon)}"
					decorative
				></violet-icon>`
			)}
		</span>
		<span class="label">${(x) => x.accessibleLabel}</span>
	</button>
	<span id="why" hidden>${(x) => x.tip}</span>
	<span id="emphasis" hidden>Emphasized by your persona</span>
`;

const styles = css`
	:host([hidden]) {
		display: none;
	}
	.entry {
		border-inline-start-width: var(--size-space-xs);
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--easing-standard),
			color var(--duration-fast) var(--easing-standard);
	}
	.icon {
		position: relative;
		display: inline-flex;
		flex: none;
		inline-size: var(--size-line-md);
		block-size: var(--size-line-md);
	}
	.entry:not([aria-disabled]):active {
		background: var(--color-action-secondary-pressed);
		color: var(--color-text-primary);
	}
	.entry[aria-current='page'] {
		background: var(--color-control-selected-background);
		color: var(--color-control-selected-foreground);
		border-inline-start-color: var(--color-control-selected-foreground);
	}
	.entry[aria-busy='true'] {
		cursor: progress;
	}
	.entry[aria-disabled] {
		opacity: 0.55;
		cursor: not-allowed;
	}
	:host([emphasized]) .icon::after {
		content: '';
		position: absolute;
		inset-block-start: 0;
		inset-inline-end: 0;
		inline-size: var(--size-space-sm);
		block-size: var(--size-space-sm);
		border-radius: var(--radius-round);
		background: currentColor;
	}
	:host([variant='rail']) .entry {
		inline-size: var(--size-target-comfortable);
	}
	@media (forced-colors: active) {
		.entry:not([aria-disabled]):hover,
		.entry:not([aria-disabled]):active,
		.entry[aria-current='page'] {
			border-color: Highlight;
			background: Highlight;
			color: HighlightText;
		}
		.entry[aria-disabled] {
			color: GrayText;
			border-color: GrayText;
		}
		:host([emphasized]) .icon::after {
			forced-color-adjust: none;
			background: ButtonText;
		}
		:host([emphasized]) .entry[aria-current='page'] .icon::after {
			background: HighlightText;
		}
		.entry:hover:focus-visible,
		.entry[aria-current='page']:focus-visible {
			outline-color: HighlightText;
		}
	}
`;

export class LoamAppEntry extends FASTElement {
	declare instance: string;
	declare label: string;
	declare icon: string;
	declare state: string;
	declare current: boolean;
	declare dimmed: boolean;
	/** First in its band by the active persona's emphasis (phase 3 specification, 6.2). */
	declare emphasized: boolean;
	/** What the rail's or tab bar's `loam-tooltip` says of it; empty for none. */
	declare tip: string;
	declare variant: 'rail' | 'tabbar';

	constructor() {
		super();
		this.instance = '';
		this.label = '';
		this.icon = 'system/folder';
		this.state = 'ready';
		this.current = false;
		this.dimmed = false;
		this.emphasized = false;
		this.tip = '';
		this.variant = 'rail';
	}

	get unavailable(): boolean {
		return UNAVAILABLE.has(this.state);
	}

	get accessibleLabel(): string {
		if (this.unavailable) return `${this.label} (unavailable)`;
		return this.state === 'loading' ? `${this.label} (loading)` : this.label;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute('role', 'listitem');
	}

	press(): void {
		if (this.dimmed) return;
		this.dispatchEvent(
			new CustomEvent(APP_OPEN_EVENT, {
				detail: { instance: this.instance },
				bubbles: true,
				composed: true,
			})
		);
	}
}
attr(LoamAppEntry.prototype, 'instance');
attr(LoamAppEntry.prototype, 'label');
attr(LoamAppEntry.prototype, 'icon');
attr(LoamAppEntry.prototype, 'state');
attr({ mode: 'boolean' })(LoamAppEntry.prototype, 'current');
attr({ mode: 'boolean' })(LoamAppEntry.prototype, 'dimmed');
attr({ mode: 'boolean' })(LoamAppEntry.prototype, 'emphasized');
attr(LoamAppEntry.prototype, 'tip');
attr(LoamAppEntry.prototype, 'variant');

/** A section of the rail's top band, Projects or Documents: a press opens it (7.2). */
export class LoamSectionEntry extends LoamAppEntry {
	declare section: string;

	override press(): void {
		if (this.dimmed) return;
		this.dispatchEvent(
			new CustomEvent(SECTION_OPEN_EVENT, {
				detail: { section: this.section },
				bubbles: true,
				composed: true,
			})
		);
	}
}
attr(LoamSectionEntry.prototype, 'section');

export const appEntryDefinition = {
	name: 'loam-app-entry',
	template,
	styles: [entryBase, styles],
} as const;

export const sectionEntryDefinition = {
	...appEntryDefinition,
	name: 'loam-section-entry',
} as const;
