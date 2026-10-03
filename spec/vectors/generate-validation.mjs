// Generates validation.json from the TypeScript reference implementation, so every language can
// check its command input validation against the same expected values (spec/validation.md).
//
//   pnpm -F @lushly-dev/afd-core build && pnpm -F @lushly-dev/afd-server build
//   node spec/vectors/generate-validation.mjs
//   npx biome format --write spec/vectors/validation.json
//
// TypeScript commands declare their input with Zod, so each case is a Zod schema. The file records
// the JSON Schema TypeScript advertises for it (zodToJsonSchema), and for each test the result of
// running the input through the server's execution engine with a handler that returns its input.
// packages/server/src/validation-vectors.test.ts calls validationCases() to check the file against
// the current code.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Tests whose result depends on the length unit when the input has characters outside the BMP. */
const ZOD_BEFORE_4_5 =
	'Zod before 4.5 counts UTF-16 code units, so a command schema built with it gives the other result. @lushly-dev/afd-server requires Zod 4.5 or later.';

const test = (description, input, extra = {}) => ({ description, input, ...extra });
const astral = (description, input) =>
	test(description, input, { exceptions: { typescript: ZOD_BEFORE_4_5 } });

/** Renames `definitions` to `$defs`, which means the same thing in a local reference. */
function toDefs(schema) {
	const text = JSON.stringify(schema).replaceAll('#/definitions/', '#/$defs/');
	const { definitions, ...rest } = JSON.parse(text);
	return { ...rest, $defs: definitions };
}

/**
 * The cases, built with the caller's Zod so the schemas share its classes. `rewrite`, when present,
 * changes the advertised JSON Schema into an equivalent form TypeScript does not emit.
 */
