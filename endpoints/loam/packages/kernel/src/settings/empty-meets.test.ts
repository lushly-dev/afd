/**
 * Step 7's R11 (phase 4 specification, 8.3): whether `{}` is proven to meet a mounted command's advertised schema, so a
 * chord may run it. A keyword `emptyMeets` does not decide, anywhere it must, makes it false: it fails safe.
 */

import { describe, expect, it } from 'vitest';
import { emptyMeets } from './empty-meets.js';

describe('emptyMeets (R11)', () => {
	it('decides the keywords about an empty object', () => {
		expect(emptyMeets({})).toBe(true);
		expect(emptyMeets(true)).toBe(true);
		expect(emptyMeets(false)).toBe(false);
		expect(emptyMeets({ type: 'object' })).toBe(true);
		expect(emptyMeets({ type: ['object', 'null'] })).toBe(true);
		expect(emptyMeets({ type: 'string' })).toBe(false);
		expect(emptyMeets({ type: 'object', required: [] })).toBe(true);
		expect(emptyMeets({ type: 'object', required: ['id'] })).toBe(false);
		expect(emptyMeets({ type: 'object', minProperties: 0 })).toBe(true);
		expect(emptyMeets({ type: 'object', minProperties: 1 })).toBe(false);
		expect(
			emptyMeets({
				type: 'object',
				properties: { id: { type: 'string', minLength: 3 } },
				additionalProperties: false,
			})
		).toBe(true);
		expect(emptyMeets({ type: 'object', additionalProperties: { type: 'string' } })).toBe(true);
	});

	it('decides allOf, anyOf and oneOf, oneOf exactly once', () => {
		expect(emptyMeets({ allOf: [{ type: 'object' }, { required: [] }] })).toBe(true);
		expect(emptyMeets({ allOf: [{ type: 'object' }, { required: ['id'] }] })).toBe(false);
		expect(emptyMeets({ anyOf: [{ required: ['id'] }, { type: 'object' }] })).toBe(true);
		expect(emptyMeets({ anyOf: [{ required: ['id'] }, { minProperties: 1 }] })).toBe(false);
		expect(emptyMeets({ oneOf: [{ type: 'object' }, { type: 'string' }] })).toBe(true);
		expect(emptyMeets({ oneOf: [{ type: 'object' }, { type: 'object' }] })).toBe(false);
		// One met branch is enough for anyOf, whatever the other.
		expect(emptyMeets({ anyOf: [{ type: 'object' }, { not: {} }] })).toBe(true);
	});

	it('passes over annotations, which assert nothing', () => {
		expect(
			emptyMeets({
				$schema: 'http://json-schema.org/draft-07/schema#',
				$id: 'input',
				$comment: 'none',
				title: 'Input',
				description: 'No input',
				default: {},
				examples: [{}],
				deprecated: false,
				readOnly: false,
				writeOnly: false,
				type: 'object',
			})
		).toBe(true);
	});

	it.each([
		['$ref', { $ref: '#/$defs/Input', $defs: { Input: { type: 'object' } } }],
		['$defs', { type: 'object', $defs: { Input: { type: 'object' } } }],
		['definitions', { type: 'object', definitions: { Input: { type: 'object' } } }],
		['not', { type: 'object', not: { const: {} } }],
		['enum', { type: 'object', enum: [{}] }],
		['const', { type: 'object', const: {} }],
		// `then` built as data: an object literal with a `then` key reads as a thenable.
		[
			'if',
			Object.fromEntries([
				['type', 'object'],
				['if', { required: ['a'] }],
				['then', { required: ['b'] }],
			]),
		],
		[
			'then',
			Object.fromEntries([
				['type', 'object'],
				['then', { required: ['b'] }],
			]),
		],
		['else', { type: 'object', else: { required: ['b'] } }],
		['dependentSchemas', { type: 'object', dependentSchemas: { a: { required: ['b'] } } }],
		['an unknown keyword', { type: 'object', 'x-loam-needs': true }],
		['a keyword inside allOf', { allOf: [{ type: 'object' }, { not: {} }] }],
	])('fails safe on %s', (_name, schema) => {
		expect(emptyMeets(schema)).toBe(false);
	});

	it("fails safe on zod-to-json-schema's `$ref` shape, whatever the object it names requires", () => {
		const shape = (input: object) => ({
			$ref: '#/definitions/Input',
			definitions: { Input: input },
			$schema: 'http://json-schema.org/draft-07/schema#',
		});
		expect(emptyMeets(shape({ type: 'object', properties: {}, additionalProperties: false }))).toBe(
			false
		);
		expect(
			emptyMeets(
				shape({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] })
			)
		).toBe(false);
	});

	it('makes a oneOf with a branch it cannot decide ineligible, since that branch could be the second match', () => {
		expect(emptyMeets({ oneOf: [{ type: 'object' }, { $ref: '#/$defs/Other' }] })).toBe(false);
		expect(emptyMeets({ oneOf: [{ type: 'string' }, { enum: [{}] }] })).toBe(false);
	});

	it('fails safe on a malformed keyword', () => {
		expect(emptyMeets({ type: 7 })).toBe(false);
		expect(emptyMeets({ required: 'id' })).toBe(false);
		expect(emptyMeets({ minProperties: '1' })).toBe(false);
		expect(emptyMeets({ allOf: [] })).toBe(false);
		expect(emptyMeets({ oneOf: {} })).toBe(false);
		expect(emptyMeets(null)).toBe(false);
		expect(emptyMeets([])).toBe(false);
	});
});
