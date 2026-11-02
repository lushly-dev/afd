import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './bench.js';
import type { ProfileBaselines, ProfileReport } from './types.js';

const fixtures = resolve(import.meta.dirname, '../fixtures/profile');
const compat = resolve(import.meta.dirname, '../compat');

describe('profiling through the bench', () => {
	let root: string;
	let baselines: string;
	let bench: SpecimenBench;
	const profile = async (id: string, extra = {}): Promise<ProfileReport> =>
		(await bench.profile({ id, runs: 1, ...extra })).reports[0] as ProfileReport;
	const recorded = async () => JSON.parse(await readFile(baselines, 'utf8')) as ProfileBaselines;

	beforeAll(async () => {
		// A scratch copy, so that recording a baseline leaves the fixtures alone.
		root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-profile-')));
		await cp(fixtures, root, { recursive: true });
		baselines = join(root, 'baselines.jsonc');
		bench = await createSpecimenBench({ root });
	});
	afterAll(async () => {
		await bench.close();
		await rm(root, { recursive: true, force: true });
	});

	it('explains that nothing has a baseline yet', async () => {
		await expect(bench.profile()).rejects.toThrow('No entry has a recorded baseline');
	});

	it('measures the page at its ready checkpoint, with where the numbers came from', async () => {
		const run = await bench.profile({ id: 'small', runs: 2 });
		const report = run.reports[0] as ProfileReport;
		expect(report).toMatchObject({
			id: 'small',
			checkpoint: 'mount',
			runs: 2,
			viewport: '1280x720',
			comparison: null,
			flags: [],
			provenance: { runner: 'specimen' },
		});
		expect(report.browser).toMatch(/^\d+\./);
		expect(report.samples).toHaveLength(2);
		const sample = report.samples[0];
		expect(sample?.firstContentfulPaintMs).toBeGreaterThan(0);
		expect(sample?.readyMs).toBeGreaterThan(0);
		expect(sample?.captureMs).toBeGreaterThan(0);
		expect(sample?.requestCount).toBeGreaterThan(0);
		expect(sample?.transferSizeBytes).toBeGreaterThan(0);
		expect(sample?.usedJSHeapSizeBytes).toBeGreaterThan(0);
		expect(report.summary?.dom.totalElements?.median).toBeGreaterThan(0);
		expect(run.counts).toMatchObject({ total: 1, noBaseline: 1, errored: 0 });
	});

	it('counts through shadow roots and flags a large DOM', async () => {
		const large = await profile('large');
		expect(large.samples[0]?.totalElements).toBeGreaterThan(500);
		expect(large.samples[0]?.customElements).toBe(1);
		expect(large.samples[0]?.shadowHosts).toBe(1);
		expect(large.flags.map((flag) => flag.code)).toContain('HIGH_DOM_NODE_COUNT');
	});

	it('counts console messages and flags them', async () => {
		const noisy = await profile('noisy');
		expect(noisy.summary?.console).toEqual({ errorCount: 1, warningCount: 1 });
		expect(noisy.flags.map((flag) => flag.code)).toEqual(['CONSOLE_ERRORS_PRESENT']);
	});

	it('measures the checkpoint it is asked for', async () => {
		const mounted = await profile('stepped', { checkpoint: 'mount' });
		const after = await profile('stepped', { checkpoint: 'after-run' });
		expect(after.samples[0]?.totalElements).toBeGreaterThan(
			(mounted.samples[0]?.totalElements ?? 0) + 19
		);
	});

	it('reports a run that fails, and keeps going', async () => {
		const run = await bench.profile({ filter: { match: 'Profile/' }, runs: 1 });
		const broken = run.reports.find((report) => report.id === 'broken');
		expect(broken?.error).toContain('This fixture does not render.');
		expect(broken?.summary).toBeNull();
		expect(run.counts).toMatchObject({ total: 5, errored: 1, noBaseline: 4 });
	});

	it('records a baseline, dated and attributable, and compares with it', async () => {
		const notes = ['Recorded for the fixture.'];
		const recording = await bench.recordBaseline({ id: 'small', runs: 2, notes });
		expect(recording.counts.errored).toBe(0);
		const entry = (await recorded()).stories.small;
		expect(entry).toMatchObject({
			runner: 'specimen',
			viewport: '1280x720',
			checkpoint: 'mount',
			runs: 2,
			notes,
		});
		expect(entry?.browser).toMatch(/^\d+\./);
		expect(Date.parse(entry?.capturedAt ?? '')).not.toBeNaN();
		const compared = await profile('small');
		expect(compared.comparison?.baseline.runner).toBe('specimen');
		// Timings vary between runs, so a tolerance may warn; nothing here can fail or be refused.
		expect(['passed', 'warnings']).toContain(compared.comparison?.status);
	});

	it('profiles what has a baseline when no id or filter is given', async () => {
		const run = await bench.profile({ runs: 1 });
		expect(run.reports.map((report) => report.id)).toEqual(['small']);
	});

	it('refuses to compare a measurement the baseline does not describe', async () => {
		const narrow = await profile('small', { context: { viewport: { width: 375, height: 812 } } });
		expect(narrow.comparison?.status).toBe('not-comparable');
		expect(narrow.comparison?.reason).toContain('1280x720');
		const later = await profile('small', { checkpoint: 'after-run' });
		expect(later.comparison?.status).toBe('not-comparable');
		expect(later.comparison?.reason).toContain('mount');
	});

	it('fails a budget, reports an orphan, and keeps a budget through a new recording', async () => {
		const file = await recorded();
		const entry = file.stories.small;
		if (!entry) throw new Error('Expected the recorded baseline');
		entry.budgets.totalElements = 1;
		file.stories.gone = { ...entry, storyId: 'gone' };
		await writeFile(baselines, JSON.stringify(file));
		const run = await bench.profile({ id: 'small', runs: 1 });
		expect(run.counts.failed).toBe(1);
		expect(run.reports[0]?.comparison?.errors[0]?.code).toBe('PERF_BUDGET_EXCEEDED_DOM');
		expect(run.orphanedBaselines).toEqual(['gone']);
		await bench.recordBaseline({ id: 'small', runs: 1 });
		expect((await recorded()).stories.small?.budgets.totalElements).toBe(1);
	});

	it('records nothing for a run that failed', async () => {
		const run = await bench.recordBaseline({ id: 'broken', runs: 1 });
		expect(run.counts.errored).toBe(1);
		expect((await recorded()).stories.broken).toBeUndefined();
	});

	it('asks for an id or a filter before recording', async () => {
		await expect(bench.recordBaseline({})).rejects.toThrow('Give an id or a filter');
	});
});

describe('profiling a retained story', () => {
	it('profiles at mount without loading axe, which no check there would use', async () => {
		const bench = await createSpecimenBench({ root: compat });
		try {
			const run = await bench.profile({ filter: { match: 'Smoke Only' }, runs: 1 });
			const report = run.reports[0] as ProfileReport;
			expect(report.checkpoint).toBe('mount');
			expect(report.error).toBeUndefined();
			expect(report.viewport).toBe('1200x900');
			// axe-core alone is over 500 KB.
			const atMount = report.samples[0]?.transferSizeBytes ?? 0;
			const after = await bench.profile({
				filter: { match: 'Smoke Only' },
				runs: 1,
				checkpoint: 'after-run',
			});
			const withAxe = after.reports[0]?.samples[0]?.transferSizeBytes ?? 0;
			expect(withAxe - atMount).toBeGreaterThan(500_000);
			await expect(bench.recordBaseline({ id: report.id })).rejects.toThrow('profile.baselines');
		} finally {
			await bench.close();
		}
	}, 120_000);
});
