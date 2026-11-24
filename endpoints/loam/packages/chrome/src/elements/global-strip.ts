/**
 * @fileoverview `loam-global`: the shell's strips under the title bar (phase 4 specification, 6.1), one line per id the
 * kernel holds, in one persistent polite live region whose text changes. It survives a switch and closes when the
 * kernel says its condition ended; a person never dismisses it. Each strip is a slotted `p` with its tone in
 * `data-tone`. In the lazy `overlays` chunk.
 */

import { css, FASTElement, html } from '@lushly-dev/fast-element';

const template = html<LoamGlobal>`<slot></slot>`;

const styles = css`
	:host {
		position: fixed;
		inset: var(--violet-shell-size-titlebar) 0 auto 0;
		z-index: var(--violet-z-index-popover);
		display: flex;
		flex-direction: column;
	}
	:host([hidden]) {
		display: none;
	}
	::slotted(p) {
		margin: 0;
		padding-block: var(--violet-space-stack-xs);
		padding-inline: var(--violet-space-inline-md);
		border-block-end: 1px solid var(--violet-color-border-strong);
		background: var(--violet-color-surface-floating);
		color: var(--violet-color-text-primary);
		font-family: var(--violet-font-family-body);
		font-size: var(--violet-type-body-md-size);
		line-height: var(--violet-type-body-md-line);
	}
	::slotted(p[data-tone='warning']) {
		color: var(--violet-color-state-warning-text);
	}
	::slotted(p[data-tone='danger']) {
		color: var(--violet-color-state-danger-text);
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
