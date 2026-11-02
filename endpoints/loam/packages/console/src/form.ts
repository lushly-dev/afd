/**
 * @fileoverview `renderForm` (phase 1 specification, 7.7): what a command's input schema asks a person
 * for, and `readForm`, what they entered as the input to send. Pure, so no DOM. A schema is a server's
 * or a package's, so it is untrusted: a keyword of the wrong type is ignored, and a property it names
 * stays data, whatever the name.
 */

export type FormControl =
	| 'text-field'
	| 'text-area'
	| 'select'
	| 'checkbox'
	| 'number'
	| 'lines'
	| 'json';

export interface FormOption {
	value: string;
	label: string;
}

/** What a field's value must be, before the call. The server remains the authority. */
export interface FormRules {
	minLength?: number;
	maxLength?: number;
	minimum?: number;
	maximum?: number;
	pattern?: string;
	integer?: boolean;
	/** A number's `enum`. A string's is a select's options. */
	oneOf?: number[];
}

export interface FormField {
	/** The property's name. */
	name: string;
	/** This field's value is the whole input, for a root that lists no properties. */
	whole?: boolean;
	label: string;
	/** The property's description, as plain text, and what the value must be, so it is known before an error. */
	help: string;
	required: boolean;
	control: FormControl;
	/** The control's first value: text for every control but `checkbox`. */
	initial: string | boolean | undefined;
	/** `checkbox` only: shown checked, from a default, whether or not it is sent. */
	checked?: boolean;
	/** `select` only, in order. An optional select starts with an empty one. */
	options?: FormOption[];
	rules: FormRules;
}

export interface FormModel {
	fields: FormField[];
}

/** What a person entered, by field name. An unchanged optional checkbox is `undefined`. */
export type FormValues = Readonly<Record<string, string | boolean | undefined>>;

export type FormReading =
	| { ok: true; input: Record<string, unknown> }
	| { ok: false; errors: Record<string, string> };

type Schema = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Schema =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const number = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const isStrings = (value: unknown): value is string[] =>
	Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string');

/** A select's values. The empty string means no choice, so an enum holding it is not one (it is the JSON row). */
const isChoices = (value: unknown): value is string[] => isStrings(value) && !value.includes('');

/** A text area when a string may run past one line's worth (7.7's first row). */
const TEXT_AREA_OVER = 200;

/** A string's choices: `enum`, or `anyOf` of `const` strings, the title naming each when it has one. */
function choicesOf(schema: Schema): FormOption[] | null {
	if (schema.type === 'string' && isChoices(schema.enum)) {
		return schema.enum.map((value) => ({ value, label: value }));
	}
	const { anyOf } = schema;
	if (!Array.isArray(anyOf) || anyOf.length === 0) return null;
	const options: FormOption[] = [];
	for (const branch of anyOf) {
		if (!isObject(branch) || typeof branch.const !== 'string' || branch.const === '') return null;
		options.push({ value: branch.const, label: text(branch.title) || branch.const });
	}
	return options;
}

function rulesOf(schema: Schema): FormRules {
	const rules: FormRules = {};
	const minLength = number(schema.minLength);
	const maxLength = number(schema.maxLength);
	const minimum = number(schema.minimum);
	const maximum = number(schema.maximum);
	if (minLength !== undefined) rules.minLength = minLength;
	if (maxLength !== undefined) rules.maxLength = maxLength;
	if (minimum !== undefined) rules.minimum = minimum;
	if (maximum !== undefined) rules.maximum = maximum;
	if (typeof schema.pattern === 'string') rules.pattern = schema.pattern;
	if (Array.isArray(schema.enum) && schema.enum.every((item) => typeof item === 'number')) {
		rules.oneOf = schema.enum;
	}
	return rules;
}

/** What a value must be, in words, so a person need not fail to learn it (WCAG 3.3.2). */
function hintsOf(control: FormControl, rules: FormRules): string {
	const { minLength, maxLength, minimum, maximum, pattern, integer, oneOf } = rules;
	const hints: string[] = [];
	if (control === 'lines') hints.push('One per line.');
	if (minLength !== undefined) hints.push(`At least ${minLength} characters.`);
	if (maxLength !== undefined) hints.push(`At most ${maxLength} characters.`);
	if (pattern !== undefined) hints.push(`Must match ${pattern}.`);
	if (integer) hints.push('A whole number.');
	if (minimum !== undefined) hints.push(`${minimum} or more.`);
	if (maximum !== undefined) hints.push(`${maximum} or less.`);
	if (oneOf !== undefined) hints.push(`One of ${oneOf.join(', ')}.`);
	return hints.join(' ');
}