export function validationCases(z) {
	const TodoId = z.string().min(1).meta({ id: 'TodoId' });
	const Node = z.object({
		name: z.string(),
		get children() {
			return z.array(Node).optional();
		},
	});
	const Tree = z.object({
		name: z.string(),
		get children() {
			return z.array(Tree).optional();
		},
	});
	const types = { s: 'x', n: 1.5, i: 3, b: true, o: {}, a: [1, 'x'], nul: null, ns: 'y', sn: 2 };
	const withType = (overrides) => ({ ...types, ...overrides });

	return [
		// ── Unknown keys ─────────────────────────────────────────────────────────────────────
		{
			id: 'unknown-keys-stripped',
			section: 'unknown-keys',
			description:
				'Keys a schema does not declare are removed before middleware and the handler run, at every level.',
			zod: z.object({
				title: z.string(),
				filter: z.object({ tag: z.string() }).optional(),
				items: z.array(z.object({ id: z.number() })).optional(),
			}),
			tests: [
				test('Undeclared top-level keys are removed', { title: 'a', extra: 1, other: { x: 1 } }),
				test('Undeclared keys in nested objects and array items are removed', {
					title: 'a',
					filter: { tag: 't', extra: true },
					items: [{ id: 1, extra: 'x' }],
				}),
				test(
					'On failure, unexpectedFields lists undeclared top-level keys in input order; nested ones are not listed',
					{ zeta: 1, title: 2, alpha: 3, filter: { tag: 't', extra: 1 } }
				),
			],
		},
		{
			id: 'unknown-keys-empty-properties',
			section: 'unknown-keys',
			description: 'An object schema with no properties removes every key.',
			zod: z.object({}),
			tests: [test('Every key is removed', { a: 1, b: { c: 2 } })],
		},
		{
			id: 'additional-properties-false',
			section: 'unknown-keys',
			description:
				'additionalProperties: false rejects undeclared keys with one unrecognized_keys issue per object, reported after the issues of its properties.',
			zod: z.strictObject({
				title: z.string(),
				filter: z.strictObject({ tag: z.string() }).optional(),
			}),
			tests: [
				test('Declared keys only', { title: 'a', filter: { tag: 't' } }),
				test('An undeclared top-level key', { title: 'a', extra: 1 }),
				test('Undeclared nested keys are named in one issue at the object path', {
					title: 'a',
					filter: { tag: 't', b: 1, c: 2 },
				}),
				test('Property issues come before the object issue', { extra: 1, title: 2 }),
			],
		},
		{
			id: 'additional-properties-empty-schema',
			section: 'unknown-keys',
			description: 'additionalProperties: {} keeps undeclared keys.',
			zod: z.looseObject({ title: z.string(), filter: z.looseObject({ tag: z.string() }) }),
			tests: [
				test('Undeclared keys are kept at every level', {
					title: 'a',
					filter: { tag: 't', extra: [1] },
					extra: { x: 1 },
				}),
			],
		},
		{
			id: 'additional-properties-true',
			section: 'unknown-keys',
			description:
				'additionalProperties: true keeps undeclared keys. TypeScript emits {} for this; the case rewrites it to the equivalent true.',
			zod: z.looseObject({ title: z.string() }),
			rewrite: (schema) => ({ ...schema, additionalProperties: true }),
			tests: [test('Undeclared keys are kept', { title: 'a', extra: { x: 1 } })],
		},
		{
			id: 'additional-properties-schema',
			section: 'unknown-keys',
			description:
				'An additionalProperties schema validates each undeclared key, which is kept. unexpectedFields still lists such keys.',
			zod: z.object({ title: z.string() }).catchall(z.number()),
			tests: [
				test('A valid undeclared key is kept', { title: 'a', count: 2 }),
				test('An undeclared key is validated at its own path', { title: 'a', count: 'x' }),
			],
		},

		// ── The VALIDATION_ERROR shape ───────────────────────────────────────────────────────
		{
			id: 'error-shape',
			section: 'error-shape',
			description:
				'The failure: message, details and the suggestion layout. Empty field lists are left out.',
			zod: z.object({
				title: z.string().min(1).describe('Todo title'),
				priority: z.enum(['low', 'medium', 'high']).default('medium'),
				done: z.boolean().optional(),
			}),
			tests: [
				test('Valid input', { title: 'a' }),
				test('One issue: "path: message"', { title: 5 }),
				test('Several issues: one "- path: message" line each', {
					title: '',
					priority: 'urgent',
					done: 'no',
				}),
				test('A missing required field', {}),
				test('Every part of the suggestion', { priority: 'low', extra: 1 }),
				test('Input that is not an object is reported at (root)', []),
			],
		},
		{
			id: 'error-order',
			section: 'error-shape',
			description:
				'Issues follow the order the schema declares its properties, with missing fields in place. Item issues come before the issues of their array.',
			zod: z.object({
				zulu: z.string(),
				alpha: z.number(),
				mike: z.array(z.string()).min(2),
			}),
			tests: [test('Declaration order, not input or alphabetical order', { mike: [1], zulu: 2 })],
		},
		{
			id: 'missing-required',
			section: 'error-shape',
			description:
				'An absent required property is reported as its schema reports a value of the wrong type, with "received undefined".',
			zod: z.object({
				count: z.int(),
				level: z.enum(['low', 'high']),
				label: z.string().nullable(),
				value: z.union([z.string(), z.number()]),
			}),
			tests: [
				test('Present', { count: 1, level: 'low', label: null, value: 'x' }),
				test('Absent: invalid_type with "number" for an integer, invalid_value for an enum', {}),
			],
		},
		{
			id: 'error-paths',
			section: 'error-shape',
			description:
				'A path joins object keys and array indices with dots. Only top-level fields are listed in missingFields.',
			zod: z.object({
				filter: z.object({
					tags: z.array(z.string()),
					range: z.object({ from: z.number() }),
				}),
				items: z.array(z.object({ id: z.number() })),
			}),
			tests: [
				test('Nested paths', {
					filter: { tags: ['a', 2], range: { from: 'x' } },
					items: [{ id: 1 }, { id: 'b' }],
				}),
				test('A missing nested field is reported by path only', {
					filter: { tags: [] },
					items: [],
				}),
			],
		},

		// ── Length units (D3) ────────────────────────────────────────────────────────────────
		{
			id: 'string-length-code-points',
			section: 'length-units',
			description: 'minLength and maxLength count Unicode code points, not UTF-16 code units.',
			zod: z.object({ code: z.string().min(2).max(3) }),
			tests: [
				test('ASCII', { code: 'ab' }),
				astral('U+1F600 is one code point (two UTF-16 units), so it is too short', {
					code: '😀',
				}),
				astral('Two emoji are two code points (four UTF-16 units)', { code: '😀😀' }),
				astral('Three emoji are three code points (six UTF-16 units), which fits', {
					code: '😀😀😀',
				}),
				test('Four emoji are four code points, which is too long', { code: '😀😀😀😀' }),
				test('"a" and one emoji are two code points (three UTF-16 units)', { code: 'a😀' }),
			],
		},
		{
			id: 'string-length-not-graphemes-or-bytes',
			section: 'length-units',
			description: 'Lengths count code points, not grapheme clusters or UTF-8 bytes.',
			zod: z.object({
				one: z.string().max(1).optional(),
				two: z.string().max(2).optional(),
				five: z.string().max(5).optional(),
			}),
			tests: [
				test('U+00E9 is one code point', { one: 'é' }),
				test('"e" and U+0301 COMBINING ACUTE ACCENT are two code points, one grapheme', {
					one: 'é',
				}),
				test('Two CJK characters are two code points (six UTF-8 bytes)', { two: '日本' }),
				test('Three CJK characters are too long', { two: '日本語' }),
				astral(
					'A ZWJ family emoji is five code points (eight UTF-16 units, one grapheme), which fits',
					{ five: '👨‍👩‍👧' }
				),
			],
		},

		// ── Required keywords ────────────────────────────────────────────────────────────────
		{
			id: 'type',
			section: 'keywords',
			description:
				'type, including integer and a list of types. Values are never coerced. A list with "null" reports the other type as expected.',
			zod: z.object({
				s: z.string(),
				n: z.number(),
				i: z.int(),
				b: z.boolean(),
				o: z.object({}),
				a: z.array(z.unknown()),
				nul: z.null(),
				ns: z.string().nullable(),
				sn: z.union([z.string(), z.number()]),
			}),
			tests: [
				test('Every type', types),
				test('null for a nullable string', withType({ ns: null })),
				test('A number is not a string', withType({ s: 1 })),
				test('A numeric string is not a number', withType({ n: '1' })),
				test('A boolean is not a number', withType({ n: true })),
				test('A fraction is not an integer: expected is "int"', withType({ i: 1.5 })),
				test('A string is not an integer: expected is "number"', withType({ i: '7' })),
				test(
					'An integer above 2^53 - 1 fails the maximum TypeScript advertises',
					withType({ i: 9007199254740992 })
				),
				test('A string is not a boolean', withType({ b: 'true' })),
				test('A number is not a boolean', withType({ b: 1 })),
				test('An array is not an object', withType({ o: [] })),
				test('An object is not an array', withType({ a: {} })),
				test('0 is not null', withType({ nul: 0 })),
				test('A number is not a nullable string', withType({ ns: 1 })),
				test('A value of none of several non-null types is invalid_union', withType({ sn: true })),
			],
		},
		{
			id: 'enum',
			section: 'keywords',
			description:
				'enum. A mismatch is invalid_value, even when the value also has the wrong type.',
			zod: z.object({
				priority: z.enum(['low', 'medium', 'high']),
				level: z.literal([1, 2, 3]).optional(),
				mixed: z.literal(['a', 1, null]).optional(),
			}),
			tests: [
				test('Listed values', { priority: 'low', level: 2, mixed: null }),
				test('An unlisted string', { priority: 'urgent' }),
				test('A value of another type', { priority: 1 }),
				test('An unlisted number', { priority: 'low', level: 4 }),
				test('An enum of mixed types', { priority: 'low', mixed: 'b' }),
			],
		},
		{
			id: 'string-length',
			section: 'keywords',
			description: 'minLength and maxLength are inclusive.',
			zod: z.object({ title: z.string().min(1).max(5) }),
			tests: [
				test('At the minimum', { title: 'a' }),
				test('At the maximum', { title: 'abcde' }),
				test('Below the minimum', { title: '' }),
				test('Above the maximum', { title: 'abcdef' }),
			],
		},
		{
			id: 'numeric-bounds',
			section: 'keywords',
			description:
				'minimum and maximum are inclusive; exclusiveMinimum and exclusiveMaximum are numbers and exclusive.',
			zod: z.object({
				inclusive: z.number().min(1).max(10).optional(),
				exclusive: z.number().gt(0).lt(1).optional(),
				count: z.int().min(0).max(100).optional(),
			}),
			tests: [
				test('At the inclusive bounds', { inclusive: 1, count: 100 }),
				test('Inside the exclusive bounds', { inclusive: 10, exclusive: 0.5, count: 0 }),
				test('Below minimum', { inclusive: 0 }),
				test('Above maximum', { inclusive: 11 }),
				test('At exclusiveMinimum', { exclusive: 0 }),
				test('At exclusiveMaximum', { exclusive: 1 }),
				test('An integer below its minimum', { count: -1 }),
			],
		},
		{
			id: 'items',
			section: 'keywords',
			description: 'items validates each element; minItems and maxItems are inclusive.',
			zod: z.object({ tags: z.array(z.string().min(1)).min(1).max(3) }),
			tests: [
				test('Valid', { tags: ['a', 'b', 'c'] }),
				test('Too few items', { tags: [] }),
				test('Too many items', { tags: ['a', 'b', 'c', 'd'] }),
				test('An invalid item', { tags: ['a', ''] }),
				test('An item of the wrong type', { tags: [1] }),
			],
		},
		{
			id: 'ref-definitions',
			section: 'keywords',
			description: 'A local $ref into definitions, which TypeScript emits for a reused schema.',
			zod: z.object({ id: TodoId, related: z.array(TodoId).optional() }),
			tests: [
				test('Valid', { id: 'a', related: ['b'] }),
				test('The referenced constraints apply', { id: '' }),
				test('A reference in array items', { id: 'a', related: ['b', 1] }),
				test('An absent reference is reported with the referenced type', {}),
			],
		},
		{
			id: 'ref-defs',
			section: 'keywords',
			description:
				'The same schema with $defs instead of definitions. TypeScript emits definitions (draft-07); the case renames them.',
			zod: z.object({ id: TodoId, related: z.array(TodoId).optional() }),
			rewrite: toDefs,
			tests: [
				test('Valid', { id: 'a', related: ['b'] }),
				test('The referenced constraints apply', { id: 'a', related: [''] }),
			],
		},
		{
			id: 'ref-recursive',
			section: 'keywords',
			description:
				'A recursive $ref. Unknown keys are removed inside referenced objects, at any depth.',
			zod: z.object({ root: Node }),
			tests: [
				test('Nested nodes', {
					root: { name: 'a', extra: 1, children: [{ name: 'b', children: [{ name: 'c', x: 2 }] }] },
				}),
				test('An issue deep in the tree', {
					root: { name: 'a', children: [{ name: 'b', children: [{ name: 3 }] }] },
				}),
			],
		},
		{
			id: 'ref-root',
			section: 'keywords',
			description: 'A $ref of "#" refers to the whole schema.',
			zod: Tree,
			tests: [
				test('Nested nodes', { name: 'a', children: [{ name: 'b', children: [] }] }),
				test('An issue in a child', { name: 'a', children: [{ children: [] }] }),
			],
		},
		{
			id: 'annotations',
			section: 'keywords',
			description:
				'Annotation keywords (title, description, examples, deprecated) are accepted and have no effect.',
			zod: z
				.object({
					title: z
						.string()
						.meta({ title: 'Title', description: 'What to do', examples: ['Buy milk'] }),
					legacy: z.string().optional().meta({ deprecated: true }),
				})
				.describe('Create a todo'),
			tests: [test('Valid', { title: 'Buy milk', legacy: 'x' }), test('Invalid', { title: 1 })],
		},

		// ── Explicit null (#282) and defaults (#284) ─────────────────────────────────────────
		{
			id: 'null-for-optional',
			section: 'null-and-defaults',
			description:
				'An explicit null is a value, not an absent property: it fails unless the type allows null, and a default does not replace it.',
			zod: z.object({
				title: z.string(),
				note: z.string().optional(),
				done: z.boolean().default(false),
				label: z.string().nullable().optional(),
				filter: z.object({ limit: z.number().optional() }).optional(),
			}),
			tests: [
				test('Absent optional properties', { title: 'a' }),
				test('null for an optional string', { title: 'a', note: null }),
				test('null for a property with a default', { title: 'a', done: null }),
				test('null for a required property is not a missing field', { title: null }),
				test('null where the type allows it is kept', { title: 'a', label: null }),
				test('null for a nested optional property', { title: 'a', filter: { limit: null } }),
				test('null for an optional object', { title: 'a', filter: null }),
			],
		},
		{
			id: 'defaults',
			section: 'null-and-defaults',
			description:
				'A default fills an absent property, at any depth, before middleware and the handler run. It is used as is: it is not validated, and defaults inside it are not applied.',
			zod: z.object({
				priority: z.enum(['low', 'medium', 'high']).default('medium'),
				tags: z.array(z.string()).default([]),
				filter: z
					.object({ limit: z.number().default(20), sort: z.enum(['asc', 'desc']).default('asc') })
					.default({ limit: 5 }),
				items: z.array(z.object({ qty: z.int().default(1) })).optional(),
				threshold: z.number().min(5).default(1),
			}),
			tests: [
				test('Top-level defaults, and an object default used as is', {}),
				test('Nested defaults fill a present object', { filter: {} }),
				test('Present values are kept', { priority: 'high', tags: ['x'], filter: { limit: 3 } }),
				test('Defaults fill objects inside arrays', { items: [{}, { qty: 2 }] }),
				test('A present value is validated even when it equals the default', { threshold: 1 }),
			],
		},

		// ── Optional keywords ────────────────────────────────────────────────────────────────
		{
			id: 'pattern',
			section: 'optional-keywords',
			optionalKeywords: ['pattern'],
			description: 'pattern is an ECMAScript regular expression, not anchored.',
			zod: z.object({
				slug: z.string().regex(/^[a-z]+(-[a-z]+)*$/),
				code: z.string().regex(/[0-9]/).optional(),
			}),
			tests: [
				test('Matches', { slug: 'buy-milk' }),
				test('A pattern is not anchored: it can match part of the string', {
					slug: 'a',
					code: 'a1b',
				}),
				test('Does not match', { slug: 'Buy Milk' }),
				test('Matches nowhere in the string', { slug: 'a', code: 'abc' }),
			],
		},
		{
			id: 'format',
			section: 'optional-keywords',
			optionalKeywords: ['format', 'pattern'],
			description: 'format, which TypeScript emits together with a pattern that enforces it.',
			zod: z.object({
				email: z.email().optional(),
				id: z.uuid().optional(),
				at: z.iso.datetime().optional(),
			}),
			tests: [
				test('Valid values', {
					email: 'ada@example.com',
					id: '123e4567-e89b-12d3-a456-426614174000',
					at: '2026-09-27T12:00:00Z',
				}),
				test('An invalid email', { email: 'ada' }),
				test('An invalid UUID', { id: '123' }),
				test('An invalid date-time', { at: '2026-09-27' }),
			],
		},
		{
			id: 'const',
			section: 'optional-keywords',
			optionalKeywords: ['const'],
			description: 'const. A mismatch is invalid_value, even when the value has another type.',
			zod: z.object({ version: z.literal('v1') }),
			tests: [
				test('Equal', { version: 'v1' }),
				test('Another value', { version: 'v2' }),
				test('Another type', { version: 1 }),
				test('Absent', {}),
			],
		},
		{
			id: 'any-of',
			section: 'optional-keywords',
			optionalKeywords: ['anyOf'],
			description:
				'anyOf. The first branch that matches gives the result, with its unknown keys removed. TypeScript emits anyOf for a union of objects and for a nullable object.',
			zod: z.object({
				target: z.union([z.object({ id: z.string() }), z.object({ name: z.string() })]),
				parent: z.object({ id: z.string() }).nullable().optional(),
			}),
			tests: [
				test('The first branch', { target: { id: 'a', extra: 1 } }),
				test('The second branch', { target: { name: 'n' } }),
				test('Both branches match: the first wins', { target: { id: 'a', name: 'n' } }),
				test('No branch matches', { target: { x: 1 } }),
				test('A nullable object', { target: { id: 'a' }, parent: null }),
				test('A nullable object with a value', { target: { id: 'a' }, parent: { id: 'p', z: 1 } }),
			],
		},
		{
			id: 'one-of',
			section: 'optional-keywords',
			optionalKeywords: ['oneOf', 'const'],
			description:
				'oneOf: exactly one branch must match. When every branch is an object with a const property in common, TypeScript reports the issues of the branch that property selects.',
			zod: z.object({
				value: z.xor([z.number(), z.int()]).optional(),
				shape: z
					.discriminatedUnion('kind', [
						z.object({ kind: z.literal('circle'), r: z.number() }),
						z.object({ kind: z.literal('square'), side: z.number() }),
					])
					.optional(),
			}),
			tests: [
				test('Exactly one branch matches', { value: 1.5 }),
				test('Two branches match', { value: 1 }),
				test('No branch matches', { value: 'x' }),
				test('A discriminated branch', { shape: { kind: 'square', side: 2, extra: 1 } }),
				test('An issue in the selected branch', { shape: { kind: 'circle', r: 'x' } }),
				test('An unknown discriminator', { shape: { kind: 'triangle' } }),
			],
		},
		{
			id: 'all-of',
			section: 'optional-keywords',
			optionalKeywords: ['allOf'],
			description:
				'allOf: every branch must match. TypeScript also emits a one-branch allOf around the $ref of an optional or defaulted reused schema.',
			zod: z.object({
				code: z.intersection(z.string().min(2), z.string().max(4)),
				parent: TodoId.optional(),
			}),
			tests: [
				test('Both match', { code: 'abc', parent: 'a' }),
				test('The first fails', { code: 'a' }),
				test('The second fails', { code: 'abcde' }),
				test('A reference wrapped in allOf', { code: 'abc', parent: '' }),
			],
		},
		{
			id: 'not',
			section: 'optional-keywords',
			optionalKeywords: ['not'],
			description:
				'not. TypeScript emits only not: {} (z.never()), which no value satisfies; its issue has expected "never".',
			zod: z.object({ legacy: z.never().optional() }),
			tests: [test('Absent', {}), test('Present', { legacy: 1 })],
		},
		{
			id: 'multiple-of',
			section: 'optional-keywords',
			optionalKeywords: ['multipleOf'],
			description: 'multipleOf.',
			zod: z.object({ step: z.number().multipleOf(5) }),
			tests: [test('A multiple', { step: 10 }), test('Not a multiple', { step: 7 })],
		},
	];
}

