/**
 * Checks the TypeScript engine against `spec/vectors/validation.json`, the command input validation
 * vectors every implementation loads (`spec/validation.md`).
 *
 * The cases are Zod schemas in `spec/vectors/generate-validation.mjs`. Each test rebuilds its case,
 * derives the advertised JSON Schema and runs the inputs through the execution engine, so a change
 * in validation behavior fails here until the vectors are regenerated.
 */
import { readFileSync } from 'node:fs';
import { success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDirectRegistry } from './direct-registry.js';
import { defineCommand, zodToJsonSchema } from './schema.js';
import { formatEnhancedValidationError, type ValidationError } from './validation.js';

interface VectorTest {
	description: string;
	input: unknown;
	valid: boolean;
	data?: unknown;
	error?: {
		code: string;
		message: string;
		suggestion: string;
		details: {
			errors: ValidationError[];
			expectedFields?: string[];
			unexpectedFields?: string[];
			missingFields?: string[];
		};
	};
}

interface VectorCase {
	id: string;
	section: string;
	description: string;
	optionalKeywords?: string[];
	schema: unknown;
	tests: VectorTest[];
}

interface Generator {
	validationCases(zod: typeof z): Array<{ id: string }>;
	runCase(testCase: unknown, server: unknown): Promise<VectorCase>;
}

const VECTORS_DIR = new URL('../../../spec/vectors/', import.meta.url);
const vectors: { cases: VectorCase[] } = JSON.parse(
	readFileSync(new URL('validation.json', VECTORS_DIR), 'utf8')
);
const generator = (await import(new URL('generate-validation.mjs', VECTORS_DIR).href)) as Generator;
const cases = new Map(generator.validationCases(z).map((testCase) => [testCase.id, testCase]));
const server = { defineCommand, createDirectRegistry, success, zodToJsonSchema };

/** Compare content without sibling/list order, retaining duplicate issues and omitted lists. */
function normalizeCase(vector: VectorCase): VectorCase {
	return {
		...vector,
		tests: vector.tests.map((test) => {
			if (!test.error) return test;
			const { details } = test.error;
			const identity = (issue: ValidationError) =>
				JSON.stringify([
					issue.path,
					issue.code,
					Object.hasOwn(issue, 'expected'),
					issue.expected,
					issue.message,
				]);
			return {
				...test,
				error: {
					...test.error,
					// The suggestion must match actual details, checked independently below.
					suggestion: '',
					details: {
						...details,
						errors: [...details.errors].sort((a, b) => identity(a).localeCompare(identity(b))),
						...(details.expectedFields === undefined
							? {}
							: { expectedFields: [...details.expectedFields].sort() }),
						...(details.unexpectedFields === undefined
							? {}
							: { unexpectedFields: [...details.unexpectedFields].sort() }),
						...(details.missingFields === undefined
							? {}
							: { missingFields: [...details.missingFields].sort() }),
					},
				},
			};
		}),
	};
}

function assertSuggestions(vector: VectorCase): void {
	for (const test of vector.tests) {
		if (!test.error) continue;
		const { errors, ...fields } = test.error.details;
		expect(test.error.suggestion).toBe(formatEnhancedValidationError(errors, fields));
	}
}

// The keyword lists of spec/validation.md.
const REQUIRED = [
	'type',
	'properties',
	'required',
	'enum',
	'items',
	'minItems',
	'maxItems',
	'minLength',
	'maxLength',
	'minimum',
	'maximum',
	'exclusiveMinimum',
	'exclusiveMaximum',
	'additionalProperties',
	'$ref',
	'$defs',
	'definitions',
	'default',
];
const ANNOTATIONS = [
	'title',
	'description',
	'examples',
	'deprecated',
	'readOnly',
	'writeOnly',
	'$comment',
	'$schema',
	'$id',
];
const OPTIONAL = ['pattern', 'format', 'const', 'anyOf', 'oneOf', 'allOf', 'not', 'multipleOf'];

