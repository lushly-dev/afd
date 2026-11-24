/**
 * Checks `spec/vectors/recovery.json` (`spec/recovery.md`): every valid CommandError passes
 * `spec/schema/error.json` and comes back unchanged from a command run through the server engine;
 * every invalid one fails the schema and reads to its `readsAs` (rule 7); and the core guard
 * accepts a recovery exactly when the schema's `$defs/recovery` does.
 */
import { readFileSync } from 'node:fs';
import {
	type CommandError,
	failure,
	isCommandRecovery,
	withReadableRecovery,
} from '@lushly-dev/afd-core';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDirectRegistry } from './direct-registry.js';
import { defineCommand } from './schema.js';

interface Vectors {
	valid: { name: string; error: CommandError }[];
	normalizes: { name: string; error: CommandError; readsAs: CommandError }[];
	invalid: { name: string; error: CommandError; rule: string; readsAs: CommandError }[];
}

const vectors = JSON.parse(
	readFileSync(new URL('../../../spec/vectors/recovery.json', import.meta.url), 'utf8')
) as Vectors;
const schema = JSON.parse(
	readFileSync(new URL('../../../spec/schema/error.json', import.meta.url), 'utf8')
) as Parameters<AjvJsonSchemaValidator['getValidator']>[0];
const validator = new AjvJsonSchemaValidator();
const validate = validator.getValidator(schema);
const validateRecovery = validator.getValidator({
	...(schema as Record<string, unknown>),
	$ref: '#/$defs/recovery',
	properties: undefined,
	required: undefined,
	allOf: undefined,
	additionalProperties: undefined,
	type: undefined,
	$id: 'https://afd.dev/spec/schema/error.json#recovery',
} as Parameters<AjvJsonSchemaValidator['getValidator']>[0]);

/** Every recovery in an error and its causes. */
function recoveries(error: CommandError): unknown[] {
	const own = error.recovery === undefined ? [] : [error.recovery];
	const cause = error.cause as CommandError | undefined;
	return cause ? [...own, ...recoveries(cause)] : own;
}

describe('spec/vectors/recovery.json', () => {
	it('has cases of both kinds', () => {
		expect(vectors.valid.length).toBeGreaterThan(0);
		expect(vectors.invalid.length).toBeGreaterThan(0);
	});

	for (const { name, error } of vectors.valid) {
		it(`accepts and round-trips: ${name}`, async () => {
			const outcome = validate(error);
			expect(outcome.valid, outcome.valid ? '' : outcome.errorMessage).toBe(true);
			if (error.recovery) expect(isCommandRecovery(error.recovery)).toBe(true);
			const registry = createDirectRegistry([
				defineCommand({
					name: 'vector-fail',
					description: 'Returns the vector error',
					input: z.object({}),
					handler: async () => failure(structuredClone(error)),
				}),
			]);
			const result = await registry.execute('vector-fail', {});
			expect(JSON.parse(JSON.stringify(result.error))).toEqual(error);
		});
	}

	for (const { name, error, readsAs } of vectors.normalizes) {
		it(`accepts and normalizes: ${name}`, () => {
			expect(validate(error).valid).toBe(true);
			expect(JSON.parse(JSON.stringify(withReadableRecovery(error)))).toEqual(readsAs);
		});
	}

	for (const { name, error, rule, readsAs } of vectors.invalid) {
		it(`rejects: ${name} (${rule}), and reads it leniently`, () => {
			expect(validate(error).valid).toBe(false);
			expect(withReadableRecovery(error)).toEqual(readsAs);
		});
	}

	it('accepts a recovery exactly when $defs/recovery does', () => {
		const every = [...vectors.valid, ...vectors.normalizes, ...vectors.invalid].flatMap((c) =>
			recoveries(c.error)
		);
		expect(every.length).toBeGreaterThan(30);
		for (const recovery of every) {
			expect(isCommandRecovery(recovery), JSON.stringify(recovery)).toBe(
				validateRecovery(recovery).valid
			);
		}
	});

	it('reads an unknown kind as no recovery, and treats an undefined member as omitted', () => {
		expect(isCommandRecovery({ kind: 'reboot' })).toBe(false);
		expect(isCommandRecovery({ kind: 'call' })).toBe(false);
		expect(isCommandRecovery(null)).toBe(false);
		expect(isCommandRecovery({ kind: 'stop' })).toBe(true);
		expect(isCommandRecovery({ kind: 'call', command: 'x-y', input: undefined })).toBe(true);
	});
});
