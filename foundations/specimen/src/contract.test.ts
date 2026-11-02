import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './bench.js';
import { contractRunSchema } from './schema.js';
import type { ContractRun } from './types.js';

// Each story file in the fixture breaks one rule, so each rule is shown to detect its own failure
// and to pass where nothing breaks it.
const root = resolve(import.meta.dirname, '../compat/contract');

describe('specimen-contract', () => {
	let bench: SpecimenBench;
	let run: ContractRun;
	const codesOf = (tag: string) =>
		run.findings.filter((finding) => finding.file?.includes(`/${tag}.`)).map((item) => item.code);
	beforeAll(async () => {
		bench = await createSpecimenBench({ root });
		run = await bench.contract();
	}, 120_000);
	afterAll(async () => {
		await bench.close();
	});

	it('finds nothing wrong where nothing is', () => {
		expect(codesOf('x-good')).toEqual([]);
		expect(codesOf('x-form-good')).toEqual([]);
		expect(run.findings.map((item) => item.code)).not.toContain('MISSING_GLOBAL_A11Y_ERROR_POLICY');
	});

	it.each([
		['x-no-story', 'MISSING_STORY'],
		['x-no-export', 'MISSING_STORY_EXPORT'],
		['x-no-autodocs', 'MISSING_AUTODOCS_TAG'],
		['x-no-play', 'MISSING_PLAY_FUNCTION'],
		['x-no-docs', 'MISSING_DOCS_DESCRIPTION'],
		['x-no-baseline', 'MISSING_BASELINE_STORY'],
		['x-no-state', 'MISSING_STATE_STORY'],
		['x-a11y-off', 'UNDOCUMENTED_A11Y_EXCEPTION'],
	])('flags %s as only %s', (tag, code) => {
		expect(codesOf(tag)).toEqual([code]);
	});

	it('counts a state a play set and cleared, and one a component derives', () => {
		expect(codesOf('x-state-cleared')).toEqual([]);
		expect(codesOf('x-state-derived')).toEqual([]);
	});

	it('accepts a documented accessibility exception', () => {
		expect(codesOf('x-a11y-documented')).toEqual([]);
	});

	it('wants form evidence from what ran, not what a file mentions', () => {
		const form = ['MISSING_FORMDATA_ASSERTION', 'MISSING_VALIDITY_ASSERTION'];
		expect(codesOf('x-form-silent')).toEqual(form);
		// Fastbot's text search passes this file, whose comment has both words.
		expect(codesOf('x-form-text-only')).toEqual(form);
	});

	it('says a named story does not show a state, whatever it is called', () => {
		const finding = run.findings.find((item) => item.code === 'MISSING_STATE_STORY');
		expect(finding).toMatchObject({ component: 'x-no-state', attribute: 'disabled' });
		expect(finding?.message).toBe('No story in this file shows <x-no-state> as disabled.');
	});

	it('flags a preview with no accessibility policy', async () => {
		const unset = await createSpecimenBench({
			root,
			configFile: resolve(root, 'specimen.no-policy.config.json'),
		});
		try {
			const result = await unset.contract({ filter: { file: 'src/x-good.stories.ts' } });
			expect(result.findings.map((item) => item.code)).toEqual([
				'MISSING_GLOBAL_A11Y_ERROR_POLICY',
			]);
		} finally {
			await unset.close();
		}
	}, 60_000);

	it('reports by severity, and matches its output schema', () => {
		expect(contractRunSchema.parse(run)).toBeTruthy();
		expect(run.rules).toBe('fastbot-parity@1');
		expect(run.valid).toBe(false);
		const docs = run.findings.find((item) => item.code === 'MISSING_DOCS_DESCRIPTION');
		expect(docs?.severity).toBe('warning');
		expect(run.counts.warnings).toBe(1);
		for (const finding of run.findings) expect(finding.suggestion).not.toBe('');
	});

	it('runs one component, with only its own file', async () => {
		const one = await bench.contract({ component: 'x-good' });
		expect(one.valid).toBe(true);
		expect(one.stats).toEqual({ components: 1, storyFiles: 1, scoped: true });
		expect(one.cases.total).toBe(2);
		await expect(bench.contract({ component: 'x-none' })).rejects.toThrow(
			'The manifest does not describe x-none.'
		);
	}, 60_000);
});
