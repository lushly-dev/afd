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
		color: var(--color-text-primary);
		font-family: var(--font-family-body);
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
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
		font-family: var(--font-family-heading);
		font-size: var(--type-title-md-size);
		line-height: var(--type-title-md-line);
		font-weight: var(--type-title-md-weight);
	}
	h3 {
		font-family: var(--font-family-heading);
		font-size: var(--type-title-sm-size);
		line-height: var(--type-title-sm-line);
		font-weight: var(--type-title-sm-weight);
		color: var(--color-text-secondary);
	}
	code,
	.mono {
		font-family: var(--font-family-mono);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
	button:focus-visible,
	[tabindex]:focus-visible {
		outline: var(--size-focus-ring-width) solid var(--color-focus-ring);
		outline-offset: var(--size-space-xs);
	}
	.swatch {
		display: inline-block;
		flex: 0 0 auto;
		inline-size: var(--size-font-md);
		block-size: var(--size-font-md);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		vertical-align: middle;
	}
	.value-cell {
		display: inline-flex;
		align-items: center;
		gap: var(--space-inline-sm);
		min-inline-size: 0;
	}
	.status-banner {
		padding: var(--space-stack-xs) var(--space-inline-md);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-surface-subtle);
		color: var(--color-text-primary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
	.status-banner:empty,
	.error-banner:empty {
		display: none;
	}
	.error-banner {
		padding: var(--space-stack-xs) var(--space-inline-md);
		border: 1px solid var(--color-state-danger-border);
		border-radius: var(--radius-md);
		background: var(--color-state-danger-background);
		color: var(--color-state-danger-text);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
	.muted {
		color: var(--color-text-secondary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
	@media (prefers-reduced-motion: reduce) {
		* {
			transition-duration: var(--duration-fast);
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
		background: var(--color-surface-page);
		container-type: inline-size;
	}
	h2 {
		font-size: var(--type-title-sm-size);
		line-height: var(--type-title-sm-line);
		font-weight: var(--type-title-sm-weight);
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(calc(var(--size-target-natural) * 5), calc(var(--size-target-natural) * 7)) minmax(0, 1fr);
		block-size: 100%;
		min-block-size: 0;
	}
	.nodes-column {
		display: flex;
		flex-direction: column;
		gap: var(--space-stack-sm);
		padding: var(--space-layout-sm);
		background: var(--color-surface-card);
		border-inline-end: 1px solid var(--color-border-subtle);
		overflow-y: auto;
		min-inline-size: 0;
	}
	.nodes-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-inline-sm);
	}
	.node-list {
		display: grid;
		gap: var(--space-stack-xs);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.node-button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-inline-sm);
		inline-size: 100%;
		min-block-size: var(--size-target-natural);
		padding-block: var(--space-stack-xs);
		padding-inline: var(--space-inline-sm);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-primary);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.node-button[data-depth='1'] {
		padding-inline-start: var(--space-inline-lg);
	}
	.node-button[data-depth='2'] {
		padding-inline-start: calc(var(--space-inline-lg) * 2);
	}
	.node-button[data-depth='3'] {
		padding-inline-start: calc(var(--space-inline-lg) * 3);
	}
	.node-button:hover {
		background: var(--color-surface-subtle);
	}
	.node-button[aria-current='true'] {
		background: var(--color-surface-selected);
		border-color: var(--color-control-selected-border);
		font-weight: var(--weight-medium);
	}
	.node-meta {
		display: inline-flex;
		align-items: center;
		gap: var(--space-inline-sm);
		flex: 0 0 auto;
		color: var(--color-text-secondary);
		font-size: var(--type-caption-xs-size);
		line-height: var(--type-caption-xs-line);
	}
	.workspace {
		display: flex;
		flex-direction: column;
		gap: var(--space-stack-sm);
		padding: var(--space-layout-sm);
		overflow-y: auto;
		min-inline-size: 0;
		min-block-size: 0;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-inline-sm);
	}
	.toolbar-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-inline-sm);
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
		gap: var(--space-inline-sm);
		border-block-end: 1px solid var(--color-border-subtle);
		padding-block-end: var(--space-stack-xs);
	}
	.tab {
		min-block-size: var(--size-target-natural);
		padding-block: var(--space-stack-xs);
		padding-inline: var(--space-inline-md);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font: inherit;
		font-weight: var(--weight-medium);
		cursor: pointer;
	}
	.tab:hover {
		background: var(--color-surface-subtle);
		color: var(--color-text-primary);
	}
	.tab[aria-selected='true'] {
		background: var(--color-surface-selected);
		border-color: var(--color-control-selected-border);
		color: var(--color-text-primary);
	}
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-stack-sm);
		min-inline-size: 0;
	}
	.controls-row {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-inline-sm);
	}
	.compare-picker {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-inline-md);
	}
	.table-wrap {
		overflow-x: auto;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-surface-card);
	}
	table {
		inline-size: 100%;
		border-collapse: collapse;
		text-align: start;
	}
	th,
	td {
		padding-block: var(--space-stack-xs);
		padding-inline: var(--space-inline-md);
		border-block-end: 1px solid var(--color-border-subtle);
		vertical-align: middle;
	}
	th {
		background: var(--color-surface-subtle);
		color: var(--color-text-secondary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
	}
	tr:last-child td {
		border-block-end: 0;
	}
	tr[data-selected='true'] td {
		background: var(--color-surface-selected);
	}
	.row-select {
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-family-mono);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		text-align: start;
		cursor: pointer;
	}
	.row-select:hover {
		text-decoration: underline;
	}
	.diff-mark {
		color: var(--color-accent-text);
		font-size: var(--type-caption-xs-size);
		line-height: var(--type-caption-xs-line);
		font-weight: var(--type-caption-xs-weight);
	}
	.preview-scope {
		display: grid;
		gap: var(--space-stack-md);
		padding: var(--space-layout-md);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: var(--color-surface-page);
		color: var(--color-text-primary);
	}
	.preview-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-inline-md);
	}
	.checks-summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-inline-sm);
	}
	.check-section {
		display: grid;
		gap: var(--space-stack-xs);
	}
	.check-list {
		display: grid;
		gap: var(--space-stack-xs);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.check-item {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-inline-sm);
		padding: var(--space-stack-xs) var(--space-inline-md);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-surface-card);
	}
	@container (max-width: 639px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
		}
		.nodes-column {
			border-inline-end: 0;
			border-block-end: 1px solid var(--color-border-subtle);
			max-block-size: calc(var(--size-target-natural) * 5);
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
