/**
 * The input-schema rule against the kernel's validator and a reference (documents specification, Follow-ups,
 * 2026-11-09): for each construct, the kernel's parse, `z.fromJSONSchema(schema).safeParse(input)` as
 * `apps/definitions.ts` runs it, beside Ajv's draft 2020-12 validator. A schema the rule accepts gets the same
 * answer from both on every input; a schema it refuses gets a different one on at least one, so each refusal
 * is needed. The few inputs where an accepted schema still differs are pinned at the end, and recorded there.
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { coreRules, inputSchemaProblem, needsInput } from './core-rules.js';
import { documentRules } from './document-rules.js';
import { needsInputShape } from './needs-input.js';
import { unfaithful } from './schema-fidelity.js';

type Validate = (input: unknown) => boolean;

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const AjvDraft7 = require('ajv').default;
// `multipleOfPrecision`: a multiple of 0.1 is one, which plain floating point division misses.
const reference = new Ajv2020({ strict: false, multipleOfPrecision: 12 });
const draft7 = new AjvDraft7({ strict: false });

/** Ajv's answer: `unreadable` for a schema it cannot compile, which no input agrees with, or a throw. */
function referenceOf(schema: object): (input: unknown) => boolean | 'unreadable' | 'throws' {
	try {
		const validate = reference.compile(schema);
		return (input) => {
			try {
				return validate(input);
			} catch {
				return 'throws';
			}
		};
	} catch {
		return () => 'unreadable';
	}
}

/**
 * The spec's reading of a schema whose property is named after a member of `Object.prototype`, which Ajv
 * misreads as Zod does: Ajv's answer once that name is renamed in the schema and the input alike.
 */
function renamed(schema: object, from: string, to: string): Validate {
	const swap = (value: unknown): unknown =>
		JSON.parse(JSON.stringify(value).replaceAll(`"${from}"`, `"${to}"`));
	const validate = reference.compile(swap(schema) as object);
	return (input) => validate(swap(input));
}

/** The kernel's answer: accepted, refused, or a throw, which refuses the call. */
function kernel(schema: object, input: unknown): boolean | 'throws' {
	try {
		return z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(input)
			.success;
	} catch {
		return 'throws';
	}
}

const ab = { a: { type: 'string' }, b: { type: 'string' } };
const PROTO =
	'{"type": "object", "properties": {"__proto__": {"type": "string"}}, "required": ["__proto__"]}';
const CLOSED = {
	type: 'object',
	properties: { a: { type: 'string' } },
	additionalProperties: false,
};
const root = (extra: object = {}) => ({ type: 'object', properties: ab, ...extra });
const property = (v: unknown, extra: object = {}) => ({
	type: 'object',
	properties: { v },
	...extra,
});
const typed = (name: string, extra: object = {}) => ({
	type: 'object',
	properties: { [name]: { type: 'string' } },
	required: [name],
	...extra,
});

/** Inputs every row is read with; a row adds its own. */
const COMMON: unknown[] = [
	{},
	{ a: 'x' },
	{ b: 'y' },
	{ a: 'x', b: 'y' },
	{ a: 1 },
	{ a: 'x', c: 1 },
	{ c: 1 },
	{ v: 'a' },
	{ v: 'bb' },
	{ v: '' },
	{ v: 1 },
	{ v: 1.5 },
	{ v: null },
	{ v: true },
	{ v: {} },
	{ v: { a: 'x' } },
	{ v: { a: 'x', z: 1 } },
	{ v: [] },
	{ v: [1] },
	{ v: [1, 1] },
	{ v: ['a'] },
];

interface Row {
	construct: string;
	schema: object;
	/** The keyword the rule names, or null when it accepts the schema. */
	refused: string | null;
	inputs?: unknown[];
	/** The reference for a schema that declares another draft, or reads a format. */
	validator?: Validate;
}

/** The table's size, so a report of it can be checked. */
const ACCEPTED = 46;
const REFUSED = 74;

