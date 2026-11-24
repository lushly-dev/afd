/**
 * @fileoverview Shared token-only CSS styles and value-formatting helpers for Violet in Loam.
 * Every color, length (other than 0 and 1px), font, radius and motion duration uses contract tokens.
 */
import { css } from '@lushly-dev/fast-element';
import { formatTokenValue, isColorValue } from './format.js';

export { formatTokenValue, isColorValue };

/** Apply CSSOM background colors to all `[data-swatch]` elements inside a shadow root (CSP-safe). */
export function paintSwatches(root: ShadowRoot | null): void {
	if (!root) return;
	for (const el of root.querySelectorAll<HTMLElement>('[data-swatch]')) {
		const raw = el.dataset.swatch ?? '';
		if (isColorValue(raw)) {
			el.style.setProperty('background-color', raw.trim());
		} else {
			el.style.removeProperty('background-color');
		}
	}
}

/** Shared focus ring, hidden handling, swatches, typography and forced-colors overrides. */
export const sharedStyles = css`
	:host {
		color: var(--violet-color-text-primary);
		font-family: var(--violet-font-family-body);
		font-size: var(--violet-type-body-md-size);
		line-height: var(--violet-type-body-md-line);
	}
	[hidden] {
		display: none;
	}
	h2,
	h3,
	p {
		margin: 0;
	}
	h2 {
		font-family: var(--violet-font-family-heading);
		font-size: var(--violet-type-title-md-size);
		line-height: var(--violet-type-title-md-line);
		font-weight: var(--violet-type-title-md-weight);
	}
	h3 {
		font-family: var(--violet-font-family-heading);
		font-size: var(--violet-type-title-sm-size);
		line-height: var(--violet-type-title-sm-line);
		font-weight: var(--violet-type-title-sm-weight);
		color: var(--violet-color-text-secondary);
	}
	code,
	.mono {
		font-family: var(--violet-font-family-mono);
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
	}
	button:focus-visible,
	[tabindex]:focus-visible {
		outline: var(--violet-size-focus-ring-width) solid var(--violet-color-focus-ring);
		outline-offset: var(--violet-size-space-xs);
	}
	.swatch {
		display: inline-block;
		flex: 0 0 auto;
		inline-size: var(--violet-size-font-md);
		block-size: var(--violet-size-font-md);
		border: 1px solid var(--violet-color-border-strong);
		border-radius: var(--violet-radius-sm);
		vertical-align: middle;
	}
	.value-cell {
		display: inline-flex;
		align-items: center;
		gap: var(--violet-space-inline-sm);
		min-inline-size: 0;
	}
	.status-banner {
		padding: var(--violet-space-stack-xs) var(--violet-space-inline-md);
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-md);
		background: var(--violet-color-surface-subtle);
		color: var(--violet-color-text-primary);
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
	}
	.status-banner:empty,
	.error-banner:empty {
		display: none;
	}
	.error-banner {
		padding: var(--violet-space-stack-xs) var(--violet-space-inline-md);
		border: 1px solid var(--violet-color-state-danger-border);
		border-radius: var(--violet-radius-md);
		background: var(--violet-color-state-danger-background);
		color: var(--violet-color-state-danger-text);
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
	}
	.muted {
		color: var(--violet-color-text-secondary);
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
	}
	@media (prefers-reduced-motion: reduce) {
		* {
			transition-duration: var(--violet-duration-fast);
		}
	}
	@media (forced-colors: active) {
		.swatch {
			forced-color-adjust: none;
			border-color: ButtonText;
		}
		.error-banner,
		.status-banner {
			border-color: CanvasText;
			background: Canvas;
			color: CanvasText;
		}
	}
`;

