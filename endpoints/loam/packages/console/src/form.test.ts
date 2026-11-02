import { describe, expect, it } from 'vitest';
import { errorOf, type FormModel, initialValues, readForm, renderForm } from './form.js';

const form = (properties: Record<string, unknown>, required: string[] = []) =>
	renderForm({ type: 'object', properties, required });

const only = (model: FormModel) => {
	const [field] = model.fields;
	if (!field) throw new Error('no field');
	return field;
};

const sent = (model: FormModel, values: Record<string, string | boolean | undefined>) => {
	const reading = readForm(model, values);
	if (!reading.ok) throw new Error(JSON.stringify(reading.errors));
	return reading.input;
};

const errors = (model: FormModel, values: Record<string, string | boolean | undefined>) => {
	const reading = readForm(model, values);
	if (reading.ok) throw new Error('It was accepted');
	return reading.errors;
};

describe('renderForm, each row of 7.7', () => {
	it('string: a text field; an empty optional is omitted', () => {
		const model = form({ name: { type: 'string' } });
		expect(only(model).control).toBe('text-field');
		expect(sent(model, { name: 'Ada' })).toEqual({ name: 'Ada' });
		expect(sent(model, { name: '' })).toEqual({});
		expect(sent(model, {})).toEqual({});
	});

	it('string: a text area when maxLength exceeds 200', () => {
		expect(only(form({ a: { type: 'string', maxLength: 200 } })).control).toBe('text-field');
		expect(only(form({ a: { type: 'string', maxLength: 201 } })).control).toBe('text-area');
		// A single-line field would show the break as nothing and send it.
		expect(only(form({ a: { type: 'string', default: 'x\ny' } })).control).toBe('text-area');
	});

	it('string with enum: a select, with an empty first option when optional', () => {
		const optional = form({ tone: { type: 'string', enum: ['warm', 'cold'] } });
		const field = only(optional);
		expect(field.control).toBe('select');
		expect(field.options).toEqual([
			{ value: '', label: 'None' },
			{ value: 'warm', label: 'warm' },
			{ value: 'cold', label: 'cold' },
		]);
		expect(field.initial).toBe('');
		expect(sent(optional, { tone: 'cold' })).toEqual({ tone: 'cold' });
		expect(sent(optional, { tone: '' })).toEqual({});
		expect(errors(optional, { tone: 'tepid' })).toEqual({ tone: 'Choose one of the options.' });

		const required = form({ tone: { type: 'string', enum: ['warm', 'cold'] } }, ['tone']);
		expect(only(required).options).toEqual([
			{ value: 'warm', label: 'warm' },
			{ value: 'cold', label: 'cold' },
		]);
		expect(only(required).initial).toBe('warm');
	});

	it('anyOf of const strings: a select, the title naming each', () => {
		const model = form({
			tone: { anyOf: [{ const: 'w', title: 'Warm' }, { const: 'c' }] },
		});
		expect(only(model).control).toBe('select');
		expect(only(model).options).toEqual([
			{ value: '', label: 'None' },
			{ value: 'w', label: 'Warm' },
			{ value: 'c', label: 'c' },
		]);
		expect(sent(model, { tone: 'w' })).toEqual({ tone: 'w' });
	});

	it('boolean: a checkbox; optional starts unset and is omitted unless changed', () => {
		const optional = form({ loud: { type: 'boolean' } });
		expect(only(optional).control).toBe('checkbox');
		expect(only(optional).initial).toBeUndefined();
		expect(sent(optional, initialValues(optional))).toEqual({});
		expect(sent(optional, { loud: true })).toEqual({ loud: true });
		expect(sent(optional, { loud: false })).toEqual({ loud: false });

		const required = form({ loud: { type: 'boolean' } }, ['loud']);
		expect(only(required).initial).toBe(false);
		expect(sent(required, initialValues(required))).toEqual({ loud: false });
	});

	it('number and integer: a number field; integer refuses a fraction', () => {
		const decimal = form({ n: { type: 'number' } });
		expect(only(decimal).control).toBe('number');
		expect(sent(decimal, { n: '1.5' })).toEqual({ n: 1.5 });
		expect(sent(decimal, { n: '' })).toEqual({});
		expect(sent(decimal, { n: '-2' })).toEqual({ n: -2 });
		expect(sent(decimal, { n: ' 1e3 ' })).toEqual({ n: 1000 });
		for (const text of ['not a number', '0x10', '1e', '-', '1e999', 'Infinity', '1 2']) {
			expect(errors(decimal, { n: text })).toEqual({ n: 'Enter a number.' });
		}

		const whole = form({ n: { type: 'integer' } });
		expect(only(whole).control).toBe('number');
		expect(sent(whole, { n: '3' })).toEqual({ n: 3 });
		expect(errors(whole, { n: '1.5' })).toEqual({ n: 'Enter a whole number.' });
	});

	it('array of string: a text area, one per line; empty lines dropped', () => {
		const model = form({ tags: { type: 'array', items: { type: 'string' } } });
		expect(only(model).control).toBe('lines');
		expect(sent(model, { tags: 'a\n\n  \nb\r\nc' })).toEqual({ tags: ['a', 'b', 'c'] });
		expect(sent(model, { tags: '\n\n' })).toEqual({});
	});

	it.each([
		['an object', { type: 'object', properties: { a: { type: 'string' } } }],
		['an array of numbers', { type: 'array', items: { type: 'number' } }],
		['an array with no items', { type: 'array' }],
		['anyOf that is not const strings', { anyOf: [{ type: 'string' }, { type: 'number' }] }],
		['oneOf', { oneOf: [{ const: 'a' }] }],
		['$ref', { $ref: '#/$defs/x' }],
		['no type', { description: 'Anything' }],
		['enum with no type', { enum: ['a'] }],
		['a type list', { type: ['string', 'null'] }],
		['a schema that is not an object', true],
	])('anything else, %s: a text area labeled JSON', (_name, schema) => {
		const model = form({ value: schema });
		expect(only(model).control).toBe('json');
		expect(only(model).label).toBe('value (JSON)');
		expect(sent(model, { value: '{"nested":{"a":[1]}}' })).toEqual({
			value: { nested: { a: [1] } },
		});
		expect(errors(model, { value: '{nope' })).toEqual({ value: 'Enter valid JSON.' });
		expect(sent(model, { value: '' })).toEqual({});
	});

	it.each([
		['no properties key', { type: 'object' }],
		['empty properties', { type: 'object', properties: {} }],
		['closed', { type: 'object', properties: {}, additionalProperties: false }],
		['nothing at all', undefined],
		['not an object', 'hostile'],
	])('no properties, %s: no control, and {} is sent', (_name, schema) => {
		const model = renderForm(schema);
		expect(model.fields).toEqual([]);
		expect(sent(model, {})).toEqual({});
	});

	it.each([
		['a combinator', { anyOf: [{ type: 'object' }] }],
		['open properties', { type: 'object', additionalProperties: { type: 'string' } }],
		['pattern properties', { type: 'object', patternProperties: { '^a': { type: 'string' } } }],
	])(
		'a root with %s takes the whole input as JSON, since "No input" would be untrue',
		(_name, schema) => {
			const model = renderForm(schema);
			expect(only(model).label).toBe('Input (JSON)');
			expect(only(model).whole).toBe(true);
			expect(sent(model, { input: '{"a":"b"}' })).toEqual({ a: 'b' });
			expect(errors(model, { input: '' })).toEqual({ input: 'This field is required.' });
		}
	);

	it('keeps "No input" for a root closed or open with nothing declared', () => {
		expect(renderForm({ type: 'object', additionalProperties: false }).fields).toEqual([]);
		expect(renderForm({ type: 'object', additionalProperties: true }).fields).toEqual([]);
		expect(renderForm({ type: 'object', additionalProperties: {} }).fields).toEqual([]);
	});

	it('a property named with the empty string is only a property', () => {
		const model = form({ '': { type: 'string' }, a: { type: 'string' } });
		expect(sent(model, { '': 'x', a: 'y' })).toEqual({ '': 'x', a: 'y' });
	});

	it('an enum holding the empty string is the JSON row, since the empty string means no choice', () => {
		expect(only(form({ a: { type: 'string', enum: ['', 'b'] } })).control).toBe('json');
		expect(only(form({ a: { anyOf: [{ const: '' }, { const: 'b' }] } })).control).toBe('json');
	});
});