const withHints = (field: FormField): FormField => {
	const hints = hintsOf(field.control, field.rules);
	return hints === '' ? field : { ...field, help: field.help ? `${field.help} ${hints}` : hints };
};

function fieldOf(name: string, schema: unknown, required: boolean): FormField {
	return withHints(bareField(name, schema, required));
}

function bareField(name: string, schema: unknown, required: boolean): FormField {
	const common = {
		name,
		label: (isObject(schema) && text(schema.title)) || name,
		help: isObject(schema) ? text(schema.description) : '',
		required,
	};
	if (!isObject(schema)) {
		return {
			...common,
			label: `${common.label} (JSON)`,
			control: 'json',
			initial: undefined,
			rules: {},
		};
	}
	const fallback = schema.default;
	const rules = rulesOf(schema);
	const choices = choicesOf(schema);
	if (choices) {
		const defaulted =
			typeof fallback === 'string' && choices.some(({ value }) => value === fallback)
				? fallback
				: undefined;
		return {
			...common,
			control: 'select',
			// A required select has no empty option, so it starts on one of its values, as a native one does.
			initial: defaulted ?? (required ? choices[0]?.value : ''),
			options: required ? choices : [{ value: '', label: 'None' }, ...choices],
			rules: {},
		};
	}
	switch (schema.type) {
		case 'string':
			// An enum that is not a select's choices: only JSON can say what it holds.
			if (schema.enum !== undefined) break;
			return {
				...common,
				// A single-line field would show a default's line break as nothing, and send it.
				control:
					(rules.maxLength ?? 0) > TEXT_AREA_OVER ||
					(typeof fallback === 'string' && fallback.includes('\n'))
						? 'text-area'
						: 'text-field',
				initial: typeof fallback === 'string' ? fallback : undefined,
				rules,
			};
		case 'boolean':
			return {
				...common,
				control: 'checkbox',
				// Optional and untouched, it is left out of the input, even when a default shows it checked.
				initial: required ? fallback === true : undefined,
				checked: fallback === true,
				rules: {},
			};
		case 'number':
		case 'integer':
			return {
				...common,
				control: 'number',
				initial: number(fallback)?.toString(),
				rules: { ...rules, ...(schema.type === 'integer' ? { integer: true } : {}) },
			};
		case 'array':
			if (isObject(schema.items) && schema.items.type === 'string') {
				return {
					...common,
					control: 'lines',
					initial: isStrings(fallback) ? fallback.join('\n') : undefined,
					rules: {},
				};
			}
			break;
	}
	return {
		...common,
		label: `${common.label} (JSON)`,
		control: 'json',
		initial: fallback === undefined ? undefined : JSON.stringify(fallback, null, 2),
		rules: {},
	};
}

/** A root that says what it takes some other way than `properties`, so "No input" would be untrue. */
const OTHER_WAYS = ['anyOf', 'oneOf', 'allOf', '$ref', 'not', 'if', 'patternProperties'];

const takesInputSomeOtherWay = (schema: Schema): boolean =>
	OTHER_WAYS.some((keyword) => Object.hasOwn(schema, keyword)) ||
	(isObject(schema.additionalProperties) && Object.keys(schema.additionalProperties).length > 0);

/** The form for one command's input schema. No fields means "No input", which sends `{}`. */
export function renderForm(schema: unknown): FormModel {
	if (!isObject(schema)) return { fields: [] };
	const required = Array.isArray(schema.required) ? schema.required : [];
	const properties = isObject(schema.properties) ? Object.entries(schema.properties) : [];
	if (properties.length > 0) {
		return { fields: properties.map(([name, sub]) => fieldOf(name, sub, required.includes(name))) };
	}
	if (takesInputSomeOtherWay(schema)) {
		return {
			fields: [
				{
					name: 'input',
					whole: true,
					label: 'Input (JSON)',
					help: '',
					required: true,
					control: 'json',
					initial: undefined,
					rules: {},
				},
			],
		};
	}
	return { fields: [] };
}

