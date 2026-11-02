/**
 * @fileoverview `loam-app-entry`: one app in the rail or the tab bar (phase 1 specification, 4.6). A
 * button with the app's icon, and its label as visible text in the tab bar and as `aria-label` and
 * tooltip in the rail. The active entry has `aria-current="page"`; a `failed` or `refused` one says
 * "(unavailable)" and a press still opens it; a `loading` one has `aria-busy="true"`. The tooltip
 * follows the settings entry's rules (WCAG 1.4.13).
 */

import { attr, css, FASTElement, html } from '@lushly-dev/fast-element';

export const APP_OPEN_EVENT = 'loam-app-open';

const UNAVAILABLE = new Set(['failed', 'refused']);

const template = html<LoamAppEntry>`
	<button
		class="entry"
		type="button"
		aria-label="${(x) => x.accessibleLabel}"
		aria-current="${(x) => (x.current ? 'page' : null)}"
		aria-busy="${(x) => (x.state === 'loading' ? 'true' : null)}"
		@click="${(x) => x.press()}"
		@blur="${(x) => x.resetTip()}"
	>
		<violet-icon icon="${(x) => (x.unavailable ? 'system/warning' : x.icon)}" decorative></violet-icon>
		<span class="label">${(x) => x.accessibleLabel}</span>
	</button>
	<span class="tip" aria-hidden="true">${(x) => x.accessibleLabel}</span>
`;

const styles = css`
	:host {
		position: relative;
		display: block;
		flex: none;
	}
	:host([hidden]) {
		display: none;
	}
	.entry {
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--size-space-xs);
		min-inline-size: var(--size-target-comfortable);
		min-block-size: var(--size-target-comfortable);
		padding: var(--size-space-xs);
		border: 1px solid transparent;
		border-inline-start-width: var(--size-space-xs);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font: inherit;
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--easing-standard),
			color var(--duration-fast) var(--easing-standard);
	}
	.entry violet-icon {
		--violet-icon-size: var(--size-line-md);
	}
	.entry:hover {
		background: var(--color-action-secondary-hover);
		color: var(--color-text-primary);
	}
	.entry:active {
		background: var(--color-action-secondary-pressed);
		color: var(--color-text-primary);
	}
	.entry:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: calc(-1 * var(--shell-size-focus));
	}
	.entry[aria-current='page'] {
		background: var(--color-control-selected-background);
		color: var(--color-control-selected-foreground);
		border-inline-start-color: var(--color-control-selected-foreground);
	}
	.entry[aria-busy='true'] {
		cursor: progress;
	}
	.tip {
		position: absolute;
		z-index: var(--z-index-popover);
		display: none;
		padding-block: var(--size-space-sm);
		padding-inline: var(--size-space-md);
		border-radius: var(--radius-md);
		background: var(--color-surface-floating);
		background-clip: padding-box;
		box-shadow: var(--shadow-floating);
		color: var(--color-text-primary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		white-space: nowrap;
		inset-block-start: 0;
		inset-inline-start: 100%;
	}
	:host([variant='rail']:hover) .tip,
	:host([variant='rail']) .entry:focus-visible + .tip {
		display: block;
	}
	:host([variant='rail'][data-tip='dismissed']:hover) .tip,
	:host([variant='rail'][data-tip='dismissed']) .entry:focus-visible + .tip {
		display: none;
	}
	:host([variant='rail']) .entry {
		inline-size: var(--size-target-comfortable);
	}
	:host([variant='rail']) .label {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	:host([variant='tabbar']) .entry {
		flex-direction: column;
	}
	@media (forced-colors: active) {
		.entry {
			color: ButtonText;
		}
		.entry:hover,
		.entry:active,
		.entry[aria-current='page'] {
			border-color: Highlight;
			background: Highlight;
			color: HighlightText;
		}
		.entry:focus-visible {
			outline-color: Highlight;
		}
		.entry:hover:focus-visible,
		.entry[aria-current='page']:focus-visible {
			outline-color: HighlightText;
		}
		.tip {
			border: 1px solid CanvasText;
			background: Canvas;
			color: CanvasText;
		}
	}
`;

export class LoamAppEntry extends FASTElement {
	declare instance: string;
	declare label: string;
	declare icon: string;
	declare state: string;
	declare current: boolean;
	declare variant: 'rail' | 'tabbar';

	#onKeydown = (event: KeyboardEvent) => this.dismissTip(event);

	constructor() {
		super();
		this.instance = '';
		this.label = '';
		this.icon = 'system/folder';
		this.state = 'ready';
		this.current = false;
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
		this.ownerDocument.addEventListener('keydown', this.#onKeydown, true);
		this.addEventListener('mouseleave', this.resetTip);
	}

	override disconnectedCallback(): void {
		this.ownerDocument.removeEventListener('keydown', this.#onKeydown, true);
		this.removeEventListener('mouseleave', this.resetTip);
		super.disconnectedCallback();
	}

	press(): void {
		this.dispatchEvent(
			new CustomEvent(APP_OPEN_EVENT, {
				detail: { instance: this.instance },
				bubbles: true,
				composed: true,
			})
		);
	}

	/** Escape hides a showing tooltip, wherever focus is; the key does nothing else then. */
	dismissTip(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		const tip = this.shadowRoot?.querySelector<HTMLElement>('.tip');
		if (!tip || getComputedStyle(tip).display === 'none') return;
		this.dataset.tip = 'dismissed';
		event.preventDefault();
		event.stopPropagation();
	}

	/** A dismissed tooltip shows again once the pointer and focus have both left. */
	resetTip = (): void => {
		const entry = this.shadowRoot?.querySelector<HTMLElement>('.entry');
		if (!this.matches(':hover') && !entry?.matches(':focus')) delete this.dataset.tip;
	};
}
attr(LoamAppEntry.prototype, 'instance');
attr(LoamAppEntry.prototype, 'label');
attr(LoamAppEntry.prototype, 'icon');
attr(LoamAppEntry.prototype, 'state');
attr({ mode: 'boolean' })(LoamAppEntry.prototype, 'current');
attr(LoamAppEntry.prototype, 'variant');

export const appEntryDefinition = { name: 'loam-app-entry', template, styles } as const;