/** Editor layout and view table styles (all contract tokens, zero raw lengths > 1px). */
export const editorStyles = css`
	${sharedStyles}
	:host {
		display: block;
		box-sizing: border-box;
		block-size: 100%;
		background: var(--violet-color-surface-page);
		container-type: inline-size;
	}
	h2 {
		font-size: var(--violet-type-title-sm-size);
		line-height: var(--violet-type-title-sm-line);
		font-weight: var(--violet-type-title-sm-weight);
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(calc(var(--violet-size-target-natural) * 5), calc(var(--violet-size-target-natural) * 7)) minmax(0, 1fr);
		block-size: 100%;
		min-block-size: 0;
	}
	.nodes-column {
		display: flex;
		flex-direction: column;
		gap: var(--violet-space-stack-sm);
		padding: var(--violet-space-layout-sm);
		background: var(--violet-color-surface-card);
		border-inline-end: 1px solid var(--violet-color-border-subtle);
		overflow-y: auto;
		min-inline-size: 0;
	}
	.nodes-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--violet-space-inline-sm);
	}
	.node-list {
		display: grid;
		gap: var(--violet-space-stack-xs);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.node-button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--violet-space-inline-sm);
		inline-size: 100%;
		min-block-size: var(--violet-size-target-natural);
		padding-block: var(--violet-space-stack-xs);
		padding-inline: var(--violet-space-inline-sm);
		border: 1px solid transparent;
		border-radius: var(--violet-radius-md);
		background: transparent;
		color: var(--violet-color-text-primary);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.node-button[data-depth='1'] {
		padding-inline-start: var(--violet-space-inline-lg);
	}
	.node-button[data-depth='2'] {
		padding-inline-start: calc(var(--violet-space-inline-lg) * 2);
	}
	.node-button[data-depth='3'] {
		padding-inline-start: calc(var(--violet-space-inline-lg) * 3);
	}
	.node-button:hover {
		background: var(--violet-color-surface-subtle);
	}
	.node-button[aria-current='true'] {
		background: var(--violet-color-surface-selected);
		border-color: var(--violet-color-control-selected-border);
		font-weight: var(--violet-weight-medium);
	}
	.node-meta {
		display: inline-flex;
		align-items: center;
		gap: var(--violet-space-inline-sm);
		flex: 0 0 auto;
		color: var(--violet-color-text-secondary);
		font-size: var(--violet-type-caption-xs-size);
		line-height: var(--violet-type-caption-xs-line);
	}
	.workspace {
		display: flex;
		flex-direction: column;
		gap: var(--violet-space-stack-sm);
		padding: var(--violet-space-layout-sm);
		overflow-y: auto;
		min-inline-size: 0;
		min-block-size: 0;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--violet-space-inline-sm);
	}
	.toolbar-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--violet-space-inline-sm);
	}
	.file-input {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	.tablist {
		display: flex;
		flex-wrap: wrap;
		gap: var(--violet-space-inline-sm);
		border-block-end: 1px solid var(--violet-color-border-subtle);
		padding-block-end: var(--violet-space-stack-xs);
	}
	.tab {
		min-block-size: var(--violet-size-target-natural);
		padding-block: var(--violet-space-stack-xs);
		padding-inline: var(--violet-space-inline-md);
		border: 1px solid transparent;
		border-radius: var(--violet-radius-md);
		background: transparent;
		color: var(--violet-color-text-secondary);
		font: inherit;
		font-weight: var(--violet-weight-medium);
		cursor: pointer;
	}
	.tab:hover {
		background: var(--violet-color-surface-subtle);
		color: var(--violet-color-text-primary);
	}
	.tab[aria-selected='true'] {
		background: var(--violet-color-surface-selected);
		border-color: var(--violet-color-control-selected-border);
		color: var(--violet-color-text-primary);
	}
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--violet-space-stack-sm);
		min-inline-size: 0;
	}
	.controls-row {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--violet-space-inline-sm);
	}
	.compare-picker {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--violet-space-inline-md);
	}
	.table-wrap {
		overflow-x: auto;
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-md);
		background: var(--violet-color-surface-card);
	}
	table {
		inline-size: 100%;
		border-collapse: collapse;
		text-align: start;
	}
	th,
	td {
		padding-block: var(--violet-space-stack-xs);
		padding-inline: var(--violet-space-inline-md);
		border-block-end: 1px solid var(--violet-color-border-subtle);
		vertical-align: middle;
	}
	th {
		background: var(--violet-color-surface-subtle);
		color: var(--violet-color-text-secondary);
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
		font-weight: var(--violet-type-label-sm-weight);
	}
	tr:last-child td {
		border-block-end: 0;
	}
	tr[data-selected='true'] td {
		background: var(--violet-color-surface-selected);
	}
	.row-select {
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--violet-color-text-primary);
		font-family: var(--violet-font-family-mono);
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
		text-align: start;
		cursor: pointer;
	}
	.row-select:hover {
		text-decoration: underline;
	}
	.diff-mark {
		color: var(--violet-color-accent-text);
		font-size: var(--violet-type-caption-xs-size);
		line-height: var(--violet-type-caption-xs-line);
		font-weight: var(--violet-type-caption-xs-weight);
	}
	.preview-scope {
		display: grid;
		gap: var(--violet-space-stack-md);
		padding: var(--violet-space-layout-md);
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-lg);
		background: var(--violet-color-surface-page);
		color: var(--violet-color-text-primary);
	}
	.preview-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--violet-space-inline-md);
	}
	.checks-summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--violet-space-inline-sm);
	}
	.check-section {
		display: grid;
		gap: var(--violet-space-stack-xs);
	}
	.check-list {
		display: grid;
		gap: var(--violet-space-stack-xs);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.check-item {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--violet-space-inline-sm);
		padding: var(--violet-space-stack-xs) var(--violet-space-inline-md);
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-md);
		background: var(--violet-color-surface-card);
	}
	@container (max-width: 639px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
		}
		.nodes-column {
			border-inline-end: 0;
			border-block-end: 1px solid var(--violet-color-border-subtle);
			max-block-size: calc(var(--violet-size-target-natural) * 5);
		}
	}
	@media (forced-colors: active) {
		.node-button[aria-current='true'],
		.tab[aria-selected='true'] {
			border-color: Highlight;
			background: Highlight;
			color: HighlightText;
		}
		.node-button[aria-current='true'] .node-meta {
			color: HighlightText;
		}
		.nodes-column,
		.table-wrap,
		.preview-scope,
		.check-item {
			border-color: CanvasText;
			background: Canvas;
			color: CanvasText;
		}
	}
`;
