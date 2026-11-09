/**
 * One "needs input" for the palette, a chord and New (documents specification, 2.1; step 11's re-check): the
 * shape alone, which the kernel reads in first paint, and the manifest's rule, which adds the validator's
 * parse of `{}`. Where the shape decides, both agree; a `const` or an `enum` only the parse sees.
 */

import { describe, expect, it } from 'vitest';
import { needsInput } from './core-rules.js';
import { needsInputShape } from './needs-input.js';

const object = (extra: object) => ({
	type: 'object',
	properties: { a: { type: 'string' }, b: { type: 'string' } },
	additionalProperties: false,
	...extra,
});

describe('needsInputShape and needsInput', () => {
	const table: Array<[string, unknown, boolean]> = [
		['an empty object', object({}), false],
		['a required property', object({ required: ['a'] }), true],
		['minProperties 1', object({ minProperties: 1 }), true],
		['minProperties 0', object({ minProperties: 0 }), false],
		[
			'required in every anyOf branch',
			object({ anyOf: [{ required: ['a'] }, { required: ['b'] }] }),
			true,
		],
		[
			'required in every oneOf branch',
			object({ oneOf: [{ required: ['a'] }, { required: ['b'] }] }),
			true,
		],
		['an anyOf branch {} meets', object({ anyOf: [{ required: ['a'] }, {}] }), false],
		['required in an allOf branch', object({ allOf: [{ required: ['a'] }] }), true],
		['required two levels down', object({ allOf: [{ anyOf: [{ required: ['a'] }] }] }), true],
		['a path, read later', 'schemas/x.json', false],
	];
	it.each(table)('%s', (_name, schema, needs) => {
		expect(needsInputShape(schema)).toBe(needs);
		expect(needsInput(schema)).toBe(needs);
	});

	it('adds the parse for what the shape cannot see: a `const` that `{}` is not', () => {
		const schema = object({ const: { a: 'x' } });
		expect(needsInputShape(schema)).toBe(false);
		expect(needsInput(schema)).toBe(true);
	});
});