/**
 * Runs one case through the execution engine and returns it as it appears in validation.json.
 * `server` provides `defineCommand`, `createDirectRegistry`, `success` and `zodToJsonSchema`.
 */
export async function runCase(testCase, server) {
	const { zod, rewrite, tests, ...rest } = testCase;
	const advertised = server.zodToJsonSchema(zod, { io: 'input' });
	const command = server.defineCommand({
		name: 'vector-echo',
		description: 'Returns its validated input',
		input: zod,
		handler: async (input) => server.success(input),
	});
	const registry = server.createDirectRegistry([command]);
	const results = [];
	for (const entry of tests) {
		const result = await registry.execute('vector-echo', entry.input);
		// A JSON round trip drops undefined members, as the wire does.
		results.push(
			JSON.parse(
				JSON.stringify(
					result.success
						? { ...entry, valid: true, data: result.data }
						: { ...entry, valid: false, error: result.error }
				)
			)
		);
	}
	return { ...rest, schema: rewrite ? rewrite(advertised) : advertised, tests: results };
}

async function main() {
	const server = await import('../../packages/server/dist/index.js');
	// The server's own Zod, so the schemas are instances of the classes it checks for.
	const zodDir = new URL('../../packages/server/node_modules/zod/', import.meta.url);
	const { z } = await import(new URL('index.js', zodDir).href);
	const { version } = JSON.parse(readFileSync(new URL('package.json', zodDir), 'utf8'));
	const cases = [];
	for (const testCase of validationCases(z)) cases.push(await runCase(testCase, server));
	const vectors = {
		description:
			'Command input validation (spec/validation.md), with results produced by the TypeScript implementation. Regenerate with node spec/vectors/generate-validation.mjs.',
		generatedWith: { zod: version },
		cases,
	};
	writeFileSync(
		new URL('./validation.json', import.meta.url),
		`${JSON.stringify(vectors, null, '\t')}\n`
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
