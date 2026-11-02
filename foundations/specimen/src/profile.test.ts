import { describe, expect, it } from 'vitest';
import {
	BASELINE_RUNNER,
	compareProfile,
	parseBaselines,
	profileFlags,
	summarizeProfile,
	withBaseline,
} from './profile.js';
import type { ProfileBaseline, ProfileSample } from './types.js';

const sample = (overrides: Partial<ProfileSample> = {}): ProfileSample => ({
	firstContentfulPaintMs: 100,
	domContentLoadedMs: 50,
	loadMs: 60,
	readyMs: 120,
	captureMs: 30,
	totalElements: 100,
	customElements: 2,
	shadowHosts: 2,
	requestCount: 10,
	transferSizeBytes: 1000,
	usedJSHeapSizeBytes: 1_000_000,
	consoleErrors: 0,
	consoleWarnings: 0,
	...overrides,
});
const current = { viewport: '1280x720', checkpoint: 'mount', browser: '156.0' };
const baselineOf = (overrides: Partial<ProfileBaseline> = {}): ProfileBaseline => ({
	storyId: 'a',
	runner: BASELINE_RUNNER,
	viewport: '1280x720',
	checkpoint: 'mount',
	browser: '156.0',
	runs: 3,
	capturedAt: '2026-11-01T00:00:00.000Z',
	summary: summarizeProfile([sample()]),
	budgets: {},
	notes: [],
	...overrides,
});

describe('summarizing a profile', () => {
	it('takes the min, median and max of each metric and totals console counts', () => {
		const summary = summarizeProfile([
			sample({ firstContentfulPaintMs: 120, consoleWarnings: 1 }),
			sample({ firstContentfulPaintMs: 100, consoleErrors: 2 }),
			sample({ firstContentfulPaintMs: 110.126 }),
		]);
		expect(summary.paints.firstContentfulPaintMs).toEqual({ min: 100, median: 110.13, max: 120 });
		expect(summary.console).toEqual({ errorCount: 2, warningCount: 1 });
	});
	it('averages the two middle values of an even count', () => {
		const summary = summarizeProfile([sample({ loadMs: 10 }), sample({ loadMs: 20 })]);
		expect(summary.timings.loadMs?.median).toBe(15);
	});
	it('reports no summary for a metric no run could measure', () => {
		const summary = summarizeProfile([sample({ firstContentfulPaintMs: null })]);
		expect(summary.paints.firstContentfulPaintMs).toBeNull();
	});
});

describe('profile flags', () => {
	const flags = (overrides: Partial<ProfileSample>) =>
		profileFlags(summarizeProfile([sample(overrides)])).map((flag) => [flag.code, flag.severity]);

	it('stays quiet within the thresholds', () => {
		expect(flags({ firstContentfulPaintMs: 1600, totalElements: 450, shadowHosts: 35 })).toEqual(
			[]
		);
	});
	it('grades a slow paint and a large DOM', () => {
		expect(flags({ firstContentfulPaintMs: 1601 })).toEqual([
			['SLOW_FIRST_CONTENTFUL_PAINT', 'warning'],
		]);
		expect(flags({ firstContentfulPaintMs: 2501 })).toEqual([
			['SLOW_FIRST_CONTENTFUL_PAINT', 'high'],
		]);
		expect(flags({ totalElements: 451 })).toEqual([['HIGH_DOM_NODE_COUNT', 'warning']]);
		expect(flags({ totalElements: 701 })).toEqual([['HIGH_DOM_NODE_COUNT', 'high']]);
		expect(flags({ shadowHosts: 36 })).toEqual([['HIGH_SHADOW_HOST_COUNT', 'warning']]);
	});
	it('reports console errors over warnings', () => {
		expect(flags({ consoleWarnings: 1 })).toEqual([['CONSOLE_WARNINGS_PRESENT', 'warning']]);
		expect(flags({ consoleErrors: 1, consoleWarnings: 1 })).toEqual([
			['CONSOLE_ERRORS_PRESENT', 'high'],
		]);
	});
});

