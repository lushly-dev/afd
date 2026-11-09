/**
 * The input-schema rule over generated schemas (the independent review of 2026-11-09): from a fixed seed,
 * schemas built from the constructs the rule reads, `$defs` and `$ref`, `prefixItems`, `items: false`,
 * `minItems` and `maxItems`, `uniqueItems`, `const` with `type`, `multipleOf`, `exclusiveMinimum`, branches,
 * and some Zod refuses outright, `dependentSchemas` and `unevaluatedProperties`. Every schema the rule accepts
 * must get the same answer from the kernel's parse and from Ajv on every input: some sampled to meet it,
 * some drawn at random. `schema-fidelity.test.ts` holds the table; this holds what a table misses.
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { inputSchemaProblem } from './core-rules.js';

type Json = Record<string, unknown>;

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
// `multipleOfPrecision`: 0.3 is a multiple of 0.1, which Zod knows and plain floating point division misses.
const reference = new Ajv2020({ strict: false, multipleOfPrecision: 12 });

const SEED = Number(process.env.FUZZ_SEED ?? 0x5eed845);
const SCHEMAS = Number(process.env.FUZZ_SCHEMAS ?? 1_500);
const INPUTS = 12;

/** mulberry32: a small generator, so a failure names its seed and repeats. */
function generator(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

const random = generator(SEED);
const chance = (p: number): boolean => random() < p;
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const some = <T>(items: readonly T[], at = 0): T[] => items.filter(() => chance(0.5)).slice(at);

const NAMES = ['a', 'b', 'c', 'ab', 'x1'];
// Patterns that mean the same with and without the `u` flag on these strings; `.` and `\S` alone do not.
const PATTERNS = ['^[a-z]+$', '^a', 'b$', '^[^0-9]*$', '^x'];
const STRINGS = ['', 'a', 'b', 'bb', 'ab', 'xyz', '9', '😀', 'x1'];
const NUMBERS = [0, 1, 2, 3, -1, 0.5, 1.5, 2.5, 6, 10, 0.3];

function stringSchema(): Json {
	const schema: Json = { type: 'string' };
	if (chance(0.3)) schema.minLength = pick([0, 1, 2]);
	if (chance(0.3)) schema.maxLength = pick([1, 2, 3]);
	if (chance(0.25)) schema.pattern = pick(PATTERNS);
	if (chance(0.15)) schema.enum = some(STRINGS, 0).concat(pick(STRINGS));
	else if (chance(0.1)) schema.const = pick(STRINGS);
	return schema;
}

function numberSchema(): Json {
	const schema: Json = { type: pick(['number', 'integer']) };
	if (chance(0.3)) schema.minimum = pick([-1, 0, 1]);
	if (chance(0.3)) schema.maximum = pick([2, 3, 10]);
	if (chance(0.25)) schema.exclusiveMinimum = pick([0, 1]);
	if (chance(0.2)) schema.exclusiveMaximum = pick([3, 10]);
	if (chance(0.25)) schema.multipleOf = pick([0.1, 0.5, 2, 3]);
	if (chance(0.1)) schema.const = pick(NUMBERS);
	return schema;
}

/** How many `items` or `prefixItems` the schema being generated sits under. */
let underItems = 0;

function arraySchema(depth: number): Json {
	const schema: Json = { type: 'array' };
	const nested = underItems > 0;
	underItems++;
	if (chance(0.3)) schema.prefixItems = [leaf(depth + 1), leaf(depth + 1)].slice(0, pick([1, 2]));
	if (chance(0.6)) schema.items = chance(0.2) ? pick([false, true]) : leaf(depth + 1);
	underItems--;
	if (chance(0.35)) schema.minItems = pick([0, 1, 2]);
	if (chance(0.3)) schema.maxItems = pick([1, 2, 3]);
	// An item that accepts anything among the first `minItems`, with which Zod pads a short array.
	if (chance(0.1)) {
		underItems++;
		schema.prefixItems = [pick([true, {}]), leaf(depth + 1)];
		underItems--;
		schema.minItems = 1;
		delete schema.maxItems;
	}
	// Kept apart where Ajv 8.20 is wrong and Zod right, each refusing what JSON Schema refuses: beside
	// `prefixItems`, Ajv accepts `[]` against `contains` and `[null, null]` against `uniqueItems`; and under
	// `items` or `prefixItems`, even through an object, it accepts an empty array against `contains` once an
	// earlier item has met it (`items: {type: 'array', contains: {pattern: '^x'}}` accepts `[["xa"], []]`).
	if (!schema.prefixItems && chance(0.2)) schema.uniqueItems = true;
	if (!schema.prefixItems && !nested && chance(0.2)) {
		schema.contains = { const: pick([1, 'a']) };
		if (chance(0.4)) schema.minContains = pick([0, 1, 2]);
		if (chance(0.3)) schema.maxContains = pick([1, 2]);
	}
	return schema;
}

function objectSchema(depth: number, rooted = false): Json {
	const declared = some(NAMES);
	const properties: Json = {};
	for (const name of declared) properties[name] = leaf(depth + 1);
	const schema: Json = { type: 'object', properties };
	if (chance(0.4)) schema.required = some(declared);
	if (chance(0.25)) schema.additionalProperties = chance(0.6) ? false : leaf(depth + 1);
	if (chance(0.15)) schema.patternProperties = { '^x': leaf(depth + 1) };
	if (chance(0.15)) schema.propertyNames = { maxLength: pick([1, 2]) };
	if (chance(0.15)) schema.minProperties = pick([0, 1, 2]);
	if (chance(0.1)) schema.maxProperties = pick([1, 2]);
	if (depth < 2 && chance(0.25)) {
		schema[pick(['anyOf', 'oneOf', 'allOf'])] = [branch(depth), branch(depth)].slice(
			0,
			pick([1, 2])
		);
	}
	// A cycle through a typed node's branches, which the rule refuses and both validators overflow on.
	if (rooted && chance(0.04)) schema[pick(['allOf', 'anyOf', 'oneOf'])] = [{ $ref: '#' }];
	if (rooted && chance(0.08)) schema.dependentSchemas = { a: { required: ['b'] } };
	if (rooted && chance(0.08)) schema.unevaluatedProperties = false;
	if (rooted && chance(0.05)) schema.not = {};
	return schema;
}

/**
 * A branch at an object's place: typed, with what it requires declared beside it; or a closed object reached
 * through `$ref` or nested branches with no `type`, where Zod's join weakens it.
 */
function branch(depth: number): Json {
	if (chance(0.12)) return { $ref: pick(['#/$defs/closed', '#/$defs/named']) };
	if (chance(0.12))
		return { [pick(['anyOf', 'oneOf'])]: [chance(0.5) ? DEFS.closed : branch(depth + 1)] };
	const name = pick(NAMES);
	const shape: Json = { type: 'object', properties: { [name]: leaf(depth + 1) } };
	if (chance(0.6)) shape.required = [name];
	if (chance(0.15)) shape.minProperties = 1;
	return shape;
}

function leaf(depth: number): unknown {
	const kinds = [
		'string',
		'number',
		'boolean',
		'null',
		'list',
		'union',
		'const',
		'ref',
		'any',
		'loose',
	];
	const kind = depth > 2 ? pick(kinds.slice(0, 4)) : pick([...kinds, 'array', 'object']);
	switch (kind) {
		case 'string':
			return stringSchema();
		case 'number':
			return numberSchema();
		case 'boolean':
			return { type: 'boolean' };
		case 'null':
			return { type: 'null' };
		case 'list':
			return { type: ['string', 'null'], ...(chance(0.4) ? { minLength: 1 } : {}) };
		case 'loose':
			// A branch that accepts anything beside one Zod checks apart: Zod lets the value go missing.
			return {
				[pick(['anyOf', 'oneOf'])]: [
					pick([true, {}]),
					pick([
						{ type: 'array', uniqueItems: true },
						{ type: 'object', minProperties: 1 },
					]),
				],
			};
		case 'union':
			return { [pick(['anyOf', 'oneOf'])]: [leaf(depth + 1), leaf(depth + 1)] };
		case 'const':
			return chance(0.5)
				? { const: pick([...STRINGS, ...NUMBERS, true, null]) }
				: { enum: some(STRINGS).concat('a') };
		case 'ref':
			return {
				$ref: pick([
					'#/$defs/word',
					'#/$defs/count',
					'#/$defs/pair',
					'#/$defs/closed',
					'#/$defs/loop',
				]),
			};
		case 'array':
			return arraySchema(depth);
		case 'object':
			return objectSchema(depth);
		default:
			return pick([true, false, {}]);
	}
}

const DEFS = {
	word: { type: 'string', maxLength: 2 },
	count: { type: 'integer', minimum: 0 },
	pair: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], items: false },
	closed: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false },
	named: { type: 'object', properties: { a: { type: 'string' } }, propertyNames: { maxLength: 1 } },
	// A cycle through a typed node's branch.
	loop: { type: 'string', anyOf: [{ $ref: '#/$defs/loop' }] },
};

