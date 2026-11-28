import { describe, expect, it } from 'vitest';
import { fixture } from './fixtures.test-helper';
import {
	describeTrend,
	formatValue,
	measureChoices,
	measureTrend,
	orderReports,
	plotGeometry,
	resolveSelection,
	type TrendSource,
} from './trend';
import type { HealthReport } from './types';
import { parseReport } from './validate';

/** The three dated Health CLI fixtures, loaded out of date order as a file picker might. */
const DAYS = ['2026-01-03', '2026-01-01', '2026-01-02'];
const load = (day: string): TrendSource => {
	const source = `trend-${day}.report.json`;
	const result = parseReport(fixture(`reports/${source}`), source);
	if (!result.ok) throw new Error(`${source}: ${result.message}`);
	return { source, report: result.report };
};
const sources = () => DAYS.map(load);

describe('measureTrend over the dated fixtures', () => {
	it('lists each measure once, by key and target, with how many reports carry it', () => {
		expect(measureChoices(sources())).toEqual([
			{
				id: 'files_over_warn',
				key: 'files_over_warn',
				label: 'Files over size warning',
				unit: 'files',
				direction: 'lower_is_better',
				reports: 2,
			},
			{
				id: 'line_coverage@tidy-lib',
				key: 'line_coverage',
				target: 'tidy-lib',
				label: 'Line coverage',
				unit: 'percent',
				direction: 'higher_is_better',
				reports: 3,
			},
		]);
	});

	it('orders the points by generated_at and plots the shared measure in every report', () => {
		const trend = measureTrend(sources(), 'line_coverage@tidy-lib');
		expect(trend?.points).toEqual([
			{ source: 'trend-2026-01-01.report.json', generatedAt: '2026-01-01T06:00:00Z', value: 90 },
			{ source: 'trend-2026-01-02.report.json', generatedAt: '2026-01-02T06:00:00Z', value: 90.75 },
			{ source: 'trend-2026-01-03.report.json', generatedAt: '2026-01-03T06:00:00Z', value: 91.5 },
		]);
		expect(trend?.change).toMatchObject({ delta: 0.75, verdict: 'better' });
		expect(describeTrend(trend as NonNullable<typeof trend>)).toBe(
			'Line coverage is 91.5 percent, up 0.75 since 2026-01-02: better (3 of 3 reports).'
		);
	});

	it('leaves a gap, not a zero, for the report without the measure', () => {
		const trend = measureTrend(sources(), 'files_over_warn');
		expect(trend?.points.map(({ value, gap }) => ({ value, gap }))).toEqual([
			{ value: 4, gap: undefined },
			{ value: null, gap: 'missing' },
			{ value: 2, gap: undefined },
		]);
		// Lower is better, so a fall is an improvement, measured across the gap.
		expect(trend?.change).toMatchObject({ delta: -2, verdict: 'better' });
		const geometry = plotGeometry(trend as NonNullable<typeof trend>);
		expect(geometry.markers).toHaveLength(2);
		expect(geometry.slots).toHaveLength(3);
		// Each side of the gap is a lone point, so no line crosses it.
		expect(geometry.runs).toEqual([]);
	});

	it('is null for a measure no report carries', () => {
		expect(measureTrend(sources(), 'line_coverage')).toBeNull();
	});
});

