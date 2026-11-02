import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './bench.js';
import { suggestRunSchema } from './schema.js';
import { REPLACE_ME } from './suggest.js';
import type { CoverageRun, SuggestRun } from './types.js';

const fixtures = resolve(import.meta.dirname, '../fixtures/suggest');

/** The fixture with a proposal saved beside the component and listed in its configuration. */
async function withProposal(root: string, proposal: SuggestRun, source: string) {
	await writeFile(join(root, proposal.file), source);
	const config = JSON.parse(await readFile(join(root, 'specimen.config.json'), 'utf8'));
	await writeFile(
		join(root, 'specimen.config.json'),
		JSON.stringify({ ...config, specimens: [...config.specimens, ...proposal.entries] })
	);
	return createSpecimenBench({ root });
}

describe('specimen-suggest', () => {
	let root: string;
	let bench: SpecimenBench;
	let proposal: SuggestRun;
	const levels = (run: CoverageRun) =>
		Object.fromEntries((run.components[0]?.obligations ?? []).map((item) => [item.id, item.level]));
	beforeAll(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-suggest-')));
		await cp(fixtures, root, { recursive: true });
		bench = await createSpecimenBench({ root });
		proposal = await bench.suggest({ component: 'fixture-suggest' });
	}, 60_000);
	afterAll(async () => {
		await bench.close();
		await rm(root, { recursive: true, force: true });
	});

	it('proposes for what a run leaves unverified, and calls all of it unverified', () => {
		expect(suggestRunSchema.parse(proposal)).toBeTruthy();
		expect(proposal.status).toBe('unverified');
		expect(proposal.source).toContain('Unverified: run it, and correct what it assumes.');
		expect(proposal.suggestions.map((item) => item.obligation)).toEqual(
			expect.arrayContaining([
				'default',
				'property:disabled=true',
				'property:mode=b',
				'slot:after=filled',
				'event:changed',
				'form:participation',
				'form:validity',
			])
		);
		expect(proposal.skipped).toEqual([]);
		expect(proposal.file).toBe('fixture-suggest.specimens.ts');
	});

	it('changes nothing coverage reports by proposing', async () => {
		const before = await bench.coverage({ component: 'fixture-suggest' });
		await bench.suggest({ component: 'fixture-suggest' });
		const after = await bench.coverage({ component: 'fixture-suggest' });
		expect(levels(after)).toEqual(levels(before));
		expect(after.counts.verified).toBe(0);
	}, 60_000);

	it('marks what only a person can complete, which fails until it is replaced', async () => {
		const participation = proposal.suggestions.find(
			(item) => item.obligation === 'form:participation'
		);
		expect(participation?.placeholder).toBe(true);
		const scratch = await realpath(await mkdtemp(join(tmpdir(), 'specimen-suggest-run-')));
		await cp(fixtures, scratch, { recursive: true });
		const proposed = await withProposal(scratch, proposal, proposal.source);
		try {
			const run = await proposed.coverage({ component: 'fixture-suggest' });
			const failed = run.cases.failed.map((item) => item.id);
			expect(failed).toEqual(['fixture-suggest-form-participation']);
			expect(levels(run)['form:participation']).not.toBe('verified');
			// Everything the schema could derive holds on its merits.
			expect(levels(run)).toMatchObject({
				default: 'verified',
				'property:disabled=true': 'verified',
				'property:disabled=false': 'verified',
				'property:size=large': 'verified',
				'property:mode=b': 'verified',
				'slot:default=filled': 'verified',
				'slot:after=filled': 'verified',
				'slot:after=empty': 'verified',
				'event:changed': 'verified',
				'form:validity': 'verified',
			});
			expect(run.invalidClaims).toEqual([]);
			expect(run.complete).toBe(false);
		} finally {
			await proposed.close();
			await rm(scratch, { recursive: true, force: true });
		}
	}, 120_000);

	it('reaches complete only after a person corrects what it could not know', async () => {
		const scratch = await realpath(await mkdtemp(join(tmpdir(), 'specimen-suggest-fix-')));
		await cp(fixtures, scratch, { recursive: true });
		const corrected = await withProposal(
			scratch,
			proposal,
			proposal.source.replaceAll(REPLACE_ME, 'Water')
		);
		try {
			const run = await corrected.coverage({ component: 'fixture-suggest' });
			expect(run.cases.failed).toEqual([]);
			expect(run.complete).toBe(true);
		} finally {
			await corrected.close();
			await rm(scratch, { recursive: true, force: true });
		}
	}, 120_000);

	it('proposes for the gaps it is given, and says what it cannot propose', async () => {
		const narrow = await bench.suggest({
			component: 'fixture-suggest',
			gaps: ['property:disabled=true', 'property:nope=1', 'command:press'],
		});
		expect(narrow.suggestions.map((item) => item.obligation)).toEqual(['property:disabled=true']);
		expect(narrow.skipped).toEqual([
			{
				obligation: 'property:nope=1',
				reason: "The schema of <fixture-suggest> has no member 'nope'.",
			},
			{
				obligation: 'command:press',
				reason: 'No plugin described <fixture-suggest>, so no runner is known for this command.',
			},
		]);
		await expect(bench.suggest({ component: 'fixture-none' })).rejects.toThrow(
			'The manifest does not describe fixture-none.'
		);
	});
});