/** What a field shows and sends first; `undefined` for an unchanged optional checkbox. */
export function initialValues(model: FormModel): Record<string, string | boolean | undefined> {
	return Object.fromEntries(model.fields.map((field) => [field.name, field.initial]));
}

/** A field's error, if it has one: `errors` is keyed by a schema's names, which may be `constructor`. */
export const errorOf = (errors: Readonly<Record<string, string>>, name: string): string | null =>
	Object.hasOwn(errors, name) ? (errors[name] as string) : null;

/** JSON Schema counts characters, not UTF-16 code units. */
const lengthOf = (value: string): number => [...value].length;

function compiled(pattern: string): RegExp | null {
	try {
		return new RegExp(pattern, 'u');
	} catch {
		// A pattern that does not compile is skipped (7.7).
		return null;
	}
}

function checkString(value: string, rules: FormRules): string | null {
	const { minLength, maxLength, pattern } = rules;
	if (minLength !== undefined && lengthOf(value) < minLength) {
		return `Enter at least ${minLength} characters.`;
	}
	if (maxLength !== undefined && lengthOf(value) > maxLength) {
		return `Enter at most ${maxLength} characters.`;
	}
	if (pattern !== undefined && compiled(pattern)?.test(value) === false) {
		return `Enter a value that matches ${pattern}.`;
	}
	return null;
}

function checkNumber(value: number, rules: FormRules): string | null {
	const { minimum, maximum, integer, oneOf } = rules;
	if (integer && !Number.isInteger(value)) return 'Enter a whole number.';
	// Past 2^53 what is sent would differ from what is shown.
	if (integer && !Number.isSafeInteger(value))
		return 'Enter a smaller number: this one would be rounded.';
	if (oneOf !== undefined && !oneOf.includes(value)) return `Enter one of ${oneOf.join(', ')}.`;
	if (minimum !== undefined && value < minimum) return `Enter ${minimum} or more.`;
	if (maximum !== undefined && value > maximum) return `Enter ${maximum} or less.`;
	return null;
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

type Reading = { value: unknown } | { error: string } | { omit: true };

function readField(field: FormField, raw: string | boolean | undefined): Reading {
	if (field.control === 'checkbox') {
		return typeof raw === 'boolean' ? { value: raw } : { omit: true };
	}
	const entered = typeof raw === 'string' ? raw : '';
	const lines =
		field.control === 'lines' ? entered.split(/\r?\n/).filter((line) => line.trim() !== '') : [];
	if (entered === '' || (field.control === 'lines' && lines.length === 0)) {
		return field.required ? { error: 'This field is required.' } : { omit: true };
	}
	switch (field.control) {
		case 'lines':
			return { value: lines };
		case 'select':
			return field.options?.some(({ value }) => value === entered)
				? { value: entered }
				: { error: 'Choose one of the options.' };
		case 'number': {
			// JSON's numbers and a leading point, and so not `Number`'s 0x10 or an empty string's 0.
			const value = NUMBER.test(entered.trim()) ? Number(entered) : Number.NaN;
			if (!Number.isFinite(value)) return { error: 'Enter a number.' };
			const error = checkNumber(value, field.rules);
			return error === null ? { value } : { error };
		}
		case 'json':
			try {
				return { value: JSON.parse(entered) };
			} catch {
				return { error: 'Enter valid JSON.' };
			}
		default: {
			const error = checkString(entered, field.rules);
			return error === null ? { value: entered } : { error };
		}
	}
}

/**
 * Checks what a person entered, and builds the input. `Object.fromEntries`, so a property a schema
 * names `__proto__` is sent as data and sets no prototype.
 */
export function readForm(model: FormModel, values: FormValues): FormReading {
	const entries: [string, unknown][] = [];
	const errors: [string, string][] = [];
	for (const field of model.fields) {
		const reading = readField(
			field,
			Object.hasOwn(values, field.name) ? values[field.name] : undefined
		);
		if ('error' in reading) errors.push([field.name, reading.error]);
		else if ('value' in reading) {
			if (field.whole) return { ok: true, input: reading.value as Record<string, unknown> };
			entries.push([field.name, reading.value]);
		}
	}
	if (errors.length > 0) return { ok: false, errors: Object.fromEntries(errors) };
	return { ok: true, input: Object.fromEntries(entries) };
}
