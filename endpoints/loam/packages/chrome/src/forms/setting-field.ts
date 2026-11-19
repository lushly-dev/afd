/**
 * @fileoverview One setting's field (phase 4 specification, 3.5), in the `settings` chunk: the console's schema form
 * (phase 1 specification, 7.7), `renderForm` and `readForm`, over a one-key schema whose default is the value the level
 * shows, so the console and the settings section read a schema, check what was entered and build the value alike.
 *
 * The model is the console's, used by both: it stays in `@lushly-dev/loam-console`, which the chrome already depends
 * on, since the console depending on the chrome would be a cycle. The controls here are native, on the field tokens,
 * as the account and documents sections' are (design.md): the console's Violet controls would more than double the
 * chunk (the step 2 record).
 */

import {
	type FormField,
	type FormModel,
	readForm,
	renderForm,
} from '@lushly-dev/loam-console/form';
import { el } from '../settings/parts.js';

/** A key's schema, as `setting-schema-get` answers it (3.1). */
export interface SettingKeySchema {
	type: string;
	title: string;
	description?: string;
	enum?: string[];
	enumTitles?: string[];
	default?: unknown;
	[keyword: string]: unknown;
}

export interface SettingField {
	/** The labelled control, its help and its error. */
	element: HTMLElement;
	/** The control itself, which takes focus and says `change`. */
	control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
	/** What the person entered, as the value to write, or why it cannot be one. */
	read(): { ok: true; value: unknown } | { ok: false; error: string };
	/** Show an error, or clear it with null. Never color alone: the words say it. */
	showError(message: string | null): void;
	disabled: boolean;
}

/** The native control for a field of the console's model. */
function controlOf(field: FormField, id: string): SettingField['control'] {
	if (field.control === 'checkbox') {
		const box = el('input', { type: 'checkbox', id }) as HTMLInputElement;
		box.checked = field.checked === true;
		return box;
	}
	if (field.control === 'select') {
		const select = el('select', { id }) as HTMLSelectElement;
		for (const option of field.options ?? []) {
			const made = el('option', { value: option.value }, option.label) as HTMLOptionElement;
			made.selected = option.value === field.initial;
			select.append(made);
		}
		return select;
	}
	const multiline =
		field.control === 'text-area' || field.control === 'lines' || field.control === 'json';
	const text = el(multiline ? 'textarea' : 'input', {
		id,
		autocomplete: 'off',
		...(field.control === 'number'
			? { inputmode: (field.rules.minimum ?? -1) >= 0 ? 'decimal' : 'text' }
			: {}),
		...(field.rules.maxLength !== undefined ? { maxlength: String(field.rules.maxLength) } : {}),
		...(multiline ? { rows: '4' } : {}),
	}) as HTMLInputElement | HTMLTextAreaElement;
	text.value = typeof field.initial === 'string' ? field.initial : '';
	return text;
}

/**
 * The field for `key`, showing `value`. A select names each choice by its `enumTitles`; a list of choices is one per
 * line, as the console's form takes a list of strings.
 */
export function settingField(key: string, schema: SettingKeySchema, value: unknown): SettingField {
	const model: FormModel = renderForm({
		type: 'object',
		properties: { [key]: { ...schema, default: value } },
		required: [key],
		additionalProperties: false,
	});
	const field = model.fields[0] as FormField;
	const titles = schema.enumTitles;
	if (field.options && Array.isArray(titles) && titles.length === schema.enum?.length) {
		field.options = field.options.map((option) => ({
			...option,
			label: titles[schema.enum?.indexOf(option.value) ?? -1] ?? option.label,
		}));
	}
	const id = `field-${key}`;
	const control = controlOf(field, id);
	const help = el('span', { class: 'note', id: `${id}-help` }, field.help);
	const error = el('span', { class: 'error', id: `${id}-error` });
	control.setAttribute('aria-describedby', `${id}-help ${id}-error`);
	const element =
		field.control === 'checkbox'
			? el(
					'div',
					{ class: 'control' },
					el('label', { class: 'check', for: id }, control, field.label),
					help,
					error
				)
			: el(
					'div',
					{ class: 'control' },
					el('label', { for: id }, field.label),
					control,
					help,
					error
				);
	const showError = (message: string | null) => {
		error.textContent = message === null ? '' : `Error: ${message}`;
		if (message === null) control.removeAttribute('aria-invalid');
		else control.setAttribute('aria-invalid', 'true');
	};
	// An error stays only until the person changes what it is about.
	control.addEventListener('input', () => showError(null));
	return {
		element,
		control,
		showError,
		get disabled() {
			return control.disabled;
		},
		set disabled(next: boolean) {
			control.disabled = next;
		},
		read() {
			const raw =
				control instanceof HTMLInputElement && control.type === 'checkbox'
					? control.checked
					: control.value;
			// An empty list is a list: the console's form would call it missing.
			if (schema.type === 'array' && typeof raw === 'string' && raw.trim() === '')
				return { ok: true, value: [] };
			const reading = readForm(model, { [key]: raw });
			return reading.ok
				? { ok: true, value: reading.input[key] }
				: { ok: false, error: reading.errors[key] ?? 'Enter a value.' };
		},
	};
}
