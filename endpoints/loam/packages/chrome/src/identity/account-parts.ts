/**
 * @fileoverview What the `account` chunk's section and pages share (phase 3 specification, 5.1 and 14): elements whose
 * text is always text, buttons, dates, the roles' names, the styles, and the native modal dialogs that confirm a
 * destructive action or ask a name. One chunk with `account.ts` and `link-pages.ts`, which import it.
 */

export interface Answer<T = unknown> {
	success: boolean;
	data?: T;
	error?: { code?: string; message?: string; suggestion?: string };
}

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

export const button = (
	label: string,
	run: () => unknown,
	attributes: Record<string, string> = {}
) => {
	const made = el('button', { type: 'button', class: 'action', ...attributes }, label);
	made.addEventListener('click', () => void run());
	return made;
};

export const dateText = (value: string | number | null | undefined): string => {
	if (value === null || value === undefined) return '';
	try {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(value)
		);
	} catch {
		return '';
	}
};

export const ROLE_NAMES: Record<string, string> = {
	owner: 'Owner',
	admin: 'Admin',
	member: 'Member',
};

/** The section's and pages' styles, tokens only; a constructable sheet, so this chunk needs nothing of FAST's. */
export const STYLES = `
	:host {
		display: block;
		color: var(--color-text-primary);
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	.section {
		display: grid;
		gap: var(--space-stack-md);
		max-inline-size: calc(var(--shell-size-main-min) * 2);
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
	}
	p {
		margin: 0;
	}
	[role='tablist'] {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-inline-sm);
		border-block-end: 1px solid var(--color-border-subtle);
	}
	[role='tab'] {
		display: inline-flex;
		align-items: center;
		min-block-size: var(--size-target-natural);
		padding-inline: var(--size-space-md);
		border-block-end: 2px solid transparent;
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
	}
	[role='tab'][aria-selected='true'] {
		border-block-end-color: var(--color-focus-ring);
		color: var(--color-text-primary);
		font-weight: var(--weight-semibold);
	}
	[role='tabpanel'] {
		display: grid;
		gap: var(--space-stack-md);
	}
	table {
		border-collapse: collapse;
		inline-size: 100%;
	}
	caption {
		text-align: start;
		padding-block-end: var(--space-stack-xs);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
		color: var(--color-text-secondary);
	}
	th,
	td {
		padding: var(--size-space-sm);
		border-block-end: 1px solid var(--color-border-subtle);
		text-align: start;
		vertical-align: middle;
	}
	th {
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
		color: var(--color-text-secondary);
	}
	form,
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-inline-sm);
	}
	label {
		display: grid;
		gap: var(--space-stack-xs);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
	}
	input,
	select {
		min-block-size: var(--size-target-natural);
		padding-inline: var(--size-space-sm);
		border: 1px solid var(--color-field-border);
		border-radius: var(--radius-md);
		background: var(--color-field-background);
		color: var(--color-text-primary);
		font: inherit;
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
	.action.primary {
		border-color: var(--color-action-primary-background);
		background: var(--color-action-primary-background);
		color: var(--color-action-primary-text);
	}
	.action[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.6;
	}
	[role='tab']:focus-visible,
	.action:focus-visible,
	input:focus-visible,
	select:focus-visible,
	h1:focus-visible,
	a:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: var(--size-space-xs);
	}
	h1:focus:not(:focus-visible) {
		outline: none;
	}
	.note {
		color: var(--color-text-secondary);
	}
	.status:empty {
		display: none;
	}
	dialog {
		box-sizing: border-box;
		inline-size: min(92vw, var(--shell-size-main-min));
		padding: var(--space-layout-md);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		background: var(--color-surface-floating);
		box-shadow: var(--shadow-floating);
		color: var(--color-text-primary);
	}
	dialog .row {
		justify-content: end;
		margin-block-start: var(--space-stack-md);
	}
	@media (forced-colors: active) {
		[role='tab'][aria-selected='true'] {
			border-block-end-color: Highlight;
		}
		.action[aria-disabled='true'] {
			color: GrayText;
		}
	}
`;

/** A destructive action, confirmed in a native modal dialog with its consequence in words (14). */
export function confirmIn(
	root: ShadowRoot,
	title: string,
	consequence: string,
	confirm: string
): Promise<boolean> {
	return new Promise((resolve) => {
		const heading = el('h2', { id: 'confirm-title' }, title);
		const yes = button(confirm, () => close(true), { class: 'action primary' });
		const no = button('Cancel', () => close(false));
		const dialog = el(
			'dialog',
			{ 'aria-labelledby': 'confirm-title' },
			heading,
			el('p', {}, consequence),
			el('div', { class: 'row' }, no, yes)
		) as HTMLDialogElement;
		const close = (answer: boolean) => {
			dialog.close();
			dialog.remove();
			resolve(answer);
		};
		dialog.addEventListener('cancel', () => close(false));
		root.append(dialog);
		dialog.showModal();
		no.focus();
	});
}

/** A new name, asked in a native modal dialog with a labelled field; undefined when cancelled. */
export function askName(
	root: ShadowRoot,
	title: string,
	current: string
): Promise<string | undefined> {
	return new Promise((resolve) => {
		const field = el('input', {
			id: 'rename-field',
			maxlength: '64',
			required: '',
		}) as HTMLInputElement;
		field.value = current;
		const form = el(
			'form',
			{ method: 'dialog' },
			el('h2', { id: 'rename-title' }, title),
			el('label', { for: 'rename-field' }, 'Name', field),
			el(
				'div',
				{ class: 'row' },
				button('Cancel', () => close(undefined)),
				el('button', { type: 'submit', class: 'action primary' }, 'Rename')
			)
		);
		const dialog = el('dialog', { 'aria-labelledby': 'rename-title' }, form) as HTMLDialogElement;
		const close = (answer: string | undefined) => {
			dialog.close();
			dialog.remove();
			resolve(answer);
		};
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			const name = field.value.trim();
			if (name) close(name.slice(0, 64));
		});
		dialog.addEventListener('cancel', () => close(undefined));
		root.append(dialog);
		dialog.showModal();
		field.select();
	});
}

/**
 * An element of this chunk: a plain custom element with an open shadow root holding `STYLES` and `extra`. FAST's
 * element and `css` are not used: importing them here parts FAST's core from first paint into a chunk of its own (13).
 */
export class AccountElement extends HTMLElement {
	static extra = '';
	constructor() {
		super();
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(STYLES + (this.constructor as typeof AccountElement).extra);
		this.attachShadow({ mode: 'open' }).adoptedStyleSheets = [sheet];
	}
}

/** Define `name` once. */
export function defineOnce(name: string, element: CustomElementConstructor): void {
	if (!customElements.get(name)) customElements.define(name, element);
}
