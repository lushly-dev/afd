// Generates output-schema.json from the TypeScript reference implementation, so every language can
// check that it advertises the same CommandResult envelope as a tool's top-level `outputSchema`
// (spec/command-metadata.md, "Structured results").
//
//   pnpm -F @lushly-dev/afd-core build
//   node spec/vectors/generate-output-schema.mjs
//   npx biome format --write spec/vectors/output-schema.json
//
// Each case is a command's output schema (`dataSchema`) and the envelope commandResultOutputSchema
// builds for it (`outputSchema`). The cases cover which `data` schemas keep their definitions (a
// schema resource: a string `$id` that is not a bare fragment) and how a `"$ref": "#"` naming `data`
// is retargeted when `data` is nested in the envelope. No case has a property that accepts `null`,
// which Python's envelope leaves out of `required` (an intended difference).
//
// The cases pin what the four builders produce, not that every envelope is a schema a client
// accepts: Ajv refuses `$id: 7` (not a string), and an empty `$id` starts a resource under the
// validators' test but does not compile once nested in the envelope.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const node = {
	type: 'object',
	properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#' } } },
	required: ['name'],
};

export const outputSchemaCases = [
	{
		description: 'a schema without definitions is data as it is, without $schema',
		dataSchema: {
			$schema: 'http://json-schema.org/draft-07/schema#',
			type: 'object',
			properties: { id: { type: 'string' } },
			required: ['id'],
		},
	},
	{
		description: 'definitions of a schema without $id move to the envelope',
		dataSchema: {
			type: 'object',
			properties: { a: { $ref: '#/$defs/A' }, b: { $ref: '#/definitions/B' } },
			$defs: { A: { type: 'string' } },
			definitions: { B: { type: 'number' } },
		},
	},
	{
		description: 'a string $id starts a resource, which keeps its definitions and its #',
		dataSchema: {
			$id: 'urn:afd:node',
			...node,
			properties: { ...node.properties, kind: { $ref: '#/$defs/Kind' } },
			$defs: { Kind: { enum: ['leaf', 'branch'] } },
		},
	},
	{
		description: 'a bare fragment $id starts no resource, so its definitions move',
		dataSchema: {
			$id: '#node',
			type: 'object',
			properties: { a: { $ref: '#/$defs/A' } },
			$defs: { A: { type: 'string' } },
		},
	},
	{
		description: 'a $id that is not a string starts no resource, so its definitions move',
		dataSchema: {
			$id: 7,
			type: 'object',
			properties: { a: { $ref: '#/$defs/A' } },
			$defs: { A: { type: 'string' } },
		},
	},
	{
		description: 'a # naming a recursive data schema names data in the envelope',
		dataSchema: node,
	},
	{
		description: 'a # inside moved definitions is retargeted too',
		dataSchema: {
			type: 'object',
			properties: { tree: { $ref: '#/$defs/Tree' } },
			$defs: {
				Tree: {
					type: 'object',
					properties: {
						up: { $ref: '#' },
						kids: { type: 'array', items: { $ref: '#/$defs/Tree' } },
					},
				},
			},
		},
	},
	{
		description: 'a # inside a nested resource names that resource and is kept',
		dataSchema: {
			type: 'object',
			properties: {
				inner: { $id: 'urn:afd:inner', type: 'object', properties: { self: { $ref: '#' } } },
				outer: { $ref: '#' },
			},
		},
	},
	{
		description: 'a # in every schema position is retargeted, values and annotations are not',
		dataSchema: {
			type: 'object',
			properties: {
				const: { anyOf: [{ $ref: '#' }, { type: 'string' }] },
				list: { type: 'array', prefixItems: [{ $ref: '#' }], items: { $ref: '#' } },
				pick: { oneOf: [{ $ref: '#' }], allOf: [{ not: { $ref: '#' } }] },
				// biome-ignore lint/suspicious/noThenProperty: `then` is a JSON Schema keyword.
				when: { if: { $ref: '#' }, then: { $ref: '#' }, else: { $ref: '#' } },
				map: {
					type: 'object',
					additionalProperties: { $ref: '#' },
					patternProperties: { '^x': { $ref: '#' } },
					propertyNames: { $ref: '#' },
				},
				fixed: {
					const: { $ref: '#' },
					enum: [{ $ref: '#' }],
					default: { $ref: '#' },
					examples: [{ $ref: '#' }],
				},
			},
			required: ['const'],
		},
	},
	{
		description: 'a # in the remaining schema positions is retargeted, dependency lists are not',
		dataSchema: {
			type: 'object',
			properties: {
				has: { type: 'array', contains: { $ref: '#' } },
				tuple: { type: 'array', items: [{ $ref: '#' }], additionalItems: { $ref: '#' } },
				rest: { unevaluatedItems: { $ref: '#' }, unevaluatedProperties: { $ref: '#' } },
				deps: {
					type: 'object',
					dependentSchemas: { a: { $ref: '#' } },
					dependencies: { b: { $ref: '#' }, c: ['a', 'b'] },
				},
				nested: {
					type: 'object',
					$defs: { Inner: { properties: { up: { $ref: '#' } } } },
					properties: { inner: { $ref: '#/properties/data/properties/nested/$defs/Inner' } },
				},
			},
			definitions: { D: { not: { $ref: '#' } } },
		},
	},
	{
		description: 'an empty $id starts a resource under the validators test, so nothing moves',
		dataSchema: {
			$id: '',
			type: 'object',
			properties: { self: { $ref: '#' }, a: { $ref: '#/$defs/A' } },
			$defs: { A: { type: 'string' } },
		},
	},
];

async function main() {
	const { commandResultOutputSchema } = await import('../../packages/core/dist/index.js');
	const vectors = {
		description:
			'The CommandResult envelope a command tool advertises as its top-level outputSchema (spec/command-metadata.md, "Structured results"), produced by TypeScript\'s commandResultOutputSchema. Regenerate with node spec/vectors/generate-output-schema.mjs.',
		cases: outputSchemaCases.map((testCase) => ({
			...testCase,
			outputSchema: commandResultOutputSchema(structuredClone(testCase.dataSchema)),
		})),
	};
	const json = `${JSON.stringify(vectors, null, '\t')}\n`;
	if (process.argv.includes('--stdout')) process.stdout.write(json);
	else writeFileSync(new URL('./output-schema.json', import.meta.url), json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
