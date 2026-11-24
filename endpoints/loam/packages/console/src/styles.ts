/** @fileoverview The console's stylesheet: tokens only, and the adapters' classes (7.7, 9.8). */

import { css } from '@lushly-dev/fast-element';

export const consoleStyles = css`
	:host {
		display: block;
		box-sizing: border-box;
		container-type: inline-size;
		padding: var(--violet-space-layout-md);
		color: var(--violet-color-text-primary);
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
		font-size: var(--violet-type-title-md-size);
		line-height: var(--violet-type-title-md-line);
		font-weight: var(--violet-type-title-md-weight);
		overflow-wrap: anywhere;
	}
	h2 {
		font-size: var(--violet-type-title-sm-size);
		line-height: var(--violet-type-title-sm-line);
		font-weight: var(--violet-type-title-sm-weight);
		overflow-wrap: anywhere;
	}
	/* minmax(0, 1fr), so an unbroken name wraps at 320 CSS pixels and does not widen the rest (WCAG 1.4.10). */
	.stack {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--violet-space-layout-md);
	}
	.group {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--violet-space-stack-sm);
		align-content: start;
		min-inline-size: 0;
	}
	.secondary {
		color: var(--violet-color-text-secondary);
		overflow-wrap: anywhere;
	}
	.name {
		color: var(--violet-color-text-secondary);
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
		overflow-wrap: anywhere;
	}
	.notice,
	.command-description,
	.result-status,
	.refresh-status,
	.filter-status {
		overflow-wrap: anywhere;
	}
	/*
	 * A notice is a card one surface step up with the components' card shadow, as violet-card is, and a failure
	 * the danger tint and state border, as violet-alert is (Refined, D159): the state border is transparent in
	 * light and dark and the failure's only edge in high contrast. The transparent border keeps the box for
	 * forced colors, below.
	 */
	.notice {
		padding: var(--violet-space-layout-sm);
		border: 1px solid transparent;
		border-radius: var(--violet-radius-lg);
		background: var(--violet-color-surface-card);
		box-shadow: var(--violet-shadow-card);
	}
	.failure {
		border-color: var(--violet-color-state-danger-border);
		background: var(--violet-color-state-danger-background);
		box-shadow: none;
		color: var(--violet-color-state-danger-text);
	}
	.command-flag {
		font-weight: var(--violet-weight-semibold);
	}
	.instance {
		display: flex;
		flex-wrap: wrap;
		gap: var(--violet-space-stack-xs) var(--violet-space-layout-md);
	}
	.instance dt {
		color: var(--violet-color-text-secondary);
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
	}
	.instance dd {
		overflow-wrap: anywhere;
	}
	.columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--violet-space-layout-md);
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
		gap: var(--violet-space-layout-sm);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--violet-space-inline-md);
		min-block-size: var(--violet-size-target-natural);
	}
	.result {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--violet-space-stack-sm);
	}
	.labels {
		display: flex;
		flex-wrap: wrap;
		gap: var(--violet-space-stack-xs) var(--violet-space-inline-md);
		list-style: none;
		color: var(--violet-color-text-secondary);
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
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
		gap: var(--violet-space-stack-sm);
		padding: var(--violet-space-layout-sm);
		border: 1px solid transparent;
		border-radius: var(--violet-radius-lg);
		background: var(--violet-color-surface-card);
		box-shadow: var(--violet-shadow-card);
		overflow: auto;
	}
	.output pre {
		margin: 0;
		font-family: var(--violet-font-family-mono);
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	/* The adapters' classes, under 'classes' styling (step 0b): state colors, and weight as well as color. */
	.afd-status-success {
		color: var(--violet-color-state-success-text);
	}
	.afd-status-failure {
		color: var(--violet-color-state-danger-text);
	}
	.afd-status-warning {
		color: var(--violet-color-state-warning-text);
	}
	.afd-status-info {
		color: var(--violet-color-text-secondary);
	}
	.afd-status-muted {
		color: var(--violet-color-text-muted);
	}
	.afd-status-neutral {
		color: inherit;
	}
	.afd-bold {
		font-weight: var(--violet-weight-semibold);
	}
	violet-text-field[invalid]::part(error-message),
	violet-text-area[invalid]::part(error-message),
	violet-checkbox[invalid]::part(error-message),
	violet-select[invalid]::part(error-message) {
		color: var(--violet-color-state-danger-text);
	}
	violet-text-field::part(label),
	violet-text-area::part(label),
	violet-select::part(label),
	violet-text-field::part(supporting-text),
	violet-text-area::part(supporting-text),
	violet-select::part(supporting-text),
	violet-text-field::part(error-message),
	violet-text-area::part(error-message),
	violet-checkbox::part(error-message),
	violet-select::part(error-message) {
		overflow-wrap: anywhere;
	}
	/* Two names differing only at the end must both be readable. */
	violet-option::part(label) {
		white-space: normal;
		overflow-wrap: anywhere;
	}
	violet-listbox::part(control):focus-visible {
		outline: var(--violet-size-space-xs) solid var(--violet-color-focus-ring);
		outline-offset: var(--violet-size-space-xs);
	}
	violet-listbox:focus-within violet-option[data-active]::part(control),
	violet-select violet-option[data-active]::part(control) {
		outline: var(--violet-size-space-xs) solid var(--violet-color-focus-ring);
		outline-offset: calc(-1 * var(--violet-size-space-xs));
	}
	violet-listbox violet-option[selected]::part(control) {
		border-inline-start: var(--violet-size-space-xs) solid var(--violet-color-control-selected-foreground);
		background: var(--violet-color-control-selected-background);
		color: var(--violet-color-control-selected-foreground);
	}
	.row-title {
		font-size: var(--violet-type-body-md-size);
		line-height: var(--violet-type-body-md-line);
		overflow-wrap: anywhere;
	}
	.row-flag {
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
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
		/* Forced colors drops box-shadow, so the boundary comes back as a border. */
		.notice,
		.failure,
		.output {
			border-color: CanvasText;
			background: Canvas;
		}
		violet-text-field[invalid]::part(error-message),
		violet-text-area[invalid]::part(error-message),
		violet-checkbox[invalid]::part(error-message),
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
