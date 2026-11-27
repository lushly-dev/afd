/**
 * The language-neutral vectors in `spec/vectors/journal-seams.json`: the dispatch id
 * (`spec/dispatch.md`, "The dispatch id") and the approval summary (`spec/command-metadata.md`,
 * "The approval summary").
 *
 * TypeScript implements neither yet. The file lists TypeScript in its `gaps`, and every case here
 * is skipped as that documented gap until TypeScript implements them and leaves the list
 * (https://github.com/lushly-dev/afd/issues/2680). The skip is conditional on the listing, so the
 * cases start running, and fail until they are implemented, the moment the listing is removed.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Case {
	description: string;
	rule: string;
	run: Record<string, unknown>;
	expect: Record<string, unknown>;
}

interface Vectors {
	gaps: Record<string, string>;
	dispatchId: { format: { length: number; pattern: string }; cases: Case[] };
	approvalSummary: { cases: Case[] };
}

const vectors = JSON.parse(
	readFileSync(new URL('../../../spec/vectors/journal-seams.json', import.meta.url), 'utf8')
) as Vectors;
const GAP = vectors.gaps.typescript;
/** The reason a skipped case shows in the run: the convention of `spec/vectors/README.md`. */
const REASON = `documented TypeScript gap, ${GAP}`;

describe('journal-seams.json', () => {
	it('lists TypeScript as a documented gap', () => {
		// When TypeScript implements the dispatch id and the approval summary, it leaves `gaps`
		// and the cases below run instead of being skipped.
		expect(GAP).toBe('https://github.com/lushly-dev/afd/issues/2680');
	});

	it('has cases in both sections and a usable id pattern', () => {
		expect(vectors.dispatchId.cases.length).toBeGreaterThan(0);
		expect(vectors.approvalSummary.cases.length).toBeGreaterThan(0);
		const pattern = new RegExp(vectors.dispatchId.format.pattern);
		expect(pattern.test('A'.repeat(22))).toBe(true);
		// Sixteen bytes leave two bits for the last character, so most letters cannot end an id.
		expect(pattern.test('B'.repeat(22))).toBe(false);
		expect(vectors.dispatchId.format.length).toBe(22);
	});

	describe('dispatchId', () => {
		it.skipIf(GAP !== undefined).each(vectors.dispatchId.cases)(
			`$description (${REASON})`,
			(vector) => {
				expect.fail(`not implemented: ${vector.rule} has no TypeScript harness yet (#2680)`);
			}
		);
	});

	describe('approvalSummary', () => {
		it.skipIf(GAP !== undefined).each(vectors.approvalSummary.cases)(
			`$description (${REASON})`,
			(vector) => {
				expect.fail(`not implemented: rule ${vector.rule} has no TypeScript harness yet (#2680)`);
			}
		);
	});
});
