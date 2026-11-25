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
		padding: var(--violet-space-layout-page);
		background: var(--violet-color-surface-page);
		color: var(--violet-color-text-primary);
		font-family: var(--violet-font-family-body);
		font-size: var(--violet-type-body-size);
		line-height: var(--violet-type-body-line);
		font-weight: var(--violet-type-body-weight);
	}

	main {
		display: grid;
		gap: var(--violet-space-stack-section);
	}

	h1 {
		margin: 0;
		font-size: var(--violet-type-heading-section-size);
		line-height: var(--violet-type-heading-section-line);
		font-weight: var(--violet-type-heading-section-weight);
	}

	.summary,
	.empty,
	.status {
		margin: 0;
		color: var(--violet-color-text-secondary);
	}

	.status:empty {
		display: none;
	}

	.status[data-tone='danger'] {
		color: var(--violet-color-state-danger-text);
	}

	form {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--violet-space-inline-tight);
	}

	label {
		display: grid;
		flex: 1 1 auto;
		gap: var(--violet-space-stack-tight);
		font-size: var(--violet-type-label-size);
		line-height: var(--violet-type-label-line);
		font-weight: var(--violet-type-label-weight);
	}

	input {
		box-sizing: border-box;
		min-inline-size: 0;
		inline-size: 100%;
		min-block-size: var(--violet-size-target-natural);
		padding-inline: max(var(--violet-space-inline-group), calc(var(--violet-size-target-natural) * 0.375));
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-control);
		background: var(--violet-color-field-background);
		box-shadow:
			inset 0 1px 0 var(--violet-color-field-border),
			var(--violet-shadow-well);
		color: var(--violet-color-field-text);
		font: inherit;
		font-size: var(--violet-type-body-size);
		line-height: var(--violet-type-body-line);
		font-weight: var(--violet-type-body-weight);
	}

	input::placeholder {
		color: var(--violet-color-field-placeholder);
	}

	input:hover {
		box-shadow:
			inset 0 1px 0 var(--violet-color-field-border-hover),
			var(--violet-shadow-well);
	}

	input:focus-visible {
		border-color: var(--violet-color-field-border-focus);
	}

	input[aria-invalid='true'] {
		border-color: var(--violet-color-field-border-invalid);
	}

	button {
		box-sizing: border-box;
		min-block-size: var(--violet-size-target-natural);
		padding-inline: max(var(--violet-space-inline-group), calc(var(--violet-size-target-natural) * 0.375));
		border: 1px solid var(--violet-color-action-secondary-border);
		border-radius: var(--violet-radius-control);
		background: var(--violet-color-action-secondary-background);
		color: var(--violet-color-action-secondary-text);
		font: inherit;
		font-weight: var(--violet-weight-medium);
		cursor: pointer;
	}

	button:hover {
		background: var(--violet-color-action-secondary-hover);
	}

	button:active {
		background: var(--violet-color-action-secondary-pressed);
	}

	button.add {
		border-color: transparent;
		background: var(--violet-color-action-primary-background);
		box-shadow: var(--violet-shadow-control);
		color: var(--violet-color-action-primary-text);
	}

	button.add:hover {
		background: var(--violet-color-action-primary-hover);
	}

	button.add:active {
		background: var(--violet-color-action-primary-pressed);
		box-shadow: none;
	}

	button:disabled {
		box-shadow: none;
		cursor: default;
		opacity: 0.6;
	}

	:focus-visible {
		outline: var(--violet-size-focus-ring-width) solid var(--violet-color-focus-ring);
		outline-offset: 1px;
	}

	ul {
		display: grid;
		gap: var(--violet-space-stack-tight);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: var(--violet-space-inline-tight);
	}

	button.item {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		gap: var(--violet-space-inline-tight);
		padding-inline: var(--violet-space-inline-group);
		border-color: transparent;
		background: transparent;
		color: var(--violet-color-text-primary);
		font-weight: var(--violet-type-body-weight);
		text-align: start;
	}

	button.item:hover {
		background: var(--violet-color-action-secondary-hover);
	}

	.box {
		display: inline-grid;
		flex: none;
		place-items: center;
		box-sizing: border-box;
		inline-size: var(--violet-type-body-line);
		block-size: var(--violet-type-body-line);
		border: 1px solid var(--violet-color-field-border);
		border-radius: var(--violet-radius-inset);
		background: var(--violet-color-field-background);
		color: var(--violet-color-action-primary-text);
		font-weight: var(--violet-weight-semibold);
	}

	button.item[aria-checked='true'] .box {
		border-color: var(--violet-color-action-primary-background);
		background: var(--violet-color-action-primary-background);
	}

	button.item[aria-checked='true'] .text {
		color: var(--violet-color-text-secondary);
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
