/**
 * @fileoverview `loam-statusbar`: `contentinfo`, "Status". Its left side shows the signed-in
 * actor or "Signed out", its right side the journal's last sequence number (5.1).
 */

import { css, FASTElement, html } from '@lushly-dev/fast-element';
import { partHost } from './styles.js';

const template = html<LoamStatusbar>`
	<span class="start"><slot name="start"></slot></span>
	<span class="end"><slot name="end"></slot></span>
`;

const styles = [
	partHost,
	css`
		:host {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--space-inline-sm);
			block-size: var(--shell-size-statusbar);
			padding-inline: var(--space-inline-md);
			background: var(--color-surface-subtle);
			color: var(--color-text-secondary);
			border-block-start: 1px solid var(--color-border-subtle);
			overflow: hidden;
		}
		.start,
		.end {
			display: inline-flex;
			gap: var(--space-inline-sm);
			min-inline-size: 0;
		}
		@media (forced-colors: active) {
			:host {
				background: Canvas;
				color: CanvasText;
				border-block-start-color: CanvasText;
			}
		}
	`,
];

export class LoamStatusbar extends FASTElement {
	override connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute('role', 'contentinfo');
		this.setAttribute('aria-label', 'Status');
	}
}

export const statusbarDefinition = { name: 'loam-statusbar', template, styles } as const;
