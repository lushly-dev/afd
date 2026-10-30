import { describe, expect, it } from 'vitest';
import { fixture, fixtureNames } from './fixtures.test-helper';
import type { HealthReport } from './types';
import { STATUSES } from './types';
import {
	countStatuses,
	DEFAULT_QUERY,
	describeEvidence,
	plural,
	SORT_COLUMN,
	SORT_OPTIONS,
	STATUS_PRESENTATION,
	selectOutcomes,
} from './view';

const mixed = JSON.parse(fixture('reports/mixed-status.report.json')) as HealthReport;

describe('status presentation', () => {
	it('gives all seven statuses distinct words and distinct icon/fill pairs', () => {
		const looks = STATUSES.map((status) => STATUS_PRESENTATION[status]);
		expect(new Set(looks.map((look) => look.label)).size).toBe(7);
		expect(new Set(looks.map((look) => look.icon)).size).toBe(7);
		expect(new Set(looks.map((look) => `${look.color}/${look.appearance}`)).size).toBe(7);
		expect(new Set(looks.map((look) => look.rank)).size).toBe(7);
		for (const status of STATUSES)
			expect(STATUS_PRESENTATION[status].icon).toBe(`health/${status}`);
	});

	it('never presents a non-passing status like a pass', () => {
		for (const status of STATUSES.filter((item) => item !== 'passed')) {
			const look = STATUS_PRESENTATION[status];
			expect(look.color).not.toBe('success');
			expect(look.label.toLowerCase()).not.toContain('pass');
		}
	});
});

describe('selectOutcomes', () => {
	it('keeps report order by default', () => {
		expect(selectOutcomes(mixed.outcomes, DEFAULT_QUERY)).toEqual(mixed.outcomes);
	});

	it('filters by status and target together', () => {
		const rows = selectOutcomes(mixed.outcomes, {
			...DEFAULT_QUERY,
			status: 'failed',
			target: 'web-app',
		});
		expect(rows.map((row) => row.check_id)).toEqual([
			'lefthook_configured',
			'commitlint_configured',
			'linter_strict',
		]);
	});

	it('sorts by status severity with report order as the tie-break', () => {
		const rows = selectOutcomes(mixed.outcomes, { ...DEFAULT_QUERY, sort: 'status' });
		const ranks = rows.map((row) => STATUS_PRESENTATION[row.status].rank);
		expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
		expect(rows[0]?.status).toBe('failed');
		expect(rows.at(-1)?.status).toBe('passed');
	});

	it.each([
		['check', (row: HealthReport['outcomes'][0]) => row.check_id],
		['target', (row: HealthReport['outcomes'][0]) => row.target],
	] as const)('sorts by %s alphabetically', (sort, key) => {
		const values = selectOutcomes(mixed.outcomes, { ...DEFAULT_QUERY, sort }).map(key);
		expect(values).toEqual([...values].sort());
	});

	it('sorts required before advisory', () => {
		const rows = selectOutcomes(mixed.outcomes, { ...DEFAULT_QUERY, sort: 'severity' });
		const firstAdvisory = rows.findIndex((row) => row.severity === 'advisory');
		expect(rows.slice(firstAdvisory).every((row) => row.severity === 'advisory')).toBe(true);
	});

	it('maps every sort option to a column or to report order', () => {
		for (const option of SORT_OPTIONS) expect(option.value in SORT_COLUMN).toBe(true);
	});
});

describe('helpers', () => {
	it('counts statuses like Health summaries', () => {
		for (const name of fixtureNames('reports')) {
			const report = JSON.parse(fixture(`reports/${name}`)) as HealthReport;
			expect(countStatuses(report.outcomes)).toEqual(report.summary);
		}
	});

	it('describes evidence without repeating its constant kind', () => {
		expect(
			describeEvidence({
				paths: ['.git'],
				required_tools: ['git'],
				kind: 'local_configuration_heuristic',
				metric: '2/2',
				error_type: 'JSONDecodeError',
			})
		).toEqual([
			{ label: 'Reads', values: ['.git'] },
			{ label: 'Needs', values: ['git'] },
			{ label: 'Metric', values: ['2/2'] },
			{ label: 'Error type', values: ['JSONDecodeError'] },
		]);
		expect(
			describeEvidence({ paths: [], required_tools: [], kind: 'local_configuration_heuristic' })
		).toEqual([]);
	});

	it('pluralizes counts', () => {
		expect(plural(1, 'report', 'reports')).toBe('1 report');
		expect(plural(2, 'report', 'reports')).toBe('2 reports');
	});
});
