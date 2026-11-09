/**
 * One "needs input" for the palette, a chord and New (documents specification, 2.1; step 11's re-check): the
 * shape alone, which the kernel reads in first paint, and the manifest's rule, which adds the validator's
 * parse of `{}`. Where the shape decides, both agree; a `oneOf` that `{}` meets twice only the parse sees. A
 * branch's `required` counts only with the branch's `type`, the one form the input-schema rule accepts.
 */

import { describe, expect, it } from 'vitest';
import { inputSchemaProblem, needsInput } from './core-rules.js';
import { needsInputShape } from './needs-input.js';

const object = (extra: object) => ({
	type: 'object',
	properties: { a: { type: 'string' }, b: { type: 'string' } },
	...extra,
});
const requires = (name: string) => ({
	type: 'object',
	properties: { [name]: { type: 'string' } },
	required: [name],
});

describe('needsInputShape and needsInput', () => {
	const table: Array<[string, unknown, boolean]> = [
		['an empty object', object({}), false],
		['a required property', object({ required: ['a'] }), true],
		['minProperties 1', object({ minProperties: 1 }), true],
		['minProperties 0', object({ minProperties: 0 }), false],
		['required in every anyOf branch', object({ anyOf: [requires('a'), requires('b')] }), true],
		['required in every oneOf branch', object({ oneOf: [requires('a'), requires('b')] }), true],
		['an anyOf branch {} meets', object({ anyOf: [requires('a'), { type: 'object' }] }), false],
		['required in an allOf branch', object({ allOf: [requires('a')] }), true],
		[
			'minProperties in an allOf branch',
			object({ allOf: [{ type: 'object', minProperties: 1 }] }),
			true,
		],
		['required two levels down', object({ allOf: [{ anyOf: [requires('a')] }] }), true],
		['a path, read later', 'schemas/x.json', false],
	];
	it.each(table)('%s', (_name, schema, needs) => {
		expect(inputSchemaProblem(schema)).toBeUndefined();
		expect(needsInputShape(schema)).toBe(needs);
		expect(needsInput(schema)).toBe(needs);
	});

	it('adds the parse for what the shape cannot see: a `oneOf` that `{}` meets twice', () => {
		const schema = object({ oneOf: [{ type: 'object' }, { type: 'object' }] });
		expect(inputSchemaProblem(schema)).toBeUndefined();
		expect(needsInputShape(schema)).toBe(false);
		expect(needsInput(schema)).toBe(true);
	});
});
