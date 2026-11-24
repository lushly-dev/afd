/**
 * @fileoverview Style partials every Loam element shares (design.md, "Focus and state"). Each
 * partial is linted on its own, so none declares a private alias another sheet reads.
 */

import { css } from '@lushly-dev/fast-element';

/** The focus indicator, on `:focus-visible` only. */
export const focusRing = css.partial`
	outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
	outline-offset: var(--violet-size-space-xs);
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
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: calc(-1 * var(--violet-shell-size-focus));
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
		gap: var(--violet-size-space-sm);
		min-block-size: var(--violet-size-target-natural);
		min-inline-size: var(--violet-size-target-natural);
		padding-block: 0;
		padding-inline: var(--violet-size-space-md);
		border: 1px solid transparent;
		border-inline-start-width: var(--violet-size-space-xs);
		border-radius: var(--violet-radius-md);
		background: transparent;
		color: var(--violet-color-text-secondary);
		font: inherit;
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
		font-weight: var(--violet-type-label-sm-weight);
		cursor: pointer;
		transition:
			background-color var(--violet-duration-fast) var(--violet-easing-standard),
			color var(--violet-duration-fast) var(--violet-easing-standard),
			border-color var(--violet-duration-fast) var(--violet-easing-standard);
	}
	.quiet:hover {
		background: var(--violet-color-action-secondary-hover);
		color: var(--violet-color-text-primary);
	}
	.quiet:active {
		background: var(--violet-color-action-secondary-pressed);
		color: var(--violet-color-text-primary);
	}
	.quiet:focus-visible {
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: calc(-1 * var(--violet-shell-size-focus));
	}
	.quiet[aria-pressed='true'] {
		background: var(--violet-color-control-selected-background);
		color: var(--violet-color-control-selected-foreground);
		border-inline-start-color: var(--violet-color-control-selected-foreground);
	}
	.quiet[aria-disabled='true'],
	.quiet:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		background: transparent;
		color: var(--violet-color-text-secondary);
	}
	.quiet violet-icon {
		--violet-icon-size: var(--violet-size-line-sm);
	}
	@media (prefers-reduced-motion: reduce) {
		.quiet {
			transition: none;
		}
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
			forced-color-adjust: none;
			background: SelectedItem;
			color: SelectedItemText;
			border-color: SelectedItem;
		}
		.quiet:focus-visible {
			outline-color: Highlight;
		}
		.quiet:hover:focus-visible,
		.quiet[aria-pressed='true']:focus-visible {
			outline-color: SelectedItemText;
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
		gap: var(--violet-space-inline-sm);
		padding-block: var(--violet-space-stack-sm);
		padding-inline: var(--violet-space-layout-sm);
		border-block-end: 1px solid var(--violet-color-border-subtle);
	}
	.title {
		flex: 1;
		margin: 0;
		min-inline-size: 0;
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
		font-weight: var(--violet-type-label-sm-weight);
		color: var(--violet-color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.body {
		padding: var(--violet-space-layout-sm);
		overflow: auto;
		min-block-size: 0;
	}
	@media (forced-colors: active) {
		.header {
			border-block-end-color: CanvasText;
		}
	}
`;
