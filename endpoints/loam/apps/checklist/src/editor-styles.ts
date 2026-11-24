/**
 * @fileoverview The editor page's stylesheet: semantic tokens only, which `connectView` sets on the page's
 * root from `dev.loam/tokens` and again on each change of theme or density, so `lint:tokens` reads it here.
 * Each pair it relies on is in the theme's `pairs.ts`: text on the page, the field's border on the field,
 * each action's text on its fill and the focus ring on the page. A done item is ticked and struck through,
 * never shown by color alone. Nothing animates.
 *
 * The field and the buttons draw what `violet-text-field` and `violet-button` draw (Refined, D159): the field
 * is a well, its 3:1 rule an inner line along the top over the well's shadow; the add button is a key, its
 * fill raised by the control shadow; edges come from surfaces and shadows, and forced colors draws them as
 * borders, since it drops box-shadow. The faces come from the shell, in `styles.css.fonts`.
 */

/** A plain template tag, so the token lint finds the stylesheet. */
const css = String.raw;

export const EDITOR_STYLES = css`
	body {
		margin: 0;
		padding: var(--space-layout-md);
		background: var(--color-surface-page);
		color: var(--color-text-primary);
		font-family: var(--font-family-body);
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
		min-inline-size: 0;
		inline-size: 100%;
		min-block-size: var(--size-target-natural);
		padding-inline: max(var(--space-inline-md), calc(var(--size-target-natural) * 0.375));
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-field-background);
		box-shadow:
			inset 0 1px 0 var(--color-field-border),
			var(--shadow-well);
		color: var(--color-field-text);
		font: inherit;
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
		font-weight: var(--type-body-md-weight);
	}

	input::placeholder {
		color: var(--color-field-placeholder);
	}

	input:hover {
		box-shadow:
			inset 0 1px 0 var(--color-field-border-hover),
			var(--shadow-well);
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
		padding-inline: max(var(--space-inline-md), calc(var(--size-target-natural) * 0.375));
		border: 1px solid var(--color-action-secondary-border);
		border-radius: var(--radius-md);
		background: var(--color-action-secondary-background);
		color: var(--color-action-secondary-text);
		font: inherit;
		font-weight: var(--weight-medium);
		cursor: pointer;
	}

	button:hover {
		background: var(--color-action-secondary-hover);
	}

	button:active {
		background: var(--color-action-secondary-pressed);
	}

	button.add {
		border-color: transparent;
		background: var(--color-action-primary-background);
		box-shadow: var(--shadow-control);
		color: var(--color-action-primary-text);
	}

	button.add:hover {
		background: var(--color-action-primary-hover);
	}

	button.add:active {
		background: var(--color-action-primary-pressed);
		box-shadow: none;
	}

	button:disabled {
		box-shadow: none;
		cursor: default;
		opacity: 0.6;
	}

	:focus-visible {
		outline: var(--size-focus-ring-width) solid var(--color-focus-ring);
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
		padding-inline: var(--size-space-md);
		border-color: transparent;
		background: transparent;
		color: var(--color-text-primary);
		font-weight: var(--type-body-md-weight);
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

		input,
		button,
		button.add {
			border-color: ButtonText;
		}

		.box {
			border-color: ButtonText;
			background: Canvas;
			color: CanvasText;
		}

		button.item[aria-checked='true'] .box {
			forced-color-adjust: none;
			border-color: SelectedItem;
			background: SelectedItem;
			color: SelectedItemText;
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