describe('errorOf', () => {
	it("finds a field's own error, and nothing through the prototype chain", () => {
		expect(errorOf({ a: 'Bad' }, 'a')).toBe('Bad');
		expect(errorOf({ a: 'Bad' }, 'b')).toBeNull();
		expect(errorOf({ a: 'Bad' }, 'constructor')).toBeNull();
		expect(errorOf({ a: 'Bad' }, 'toString')).toBeNull();
	});
});

describe('labels, defaults and required', () => {
	it("labels a control with the property's title or name, and its description as help", () => {
		const titled = only(form({ a: { type: 'string', title: 'Full name', description: 'Yours' } }));
		expect(titled.label).toBe('Full name');
		expect(titled.help).toBe('Yours');
		expect(only(form({ a: { type: 'string' } })).label).toBe('a');
	});

	it('says what a value must be in its help, so a person need not fail to learn it', () => {
		const help = (schema: unknown) => only(form({ a: schema })).help;
		expect(help({ type: 'string', description: 'Yours', minLength: 2 })).toBe(
			'Yours At least 2 characters.'
		);
		expect(help({ type: 'string', maxLength: 3, pattern: '^a' })).toBe(
			'At most 3 characters. Must match ^a.'
		);
		expect(help({ type: 'integer', minimum: 1, maximum: 5 })).toBe(
			'A whole number. 1 or more. 5 or less.'
		);
		expect(help({ type: 'number', enum: [1, 2] })).toBe('One of 1, 2.');
		expect(help({ type: 'array', items: { type: 'string' } })).toBe('One per line.');
		expect(help({ type: 'string' })).toBe('');
	});

	it('pre-fills a default of the right type, and ignores one of the wrong type', () => {
		expect(only(form({ a: { type: 'string', default: 'x' } })).initial).toBe('x');
		expect(only(form({ a: { type: 'string', default: 1 } })).initial).toBeUndefined();
		expect(only(form({ a: { type: 'number', default: 2 } })).initial).toBe('2');
		expect(only(form({ a: { type: 'boolean', default: true } }, ['a'])).initial).toBe(true);
		expect(only(form({ a: { type: 'string', enum: ['x', 'y'], default: 'y' } })).initial).toBe('y');
		expect(only(form({ a: { type: 'string', enum: ['x', 'y'], default: 'z' } })).initial).toBe('');
		expect(
			only(form({ a: { type: 'array', items: { type: 'string' }, default: ['p', 'q'] } })).initial
		).toBe('p\nq');
		expect(only(form({ a: { type: 'object', default: { b: 1 } } })).initial).toBe(
			JSON.stringify({ b: 1 }, null, 2)
		);
	});

	it('marks required, and refuses an empty required field of every kind that can be empty', () => {
		const required = (schema: unknown) => form({ a: schema }, ['a']);
		expect(only(required({ type: 'string' })).required).toBe(true);
		for (const schema of [
			{ type: 'string' },
			{ type: 'number' },
			{ type: 'array', items: { type: 'string' } },
			{ type: 'object' },
		]) {
			expect(errors(required(schema), { a: '' })).toEqual({ a: 'This field is required.' });
		}
	});
});

