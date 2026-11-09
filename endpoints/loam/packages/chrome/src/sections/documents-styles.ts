/**
 * @fileoverview The documents section's styles (documents specification, 8; design.md's component list),
 * shared by its list and its sidebar. Its fields and buttons are native, on the contract's tokens, as the
 * palette's field is: `violet-text-field` and `violet-button` would put the `documents` chunk well over its
 * row, and the section needs none of what they add (scope and projects specification, 2.4).
 */

import { css } from '@lushly-dev/fast-element';

export const documentsStyles = css`
	:host {
		color: var(--color-text-primary);
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	[hidden] {
		display: none !important;
	}
	h1 {
		margin: 0;
		font-size: var(--type-title-md-size);
		line-height: var(--type-title-md-line);
		font-weight: var(--type-title-md-weight);
	}
	h2 {
		margin: 0;
		font-size: var(--type-title-sm-size);
		line-height: var(--type-title-sm-line);
		font-weight: var(--type-title-sm-weight);
		overflow-wrap: anywhere;
	}
	p {
		margin: 0;
	}
	.muted,
	.empty,
	th,
	label {
		color: var(--color-text-secondary);
	}
	.failure {
		color: var(--color-state-danger-text);
	}
	label {
		display: grid;
		gap: var(--space-stack-xs);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
	.check {
		display: inline-flex;
		align-items: center;
		gap: var(--space-inline-sm);
		min-block-size: var(--size-target-natural);
	}
	/* A 24 px target in both densities, beside the pickers (design.md). */
	.check input {
		inline-size: var(--size-target-compact);
		block-size: var(--size-target-compact);
		margin: 0;
		accent-color: var(--color-control-selected-background);
	}
	.field,
	select {
		box-sizing: border-box;
		min-block-size: var(--size-target-natural);
		padding-inline: var(--size-space-sm);
		border: 1px solid var(--color-field-border);
		border-radius: var(--radius-md);
		background: var(--color-field-background);
		color: var(--color-field-text);
		font: inherit;
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	.field:hover,
	select:hover {
		border-color: var(--color-field-border-hover);
	}
	.field[aria-invalid='true'] {
		border-color: var(--color-field-border-invalid);
	}
	.button {
		min-block-size: var(--size-target-natural);
		padding-inline: var(--space-inline-md);
		border: 1px solid var(--color-action-secondary-border);
		border-radius: var(--radius-md);
		background: var(--color-action-secondary-background);
		color: var(--color-action-secondary-text);
		font: inherit;
		cursor: pointer;
		transition: background-color var(--duration-fast) var(--easing-standard);
	}
	.button:hover {
		background: var(--color-action-secondary-hover);
	}
	.button:active {
		background: var(--color-action-secondary-pressed);
	}
	.button.primary {
		border-color: transparent;
		background: var(--color-action-primary-background);
		color: var(--color-action-primary-text);
	}
	.button.primary:hover {
		background: var(--color-action-primary-hover);
	}
	.button.primary:active {
		background: var(--color-action-primary-pressed);
	}
	.field:focus-visible,
	select:focus-visible,
	.button:focus-visible,
	.check input:focus-visible,
	h1:focus-visible,
	a:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: var(--size-space-xs);
	}
	h1:focus:not(:focus-visible) {
		outline: none;
	}
	a {
		display: inline-block;
		min-block-size: var(--size-target-compact);
		color: var(--color-text-primary);
		text-decoration: underline;
		text-underline-offset: var(--size-space-xs);
		overflow-wrap: anywhere;
	}
	table {
		inline-size: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		padding-block: var(--space-stack-xs);
		padding-inline: var(--space-inline-sm);
		border-block-end: 1px solid var(--color-border-subtle);
		text-align: start;
		vertical-align: top;
		overflow-wrap: anywhere;
	}
	th {
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
	}
	.actions,
	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-inline-sm);
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
		.field,
		select {
			border-color: ButtonText;
			background: Field;
			color: FieldText;
		}
		.button,
		.button.primary {
			border-color: ButtonText;
			background: ButtonFace;
			color: ButtonText;
		}
		a {
			color: LinkText;
		}
		.field:focus-visible,
		select:focus-visible,
		.button:focus-visible,
		.check input:focus-visible,
		h1:focus-visible,
		a:focus-visible {
			outline-color: Highlight;
		}
	}
`;