describe('measureTrend rules', () => {
	const base = load('2026-01-01').report;
	const at = (
		generated_at: string,
		measures: HealthReport['measures'],
		source = generated_at
	): TrendSource => ({ source, report: { ...base, generated_at, measures } });
	const m = (
		value: number,
		unit = 'files',
		direction: 'lower_is_better' | 'neutral' = 'lower_is_better'
	) => ({
		key: 'k',
		label: 'K',
		value,
		unit,
		direction,
	});

	it('breaks the series at a value recorded in another unit, and takes the newest unit', () => {
		const trend = measureTrend(
			[
				at('2026-01-01T00:00:00Z', [m(1, 'bytes')]),
				at('2026-01-02T00:00:00Z', [m(3)]),
				at('2026-01-03T00:00:00Z', [m(2)]),
			],
			'k'
		);
		expect(trend?.measure.unit).toBe('files');
		expect(trend?.points.map((point) => point.gap)).toEqual(['unit', undefined, undefined]);
	});

	it('calls a rise worse when lower is better, and judges nothing for a neutral measure', () => {
		const worse = measureTrend(
			[at('2026-01-01T00:00:00Z', [m(1)]), at('2026-01-02T00:00:00Z', [m(3)])],
			'k'
		);
		expect(worse?.change?.verdict).toBe('worse');
		const neutral = measureTrend(
			[
				at('2026-01-01T00:00:00Z', [m(1, 'files', 'neutral')]),
				at('2026-01-02T00:00:00Z', [m(3, 'files', 'neutral')]),
			],
			'k'
		);
		expect(neutral?.change?.verdict).toBe('changed');
		expect(describeTrend(neutral as NonNullable<typeof neutral>)).toContain(
			'neither better nor worse'
		);
	});

	it('orders same-second reports by name, and keeps a single point without a change', () => {
		const ordered = orderReports([
			at('2026-01-01T00:00:00Z', [], 'b'),
			at('2026-01-01T00:00:00Z', [], 'a'),
		]);
		expect(ordered.map((entry) => entry.source)).toEqual(['a', 'b']);
		const single = measureTrend([at('2026-01-01T00:00:00Z', [m(5)])], 'k');
		expect(single?.change).toBeUndefined();
		expect(describeTrend(single as NonNullable<typeof single>)).toBe(
			'K is 5 files in the one report that has it (1 of 1 report).'
		);
		expect(plotGeometry(single as NonNullable<typeof single>).markers).toHaveLength(1);
	});

	it('places points in proportion to time and keeps the values inside the y ticks', () => {
		const trend = measureTrend(
			[
				at('2026-01-01T00:00:00Z', [m(10)]),
				at('2026-01-02T00:00:00Z', [m(12)]),
				at('2026-01-05T00:00:00Z', [m(11)]),
			],
			'k'
		);
		const geometry = plotGeometry(trend as NonNullable<typeof trend>);
		const [a, b, c] = geometry.markers.map((marker) => marker.x);
		expect(((b as number) - (a as number)) * 4).toBeCloseTo((c as number) - (a as number), 1);
		expect(geometry.runs).toHaveLength(1);
		const ticks = geometry.yTicks.map((tick) => tick.value);
		expect(Math.min(...ticks)).toBeLessThanOrEqual(10);
		expect(Math.max(...ticks)).toBeGreaterThanOrEqual(12);
		for (const marker of geometry.markers) {
			expect(marker.y).toBeGreaterThanOrEqual(geometry.plot.top);
			expect(marker.y).toBeLessThanOrEqual(geometry.plot.bottom);
		}
	});
});

describe('values at the edge of the schema', () => {
	const base = load('2026-01-01').report;
	const series = (values: number[]): TrendSource[] =>
		values.map((value, index) => ({
			source: `r${index}`,
			report: {
				...base,
				generated_at: `2026-01-0${index + 1}T00:00:00Z`,
				measures: [{ key: 'k', label: 'K', value, unit: 'bytes', direction: 'neutral' }],
			},
		}));

	it.each([
		[2 ** 52, 2 ** 52 + 1],
		[Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER],
		[-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
	])('plots %d and %d in bounded time with distinct ticks', (a, b) => {
		const trend = measureTrend(series([a, b]), 'k') as NonNullable<ReturnType<typeof measureTrend>>;
		const geometry = plotGeometry(trend);
		const labels = geometry.yTicks.map((tick) => formatValue(tick.value));
		expect(new Set(labels).size).toBe(labels.length);
		expect(labels.length).toBeLessThanOrEqual(13);
		for (const marker of geometry.markers) expect(Number.isFinite(marker.y)).toBe(true);
	});

	it('shows integers exactly and strips subtraction noise from fractions', () => {
		expect(formatValue(123456789012345)).toBe('123456789012345');
		expect(formatValue(0.1 + 0.2)).toBe('0.3');
	});
});

describe('resolveSelection', () => {
	it('keeps the chosen measure while a report carries it, and falls back when it goes', () => {
		const choices = measureChoices(sources());
		expect(resolveSelection(choices, 'line_coverage@tidy-lib')).toBe('line_coverage@tidy-lib');
		expect(resolveSelection(measureChoices(sources().slice(0, 1)), 'files_over_warn')).toBe(
			'files_over_warn'
		);
		// The 2026-01-02 report alone has no files_over_warn, so the choice moves to what it has.
		expect(resolveSelection(measureChoices([load('2026-01-02')]), 'files_over_warn')).toBe(
			'line_coverage@tidy-lib'
		);
		expect(resolveSelection(choices, undefined)).toBe('files_over_warn');
		expect(resolveSelection([], 'files_over_warn')).toBe('');
	});
});
