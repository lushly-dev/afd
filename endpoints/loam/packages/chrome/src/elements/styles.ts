/**
 * @fileoverview Style partials every Loam element shares (design.md, "Focus and state"). Each
 * partial is linted on its own, so none declares a private alias another sheet reads.
 */

import { css } from '@lushly-dev/fast-element';

/** The focus indicator, on `:focus-visible` only. */
export const focusRing = css.partial`
	outline: var(--shell-size-focus) solid var(--color-focus-ring);
	outline-offset: var(--size-space-xs);
`;

/** A part host: hidden when not present, focusable for F6 with the ring drawn inside it. */
export const partHost = css`
	:host {
		box-sizing: border-box;
		min-inline-size: 0;
		min-block-size: 0;
	}
	:host([hidden]) {
		display: none;
	}
	:host(:focus-visible) {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: calc(-1 * var(--shell-size-focus));
	}
	@media (forced-colors: active) {
		:host(:focus-visible) {
			outline-color: Highlight;
		}
	}
`;

/**
 * A quiet button on a bar (`color.surface.subtle`) or on a part: transparent at rest, the
 * secondary action's hover and pressed colors, the selected-control colors with a start-edge
 * mark when pressed, and the disabled treatment.
 */
export const quietButton = css`
	.quiet {
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--size-space-sm);
		min-block-size: var(--size-target-natural);
		min-inline-size: var(--size-target-natural);
		padding-block: 0;
		padding-inline: var(--size-space-md);
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
	.quiet:hover {
		background: var(--color-action-secondary-hover);
		color: var(--color-text-primary);
	}
	.quiet:active {
		background: var(--color-action-secondary-pressed);
		color: var(--color-text-primary);
	}
	.quiet:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: calc(-1 * var(--shell-size-focus));
	}
	.quiet[aria-pressed='true'] {
		background: var(--color-control-selected-background);
		color: var(--color-control-selected-foreground);
		border-inline-start-color: var(--color-control-selected-foreground);
	}
	.quiet[aria-disabled='true'],
	.quiet:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		background: transparent;
		color: var(--color-text-secondary);
	}
	.quiet violet-icon {
		--violet-icon-size: var(--size-line-sm);
	}
	@media (forced-colors: active) {
		.quiet {
			color: ButtonText;
			background: ButtonFace;
			border-color: ButtonText;
		}
		.quiet:hover,
		.quiet:active,
		.quiet[aria-pressed='true'] {
			background: Highlight;
			color: HighlightText;
			border-color: Highlight;
		}
		.quiet:focus-visible {
			outline-color: Highlight;
		}
		.quiet[aria-disabled='true'],
		.quiet:disabled {
			color: GrayText;
			border-color: GrayText;
			background: ButtonFace;
		}
	}
`;

/** Visually hidden but read by assistive technology. */
export const visuallyHidden = css`
	.visually-hidden {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
`;

/** A part's header: its title and its close and size buttons. */
export const partHeader = css`
	.header {
		display: flex;
		align-items: center;
		gap: var(--space-inline-sm);
		padding-block: var(--space-stack-sm);
		padding-inline: var(--space-layout-sm);
		border-block-end: 1px solid var(--color-border-subtle);
	}
	.title {
		flex: 1;
		margin: 0;
		min-inline-size: 0;
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
		color: var(--color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.body {
		padding: var(--space-layout-sm);
		overflow: auto;
		min-block-size: 0;
	}
	@media (forced-colors: active) {
		.header {
			border-block-end-color: CanvasText;
		}
	}
`;
