/**
 * @fileoverview A button that runs a command, from the action tokens: `primary`, `secondary` and
 * `danger`. For a header's actions and a modal's two buttons (design.md, "States").
 */

import { css } from '@lushly-dev/fast-element';

export const actionButton = css`
	.action {
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-block-size: var(--violet-size-target-natural);
		min-inline-size: var(--violet-size-target-natural);
		padding-block: 0;
		padding-inline: var(--violet-size-space-lg);
		border: 1px solid var(--violet-color-action-secondary-border);
		border-radius: var(--violet-radius-md);
		background: var(--violet-color-action-secondary-background);
		color: var(--violet-color-action-secondary-text);
		font: inherit;
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
		font-weight: var(--violet-type-label-sm-weight);
		cursor: pointer;
		transition:
			background-color var(--violet-duration-fast) var(--violet-easing-standard),
			color var(--violet-duration-fast) var(--violet-easing-standard),
			border-color var(--violet-duration-fast) var(--violet-easing-standard),
			box-shadow var(--violet-duration-fast) var(--violet-easing-standard);
	}
	.action:not([aria-disabled='true']):hover {
		background: var(--violet-color-action-secondary-hover);
	}
	.action:not([aria-disabled='true']):active {
		background: var(--violet-color-action-secondary-pressed);
	}
	.action:focus-visible {
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: var(--violet-size-space-xs);
	}
	.action.primary {
		border-color: transparent;
		background: var(--violet-color-action-primary-background);
		color: var(--violet-color-action-primary-text);
		box-shadow: var(--violet-shadow-control);
	}
	.action.primary:not([aria-disabled='true']):hover {
		background: var(--violet-color-action-primary-hover);
	}
	.action.primary:not([aria-disabled='true']):active {
		background: var(--violet-color-action-primary-pressed);
		box-shadow: none;
	}
	.action.danger {
		border-color: transparent;
		background: var(--violet-color-action-danger-background);
		color: var(--violet-color-action-danger-text);
		box-shadow: var(--violet-shadow-control);
	}
	.action.danger:not([aria-disabled='true']):hover {
		background: var(--violet-color-action-danger-hover);
	}
	.action.danger:not([aria-disabled='true']):active {
		background: var(--violet-color-action-danger-pressed);
		box-shadow: none;
	}
	.action[aria-disabled='true'],
	.action.primary[aria-disabled='true'],
	.action.danger[aria-disabled='true'] {
		opacity: 0.55;
		border-color: var(--violet-color-action-secondary-border);
		cursor: not-allowed;
		background: var(--violet-color-action-secondary-background);
		color: var(--violet-color-action-secondary-text);
		box-shadow: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.action {
			transition: none;
		}
	}
	@media (forced-colors: active) {
		.action,
		.action.primary,
		.action.danger {
			border-color: ButtonText;
			background: ButtonFace;
			color: ButtonText;
			box-shadow: none;
		}
		.action:not([aria-disabled='true']):hover,
		.action:not([aria-disabled='true']):active,
		.action.primary:not([aria-disabled='true']):hover,
		.action.primary:not([aria-disabled='true']):active,
		.action.danger:not([aria-disabled='true']):hover,
		.action.danger:not([aria-disabled='true']):active {
			border-color: Highlight;
			background: Highlight;
			color: HighlightText;
		}
		.action:focus-visible {
			outline-color: Highlight;
		}
		.action[aria-disabled='true'],
		.action.primary[aria-disabled='true'],
		.action.danger[aria-disabled='true'] {
			border-color: GrayText;
			background: ButtonFace;
			color: GrayText;
		}
	}
`;
