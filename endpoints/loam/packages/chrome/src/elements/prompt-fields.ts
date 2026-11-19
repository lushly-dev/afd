/**
 * @fileoverview A prompt's fields (phase 4 specification, 6.4): one line of text with no schema, a single field, or an
 * object's named fields, each a native control on the field tokens, with a label. Built with the DOM API, since the
 * kernel checks the value it reads on confirm and answers what fails.
 */

import type { PromptFieldV1, PromptSchemaV1 } from '@lushly-dev/loam-sdk';

/** The fields, and how to read their value as the kernel takes it. */
export interface PromptFields {
	element: HTMLElement;
	read(): unknown;
	/** The first control, which takes focus. */
	first: HTMLElement | null;
}

let counter = 0;

function control(
	doc: Document,
	field: PromptFieldV1,
	value: unknown,
	label: string
): { row: HTMLElement; read(): unknown; input: HTMLElement } {
	const row = doc.createElement('div');
	row.className = 'field';
	const id = `prompt-field-${++counter}`;
	const name = doc.createElement('label');
	name.htmlFor = id;
	name.textContent = label;
	let input: HTMLInputElement | HTMLSelectElement;
	let read: () => unknown;
	if (field.enum) {
		const select = doc.createElement('select');
		// No starting value picks no choice (the review's 13): an empty first option, which reads as none.
		if (!field.enum.includes(value as string | number)) {
			const none = doc.createElement('option');
			none.value = '';
			none.textContent = 'Choose';
			none.selected = true;
			select.append(none);
		}
		for (const [index, choice] of field.enum.entries()) {
			const option = doc.createElement('option');
			option.value = String(index);
			option.textContent = String(choice);
			option.selected = choice === value;
			select.append(option);
		}
		input = select;
		read = () => (select.value === '' ? undefined : field.enum?.[Number(select.value)]);
	} else if (field.type === 'boolean') {
		const box = doc.createElement('input');
		box.type = 'checkbox';
		box.checked = value === true;
		input = box;
		read = () => box.checked;
		row.classList.add('check');
	} else {
		const text = doc.createElement('input');
		text.type = field.type === 'string' ? 'text' : 'number';
		if (field.type === 'integer') text.step = '1';
		if (field.maxLength !== undefined) text.maxLength = field.maxLength;
		if (field.minimum !== undefined) text.min = String(field.minimum);
		if (field.maximum !== undefined) text.max = String(field.maximum);
		text.value = value === undefined || value === null ? '' : String(value);
		input = text;
		read = () => {
			if (field.type === 'string') return text.value;
			return text.value.trim() === '' ? undefined : Number(text.value);
		};
	}
	input.id = id;
	if (field.description) {
		const hint = doc.createElement('p');
		hint.className = 'hint';
		hint.id = `${id}-hint`;
		hint.textContent = field.description;
		input.setAttribute('aria-describedby', hint.id);
		row.append(name, input, hint);
	} else row.append(name, input);
	return { row, read, input };
}

/** The controls for `schema`, starting from `value`. */
export function promptFields(
	doc: Document,
	schema: PromptSchemaV1 | undefined,
	value: unknown
): PromptFields {
	const element = doc.createElement('div');
	element.className = 'fields';
	if (schema?.type !== 'object') {
		const field: PromptFieldV1 = schema ?? { type: 'string', maxLength: 1000 };
		const one = control(doc, field, value, field.title ?? 'Answer');
		element.append(one.row);
		return { element, read: one.read, first: one.input };
	}
	const given = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	const reads: Array<[string, () => unknown]> = [];
	let first: HTMLElement | null = null;
	for (const [key, field] of Object.entries(schema.properties)) {
		const required = schema.required?.includes(key) === true;
		const each = control(
			doc,
			field,
			given[key],
			`${field.title ?? key}${required ? ' (required)' : ''}`
		);
		if (required) each.input.setAttribute('aria-required', 'true');
		first ??= each.input;
		reads.push([key, each.read]);
		element.append(each.row);
	}
	return {
		element,
		first,
		read: () => {
			const out: Record<string, unknown> = {};
			for (const [key, read] of reads) {
				const got = read();
				// Exactly what was entered (the review's 8): a cleared field is left out, so a required one fails; an
				// empty text is kept where the schema takes one, and left out of an optional field that cannot.
				const field = schema.properties[key] as PromptFieldV1;
				const emptyRefused =
					got === '' && (field.minLength ?? 0) > 0 && !schema.required?.includes(key);
				if (got !== undefined && !emptyRefused) out[key] = got;
			}
			return out;
		},
	};
}
