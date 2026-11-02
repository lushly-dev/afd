import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './bench.js';
import type { A11yReport } from './types.js';

const fixtures = resolve(import.meta.dirname, '../fixtures/accessibility');
const compat = resolve(import.meta.dirname, '../compat/failing');

describe('accessibility checks on native specimens', () => {
	let bench: SpecimenBench;
	const report = async (id: string, checkpoint?: string): Promise<A11yReport> => {
		const { reports } = await bench.a11y({ id, ...(checkpoint ? { checkpoint } : {}) });
		return reports[0] as A11yReport;
	};

	beforeAll(async () => {
		bench = await createSpecimenBench({ root: fixtures });
	});
	afterAll(async () => {
		await bench.close();
	});

	it('passes a clean specimen and fails a violation, with what axe found', async () => {
		expect(await report('clean')).toMatchObject({
			status: 'passed',
			policy: 'error',
			violations: [],
			engine: '4.13.0',
			exceptions: [],
			failures: [],
		});
		const failing = await report('violating');
		expect(failing.status).toBe('failed');
		expect(failing.violations).toMatchObject([{ id: 'image-alt', targets: ['img'] }]);
		expect(failing.violations[0]?.details[0]).toContain('alt');
	});

	it('reports an exception and what it excused, with its reason', async () => {
		const excepted = await report('excepted');
		expect(excepted.status).toBe('passed');
		expect(excepted.violations).toEqual([]);
		expect(excepted.exceptions).toEqual([
			{
				rule: 'image-alt',
				target: '[data-legacy]',
				reason: 'Legacy artwork, replaced in the next release.',
				matched: [expect.stringContaining('img')],
			},
		]);
	});

	it('never lets an exception reach past its target or its rule', async () => {
		const partly = await report('partly-excepted');
		expect(partly.status).toBe('failed');
		expect(partly.violations[0]?.targets).toHaveLength(1);
		expect(partly.exceptions[0]?.matched).toHaveLength(1);
		const otherRule = await report('other-rule');
		expect(otherRule.status).toBe('failed');
		expect(otherRule.exceptions[0]?.matched).toEqual([]);
	});

	it('follows a target into a shadow root', async () => {
		const inShadow = await report('in-shadow');
		expect(inShadow.status).toBe('passed');
		expect(inShadow.exceptions[0]?.matched).toHaveLength(1);
	});

	it('shows an exception that excused nothing, which may be stale', async () => {
		const stale = await report('stale-exception');
		expect(stale.status).toBe('passed');
		expect(stale.exceptions[0]?.matched).toEqual([]);
	});

	it('reports a disabled check and its reason, and finds nothing', async () => {
		expect(await report('disabled')).toMatchObject({
			status: 'not-run',
			policy: 'disabled',
			reason: 'A fixture of the broken state itself.',
			violations: [],
		});
	});

	it('refuses an exclusion without a reason or a target', async () => {
		for (const [id, field] of [
			['no-reason', 'reason'],
			['no-target', 'target'],
		] as const) {
			const refused = await report(id);
			expect(refused.status).toBe('not-run');
			expect(refused.failures[0]?.category).toBe('render');
			expect(refused.failures[0]?.message).toContain(`${field} is required`);
		}
	});

	it('reports what axe could not decide, without passing or failing it', async () => {
		const undecided = await report('undecided');
		expect(undecided.status).toBe('passed');
		expect(undecided.incomplete).toBe(undecided.incompleteChecks.length);
		expect(undecided.incompleteChecks.map((check) => check.id)).toContain('color-contrast');
		expect(undecided.incompleteChecks[0]?.targets).toHaveLength(1);
	});

	it('checks the state at the checkpoint it is asked for', async () => {
		expect((await report('after-scenario', 'mount')).status).toBe('passed');
		const after = await report('after-scenario');
		expect(after.checkpoint).toBe('after-run');
		expect(after.status).toBe('failed');
		expect(after.violations[0]?.id).toBe('image-alt');
	});

	it('checks everything a filter selects, and counts each status', async () => {
		const run = await bench.a11y({ workers: 2 });
		expect(run.workers).toBe(2);
		expect(run.reports.map((item) => item.id)).toEqual(bench.list().map((entry) => entry.id));
		expect(run.counts.total).toBe(12);
		expect(run.counts.passed + run.counts.warning + run.counts.failed + run.counts.notRun).toBe(12);
		const filtered = await bench.a11y({ filter: { match: 'A11y/Clean' } });
		expect(filtered.reports.map((item) => item.id)).toEqual(['clean']);
		await expect(bench.a11y({ id: 'missing' })).rejects.toThrow('Specimen not found');
		await expect(bench.a11y({ filter: { match: 'no such thing' } })).rejects.toThrow('matches');
		await expect(bench.a11y({ id: 'clean', filter: {} })).rejects.toThrow('not both');
	});
});

describe('accessibility checks on retained stories', () => {
	let bench: SpecimenBench;
	const reportOf = async (name: string, checkpoint?: string): Promise<A11yReport> => {
		const id = bench.list().find((entry) => entry.story?.name === name)?.id as string;
		const { reports } = await bench.a11y({ id, ...(checkpoint ? { checkpoint } : {}) });
		return reports[0] as A11yReport;
	};

	beforeAll(async () => {
		bench = await createSpecimenBench({ root: compat });
	});
	afterAll(async () => {
		await bench.close();
	});

	it("keeps the story's own policy", async () => {
		expect(await reportOf('Accessibility Failure')).toMatchObject({
			status: 'failed',
			policy: 'error',
			violations: [{ id: 'image-alt' }],
			exceptions: [],
		});
		expect(await reportOf('Accessibility Todo')).toMatchObject({
			status: 'warning',
			policy: 'todo',
		});
		expect(await reportOf('Accessibility Off')).toMatchObject({
			status: 'not-run',
			policy: 'off',
		});
	});

	it('says when a play stopped the run before its check', async () => {
		const failing = await reportOf('Interaction Failure');
		expect(failing.status).toBe('not-run');
		expect(failing.failures).toMatchObject([{ category: 'play' }]);
		// At mount there is no play to stop it.
		const mounted = await reportOf('Interaction Failure', 'mount');
		expect(mounted.status).toBe('passed');
		expect(mounted.failures).toEqual([]);
	});

	it("records a run's check in its capture", async () => {
		const id = bench.list().find((entry) => entry.story?.name === 'Accessibility Failure')?.id;
		const { observation } = await bench.run({ id: id as string });
		const axe = observation?.channels.a11y.axe;
		expect(axe === 'not-run' ? null : axe?.violations[0]?.id).toBe('image-alt');
		expect(observation?.completeness.a11y.status).toBe('complete');
	});
});