const TABLE: Row[] = [
	// `required` and `minProperties` in branches: the follow-up itself.
	{ construct: 'required at the root', schema: root({ required: ['a'] }), refused: null },
	{
		construct: 'required in anyOf branches with no type',
		schema: root({ anyOf: [{ required: ['a'] }, { required: ['b'] }] }),
		refused: 'required',
	},
	{
		construct: 'required in anyOf branches with their type',
		schema: root({ anyOf: [typed('a'), typed('b')] }),
		refused: null,
	},
	{
		construct: 'required in oneOf branches with no type',
		schema: root({ oneOf: [{ required: ['a'] }, { required: ['b'] }] }),
		refused: 'required',
	},
	{
		construct: 'required in oneOf branches with their type',
		schema: root({ oneOf: [typed('a'), typed('b')] }),
		refused: null,
	},
	{
		construct: 'required in an allOf branch with no type',
		schema: root({ allOf: [{ required: ['a'] }] }),
		refused: 'required',
	},
	{
		construct: 'required in an allOf branch with its type',
		schema: root({ allOf: [typed('a')] }),
		refused: null,
	},
	{
		construct: 'required two levels down with no type',
		schema: root({ allOf: [{ anyOf: [{ required: ['a'] }] }] }),
		refused: 'required',
	},
	{
		construct: 'required in a nested object anyOf with no type',
		schema: property({ type: 'object', properties: ab, anyOf: [{ required: ['a'] }] }),
		refused: 'required',
	},
	{ construct: 'minProperties at the root', schema: root({ minProperties: 1 }), refused: null },
	{
		construct: 'minProperties in an allOf branch with no type',
		schema: root({ allOf: [{ minProperties: 1 }] }),
		refused: 'minProperties',
	},
	{
		construct: 'minProperties in anyOf branches with no type',
		schema: root({ anyOf: [{ minProperties: 1 }, { minProperties: 2 }] }),
		refused: 'minProperties',
	},
	{
		construct: 'minProperties in an allOf branch with its type',
		schema: root({ allOf: [{ type: 'object', minProperties: 1 }] }),
		refused: null,
	},
	// The rest of an object's keywords in a branch with no type.
	{
		construct: 'maxProperties in an allOf branch with no type',
		schema: root({ allOf: [{ maxProperties: 1 }] }),
		refused: 'maxProperties',
	},
	{
		construct: 'properties in an allOf branch with no type',
		schema: root({ allOf: [{ properties: { a: { const: 'x' } } }] }),
		refused: 'properties',
		inputs: [{ a: 'y' }],
	},
	{
		construct: 'properties in oneOf branches with no type',
		schema: root({
			oneOf: [{ properties: { a: { const: 'x' } } }, { properties: { a: { const: 'y' } } }],
		}),
		refused: 'properties',
	},
	{
		construct: 'properties in oneOf branches with their type: a discriminator',
		schema: root({
			oneOf: [
				{ type: 'object', properties: { a: { const: 'x' } }, required: ['a'] },
				{ type: 'object', properties: { a: { const: 'y' } }, required: ['a'] },
			],
		}),
		refused: null,
		inputs: [{ a: 'y' }, { a: 'z' }],
	},
	{
		construct: 'additionalProperties false in an allOf branch with no type',
		schema: root({ allOf: [{ additionalProperties: false }] }),
		refused: 'additionalProperties',
	},
	{
		construct: 'patternProperties in an allOf branch with no type',
		schema: root({ allOf: [{ patternProperties: { '^x': { type: 'number' } } }] }),
		refused: 'patternProperties',
		inputs: [{ x1: 'q' }],
	},
	{
		construct: 'propertyNames in an allOf branch with no type',
		schema: root({ allOf: [{ propertyNames: { maxLength: 1 } }] }),
		refused: 'propertyNames',
		inputs: [{ ab: 1 }],
	},
	// Other types' keywords with no type.
	{
		construct: 'minLength with no type',
		schema: property({ minLength: 2 }),
		refused: 'minLength',
	},
	{ construct: 'minimum with no type', schema: property({ minimum: 2 }), refused: 'minimum' },
	{
		construct: 'contains with no type',
		schema: property({ contains: { const: 1 } }),
		refused: 'contains',
	},
	{
		construct: 'items with no type',
		schema: property({ items: { type: 'string' } }),
		refused: 'items',
	},
	{
		construct: 'a type list with its keywords',
		schema: property({ type: ['string', 'null'], minLength: 2 }),
		refused: null,
	},
	// `required` that Zod does not apply.
	{
		construct: 'required naming a property properties lacks',
		schema: { type: 'object', required: ['a'] },
		refused: 'required',
	},
	{
		construct: 'required naming a property with a default',
		schema: root({ properties: { a: { type: 'string', default: 'd' } }, required: ['a'] }),
		refused: 'required',
	},
	{
		construct: 'a default on an optional property',
		schema: root({ properties: { a: { type: 'string', default: 'd' } } }),
		refused: null,
	},
	{
		construct: 'a default in a branch, against the root',
		schema: root({
			properties: { a: { type: 'string', default: 'x' } },
			allOf: [{ type: 'object', properties: { a: { type: 'string', default: 'y' } } }],
		}),
		refused: 'default',
	},
	{
		construct: 'a default in $defs, through $ref, on a required property',
		schema: {
			type: 'object',
			$defs: { s: { type: 'string', default: 'x' } },
			properties: { a: { $ref: '#/$defs/s' } },
			required: ['a'],
		},
		refused: 'default',
	},
	// Key rules inside an intersection.
	{
		construct: 'additionalProperties false at the root',
		schema: root({ additionalProperties: false }),
		refused: null,
	},
	{
		construct: 'additionalProperties false beside anyOf',
		schema: root({ additionalProperties: false, anyOf: [typed('a')] }),
		refused: 'additionalProperties',
	},
	{
		construct: 'additionalProperties false beside oneOf',
		schema: root({ additionalProperties: false, oneOf: [typed('a'), typed('b')] }),
		refused: 'additionalProperties',
	},
	{
		construct: 'additionalProperties false beside allOf',
		schema: root({ additionalProperties: false, allOf: [{ type: 'object' }] }),
		refused: 'additionalProperties',
	},
	{
		construct: 'additionalProperties false in a typed allOf branch',
		schema: root({ allOf: [{ ...typed('a'), additionalProperties: false }] }),
		refused: 'additionalProperties',
		inputs: [{ a: 'x', b: 'y' }],
	},
	{
		construct: 'additionalProperties false in an anyOf branch beside type',
		schema: root({ anyOf: [{ ...typed('a'), additionalProperties: false }] }),
		refused: 'additionalProperties',
	},
	{
		construct: 'additionalProperties false in the options of an anyOf with no type',
		schema: property({
			anyOf: [
				{ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false },
				{ type: 'string' },
			],
		}),
		refused: null,
	},
	{
		construct: 'additionalProperties false on an object nested in a branch',
		schema: root({
			allOf: [
				{
					type: 'object',
					properties: {
						v: { type: 'object', properties: ab, additionalProperties: false },
					},
				},
			],
		}),
		refused: null,
	},
	{
		construct: 'propertyNames at the root',
		schema: root({ propertyNames: { maxLength: 1 } }),
		refused: null,
		inputs: [{ ab: 1 }],
	},
	{
		construct: 'propertyNames beside allOf',
		schema: root({ propertyNames: { maxLength: 1 }, allOf: [{ type: 'object' }] }),
		refused: 'propertyNames',
		inputs: [{ ab: 1 }],
	},
	{
		construct: 'patternProperties with additionalProperties false',
		schema: root({ patternProperties: { '^x': { type: 'number' } }, additionalProperties: false }),
		refused: null,
		inputs: [{ x1: 1 }, { x1: 'q' }, { y: 1 }],
	},
	{
		construct: 'patternProperties with an additionalProperties schema',
		schema: root({
			patternProperties: { '^x': { type: 'number' } },
			additionalProperties: { type: 'number' },
		}),
		refused: 'additionalProperties',
	},
	{
		construct: 'an additionalProperties schema alone',
		schema: root({ additionalProperties: { type: 'number' } }),
		refused: null,
	},
	// `$ref`, `enum` and `const`, which Zod reads alone.
	{
		construct: '$ref',
		schema: {
			type: 'object',
			$defs: { s: { type: 'string', minLength: 2 } },
			properties: { v: { $ref: '#/$defs/s' } },
		},
		refused: null,
	},
	{
		construct: '$ref to the root',
		schema: { type: 'object', properties: { v: { $ref: '#' }, a: { type: 'string' } } },
		refused: null,
		inputs: [{ v: { v: { a: 1 } } }, { v: { v: { a: 'x' } } }],
	},
	{
		construct: '$ref beside maxLength',
		schema: {
			type: 'object',
			$defs: { s: { type: 'string' } },
			properties: { v: { $ref: '#/$defs/s', maxLength: 1 } },
		},
		refused: 'maxLength',
	},
	{
		construct: '$ref beside type',
		schema: {
			type: 'object',
			$defs: { s: { type: 'string' } },
			properties: { v: { $ref: '#/$defs/s', type: 'number' } },
		},
		refused: 'type',
	},
	{
		construct: '$ref beside anyOf',
		schema: {
			type: 'object',
			$defs: { s: { type: 'string' } },
			properties: { v: { $ref: '#/$defs/s', anyOf: [{ type: 'string' }, { type: 'number' }] } },
		},
		refused: 'anyOf',
	},
	{
		construct: 'enum of strings with their type',
		schema: property({ type: 'string', enum: ['a', 'bb'] }),
		refused: null,
	},
	{
		construct: 'enum with null and a type list',
		schema: property({ type: ['string', 'null'], enum: ['a', null] }),
		refused: null,
	},
	{
		construct: 'anyOf of const strings',
		schema: property({ anyOf: [{ const: 'a' }, { const: 'bb' }] }),
		refused: null,
	},
	{
		construct: 'oneOf of const strings',
		schema: property({ oneOf: [{ const: 'a' }, { const: 'bb' }] }),
		refused: null,
	},
	{
		construct: 'enum beside minLength',
		schema: property({ type: 'string', enum: ['a', 'bb'], minLength: 2 }),
		refused: 'minLength',
	},
	{
		construct: 'enum with a value its type refuses',
		schema: property({ type: 'string', enum: ['a', 1] }),
		refused: 'enum',
	},
	{
		construct: 'enum with a fraction under integer',
		schema: property({ type: 'integer', enum: [1, 1.5] }),
		refused: 'enum',
	},
	{
		construct: 'enum with an integer under number',
		schema: property({ type: 'number', enum: [1, 1.5] }),
		refused: null,
	},
	{
		construct: 'enum beside const',
		schema: property({ enum: ['a', 'bb'], const: 'a' }),
		refused: 'const',
	},
	{
		construct: 'enum of an object',
		schema: property({ enum: [{ a: 'x' }] }),
		refused: 'enum',
		inputs: [{ v: { a: 'x' } }],
	},
	{
		construct: 'const of an array',
		schema: property({ const: [1] }),
		refused: 'const',
	},
	{
		construct: 'const of an object at the root',
		schema: { type: 'object', const: { a: 'x' } },
		refused: 'const',
	},
	// Composition with no type.
	{
		construct: 'anyOf and oneOf with no type',
		schema: property({
			anyOf: [{ type: 'string' }, { type: 'number' }],
			oneOf: [{ type: 'number' }, { type: 'boolean' }],
		}),
		refused: 'oneOf',
	},
	{
		construct: 'anyOf and oneOf beside type',
		schema: property({
			type: ['string', 'number'],
			anyOf: [{ type: 'string' }, { type: 'number' }],
			oneOf: [{ type: 'number' }, { type: 'string', minLength: 2 }],
		}),
		refused: null,
	},
	{
		construct: 'anyOf of typed options',
		schema: property({
			anyOf: [
				{ type: 'string', minLength: 2 },
				{ type: 'number', minimum: 3 },
			],
		}),
		refused: null,
	},
	// Keywords Zod reads its own way, or not at all.
	{
		construct: 'format',
		schema: property({ type: 'string', format: 'email' }),
		refused: 'format',
		inputs: [{ v: 'x@y.z' }, { v: 'nope' }],
		validator: (() => {
			const strict = new Ajv2020({ strict: false });
			strict.addFormat('email', /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
			return (input: unknown) =>
				strict.validate(property({ type: 'string', format: 'email' }), input);
		})(),
	},
	{
		construct: 'nullable, from OpenAPI',
		schema: property({ type: 'string', nullable: true }),
		refused: 'nullable',
	},
	{
		construct: '$dynamicRef',
		schema: {
			type: 'object',
			$defs: { s: { $dynamicAnchor: 's', type: 'number' } },
			properties: { v: { $dynamicRef: '#s' } },
		},
		refused: '$dynamicRef',
	},
	{
		construct: '$id below the root',
		schema: {
			type: 'object',
			$defs: { s: { type: 'string' } },
			properties: {
				v: {
					$id: 'https://example.test/v',
					$defs: { s: { type: 'number' } },
					type: 'object',
					properties: { w: { $ref: '#/$defs/s' } },
				},
			},
		},
		refused: '$id',
		inputs: [{ v: { w: 1 } }, { v: { w: 's' } }],
	},
	{
		construct: '$schema of draft 7',
		schema: {
			$schema: 'http://json-schema.org/draft-07/schema#',
			type: 'object',
			properties: ab,
			dependencies: { a: ['b'] },
		},
		refused: '$schema',
		validator: (input) =>
			draft7.validate(
				{
					$schema: 'http://json-schema.org/draft-07/schema#',
					type: 'object',
					properties: ab,
					dependencies: { a: ['b'] },
				},
				input
			),
	},
	{
		construct: '$schema of 2020-12',
		schema: root({ $schema: 'https://json-schema.org/draft/2020-12/schema' }),
		refused: null,
	},
	{
		construct: 'pattern',
		schema: property({ type: 'string', pattern: '^[a-z]+$' }),
		refused: null,
	},
	{
		construct: 'pattern with a Unicode property escape',
		schema: property({ type: 'string', pattern: '^\\p{L}+$' }),
		refused: 'pattern',
		inputs: [{ v: 'é' }, { v: 'p{L}' }],
	},
	// What Zod reads as JSON Schema does.
	{
		construct: 'string lengths',
		schema: property({ type: 'string', minLength: 1, maxLength: 2 }),
		refused: null,
		inputs: [{ v: '😀' }, { v: '😀😀😀' }],
	},
	{
		construct: 'number bounds and multipleOf',
		schema: property({ type: 'number', exclusiveMinimum: 0, maximum: 10, multipleOf: 0.5 }),
		refused: null,
		inputs: [{ v: 0 }, { v: 10 }, { v: 10.5 }, { v: 0.5 }, { v: 0.3 }],
	},
	{ construct: 'integer', schema: property({ type: 'integer' }), refused: null },
	{
		construct: 'array keywords',
		schema: property({
			type: 'array',
			items: { type: 'number' },
			minItems: 1,
			maxItems: 2,
			uniqueItems: true,
			contains: { const: 1 },
		}),
		refused: null,
		inputs: [{ v: [2] }, { v: [1, 2, 3] }],
	},
	{
		construct: 'prefixItems with items false',
		schema: property({
			type: 'array',
			prefixItems: [{ type: 'number' }, { type: 'string' }],
			items: false,
		}),
		refused: null,
		inputs: [{ v: [1, 'a'] }, { v: [1, 'a', 2] }, { v: ['a'] }],
	},
	{
		construct: 'minContains and maxContains',
		schema: property({ type: 'array', contains: { const: 1 }, minContains: 2, maxContains: 2 }),
		refused: null,
		inputs: [{ v: [1, 1, 1] }],
	},
	{ construct: 'a false property', schema: property(false), refused: null },
	{
		construct: 'not {} at the root',
		schema: root({ not: {} }),
		refused: null,
	},
	{
		construct: 'oneOf whose branches {} both meets',
		schema: root({ oneOf: [{ type: 'object' }, { type: 'object' }] }),
		refused: null,
	},
	// The independent review of 2026-11-09.
	{
		construct: 'minItems with no items',
		schema: property({ type: 'array', minItems: 1 }),
		refused: 'minItems',
	},
	{
		construct: 'maxItems with no items',
		schema: property({ type: 'array', maxItems: 1 }),
		refused: 'maxItems',
		inputs: [{ v: [1, 2] }],
	},
	{
		construct: 'minItems and maxItems with items true',
		schema: property({ type: 'array', items: true, minItems: 1, maxItems: 2 }),
		refused: null,
		inputs: [{ v: [1, 2, 3] }],
	},
	{
		construct: 'minItems with prefixItems',
		schema: property({ type: 'array', prefixItems: [{ type: 'number' }], minItems: 1 }),
		refused: null,
		inputs: [{ v: [1, 'a'] }],
	},
	{
		construct: 'a default in prefixItems',
		schema: property({
			type: 'array',
			prefixItems: [{ type: 'number', default: 1 }],
			minItems: 1,
		}),
		refused: 'default',
	},
	{
		construct: 'a patternProperties key with a property escape, closed',
		schema: {
			type: 'object',
			patternProperties: { '^\\p{L}$': { type: 'number' } },
			additionalProperties: false,
		},
		refused: 'patternProperties',
		inputs: [{ é: 1 }, { 'p{L}': 1 }],
	},
	{
		construct: 'a patternProperties key with a property escape, open',
		schema: { type: 'object', patternProperties: { '^\\p{L}$': { type: 'number' } } },
		refused: 'patternProperties',
		inputs: [{ é: 's' }, { 'p{L}': 's' }],
	},
	{
		construct: 'a patternProperties key, open',
		schema: { type: 'object', patternProperties: { '^x': { type: 'number' } } },
		refused: null,
		inputs: [{ x1: 1 }, { x1: 's' }, { y: 's' }],
	},
	{
		construct: 'a pattern with a character beyond U+FFFF in a class',
		schema: property({ type: 'string', pattern: '^[😀]$' }),
		refused: 'pattern',
		inputs: [{ v: '😀' }],
	},
	{
		construct: 'a pattern quantifying a character beyond U+FFFF',
		schema: property({ type: 'string', pattern: '^😀+$' }),
		refused: 'pattern',
		inputs: [{ v: '😀😀' }],
	},
	{
		construct: 'a pattern with surrogate escapes in a class',
		schema: property({ type: 'string', pattern: '^[\\uD83D\\uDE00]$' }),
		refused: 'pattern',
		inputs: [{ v: '😀' }],
	},
	{
		construct: '$ref below an entry of $defs',
		schema: {
			type: 'object',
			$defs: { a: { type: 'object', properties: { b: { type: 'number' } } } },
			properties: { v: { $ref: '#/$defs/a/properties/b' } },
		},
		refused: '$ref',
	},
	{
		construct: '$ref to #/$defs with only definitions at the root, which Ajv cannot resolve',
		schema: {
			type: 'object',
			definitions: { a: { type: 'number' } },
			properties: { v: { $ref: '#/$defs/a' } },
		},
		refused: '$ref',
	},
	{
		construct: '$ref cycle with nothing between, which Ajv cannot compile either',
		schema: {
			type: 'object',
			$defs: { a: { $ref: '#/$defs/b' }, b: { $ref: '#/$defs/a' } },
			properties: { v: { $ref: '#/$defs/a' } },
		},
		refused: '$ref',
	},
	{
		construct: '$ref cycle through a branch, which Ajv cannot compile either',
		schema: {
			type: 'object',
			$defs: {
				a: { anyOf: [{ $ref: '#/$defs/b' }, { type: 'string' }] },
				b: { $ref: '#/$defs/a' },
			},
			properties: { v: { $ref: '#/$defs/a' } },
		},
		refused: '$ref',
	},
	{
		construct: '$ref cycle through an object',
		schema: {
			type: 'object',
			$defs: {
				node: {
					type: 'object',
					properties: { next: { $ref: '#/$defs/node' }, n: { type: 'number' } },
				},
			},
			properties: { v: { $ref: '#/$defs/node' } },
		},
		refused: null,
		inputs: [{ v: { next: { n: 'x' } } }, { v: { next: { n: 1 } } }],
	},
	{
		construct: 'propertyNames holding a $ref',
		schema: {
			type: 'object',
			$defs: { k: { type: 'string', maxLength: 1 } },
			propertyNames: { $ref: '#/$defs/k' },
		},
		refused: null,
		inputs: [{ ab: 1 }],
	},
	{
		construct: 'a default at the root, reached through $ref',
		schema: {
			type: 'object',
			properties: { a: { type: 'string' }, child: { $ref: '#' } },
			required: ['a', 'child'],
			default: { a: 'x' },
		},
		refused: 'default',
	},
	// Found by the committed fuzz: where Zod lets a value go missing.
	{
		construct: 'a required property whose branches let it go missing',
		schema: {
			type: 'object',
			properties: { a: { anyOf: [{}, { type: 'array', uniqueItems: true }] } },
			required: ['a'],
		},
		refused: 'required',
	},
	{
		construct: 'a required property with a branch that accepts anything, beside a typed one',
		schema: {
			type: 'object',
			properties: { a: { anyOf: [{ type: 'string' }, {}] } },
			required: ['a'],
		},
		refused: null,
	},
	{
		construct: 'a required property with two branches that accept anything, in oneOf',
		schema: {
			type: 'object',
			properties: { a: { oneOf: [{}, true, { type: 'array', uniqueItems: true }] } },
			required: ['a'],
		},
		refused: null,
	},
	{
		construct: 'an optional property whose branches would let it go missing',
		schema: {
			type: 'object',
			properties: { a: { anyOf: [{}, { type: 'array', uniqueItems: true }] } },
		},
		refused: null,
	},
	{
		construct: 'an item that accepts anything among the first minItems',
		schema: property({ type: 'array', prefixItems: [true], minItems: 1 }),
		refused: 'prefixItems',
	},
	{
		construct: 'an item that accepts anything among the first minItems, with items false',
		schema: property({ type: 'array', prefixItems: [true], items: false, minItems: 1 }),
		refused: null,
	},
	{
		construct: 'an optional item among the first minItems, with items false',
		schema: property({
			type: 'array',
			prefixItems: [{ anyOf: [{}, { type: 'array', uniqueItems: true }] }],
			items: false,
			minItems: 1,
		}),
		refused: 'prefixItems',
	},
	{
		construct: 'an item that accepts anything after the first minItems',
		schema: property({ type: 'array', prefixItems: [{ type: 'number' }, true], minItems: 1 }),
		refused: null,
		inputs: [{ v: [1, 'a'] }],
	},
	// The re-check of 2026-11-09: joins through `$ref` and nested branches, cycles through a typed node's
	// branches, and names an object inherits.
	{
		construct: 'allOf naming a closed object through $ref',
		schema: {
			type: 'object',
			properties: { a: { type: 'string' } },
			allOf: [{ $ref: '#/$defs/c' }],
			$defs: { c: CLOSED },
		},
		refused: '$ref',
	},
	{
		construct: 'a closed object through $ref, in no join',
		schema: { type: 'object', properties: { v: { $ref: '#/$defs/c' } }, $defs: { c: CLOSED } },
		refused: null,
		inputs: [{ v: { a: 'x', z: 1 } }],
	},
	{
		construct: 'a closed object in a nested anyOf beside type',
		schema: { type: 'object', properties: { a: { type: 'string' } }, anyOf: [{ anyOf: [CLOSED] }] },
		refused: 'additionalProperties',
	},
	{
		construct: 'a closed object in an anyOf inside allOf',
		schema: { type: 'object', properties: { a: { type: 'string' } }, allOf: [{ anyOf: [CLOSED] }] },
		refused: 'additionalProperties',
	},
	{
		construct: 'propertyNames in an anyOf inside allOf',
		schema: {
			type: 'object',
			properties: { a: { type: 'string' } },
			allOf: [
				{
					anyOf: [
						{
							type: 'object',
							properties: { a: { type: 'string' } },
							propertyNames: { maxLength: 1 },
						},
					],
				},
			],
		},
		refused: 'propertyNames',
		inputs: [{ a: 'x', ab: 1 }],
	},
	{
		construct: 'a property of an object type with a closed object in a nested anyOf',
		schema: property({ type: 'object', anyOf: [{ anyOf: [CLOSED] }] }),
		refused: 'additionalProperties',
	},
	{
		construct: '$ref to the root in allOf beside type',
		schema: { type: 'object', allOf: [{ $ref: '#' }] },
		refused: '$ref',
	},
	{
		construct: '$ref to the root in anyOf beside type',
		schema: { type: 'object', anyOf: [{ $ref: '#' }] },
		refused: '$ref',
	},
	{
		construct: '$ref to the root in oneOf beside type',
		schema: { type: 'object', oneOf: [{ $ref: '#' }] },
		refused: '$ref',
	},
	{
		construct: '$ref cycle through a typed entry of $defs',
		schema: {
			type: 'object',
			$defs: { a: { type: 'string', anyOf: [{ $ref: '#/$defs/a' }] } },
			properties: { v: { $ref: '#/$defs/a' } },
		},
		refused: '$ref',
	},
	{
		construct: 'a property named after an inherited member, read by the spec',
		schema: {
			type: 'object',
			properties: { constructor: { type: 'string' }, x: { type: 'number' } },
		},
		refused: 'properties',
		inputs: [{ x: 1 }],
		validator: renamed(
			{ type: 'object', properties: { constructor: { type: 'string' }, x: { type: 'number' } } },
			'constructor',
			'renamed'
		),
	},
	{
		construct: 'a required property named after an inherited member, read by the spec',
		schema: { type: 'object', properties: { constructor: {} }, required: ['constructor'] },
		refused: 'properties',
		validator: renamed(
			{ type: 'object', properties: { constructor: {} }, required: ['constructor'] },
			'constructor',
			'renamed'
		),
	},
	{
		// Only `JSON.parse` makes an own `__proto__` key; an object literal sets the prototype instead.
		construct: 'a required property named __proto__, read by the spec',
		schema: JSON.parse(PROTO),
		refused: 'properties',
		inputs: [JSON.parse('{"__proto__": 1}'), JSON.parse('{"__proto__": "s"}')],
		validator: renamed(JSON.parse(PROTO), '__proto__', 'renamed'),
	},
	{
		construct: 'two branch keywords with no type on a required property',
		schema: {
			type: 'object',
			properties: {
				a: { anyOf: [{ type: 'string' }], oneOf: [{ type: 'number' }, { type: 'string' }] },
			},
			required: ['a'],
		},
		refused: 'oneOf',
		inputs: [{ a: 1 }],
	},
];

describe('the input-schema rule against the kernel and a reference', () => {
	it.each(TABLE)('$construct', ({ schema, refused, inputs = [], validator }) => {
		const [problem, remedy] = inputSchemaProblem(schema) ?? [];
		const answer = validator ?? referenceOf(schema);
		const rows = [...COMMON, ...inputs].map((input) => ({
			input,
			kernel: kernel(schema, input),
			reference: answer(input),
		}));
		const differ = rows.filter((row) => row.kernel !== row.reference || row.kernel === 'throws');
		if (refused === null) {
			expect(problem).toBeUndefined();
			expect(differ).toEqual([]);
		} else {
			expect(problem).toContain(`\`${refused}\``);
			// Each refusal says how to restructure, in its own words.
			expect(remedy).toMatch(/^[A-Z].+\.$/);
			// A different answer, or a parse that throws, which refuses every call.
			expect(differ.length, 'a refusal the kernel would not need').toBeGreaterThan(0);
		}
	});

	it('counts its rows', () => {
		expect(TABLE.filter((row) => row.refused === null).length).toBe(ACCEPTED);
		expect(TABLE.filter((row) => row.refused !== null).length).toBe(REFUSED);
	});

	it("keeps first paint's needs-input answer with the kernel on every schema it accepts", () => {
		const accepted = [
			...TABLE.filter((row) => row.refused === null).map((row) => row.schema),
			root({ anyOf: [typed('a'), { anyOf: [typed('b')] }] }),
			root({ oneOf: [typed('a'), { type: 'object' }] }),
			root({ allOf: [{ type: 'object', allOf: [typed('a')] }] }),
			root({ anyOf: [typed('a'), { type: 'object', minProperties: 1 }] }),
		];
		for (const schema of accepted) {
			expect(inputSchemaProblem(schema)).toBeUndefined();
			const refusesEmpty = kernel(schema, {}) !== true;
			// The shape never says input is needed when the kernel takes `{}`; the rule's parse adds the rest.
			if (needsInputShape(schema)) expect(refusesEmpty, JSON.stringify(schema)).toBe(true);
			expect(needsInput(schema), JSON.stringify(schema)).toBe(refusesEmpty);
		}
	});

	it('gives its remedy as the suggestion of a command, a pipeline, a content schema and a config', () => {
		const untyped = root({ anyOf: [{ required: ['a'] }] });
		const { refusals } = coreRules({
			plugin: { id: 'x', kind: 'native', domains: ['x'] },
			commands: [{ name: 'x-run', input_schema: untyped }],
			pipelines: [{ name: 'x-flow', input_schema: untyped, steps: [] }],
			config: { schema: { ...untyped, additionalProperties: false } },
		} as Parameters<typeof coreRules>[0]);
		const of = (pointer: string) => refusals.find((refusal) => refusal.pointer === pointer);
		const remedy = (unfaithful(untyped) as [string, string])[1];
		expect(of('/commands/0/input_schema')?.suggestion).toBe(remedy);
		expect(of('/pipelines/0/input_schema')?.suggestion).toBe(remedy);
		expect(of('/config/schema')?.suggestion).toContain("Declare every branch's properties");
		const content: { pointer: string; suggestion: string }[] = [];
		documentRules(
			{
				plugin: { id: 'x', kind: 'native' },
				ui: {
					documents: [
						{
							id: 'x',
							content_schema: untyped,
							binding: { model: 'command', selection: 'none', locator: 'none' },
							templates: [],
							instance_commands: [],
						},
					],
				},
			} as unknown as Parameters<typeof documentRules>[0],
			(_code, pointer, _message, suggestion) => {
				content.push({ pointer, suggestion });
			},
			() => {}
		);
		expect(
			content.find((refusal) => refusal.pointer === '/ui/documents/0/content_schema')?.suggestion
		).toBe(remedy);
		// A refusal the rule has no remedy for keeps the site's own suggestion.
		const plain = coreRules({
			plugin: { id: 'x', kind: 'native', domains: ['x'] },
			commands: [{ name: 'x-run', input_schema: { type: 'string' } }],
		} as Parameters<typeof coreRules>[0]);
		expect(plain.refusals[0]?.suggestion).toContain('type: object');
	});

	it("says a required property's two branch keywords before it says the property can go missing", () => {
		const schema = {
			type: 'object',
			properties: { a: { anyOf: [{}, { type: 'array', uniqueItems: true }], oneOf: [{}, true] } },
			required: ['a'],
		};
		expect(unfaithful(schema)?.[0]).toBe(
			'`oneOf` at `/properties/a`, which replaces the `anyOf` beside it, as Zod keeps one branch keyword where there is no `type`'
		);
	});

	it('names the place of what it refuses', () => {
		expect(inputSchemaProblem(root({ anyOf: [typed('a'), { required: ['b'] }] }))).toEqual([
			'`required` at `/anyOf/1`, which Zod ignores with no `type` beside it',
			'Give this branch `type: object` beside `required`, or require top-level properties told apart by an `enum`.',
		]);
		expect(
			unfaithful(property({ type: 'object', properties: { 'a/b': { minLength: 1 } } }))?.[0]
		).toContain('at `/properties/v/properties/a~1b`');
		// A pattern only a reading without the `u` flag compiles, which Ajv cannot compile at all.
		expect(unfaithful(property({ type: 'string', pattern: 'a\\-b' }))?.[0]).toContain('`pattern`');
		expect(unfaithful(root({ required: ['z'] }))).toEqual([
			'`required` at `/`, which names `z`, a property `properties` does not declare, so Zod does not require it',
			'Declare `z` in `properties`, or remove it from `required`.',
		]);
		expect(unfaithful(property({ minLength: 1 }))?.[1]).toBe(
			'Give this subschema the `type` that `minLength` constrains.'
		);
	});

	it('accepts the shipped apps’ schemas', async () => {
		const { readdirSync, readFileSync } = await import('node:fs');
		const { join } = await import('node:path');
		const apps = new URL('../../../apps/', import.meta.url).pathname;
		const files = readdirSync(apps).flatMap((app) => {
			const dir = join(apps, app, 'schemas');
			try {
				return readdirSync(dir).map((name) => join(dir, name));
			} catch {
				return [];
			}
		});
		expect(files.length).toBeGreaterThan(8);
		for (const file of files) {
			expect(unfaithful(JSON.parse(readFileSync(file, 'utf8'))), file).toBeUndefined();
		}
	});
});

/**
 * Accepted schemas that still differ on these inputs. Each is narrow, and recorded in the documents
 * specification's Follow-ups: the rule cannot refuse `pattern` or `integer`, and the fix is the kernel's.
 */
describe('known differences, pinned', () => {
	it('`.` in a pattern meets half of an astral character, with no `u` flag', () => {
		const schema = property({ type: 'string', pattern: '^.$' });
		expect(inputSchemaProblem(schema)).toBeUndefined();
		expect(kernel(schema, { v: '😀' })).toBe(false);
		expect(reference.validate(schema, { v: '😀' })).toBe(true);
	});

	it('`\\S` and `[^a]` meet half of an astral character, with no `u` flag', () => {
		for (const pattern of ['^\\S$', '^[^a]$']) {
			const schema = property({ type: 'string', pattern });
			expect(inputSchemaProblem(schema)).toBeUndefined();
			expect(kernel(schema, { v: '😀' })).toBe(false);
			expect(reference.validate(schema, { v: '😀' })).toBe(true);
		}
	});

	it('an integer above 2^53 is refused, which JSON numbers cannot carry exactly anyway', () => {
		const schema = property({ type: 'integer' });
		expect(kernel(schema, { v: 2 ** 60 })).toBe(false);
		expect(reference.validate(schema, { v: 2 ** 60 })).toBe(true);
	});
});