describe('comparing with a baseline', () => {
	const compare = (overrides: Partial<ProfileSample>, baseline = baselineOf()) =>
		compareProfile(baseline, summarizeProfile([sample(overrides)]), current);

	it('passes within the tolerances', () => {
		const result = compare({
			firstContentfulPaintMs: 120,
			totalElements: 115,
			requestCount: 11,
			transferSizeBytes: 1150,
			usedJSHeapSizeBytes: 1_200_000,
		});
		expect(result.status).toBe('passed');
		expect(result.warnings).toEqual([]);
	});
	it('warns past each tolerance', () => {
		const result = compare({
			firstContentfulPaintMs: 121,
			totalElements: 116,
			requestCount: 12,
			transferSizeBytes: 1151,
			usedJSHeapSizeBytes: 1_200_001,
		});
		expect(result.status).toBe('warnings');
		expect(result.warnings.map((finding) => finding.code)).toEqual([
			'PERF_REGRESSION_FCP',
			'PERF_REGRESSION_DOM',
			'PERF_REGRESSION_REQUESTS',
			'PERF_REGRESSION_TRANSFER',
			'PERF_REGRESSION_HEAP',
		]);
	});
	it('fails past a budget, ahead of its tolerance', () => {
		const result = compare(
			{ firstContentfulPaintMs: 500 },
			baselineOf({ budgets: { firstContentfulPaintMs: 400 } })
		);
		expect(result.status).toBe('failed');
		expect(result.errors).toMatchObject([
			{ code: 'PERF_BUDGET_EXCEEDED_FCP', current: 500, allowed: 400 },
		]);
		expect(result.warnings).toEqual([]);
	});
	it('holds console counts to the budget, or else the baseline', () => {
		expect(compare({ consoleErrors: 1 }).errors[0]?.code).toBe('PERF_CONSOLE_ERRORS_EXCEEDED');
		expect(compare({ consoleWarnings: 1 }).warnings[0]?.code).toBe(
			'PERF_CONSOLE_WARNINGS_EXCEEDED'
		);
		const allowed = baselineOf({ budgets: { consoleErrorCount: 1 } });
		expect(compare({ consoleErrors: 1 }, allowed).status).toBe('passed');
	});
	it('refuses to compare a baseline from another page, viewport, checkpoint or browser', () => {
		const storybook = baselineOf({ runner: undefined, baseUrl: 'http://localhost:6008' });
		const fromStorybook = compare({ firstContentfulPaintMs: 900 }, storybook);
		expect(fromStorybook.status).toBe('not-comparable');
		expect(fromStorybook.reason).toContain('http://localhost:6008');
		expect(fromStorybook.warnings).toEqual([]);
		for (const [field, value] of [
			['viewport', '375x812'],
			['checkpoint', 'after-run'],
			['browser', '155.0'],
		] as const)
			expect(compare({}, baselineOf({ [field]: value })).status).toBe('not-comparable');
	});
	it('still applies an absolute budget when the baseline is not comparable', () => {
		const result = compare(
			{ totalElements: 500 },
			baselineOf({ runner: undefined, budgets: { totalElements: 400 } })
		);
		expect(result.status).toBe('failed');
		expect(result.errors[0]?.code).toBe('PERF_BUDGET_EXCEEDED_DOM');
	});
});

describe('the baselines file', () => {
	const record = {
		storyId: 'a',
		runner: BASELINE_RUNNER,
		viewport: '1280x720',
		checkpoint: 'mount',
		browser: '156.0',
		runs: 5,
		capturedAt: '2026-11-01T00:00:00.000Z',
		summary: summarizeProfile([sample()]),
	};

	it('reads comments, as a .jsonc file may have', () => {
		const text = '// a note\n{ /* inline */ "stories": { "a": { "baseUrl": "http://x//y" } } }';
		expect(parseBaselines(text, 'file').stories.a?.baseUrl).toBe('http://x//y');
	});
	it('explains a file it cannot read', () => {
		expect(() => parseBaselines('{', 'file')).toThrow('not valid JSON');
		expect(() => parseBaselines('{}', 'file')).toThrow('"stories" object');
	});
	it('creates a file, with empty budgets', () => {
		const written = JSON.parse(withBaseline(null, 'file', 'a', record, ['first']));
		expect(written.stories.a.budgets.firstContentfulPaintMs).toBeNull();
		expect(written.stories.a.notes).toEqual(['first']);
	});
	it('keeps budgets a person set, and says what a new baseline replaced', () => {
		const existing = JSON.stringify({
			version: '0.1.0',
			description: 'kept',
			stories: {
				a: {
					baseUrl: 'http://localhost:6008',
					capturedAt: '2026-03-19',
					budgets: { totalElements: 400 },
				},
				b: { capturedAt: '2026-03-19' },
			},
		});
		const written = JSON.parse(withBaseline(existing, 'file', 'a', record, []));
		expect(written.description).toBe('kept');
		expect(written.stories.b).toEqual({ capturedAt: '2026-03-19' });
		expect(written.stories.a.runner).toBe(BASELINE_RUNNER);
		expect(written.stories.a.budgets).toEqual({ totalElements: 400 });
		expect(written.stories.a.notes[0]).toContain('http://localhost:6008');
	});
	it('refuses to write over comments it would lose', () => {
		expect(() => withBaseline('// note\n{"stories":{}}', 'file', 'a', record, [])).toThrow(
			'comments'
		);
	});
});
