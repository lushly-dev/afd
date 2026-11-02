/**
 * @fileoverview One control per field of `renderForm`'s model, by property, so nothing a schema says
 * reaches markup. Each control carries its label, its help and its error, which its own shadow root ties
 * to the input.
 */

import { Observable } from '@lushly-dev/fast-element';
import '@lushly-dev/violet-elements/dist/checkbox/violet-checkbox.js';
import '@lushly-dev/violet-elements/dist/option/violet-option.js';
import '@lushly-dev/violet-elements/dist/select/violet-select.js';
import '@lushly-dev/violet-elements/dist/text-area/violet-text-area.js';
import '@lushly-dev/violet-elements/dist/text-field/violet-text-field.js';
import type { VioletCheckbox } from '@lushly-dev/violet-elements/dist/checkbox/violet-checkbox.js';
import type { VioletOption } from '@lushly-dev/violet-elements/dist/option/violet-option.js';
import type { VioletSelect } from '@lushly-dev/violet-elements/dist/select/violet-select.js';
import type { VioletTextArea } from '@lushly-dev/violet-elements/dist/text-area/violet-text-area.js';
import type { VioletTextField } from '@lushly-dev/violet-elements/dist/text-field/violet-text-field.js';
import type { FormField, FormRules } from './form.js';

export interface FieldView {
	readonly field: FormField;
	readonly element: HTMLElement;
	/** What `readForm` takes for this field. */
	read(): string | boolean | undefined;
	showError(message: string | null): void;
	/** Once its element has rendered. */
	connected?(): void;
}

const requiredMark = (field: FormField): string =>
	field.required ? `${field.label} (required)` : field.label;

/** The message first, so it is what is heard first. Never color alone. */
const withError = (message: string | null, help: string): string =>
	message === null ? help : `Error: ${message}${help ? ` ${help}` : ''}`;

function checkboxView(field: FormField): FieldView {
	const element = document.createElement('violet-checkbox') as VioletCheckbox;
	element.checked = field.checked === true;
	element.append(field.label);
	const help = document.createElement('span');
	help.slot = 'supporting';
	help.textContent = field.help;
	element.append(help);
	// Optional, it is sent only once it has changed; required, it is always sent, so nothing needs marking.
	let touched = field.required;
	const showError = (message: string | null) => {
		element.invalid = message !== null;
		help.textContent = withError(message, field.help);
	};
	element.addEventListener('change', () => {
		touched = true;
		showError(null);
	});
	return {
		field,
		element,
		read: () => (touched ? element.checked : undefined),
		showError,
		// The element's own label wraps its help, but its `aria-label` overrides that: tie the help on.
		connected() {
			const input = element.shadowRoot?.querySelector('input');
			if (input && field.help) input.ariaDescribedByElements = [help];
		},
	};
}

function selectView(field: FormField): FieldView {
	const element = document.createElement('violet-select') as VioletSelect;
	element.label = requiredMark(field);
	element.supportingText = field.help;
	element.required = field.required;
	// By position: `violet-option` takes its label as its value when its value is empty, so "None" would be sent.
	const options = field.options ?? [];
	options.forEach(({ label }, index) => {
		const option = document.createElement('violet-option') as VioletOption;
		option.value = `option-${index}`;
		option.textContent = label;
		element.append(option);
	});
	const first = options.findIndex(({ value }) => value === field.initial);
	element.value = first < 0 ? '' : `option-${first}`;
	const showError = (message: string | null) => {
		element.invalid = message !== null;
		element.errorText = message === null ? '' : `Error: ${message}`;
	};
	element.addEventListener('change', () => showError(null));
	return {
		field,
		element,
		read: () => options[Number(element.value.slice('option-'.length))]?.value ?? '',
		showError,
		// Mark the row the keyboard is on, which the option's own fill barely shows (as `loam-list`).
		connected() {
			const sync = () => {
				for (const option of element.options) {
					option.toggleAttribute('data-active', option.value === element.activeValue);
				}
			};
			Observable.getNotifier(element).subscribe({ handleChange: sync }, 'activeValue');
			sync();
		},
	};
}

function textView(field: FormField): FieldView {
	const multiline =
		field.control === 'text-area' || field.control === 'lines' || field.control === 'json';
	const element = document.createElement(multiline ? 'violet-text-area' : 'violet-text-field') as
		| VioletTextField
		| VioletTextArea;
	element.label = requiredMark(field);
	element.supportingText = field.help;
	element.required = field.required;
	element.value = typeof field.initial === 'string' ? field.initial : '';
	if (!multiline) applyTextRules(element as VioletTextField, field.control, field.rules);
	const showError = (message: string | null) => {
		element.invalid = message !== null;
		element.supportingText = withError(message, field.help);
	};
	// An error stays only until the person changes what it is about.
	element.addEventListener('input', () => {
		if (element.invalid) showError(null);
	});
	return { field, element, read: () => element.value, showError };
}

/**
 * Text, with a numeric keyboard where a minus is not needed, and never `type="number"`. That field reports
 * text it cannot read yet as empty, and the element's value binding then clears it: typing -2 leaves 2, and
 * 1e3 leaves 3, which would be sent.
 */
function applyTextRules(
	element: VioletTextField,
	control: FormField['control'],
	rules: FormRules
): void {
	if (control !== 'number') return;
	element.inputMode = (rules.minimum ?? -1) >= 0 ? 'decimal' : 'text';
}

export function fieldView(field: FormField): FieldView {
	if (field.control === 'checkbox') return checkboxView(field);
	if (field.control === 'select') return selectView(field);
	return textView(field);
}
