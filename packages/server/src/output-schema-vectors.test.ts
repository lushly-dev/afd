/**
 * Checks TypeScript against `spec/vectors/output-schema.json`: the CommandResult envelope a command
 * tool advertises as its top-level `outputSchema` (`spec/command-metadata.md`, "Structured results").
 * The file is generated from `commandResultOutputSchema`, so this also catches a stale file.
 */
import { readFileSync } from 'node:fs';
import { commandResultOutputSchema, type JsonSchema } from '@lushly-dev/afd-core';
import { Ajv } from '@modelcontextprotocol/client/validators/ajv';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The generator is a plain ES module without type declarations.
import { outputSchemaCases } from '../../../spec/vectors/generate-output-schema.mjs';

interface OutputSchemaCase {
	description: string;
	dataSchema: JsonSchema;
	outputSchema: JsonSchema;
}

const vectors: { cases: OutputSchemaCase[] } = JSON.parse(
	readFileSync(new URL('../../../spec/vectors/output-schema.json', import.meta.url), 'utf8')
);

describe('spec/vectors/output-schema.json (#1910)', () => {
	it('holds the generator cases', () => {
		expect(
			vectors.cases.map(({ description, dataSchema }) => ({ description, dataSchema }))
		).toEqual(outputSchemaCases);
	});

	it.each(vectors.cases)('$description', ({ dataSchema, outputSchema }) => {
		expect(commandResultOutputSchema(structuredClone(dataSchema))).toEqual(outputSchema);
	});

	it('a retargeted # still names data, so Ajv checks a recursive result at every level', () => {
		const recursive = vectors.cases.find((entry) => entry.description.startsWith('a # naming'));
		const validate = new Ajv().compile(recursive?.outputSchema as JsonSchema);
		const result = (child: unknown) => ({
			success: true,
			data: { name: 'root', children: [{ name: 'kid', children: [child] }] },
		});
		expect(validate(result({ name: 'leaf' }))).toBe(true);
		expect(validate(result({ name: 7 }))).toBe(false);
	});

	it('a moved definition and a fragment $id resolve for Ajv', () => {
		for (const prefix of ['definitions of a schema', 'a bare fragment $id', 'a # inside moved']) {
			const entry = vectors.cases.find((item) => item.description.startsWith(prefix));
			expect(() => new Ajv().compile(entry?.outputSchema as JsonSchema), prefix).not.toThrow();
		}
	});
});
