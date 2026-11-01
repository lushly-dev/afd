/**
 * @fileoverview `loam-panel`: `region`, "Panel". Inline below main, maximized over main's area,
 * or in the compact class a non-modal bottom sheet above the tab bar, between `40dvh` and `80dvh`
 * high (5.3). It asks the shell to close or maximize it with `loam-action` events.
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
			background: var(--color-surface-card);
			color: var(--color-text-primary);
		}
		:host([mode='inline']),
		:host([mode='maximized']) {
			border-block-start: 1px solid var(--color-border-subtle);
		}
		::slotted([slot='handle']) {
			position: absolute;
			inset-inline: 0;
			inset-block-start: 0;
		}
		:host([mode='sheet']) {
			z-index: var(--z-index-overlay);
			block-size: clamp(40dvh, var(--_panel-height), 80dvh);
			background: var(--color-surface-floating);
			box-shadow: var(--shadow-floating);
			border-start-start-radius: var(--radius-lg);
			border-start-end-radius: var(--radius-lg);
		}
		.body {
			flex: 1;
		}
		.header,
		.body {
			overflow: hidden;
		}
		.body {
			overflow: auto;
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

	override connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute('role', 'region');
		this.setAttribute('aria-label', 'Panel');
	}
}
attr(LoamPanel.prototype, 'mode');

export const panelDefinition = { name: 'loam-panel', template, styles } as const;