describe('the checks before a call', () => {
	it('minLength and maxLength, in characters', () => {
		const model = form({ a: { type: 'string', minLength: 2, maxLength: 3 } });
		expect(errors(model, { a: 'x' })).toEqual({ a: 'Enter at least 2 characters.' });
		expect(errors(model, { a: 'xxxx' })).toEqual({ a: 'Enter at most 3 characters.' });
		expect(sent(model, { a: 'xx' })).toEqual({ a: 'xx' });
		expect(sent(model, { a: '😀😀😀' })).toEqual({ a: '😀😀😀' });
	});

	it('minimum and maximum', () => {
		const model = form({ a: { type: 'number', minimum: 1, maximum: 5 } });
		expect(errors(model, { a: '0' })).toEqual({ a: 'Enter 1 or more.' });
		expect(errors(model, { a: '6' })).toEqual({ a: 'Enter 5 or less.' });
		expect(sent(model, { a: '5' })).toEqual({ a: 5 });
	});

	it('an integer past 2^53, which would be rounded, and a number outside its enum', () => {
		const whole = form({ a: { type: 'integer' } });
		expect(errors(whole, { a: '9007199254740993' })).toEqual({
			a: 'Enter a smaller number: this one would be rounded.',
		});
		expect(sent(whole, { a: '9007199254740991' })).toEqual({ a: 9007199254740991 });
		const listed = form({ a: { type: 'number', enum: [1, 2] } });
		expect(errors(listed, { a: '3' })).toEqual({ a: 'Enter one of 1, 2.' });
		expect(sent(listed, { a: '2' })).toEqual({ a: 2 });
	});

	it('pattern, with Unicode classes; one that does not compile is skipped', () => {
		const model = form({ a: { type: 'string', pattern: '^\\p{L}+$' } });
		expect(sent(model, { a: 'Ada' })).toEqual({ a: 'Ada' });
		expect(errors(model, { a: '123' })).toEqual({ a: 'Enter a value that matches ^\\p{L}+$.' });
		expect(sent(form({ a: { type: 'string', pattern: '(' } }), { a: 'x' })).toEqual({ a: 'x' });
	});

	it('reports each field, and a good field beside a bad one sends nothing', () => {
		const model = form(
			{ a: { type: 'string' }, b: { type: 'number', minimum: 1 }, c: { type: 'string' } },
			['a']
		);
		expect(readForm(model, { b: '0', c: 'fine' })).toEqual({
			ok: false,
			errors: { a: 'This field is required.', b: 'Enter 1 or more.' },
		});
	});

	it('ignores unknown keywords, and keywords of the wrong type', () => {
		const model = form({
			a: {
				type: 'string',
				format: 'email',
				minLength: 'many',
				maxLength: null,
				pattern: 3,
				title: 7,
				description: {},
			},
		});
		expect(only(model).label).toBe('a');
		expect(only(model).help).toBe('');
		expect(sent(model, { a: 'x' })).toEqual({ a: 'x' });
	});
});