/** A value meant to meet `schema`, often not quite: the inputs that tell two validators apart. */
function sample(schema: unknown, depth = 0): unknown {
	if (typeof schema !== 'object' || schema === null || depth > 4)
		return pick([...STRINGS, ...NUMBERS]);
	const node = schema as Json;
	if (node.$ref)
		return node.$ref === '#'
			? {}
			: sample(DEFS[(node.$ref as string).slice(8) as keyof typeof DEFS], depth + 1);
	if (node.const !== undefined) return node.const;
	if (Array.isArray(node.enum)) return pick(node.enum);
	for (const key of ['anyOf', 'oneOf', 'allOf']) {
		if (Array.isArray(node[key])) return sample(pick(node[key] as unknown[]), depth + 1);
	}
	const type = Array.isArray(node.type) ? pick(node.type) : node.type;
	switch (type) {
		case 'string':
			return pick(STRINGS);
		case 'number':
		case 'integer':
			return pick(NUMBERS);
		case 'boolean':
			return chance(0.5);
		case 'null':
			return null;
		case 'array': {
			const items = Array.isArray(node.prefixItems)
				? node.prefixItems.map((item) => sample(item, depth + 1))
				: [];
			const more = Array.from({ length: pick([0, 1, 2]) }, () => sample(node.items, depth + 1));
			return chance(0.5) ? [...items, ...more] : items.slice(0, pick([0, 1]));
		}
		case 'object': {
			const value: Json = {};
			const properties = (node.properties ?? {}) as Json;
			const required = (node.required ?? []) as string[];
			for (const [name, child] of Object.entries(properties)) {
				// A required key left out now and then: where Zod lets a value go missing.
				if (required.includes(name) ? chance(0.85) : chance(0.5))
					value[name] = sample(child, depth + 1);
			}
			if (chance(0.25)) value[pick(NAMES)] = pick([...STRINGS, ...NUMBERS]);
			return value;
		}
		default:
			return pick([...STRINGS, ...NUMBERS, null, true, [], {}]);
	}
}

