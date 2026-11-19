/**
 * @fileoverview `loam-global`: the shell's strips under the title bar (phase 4 specification, 6.1), one line per id the
 * kernel holds, each a polite status. It survives a switch and closes when the kernel says its condition ended; a
 * person never dismisses it. Each strip is a slotted `p` with its tone in `data-tone`.
 */

import { css, FASTElement, html } from '@lushly-dev/fast-element';

const template = html<LoamGlobal>`<slot></slot>`;

const styles = css`
	:host {
		position: fixed;
		inset: var(--shell-size-titlebar) 0 auto 0;
		z-index: var(--z-index-popover);
		display: flex;
		flex-direction: column;
	}
	:host([hidden]) {
		display: none;
	}
	::slotted(p) {
		margin: 0;
		padding-block: var(--space-stack-xs);
		padding-inline: var(--space-inline-md);
		border-block-end: 1px solid var(--color-border-strong);
		background: var(--color-surface-floating);
		color: var(--color-text-primary);
		font-family: var(--font-family-body);
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	::slotted(p[data-tone='warning']) {
		color: var(--color-state-warning-text);
	}
	::slotted(p[data-tone='danger']) {
		color: var(--color-state-danger-text);
	}
	@media (forced-colors: active) {
		::slotted(p) {
			border-color: CanvasText;
			background: Canvas;
			color: CanvasText;
		}
	}
`;

export class LoamGlobal extends FASTElement {}

export const globalDefinition = { name: 'loam-global', template, styles } as const;
