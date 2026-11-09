/**
 * @fileoverview The editor page's stylesheet: semantic tokens only, which `connectView` sets on the page's
 * root from `dev.loam/tokens` and again on each change of theme or density, so `lint:tokens` reads it here.
 * Each pair it relies on is in the theme's `pairs.ts`: text on the page, the field's border on the field,
 * each action's text on its fill and the focus ring on the page. A done item is ticked and struck through,
 * never shown by color alone. Nothing animates.
 */

/** A plain template tag, so the token lint finds the stylesheet. */
const css = String.raw;

export const EDITOR_STYLES = css`
	body {
		margin: 0;
		padding: var(--space-layout-md);
		background: var(--color-surface-page);
		color: var(--color-text-primary);
		font-family: 'Montserrat', 'Segoe UI', sans-serif;
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
		font-weight: var(--type-body-md-weight);
	}

	main {
		display: grid;
		gap: var(--space-stack-md);
	}

	h1 {
		margin: 0;
		font-size: var(--type-title-sm-size);
		line-height: var(--type-title-sm-line);
		font-weight: var(--type-title-sm-weight);
	}

	.summary,
	.empty,
	.status {
		margin: 0;
		color: var(--color-text-secondary);
	}

	.status:empty {
		display: none;
	}

	.status[data-tone='danger'] {
		color: var(--color-state-danger-text);
	}

	form {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-inline-sm);
	}

	label {
		display: grid;
		flex: 1 1 auto;
		gap: var(--space-stack-xs);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
	}

	input {
		box-sizing: border-box;
		min-block-size: var(--size-target-natural);
		padding-inline: var(--size-space-md);
		border: 1px solid var(--color-field-border);
		border-radius: var(--radius-sm);
		background: var(--color-field-background);
		color: var(--color-field-text);
		font: inherit;
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
		font-weight: var(--type-body-md-weight);
	}

	input:hover {
		border-color: var(--color-field-border-hover);
	}

	input:focus-visible {
		border-color: var(--color-field-border-focus);
	}

	input[aria-invalid='true'] {
		border-color: var(--color-field-border-invalid);
	}

	button {
		box-sizing: border-box;
		min-block-size: var(--size-target-natural);
		padding-inline: var(--size-space-md);
		border: 1px solid var(--color-action-secondary-border);
		border-radius: var(--radius-sm);
		background: var(--color-action-secondary-background);
		color: var(--color-action-secondary-text);
		font: inherit;
		cursor: pointer;
	}

	button:hover {
		background: var(--color-action-secondary-hover);
	}

	button:active {
		background: var(--color-action-secondary-pressed);
	}

	button.add {
		border-color: var(--color-action-primary-background);
		background: var(--color-action-primary-background);
		color: var(--color-action-primary-text);
	}

	button.add:hover {
		border-color: var(--color-action-primary-hover);
		background: var(--color-action-primary-hover);
	}

	button.add:active {
		border-color: var(--color-action-primary-pressed);
		background: var(--color-action-primary-pressed);
	}

	button:disabled {
		cursor: default;
		opacity: 0.6;
	}

	:focus-visible {
		outline: var(--size-space-xs) solid var(--color-focus-ring);
		outline-offset: 1px;
	}

	ul {
		display: grid;
		gap: var(--space-stack-xs);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: var(--space-inline-sm);
	}

	button.item {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		gap: var(--space-inline-sm);
		border-color: transparent;
		background: transparent;
		color: var(--color-text-primary);
		text-align: start;
	}

	button.item:hover {
		background: var(--color-action-secondary-hover);
	}

	.box {
		display: inline-grid;
		flex: none;
		place-items: center;
		box-sizing: border-box;
		inline-size: var(--size-line-md);
		block-size: var(--size-line-md);
		border: 1px solid var(--color-field-border);
		border-radius: var(--radius-sm);
		background: var(--color-field-background);
		color: var(--color-action-primary-text);
		font-weight: var(--weight-semibold);
	}

	button.item[aria-checked='true'] .box {
		border-color: var(--color-action-primary-background);
		background: var(--color-action-primary-background);
	}

	button.item[aria-checked='true'] .text {
		color: var(--color-text-secondary);
		text-decoration: line-through;
	}

	.text {
		overflow-wrap: anywhere;
	}

	@media (forced-colors: active) {
		body {
			background: Canvas;
			color: CanvasText;
		}

		:focus-visible {
			outline-color: Highlight;
		}

		.box {
			border-color: ButtonText;
			background: Canvas;
			color: CanvasText;
		}

		button.item[aria-checked='true'] .box {
			border-color: Highlight;
			background: Highlight;
			color: HighlightText;
		}

		button.item[aria-checked='true'] .text,
		.summary,
		.empty,
		.status {
			color: CanvasText;
		}

		button:disabled {
			color: GrayText;
		}
	}
`;