/** Every keyword used anywhere in a schema, including its subschemas. */
function keywordsOf(schema: unknown, found = new Set<string>()): Set<string> {
	if (typeof schema !== 'object' || schema === null) return found;
	for (const [keyword, value] of Object.entries(schema)) {
		found.add(keyword);
		if (['properties', 'definitions', '$defs'].includes(keyword)) {
			for (const subschema of Object.values(value as Record<string, unknown>)) {
				keywordsOf(subschema, found);
			}
		} else if (['allOf', 'anyOf', 'oneOf'].includes(keyword)) {
			for (const subschema of value as unknown[]) keywordsOf(subschema, found);
		} else if (['items', 'additionalProperties', 'not'].includes(keyword)) {
			keywordsOf(value, found);
		}
	}
	return found;
}

describe('validation vectors', () => {
	it('has one vector per generator case, in the same order', () => {
		expect(vectors.cases.map((vector) => vector.id)).toEqual([...cases.keys()]);
	});

	it.each(vectors.cases.map((vector) => [vector.id, vector] as const))(
		'%s matches the TypeScript engine',
		async (id, vector) => {
			const actual = await generator.runCase(cases.get(id), server);
			assertSuggestions(actual);
			expect(normalizeCase(actual)).toEqual(normalizeCase(vector));
		}
	);

	it('preserves TypeScript declaration order and array/parent traversal in the reference case', async () => {
		const vector = vectors.cases.find((entry) => entry.id === 'error-order');
		expect(vector).toBeDefined();
		if (!vector) return;
		expect(await generator.runCase(cases.get(vector.id), server)).toEqual(vector);
	});

	it('allows sibling and field-list reordering but preserves duplicate issues and list presence', () => {
		const original = vectors.cases.find((entry) => entry.id === 'error-shape');
		expect(original).toBeDefined();
		if (!original) return;
		const reordered = structuredClone(original);
		for (const test of reordered.tests) {
			if (!test.error) continue;
			const details = test.error.details;
			details.errors.reverse();
			details.expectedFields?.reverse();
			details.unexpectedFields?.reverse();
			details.missingFields?.reverse();
			test.error.suggestion = formatEnhancedValidationError(details.errors, details);
		}
		expect(normalizeCase(reordered)).toEqual(normalizeCase(original));
		assertSuggestions(reordered);
		const error = reordered.tests.find((test) => test.error)?.error;
		expect(error).toBeDefined();
		if (!error) return;
		const first = error.details.errors[0];
		expect(first).toBeDefined();
		if (!first) return;
		error.details.errors.push(first);
		expect(normalizeCase(reordered)).not.toEqual(normalizeCase(original));
		error.details.errors.pop();
		error.details.unexpectedFields = [];
		expect(normalizeCase(reordered)).not.toEqual(normalizeCase(original));
	});

	it('uses only required keywords, annotations and the optional keywords a case declares', () => {
		for (const vector of vectors.cases) {
			const declared = vector.optionalKeywords ?? [];
			const used = keywordsOf(vector.schema);
			const allowed = new Set([...REQUIRED, ...ANNOTATIONS, ...declared]);
			expect(
				[...used].filter((keyword) => !allowed.has(keyword)),
				vector.id
			).toEqual([]);
			expect(
				declared.filter((keyword) => !used.has(keyword) || !OPTIONAL.includes(keyword)),
				vector.id
			).toEqual([]);
		}
	});

	it('builds every suggestion from the details, as formatEnhancedValidationError does', () => {
		for (const vector of vectors.cases) {
			for (const test of vector.tests) {
				if (!test.error) continue;
				expect(test.error.code).toBe('VALIDATION_ERROR');
				expect(test.error.message).toBe('Input validation failed');
				const { errors, ...fields } = test.error.details;
				expect(test.error.suggestion).toBe(formatEnhancedValidationError(errors, fields));
			}
		}
	});
});
