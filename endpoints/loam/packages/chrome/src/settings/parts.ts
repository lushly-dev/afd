/**
 * @fileoverview What the `settings` chunk's elements share (phase 4 specification, 3.5 and 15): elements whose text is
 * always text, buttons, dates and the styles, tokens only. Plain custom elements with a constructable sheet, as the
 * account section's are, so the chunk needs nothing of FAST's but what the console's form brings.
 */

export type Child = Node | string;

/** An element whose text is always text. */
export function el(
	tag: string,
	attributes: Record<string, string> = {},
	...children: Child[]
): HTMLElement {
	const element = document.createElement(tag);
	for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
	element.append(...children);
	return element;
}

/** A native button: a press runs `run` unless the button says it is disabled. */
export const button = (
	label: string,
	run: () => unknown,
	attributes: Record<string, string> = {}
): HTMLElement => {
	const made = el('button', { type: 'button', class: 'action', ...attributes }, label);
	made.addEventListener('click', () => {
		if (made.getAttribute('aria-disabled') !== 'true') void run();
	});
	return made;
};

/** A time as the person's locale writes it. */
export const dateText = (value: number | undefined): string => {
	if (value === undefined) return '';
	try {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(value)
		);
	} catch {
		return '';
	}
};

/** The chunk's styles, tokens only. */
export const STYLES = `
	:host {
		display: block;
		color: var(--color-text-primary);
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	h1,
	h2,
	h3,
	p {
		margin: 0;
	}
	h1 {
		font-size: var(--type-title-md-size);
		line-height: var(--type-title-md-line);
		font-weight: var(--type-title-md-weight);
	}
	h2 {
		font-size: var(--type-title-sm-size);
		line-height: var(--type-title-sm-line);
		font-weight: var(--type-title-sm-weight);
	}
	h3,
	legend,
	label {
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
	}
	.section {
		display: grid;
		gap: var(--space-stack-md);
	}
	.columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-layout-md);
	}
	@media (min-width: 40rem) {
		.columns {
			grid-template-columns: minmax(var(--shell-size-sidebar-min), var(--shell-size-sidebar-default)) minmax(0, 1fr);
		}
	}
	[role='tree'],
	[role='group'],
	.list {
		display: grid;
		gap: var(--space-stack-xs);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	[role='group'] {
		padding-inline-start: var(--space-inline-md);
	}
	[role='treeitem'] > .label {
		display: flex;
		align-items: center;
		min-block-size: var(--size-target-natural);
		padding-inline: var(--size-space-md);
		border-inline-start: var(--size-space-xs) solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
	}
	[role='treeitem'][aria-expanded] > .label {
		color: var(--color-text-secondary);
		cursor: default;
	}
	[role='treeitem'][aria-selected='true'] > .label {
		border-inline-start-color: var(--color-control-selected-foreground);
		background: var(--color-control-selected-background);
		color: var(--color-control-selected-foreground);
	}
	[role='treeitem']:not([aria-expanded]) > .label:hover {
		background: var(--color-surface-subtle);
	}
	[role='tablist'] {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-inline-sm);
		border-block-end: 1px solid var(--color-border-subtle);
	}
	[role='tab'] {
		min-block-size: var(--size-target-natural);
		padding-inline: var(--size-space-md);
		border: 0;
		border-block-end: var(--size-space-xs) solid transparent;
		background: none;
		color: var(--color-text-secondary);
		font: inherit;
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
		cursor: pointer;
	}
	[role='tab'][aria-selected='true'] {
		border-block-end-color: var(--color-focus-ring);
		color: var(--color-text-primary);
		font-weight: var(--weight-semibold);
	}
	[role='tabpanel'],
	.fields {
		display: grid;
		gap: var(--space-stack-md);
	}
	.field {
		display: grid;
		gap: var(--space-stack-xs);
		padding-block-end: var(--space-stack-md);
		border-block-end: 1px solid var(--color-border-subtle);
	}
	.field[data-target] {
		border-inline-start: var(--size-space-xs) solid var(--color-focus-ring);
		padding-inline-start: var(--space-inline-md);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-inline-sm);
	}
	form {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-inline-sm);
	}
	label {
		display: grid;
		gap: var(--space-stack-xs);
	}
	.grow {
		flex: 1 1 auto;
	}
	.note,
	.from {
		color: var(--color-text-secondary);
	}
	.control {
		display: grid;
		gap: var(--space-stack-xs);
		justify-items: start;
	}
	.control textarea,
	.control input:not([type='checkbox']) {
		inline-size: min(100%, var(--shell-size-main-min));
		box-sizing: border-box;
	}
	.error {
		color: var(--color-state-danger-text);
	}
	.error:empty {
		display: none;
	}
	[aria-invalid='true'] {
		border-color: var(--color-field-border-invalid);
	}
	.status:empty {
		display: none;
	}
	input,
	select,
	textarea {
		min-block-size: var(--size-target-natural);
		padding-inline: var(--size-space-sm);
		border: 1px solid var(--color-field-border);
		border-radius: var(--radius-md);
		background: var(--color-field-background);
		color: var(--color-text-primary);
		font: inherit;
	}
	fieldset {
		display: grid;
		gap: var(--space-stack-xs);
		margin: 0;
		padding: var(--size-space-sm) var(--size-space-md);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
	}
	label.check {
		display: flex;
		align-items: center;
		gap: var(--space-inline-sm);
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
		font-weight: var(--type-body-md-weight);
	}
	input[type='checkbox'] {
		inline-size: var(--size-target-compact);
		block-size: var(--size-target-compact);
		min-block-size: var(--size-target-compact);
		margin: 0;
		padding: 0;
		accent-color: var(--color-action-primary-background);
	}
	.action {
		min-block-size: var(--size-target-natural);
		padding-inline: var(--size-space-md);
		border: 1px solid var(--color-action-secondary-border);
		border-radius: var(--radius-md);
		background: var(--color-action-secondary-background);
		color: var(--color-action-secondary-text);
		font: inherit;
		cursor: pointer;
	}
	.action:hover {
		background: var(--color-action-secondary-hover);
	}
	.action.primary {
		border-color: var(--color-action-primary-background);
		background: var(--color-action-primary-background);
		color: var(--color-action-primary-text);
	}
	.action[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.55;
	}
	.action:focus-visible,
	[role='tab']:focus-visible,
	[role='treeitem']:focus-visible > .label,
	input:focus-visible,
	select:focus-visible,
	textarea:focus-visible,
	h1:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: var(--size-space-xs);
	}
	[role='treeitem']:focus-visible {
		outline: none;
	}
	h1:focus:not(:focus-visible) {
		outline: none;
	}
	@media (forced-colors: active) {
		[role='tab'][aria-selected='true'],
		[role='treeitem'][aria-selected='true'] > .label {
			border-color: Highlight;
		}
		.action[aria-disabled='true'] {
			color: GrayText;
		}
	}
`;

/** A plain custom element with an open shadow root holding `STYLES`. */
export class SettingsElement extends HTMLElement {
	constructor() {
		super();
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(STYLES);
		this.attachShadow({ mode: 'open' }).adoptedStyleSheets = [sheet];
	}
}
