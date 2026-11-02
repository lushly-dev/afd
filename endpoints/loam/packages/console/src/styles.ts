/** @fileoverview The console's stylesheet: tokens only, and the adapters' classes (7.7, 9.8). */

import { css } from '@lushly-dev/fast-element';

export const consoleStyles = css`
	:host {
		display: block;
		box-sizing: border-box;
		container-type: inline-size;
		padding: var(--space-layout-md);
		color: var(--color-text-primary);
		--violet-listbox-min-inline-size: 0;
	}
	/* Over .group and the rest, which set display at the same specificity. */
	:host([hidden]),
	[hidden] {
		display: none !important;
	}
	h1,
	h2,
	p,
	dl,
	dd,
	ul {
		margin: 0;
		padding: 0;
	}
	h1 {
		font-size: var(--type-title-md-size);
		line-height: var(--type-title-md-line);
		font-weight: var(--type-title-md-weight);
		overflow-wrap: anywhere;
	}
	h2 {
		font-size: var(--type-title-sm-size);
		line-height: var(--type-title-sm-line);
		font-weight: var(--type-title-sm-weight);
		overflow-wrap: anywhere;
	}
	/* minmax(0, 1fr), so an unbroken name wraps at 320 CSS pixels and does not widen the rest (WCAG 1.4.10). */
	.stack {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-layout-md);
	}
	.group {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-stack-sm);
		align-content: start;
		min-inline-size: 0;
	}
	.secondary {
		color: var(--color-text-secondary);
		overflow-wrap: anywhere;
	}
	.name {
		color: var(--color-text-secondary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		overflow-wrap: anywhere;
	}
	.notice,
	.command-description,
	.result-status,
	.refresh-status,
	.filter-status {
		overflow-wrap: anywhere;
	}
	.notice {
		padding: var(--space-layout-sm);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-surface-card);
	}
	.failure {
		border-color: var(--color-state-danger-border);
		background: var(--color-state-danger-background);
		color: var(--color-state-danger-text);
	}
	.command-flag {
		font-weight: var(--weight-semibold);
	}
	.instance {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-stack-xs) var(--space-layout-md);
	}
	.instance dt {
		color: var(--color-text-secondary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
	.instance dd {
		overflow-wrap: anywhere;
	}
	.columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-layout-md);
		align-items: start;
	}
	@container (min-inline-size: 720px) {
		.columns {
			grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
		}
	}
	.fields {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-layout-sm);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-inline-md);
		min-block-size: var(--size-target-natural);
	}
	.result {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-stack-sm);
	}
	.labels {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-stack-xs) var(--space-inline-md);
		list-style: none;
		color: var(--color-text-secondary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
	.labels li {
		overflow-wrap: anywhere;
	}
	.output:empty {
		display: none;
	}
	.output {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-stack-sm);
		padding: var(--space-layout-sm);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-surface-card);
		overflow: auto;
	}
	.output pre {
		margin: 0;
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	/* The adapters' classes, under 'classes' styling (step 0b): state colors, and weight as well as color. */
	.afd-status-success {
		color: var(--color-state-success-text);
	}
	.afd-status-failure {
		color: var(--color-state-danger-text);
	}
	.afd-status-warning {
		color: var(--color-state-warning-text);
	}
	.afd-status-info {
		color: var(--color-text-secondary);
	}
	.afd-status-muted {
		color: var(--color-text-muted);
	}
	.afd-status-neutral {
		color: inherit;
	}
	.afd-bold {
		font-weight: var(--weight-semibold);
	}
	violet-text-field[invalid]::part(supporting-text),
	violet-text-area[invalid]::part(supporting-text),
	violet-checkbox[invalid]::part(supporting-text),
	violet-select[invalid]::part(error-message) {
		color: var(--color-state-danger-text);
	}
	violet-text-field::part(label),
	violet-text-area::part(label),
	violet-select::part(label),
	violet-text-field::part(supporting-text),
	violet-text-area::part(supporting-text),
	violet-select::part(supporting-text),
	violet-select::part(error-message) {
		overflow-wrap: anywhere;
	}
	/* Two names differing only at the end must both be readable. */
	violet-option::part(label) {
		white-space: normal;
		overflow-wrap: anywhere;
	}
	/* As loam-list: its white fallback fails contrast in dark, and it hides which row is active. */
	violet-option {
		--color-surface-highlight: var(--color-surface-subtle);
	}
	violet-listbox::part(control):focus-visible {
		outline: var(--size-space-xs) solid var(--color-focus-ring);
		outline-offset: var(--size-space-xs);
	}
	violet-listbox:focus-within violet-option[data-active]::part(control),
	violet-select violet-option[data-active]::part(control) {
		outline: var(--size-space-xs) solid var(--color-focus-ring);
		outline-offset: calc(-1 * var(--size-space-xs));
	}
	violet-listbox violet-option[selected]::part(control) {
		border-inline-start: var(--size-space-xs) solid var(--color-control-selected-foreground);
		background: var(--color-control-selected-background);
		color: var(--color-control-selected-foreground);
	}
	/*
	 * violet-select places its list with position: fixed from viewport coordinates, and the mount's contain:
	 * content makes the mount that containing block. So here it opens under its own trigger instead.
	 */
	violet-select::part(control-shell) {
		position: relative;
	}
	violet-select::part(panel) {
		position: absolute !important;
		inset-block: 100% auto !important;
		inset-inline: 0 auto !important;
		inline-size: 100% !important;
	}
	.row-title {
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
		overflow-wrap: anywhere;
	}
	.row-flag {
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
	@media (forced-colors: active) {
		:host,
		.secondary,
		.name,
		.failure,
		.instance dt,
		.labels,
		.afd-status-success,
		.afd-status-failure,
		.afd-status-warning,
		.afd-status-info,
		.afd-status-muted {
			color: CanvasText;
		}
		.notice,
		.failure,
		.output {
			border-color: CanvasText;
			background: Canvas;
		}
		violet-text-field[invalid]::part(supporting-text),
		violet-text-area[invalid]::part(supporting-text),
		violet-checkbox[invalid]::part(supporting-text),
		violet-select[invalid]::part(error-message) {
			color: CanvasText;
		}
		/* violet-option keeps author colors here: only a selection is filled, as in loam-list. */
		violet-listbox violet-option::part(control) {
			border-color: transparent;
			background: Canvas;
			color: ButtonText;
		}
		violet-listbox violet-option::part(control):hover {
			border-color: ButtonText;
			background: Canvas;
		}
		violet-select violet-option[data-active]::part(control) {
			outline-color: Highlight;
		}
		.row-title,
		.row-flag {
			color: ButtonText;
		}
		violet-listbox violet-option[selected]::part(control),
		violet-listbox violet-option[selected]::part(control):hover {
			border-color: Highlight;
			background: Highlight;
			color: HighlightText;
		}
		violet-listbox violet-option[selected] .row-title,
		violet-listbox violet-option[selected] .row-flag {
			color: HighlightText;
		}
		violet-listbox::part(control):focus-visible,
		violet-listbox:focus-within violet-option[data-active]::part(control) {
			outline-color: Highlight;
		}
		violet-listbox:focus-within violet-option[selected][data-active]::part(control) {
			outline-color: HighlightText;
		}
	}
`;
