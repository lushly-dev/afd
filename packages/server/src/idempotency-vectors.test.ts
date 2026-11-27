/**
 * The language-neutral vectors in `spec/vectors/idempotency.json`: idempotency keys
 * (`spec/idempotency.md`).
 *
 * TypeScript implements none of it yet. The file lists TypeScript in its `gaps`, and every case
 * here is skipped as that documented gap until TypeScript implements it and leaves the list
 * (https://github.com/lushly-dev/afd/issues/2675). The skip is conditional on the listing, so the
 * cases start running, and fail until they are implemented, the moment the listing is removed.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Described {
	description?: string;
	base?: string;
	kind?: string;
	index?: number;
}

interface Vectors {
	gaps: Record<string, string>;
	metaKey: string;
	declaration: { cases: Described[] };
	key: { form: Described[]; derived: Described[]; delivery: Described[] };
	step: { cases: Described[]; options: Described[] };
	retry: { cases: Described[] };
	timeoutRecovery: { cases: Described[] };
	journal: { cases: Described[] };
}

const vectors = JSON.parse(
	readFileSync(new URL('../../../spec/vectors/idempotency.json', import.meta.url), 'utf8')
) as Vectors;
const GAP = vectors.gaps.typescript;
/** The reason a skipped case shows in the run: the convention of `spec/vectors/README.md`. */
const REASON = `documented TypeScript gap, ${GAP}`;

const SECTIONS: [string, Described[]][] = [
	['declaration', vectors.declaration.cases],
	['key.form', vectors.key.form],
	['key.derived', vectors.key.derived],
	['key.delivery', vectors.key.delivery],
	['step', vectors.step.cases],
	['step.options', vectors.step.options],
	['retry', vectors.retry.cases],
	['timeoutRecovery', vectors.timeoutRecovery.cases],
	['journal', vectors.journal.cases],
];

/** A case's title: its description, or for a derived key the inputs that name it. */
function title(vector: Described): string {
	return vector.description ?? `${vector.base} ${vector.kind} ${vector.index}`;
}

describe('idempotency.json', () => {
	it('lists TypeScript as a documented gap', () => {
		// When TypeScript implements idempotency keys, it leaves `gaps` and the cases below run
		// instead of being skipped.
		expect(GAP).toBe('https://github.com/lushly-dev/afd/issues/2675');
	});

	it('has cases in every section and names the _meta key', () => {
		expect(vectors.metaKey).toBe('dev.afd/idempotencyKey');
		for (const [, cases] of SECTIONS) expect(cases.length).toBeGreaterThan(0);
	});

	describe.each(SECTIONS)('%s', (section, cases) => {
		it.skipIf(GAP !== undefined).each(cases.map((vector) => ({ name: title(vector) })))(
			`$name (${REASON})`,
			() => {
				expect.fail(`not implemented: ${section} has no TypeScript harness yet (#2675)`);
			}
		);
	});
});