describe('a hostile schema', () => {
	it('sends a property named __proto__ as data, and sets no prototype', () => {
		const schema = JSON.parse(
			'{"type":"object","properties":{"__proto__":{"type":"string"},"constructor":{"type":"string"}}}'
		);
		const model = renderForm(schema);
		expect(model.fields.map(({ name }) => name)).toEqual(['__proto__', 'constructor']);
		const values = JSON.parse('{"__proto__":"polluted","constructor":"x"}');
		const input = sent(model, values);
		expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
		expect(Object.hasOwn(input, '__proto__')).toBe(true);
		expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
	});

	it('reads no value through the prototype chain', () => {
		const model = form({ toString: { type: 'string' } }, ['toString']);
		expect(errors(model, {})).toEqual(JSON.parse('{"toString":"This field is required."}'));
	});

	it('survives required and properties of the wrong type', () => {
		expect(renderForm({ properties: [], required: 'a' }).fields).toEqual([]);
		const model = renderForm({ properties: { a: { type: 'string' } }, required: 'a' });
		expect(only(model).required).toBe(false);
	});
});

describe('an untrusted pattern is not run where it could stall the tab', () => {
	const checked = (pattern: string, value: string) => {
		const model = form({ a: { type: 'string', pattern } });
		return readForm(model, { a: value }).ok;
	};

	it('still checks an ordinary one', () => {
		expect(checked('^[a-z]+$', 'abc')).toBe(true);
		expect(checked('^[a-z]+$', 'ABC')).toBe(false);
		expect(checked('^[a-z]+-[a-z]+$', 'ab-cd')).toBe(true);
		expect(checked('^[a-z]+-[a-z]+$', 'abcd')).toBe(false);
		expect(checked('^a{2,4}$', 'a')).toBe(false);
	});

	it.each([
		['a quantified group', '^(a+)+$'],
		['a quantified alternation', '^(a|a)*$'],
		['a bounded quantified group', '^(a+){2,}$'],
		['a backreference', '^(a)\\1$'],
		['a lookahead', '^(?=a)a$'],
		['three quantifiers', '^a*a*a*b$'],
		['a chain of alternations', `^${'(a|a)'.repeat(50)}$`],
		['a chain of alternations on anything', `^${'(.|.)'.repeat(50)}$`],
		['a chain of optionals', `^a*${'a?'.repeat(30)}$`],
		['three bounded quantifiers', '^a{1,1000}a{1,1000}a{1,1000}$'],
		['one past the length it reads', `^${'a'.repeat(300)}$`],
	])('skips %s, and leaves it to the server', (_name, pattern) => {
		const started = performance.now();
		expect(checked(pattern, `${'a'.repeat(60)}!`)).toBe(true);
		expect(performance.now() - started).toBeLessThan(1_000);
	});

	it('counts neither a quantifier in a character class nor an escaped one', () => {
		expect(checked('^[+*]+[(+)]+$', '+(')).toBe(true);
		expect(checked('^[+*]+[(+)]+$', 'ab')).toBe(false);
		expect(checked('^\\+\\*\\(\\)a+$', '+*()')).toBe(false);
	});

	it('takes at most a moment over what it does run', () => {
		const started = performance.now();
		expect(checked('^a*a*$', `${'a'.repeat(999)}!`)).toBe(false);
		expect(performance.now() - started).toBeLessThan(2_000);
	});

	it('leaves a value past the length it reads to the server', () => {
		const long = `${'a'.repeat(1_001)}!`;
		expect(checked('^a+$', long)).toBe(true);
	});

	it('still says what the pattern asks, whether or not it runs', () => {
		const [field] = form({ a: { type: 'string', pattern: '^(a+)+$' } }).fields;
		expect(field?.help).toContain('^(a+)+$');
	});
});
