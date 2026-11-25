/**
 * @fileoverview The documents section's styles (documents specification, 8; design.md's component list),
 * shared by its list and its sidebar. Its fields and buttons are native, on the contract's tokens, as the
 * palette's field is: `violet-text-field` and `violet-button` would put the `documents` chunk well over its
 * row, and the section needs none of what they add (scope and projects specification, 2.4).
 */

import { css } from '@lushly-dev/fast-element';

export const documentsStyles = css`
	:host {
		color: var(--violet-color-text-primary);
		font-size: var(--violet-type-body-size);
		line-height: var(--violet-type-body-line);
	}
	[hidden] {
		display: none !important;
	}
	h1 {
		margin: 0;
		font-family: var(--violet-font-family-heading);
		font-size: var(--violet-type-heading-page-size);
		line-height: var(--violet-type-heading-page-line);
		font-weight: var(--violet-type-heading-page-weight);
	}
	h2 {
		margin: 0;
		font-family: var(--violet-font-family-heading);
		font-size: var(--violet-type-heading-section-size);
		line-height: var(--violet-type-heading-section-line);
		font-weight: var(--violet-type-heading-section-weight);
		overflow-wrap: anywhere;
	}
	p {
		margin: 0;
	}
	.muted,
	.empty,
	th,
	label {
		color: var(--violet-color-text-secondary);
	}
	.failure {
		color: var(--violet-color-state-danger-text);
	}
	label {
		display: grid;
		gap: var(--violet-space-stack-tight);
		font-size: var(--violet-type-label-size);
		line-height: var(--violet-type-label-line);
	}
	.check {
		display: inline-flex;
		align-items: center;
		gap: var(--violet-space-inline-tight);
		min-block-size: var(--violet-size-target-natural);
	}
	/* A 24 px target in both densities, beside the pickers (design.md). */
	.check input {
		inline-size: var(--violet-size-target-compact);
		block-size: var(--violet-size-target-compact);
		margin: 0;
		accent-color: var(--violet-color-control-selected-background);
	}
	.field {
		box-sizing: border-box;
		min-block-size: var(--violet-size-target-natural);
		padding-inline: var(--violet-space-inline-tight);
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-control);
		background: var(--violet-color-field-background);
		color: var(--violet-color-field-text);
		box-shadow:
			inset 0 1px 0 var(--violet-color-field-border),
			var(--violet-shadow-well);
		font: inherit;
		font-size: var(--violet-type-body-size);
		line-height: var(--violet-type-body-line);
		transition:
			border-color var(--violet-duration-fast) var(--violet-easing-standard),
			box-shadow var(--violet-duration-base) var(--violet-easing-standard);
	}
	.field:hover {
		box-shadow:
			inset 0 1px 0 var(--violet-color-field-border-hover),
			var(--violet-shadow-well);
	}
	.field[aria-invalid='true'] {
		border-color: var(--violet-color-field-border-invalid);
	}
	.button {
		min-block-size: var(--violet-size-target-natural);
		padding-inline: var(--violet-space-inline-group);
		border: 1px solid var(--violet-color-action-secondary-border);
		border-radius: var(--violet-radius-control);
		background: var(--violet-color-action-secondary-background);
		color: var(--violet-color-action-secondary-text);
		font: inherit;
		cursor: pointer;
		transition:
			background-color var(--violet-duration-fast) var(--violet-easing-standard),
			color var(--violet-duration-fast) var(--violet-easing-standard),
			border-color var(--violet-duration-fast) var(--violet-easing-standard),
			box-shadow var(--violet-duration-fast) var(--violet-easing-standard);
	}
	.button:hover {
		background: var(--violet-color-action-secondary-hover);
	}
	.button:active {
		background: var(--violet-color-action-secondary-pressed);
	}
	.button.primary {
		border-color: transparent;
		background: var(--violet-color-action-primary-background);
		color: var(--violet-color-action-primary-text);
		box-shadow: var(--violet-shadow-control);
	}
	.button.primary:hover {
		background: var(--violet-color-action-primary-hover);
	}
	.button.primary:active {
		background: var(--violet-color-action-primary-pressed);
		box-shadow: none;
	}
	.field:focus-visible {
		border-color: var(--violet-color-field-border-focus);
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: var(--violet-space-inline-hairline);
	}
	.button:focus-visible,
	.check input:focus-visible,
	h1:focus-visible,
	a:focus-visible {
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: var(--violet-space-inline-hairline);
	}
	h1:focus:not(:focus-visible) {
		outline: none;
	}
	a {
		display: inline-block;
		min-block-size: var(--violet-size-target-compact);
		color: var(--violet-color-text-primary);
		text-decoration: underline;
		text-underline-offset: var(--violet-space-inline-hairline);
		overflow-wrap: anywhere;
	}
	table {
		inline-size: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		padding-block: var(--violet-space-stack-tight);
		padding-inline: var(--violet-space-inline-tight);
		border-block-end: 1px solid var(--violet-color-border-subtle);
		text-align: start;
		vertical-align: top;
		overflow-wrap: anywhere;
	}
	th {
		font-size: var(--violet-type-label-size);
		line-height: var(--violet-type-label-line);
		font-weight: var(--violet-type-label-weight);
	}
	.actions,
	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--violet-space-inline-tight);
	}
	.said {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	@media (prefers-reduced-motion: reduce) {
		.field,
		.button {
			transition: none;
		}
	}
	@media (forced-colors: active) {
		.muted,
		.empty,
		th,
		label,
		.failure {
			color: CanvasText;
		}
		.field {
			border-color: ButtonText;
			background: Field;
			color: FieldText;
			box-shadow: none;
		}
		.button,
		.button.primary {
			border-color: ButtonText;
			background: ButtonFace;
			color: ButtonText;
			box-shadow: none;
		}
		a {
			color: LinkText;
		}
		.field:focus-visible,
		.button:focus-visible,
		.check input:focus-visible,
		h1:focus-visible,
		a:focus-visible {
			outline-color: Highlight;
		}
	}
`;