/** Any value at all, shaped like an input. */
function anything(depth = 0): unknown {
	if (depth > 2 || chance(0.4)) return pick([...STRINGS, ...NUMBERS, null, true, false]);
	if (chance(0.3)) return Array.from({ length: pick([0, 1, 2, 3]) }, () => anything(depth + 1));
	const value: Json = {};
	for (const name of some(NAMES)) value[name] = anything(depth + 1);
	return value;
}

function kernel(schema: object, input: unknown): boolean | 'throws' {
	try {
		return z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(input)
			.success;
	} catch {
		return 'throws';
	}
}

describe('the input-schema rule over generated schemas', () => {
	it(
		`agrees with Ajv on every schema it accepts (seed ${SEED.toString(16)})`,
		() => {
			const differences: string[] = [];
			let accepted = 0;
			for (let index = 0; index < SCHEMAS; index++) {
				const schema = objectSchema(0, true);
				// Only the entries it names: an unused `loop` would have the rule refuse every schema holding it.
				const named = Object.keys(DEFS).filter((name) =>
					JSON.stringify(schema).includes(`"#/$defs/${name}"`)
				);
				if (named.length > 0)
					schema.$defs = Object.fromEntries(
						named.map((name) => [name, DEFS[name as keyof typeof DEFS]])
					);
				if (inputSchemaProblem(schema)) continue;
				accepted++;
				let validate: (input: unknown) => boolean;
				try {
					validate = reference.compile(schema);
				} catch (error) {
					differences.push(`Ajv cannot compile ${JSON.stringify(schema)}: ${String(error)}`);
					continue;
				}
				for (let at = 0; at < INPUTS; at++) {
					const input = at % 2 === 0 ? sample(schema) : anything();
					const ours = kernel(schema, input);
					let theirs: boolean | 'throws';
					try {
						theirs = validate(input);
					} catch {
						theirs = 'throws';
					}
					// A parse that throws refuses every call, whatever Ajv makes of it.
					if (ours !== theirs || ours === 'throws')
						differences.push(
							`${JSON.stringify(schema)} ${JSON.stringify(input)}: kernel ${ours}, Ajv ${theirs}`
						);
				}
			}
			expect(differences.slice(0, 3).map((line) => line.slice(0, 2000))).toEqual([]);
			// Enough of what is generated is accepted for the comparison to mean something.
			expect(accepted).toBeGreaterThan(SCHEMAS / 4);
			// A wider run by hand, `FUZZ_SEED=… FUZZ_SCHEMAS=20000`, takes about a millisecond a schema.
		},
		// Generous, as the rest of the suite runs beside it: 1.1 s alone under coverage here, 7.1 s beside
		// two whole-workspace coverage runs (load 16 on ten cores), and over 10 s on a scheduled `ci.yml` run.
		Math.max(120_000, SCHEMAS * 80)
	);
});
