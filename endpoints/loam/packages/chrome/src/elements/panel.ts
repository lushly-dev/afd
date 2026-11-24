/**
 * @fileoverview `loam-panel`: `region`, "Panel". Inline below main, maximized over main's area,
 * or in the compact class a non-modal bottom sheet above the tab bar, between `40dvh` and `80dvh`
 * high (5.3). It asks the shell to close or maximize it with `loam-action` events.
 *
 * Its body is a column: an app's panel views at their own height, then the copilot's panel (phase 5 specification,
 * 3.2), which takes what is left and at least the part's minimum, and whose thread scrolls itself. When the column
 * is taller than the part, the body scrolls, and is then a tab stop, so a person can scroll it by keyboard whatever
 * it holds (WCAG 2.1.1; axe's `scrollable-region-focusable`, which the copilot beside an app's panel failed in
 * phase 5's step 1).
 */

import { attr, css, FASTElement, html } from '@lushly-dev/fast-element';
import type { PanelMode } from '../layout-class.js';
import { dispatchAction } from './events.js';
import { registerChromeIcons } from './icons.js';
import { partHeader, partHost, quietButton } from './styles.js';

const template = html<LoamPanel>`
	<div class="header">
		<h2 class="title">Panel</h2>
		<button
			class="quiet maximize"
			type="button"
			?hidden="${(x) => x.mode === 'sheet'}"
			aria-pressed="${(x) => String(x.mode === 'maximized')}"
			@click="${(x) =>
				dispatchAction(x, { action: 'maximize', maximized: x.mode !== 'maximized' })}"
		>
			Maximize
		</button>
		<button
			class="quiet close"
			type="button"
			aria-label="Close panel"
			title="Close panel"
			@click="${(x) => dispatchAction(x, { action: 'close', part: 'panel' })}"
		>
			<violet-icon icon="system/close" decorative></violet-icon>
		</button>
	</div>
	<div class="body"><slot></slot></div>
	<slot name="handle"></slot>
`;

const styles = [
	partHost,
	quietButton,
	partHeader,
	css`
		:host {
			position: relative;
			display: flex;
			flex-direction: column;
			box-sizing: border-box;
			background: var(--violet-color-surface-card);
			color: var(--violet-color-text-primary);
		}
		:host([mode='inline']),
		:host([mode='maximized']) {
			border-block-start: 1px solid var(--violet-color-border-subtle);
		}
		::slotted([slot='handle']) {
			position: absolute;
			inset-inline: 0;
			inset-block-start: 0;
		}
		:host([mode='sheet']) {
			z-index: var(--violet-z-index-overlay);
			block-size: clamp(40dvh, var(--_panel-height), 80dvh);
			background: var(--violet-color-surface-floating);
			box-shadow: var(--violet-shadow-floating);
			border-start-start-radius: var(--violet-radius-lg);
			border-start-end-radius: var(--violet-radius-lg);
		}
		.body {
			flex: 1;
			display: flex;
			flex-direction: column;
			min-block-size: 0;
		}
		.header,
		.body {
			overflow: hidden;
		}
		.body {
			overflow: auto;
		}
		.body:focus-visible {
			outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
			outline-offset: calc(-1 * var(--violet-shell-size-focus));
		}
		/* An app's view keeps its own height: the body scrolls, never a view squeezed into a scroller of its own. */
		::slotted(:not(loam-copilot-panel)) {
			flex-shrink: 0;
		}
		::slotted(loam-copilot-panel) {
			flex: 1 0 var(--violet-shell-size-panel-min);
			block-size: auto;
		}
		[hidden] {
			display: none;
		}
		@media (forced-colors: active) {
			:host {
				background: Canvas;
				color: CanvasText;
			}
			:host([mode='sheet']) {
				border: 1px solid CanvasText;
			}
			:host([mode='inline']),
			:host([mode='maximized']) {
				border-block-start-color: CanvasText;
			}
		}
	`,
];

export class LoamPanel extends FASTElement {
	declare mode: PanelMode;

	constructor() {
		super();
		registerChromeIcons();
		this.mode = 'inline';
	}

	#observer: ResizeObserver | undefined;

	override connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute('role', 'region');
		this.setAttribute('aria-label', 'Panel');
		const body = this.shadowRoot?.querySelector<HTMLElement>('.body');
		const slot = body?.querySelector('slot');
		if (!body || !slot || typeof ResizeObserver === 'undefined') return;
		// A tab stop exactly while it scrolls: a scroller with nothing focusable in it is otherwise out of reach.
		const check = () => {
			if (body.scrollHeight > body.clientHeight + 1) body.setAttribute('tabindex', '0');
			else body.removeAttribute('tabindex');
		};
		const observer = new ResizeObserver(check);
		const watch = () => {
			observer.disconnect();
			observer.observe(body);
			for (const element of slot.assignedElements()) observer.observe(element);
			check();
		};
		slot.addEventListener('slotchange', watch);
		this.#observer = observer;
		watch();
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.#observer?.disconnect();
		this.#observer = undefined;
	}
}
attr(LoamPanel.prototype, 'mode');

export const panelDefinition = { name: 'loam-panel', template, styles } as const;
