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
		min-block-size: var(--size-target-natural);
		min-inline-size: var(--size-target-natural);
		padding-block: 0;
		padding-inline: var(--size-space-lg);
		border: 1px solid var(--color-action-secondary-border);
		border-radius: var(--radius-md);
		background: var(--color-action-secondary-background);
		color: var(--color-action-secondary-text);
		font: inherit;
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
		cursor: pointer;
		transition: background-color var(--duration-fast) var(--easing-standard);
	}
	.action:not([aria-disabled='true']):hover {
		background: var(--color-action-secondary-hover);
	}
	.action:not([aria-disabled='true']):active {
		background: var(--color-action-secondary-pressed);
	}
	.action:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: var(--size-space-xs);
	}
	.action.primary {
		border-color: transparent;
		background: var(--color-action-primary-background);
		color: var(--color-action-primary-text);
	}
	.action.primary:not([aria-disabled='true']):hover {
		background: var(--color-action-primary-hover);
	}
	.action.primary:not([aria-disabled='true']):active {
		background: var(--color-action-primary-pressed);
	}
	.action.danger {
		border-color: transparent;
		background: var(--color-action-danger-background);
		color: var(--color-action-danger-text);
	}
	.action.danger:hover {
		background: var(--color-action-danger-hover);
	}
	.action.danger:active {
		background: var(--color-action-danger-pressed);
	}
	.action[aria-disabled='true'],
	.action.primary[aria-disabled='true'] {
		opacity: 0.55;
		border-color: var(--color-action-secondary-border);
		cursor: not-allowed;
		background: var(--color-action-secondary-background);
		color: var(--color-action-secondary-text);
	}
	@media (forced-colors: active) {
		.action,
		.action.primary,
		.action.danger {
			border-color: ButtonText;
			background: ButtonFace;
			color: ButtonText;
		}
		.action:not([aria-disabled='true']):hover,
		.action:not([aria-disabled='true']):active {
			border-color: Highlight;
			background: Highlight;
			color: HighlightText;
		}
		.action:focus-visible {
			outline-color: Highlight;
		}
		.action[aria-disabled='true'],
		.action.primary[aria-disabled='true'] {
			border-color: GrayText;
			background: ButtonFace;
			color: GrayText;
		}
	}
`;
