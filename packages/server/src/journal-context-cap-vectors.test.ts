/**
 * Checks the journal's cap on a declared context field's value against
 * `spec/vectors/journal-context-cap.json`, the vectors every implementation loads
 * (`spec/journal.md`, "Declared context fields").
 *
 * The file is rebuilt by `journalContextCapVectors()` in
 * `spec/vectors/generate-journal-context-cap.mjs`, so a change to the cap or to how it measures
 * fails here.
 */
import { readFileSync } from 'node:fs';
import type { CommandContext } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { journalContextFields, MAX_JOURNAL_CONTEXT_BYTES } from './journal.js';

interface CapCase {
	description: string;
	json: string;
	bytes: number;
	expected: 'kept' | 'omitted';
}

interface Vectors {
	maxBytes: number;
	field: string;
	cases: CapCase[];
}

const VECTORS_DIR = new URL('../../../spec/vectors/', import.meta.url);
const vectors: Vectors = JSON.parse(
	readFileSync(new URL('journal-context-cap.json', VECTORS_DIR), 'utf8')
);
const generator = (await import(new URL('generate-journal-context-cap.mjs', VECTORS_DIR).href)) as {
	journalContextCapVectors(journal: typeof journalContextFields): Vectors;
};

describe('journal context cap vectors', () => {
	it('match what the generator builds from the current journal', () => {
		expect(generator.journalContextCapVectors(journalContextFields)).toEqual(vectors);
	});

	it('use the cap the journal applies', () => {
		expect(vectors.maxBytes).toBe(MAX_JOURNAL_CONTEXT_BYTES);
	});

	describe.each(vectors.cases)('$description', (vector) => {
		const value: unknown = JSON.parse(vector.json);

		it('measures the canonical JSON as the vector does', () => {
			expect(new TextEncoder().encode(JSON.stringify(value)).length).toBe(vector.bytes);
		});

		it(`${vector.expected === 'kept' ? 'keeps' : 'omits'} the value`, () => {
			const context = { [vectors.field]: value } as CommandContext;
			const journaled = journalContextFields(context, [vectors.field]);
			if (vector.expected === 'kept') {
				// As JSON: the journal keeps -0 as 0.
				const kept: unknown = JSON.parse(JSON.stringify(value));
				expect(journaled).toEqual({ context: { [vectors.field]: kept } });
			} else {
				expect(journaled).toEqual({ contextOmitted: [vectors.field] });
			}
		});
	});
});
