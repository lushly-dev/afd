// The example library's cases. A case that names a component supplies its examples and its
// accessibility check; the checks below name none, and prove what they claim.
import './field.js';
import './select.js';

/** Markup as a person writes it, mounted as written. */
function markup(html) {
	const template = document.createElement('template');
	template.innerHTML = html;
	return template.content.firstElementChild;
}

export const FieldDefault = {
	render: () => markup('<example-field label="Email" value="ada@example.com"></example-field>'),
};

export const FieldInvalid = {
	render: () =>
		markup(
			'<example-field label="Email" invalid>\n\t<span slot="hint">Enter an address with an @.</span>\n</example-field>'
		),
};

export const SelectDefault = {
	render: () =>
		markup(
			'<example-select label="Size" value="m">\n\t<example-option value="s">Small</example-option>\n\t<example-option value="m" selected>Medium</example-option>\n</example-select>'
		),
};

const field = { field: { selector: 'example-field' } };
const select = { select: { selector: 'example-select' } };

/** Each state of the field a claim proves, and a small one only shown. */
export const FieldStates = {
	render: () => {
		const box = document.createElement('div');
		box.innerHTML =
			'<example-field label="Name"></example-field><example-field label="Code" size="small"></example-field>';
		return box;
	},
	targets: { field: { selector: 'example-field[label="Name"]' } },
	scenario: [
		{ id: 'medium', expect: { target: 'field', state: { property: 'size', equals: 'medium' } } },
		{ id: 'named', expect: { target: 'field', state: { attribute: 'label', equals: 'Name' } } },
	],
	coverage: [
		{
			target: 'field',
			obligation: 'property:size=medium',
			checkpoint: 'after-run',
			expectations: ['medium'],
		},
		{
			target: 'field',
			obligation: 'guide:field.label-required',
			checkpoint: 'after-run',
			expectations: ['named'],
		},
	],
};

export const FieldDisabled = {
	render: () => markup('<example-field label="Email" disabled></example-field>'),
	targets: field,
	scenario: [
		{ id: 'disabled', expect: { target: 'field', state: { property: 'disabled', equals: true } } },
	],
	coverage: [
		{
			target: 'field',
			obligation: 'property:disabled=true',
			checkpoint: 'after-run',
			expectations: ['disabled'],
		},
	],
};

export const FieldInvalidState = {
	render: () => markup('<example-field label="Email" invalid></example-field>'),
	targets: field,
	scenario: [
		{ id: 'invalid', expect: { target: 'field', state: { property: 'invalid', equals: true } } },
	],
	coverage: [
		{
			target: 'field',
			obligation: 'property:invalid=true',
			checkpoint: 'after-run',
			expectations: ['invalid'],
		},
	],
};

export const FieldChange = {
	render: () => markup('<example-field label="Email" value="ada@example.com"></example-field>'),
	targets: field,
	events: [{ type: 'change', target: 'field' }],
	scenario: [
		{ id: 'activate', action: { click: 'field' } },
		{ id: 'changed', expect: { event: 'change', target: 'field', since: 'activate' } },
	],
	coverage: [
		{
			target: 'field',
			obligation: 'event:change',
			checkpoint: 'after-run',
			expectations: ['changed'],
		},
	],
};

/** Opening the select: it is open, it said so, and focus stays on it. */
export const SelectOpen = {
	render: () =>
		markup(
			'<example-select label="Size"><example-option value="s" disabled>Small</example-option><example-option value="m">Medium</example-option></example-select>'
		),
	targets: select,
	events: [{ type: 'change', target: 'select' }],
	scenario: [
		{ id: 'activate', action: { click: 'select' } },
		{ id: 'changed', expect: { event: 'change', target: 'select', since: 'activate' } },
		{ id: 'open', expect: { target: 'select', state: { attribute: 'open', equals: '' } } },
		{ id: 'focus-kept', expect: { target: 'select', state: { property: 'open', equals: true } } },
	],
	coverage: [
		{
			target: 'select',
			obligation: 'property:open=true',
			checkpoint: 'after-run',
			expectations: ['open'],
		},
		{
			target: 'select',
			obligation: 'event:change',
			checkpoint: 'after-run',
			expectations: ['changed'],
		},
		{
			target: 'select',
			obligation: 'guide:popup.focus-return',
			checkpoint: 'after-run',
			expectations: ['focus-kept'],
		},
	],
};

export const SelectDisabled = {
	render: () =>
		markup(
			'<example-select label="Size" disabled><example-option value="s">Small</example-option></example-select>'
		),
};
