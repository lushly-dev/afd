/**
 * One measure across the loaded reports: which measures there are, the series of one of
 * them in `generated_at` order, its latest change and the plot's geometry. Pure, so the
 * page and its tests share every rule.
 */
import type { HealthReport, Measure, MeasureDirection } from './types';

/** A loaded report and the name the page shows for it. */
export interface TrendSource {
	source: string;
	report: HealthReport;
}

/** A measure is identified by its key and, when it has one, its target. */
export interface MeasureChoice {
	id: string;
	key: string;
	target?: string;
	label: string;
	unit: string;
	direction: MeasureDirection;
	/** How many loaded reports carry it. */
	reports: number;
}

export type GapReason = 'missing' | 'unit';

export interface TrendPoint {
	source: string;
	generatedAt: string;
	/** Null is a gap: the report doesn't carry this measure, or carries it in another unit. */
	value: number | null;
	gap?: GapReason;
}

export type ChangeVerdict = 'better' | 'worse' | 'unchanged' | 'changed';

export interface TrendChange {
	from: TrendPoint & { value: number };
	to: TrendPoint & { value: number };
	delta: number;
	verdict: ChangeVerdict;
}

export interface Trend {
	measure: MeasureChoice;
	points: TrendPoint[];
	/** Between the two newest points that have a value; absent with fewer than two. */
	change?: TrendChange;
}

export const DIRECTION_TEXT: Record<MeasureDirection, string> = {
	higher_is_better: 'Higher is better',
	lower_is_better: 'Lower is better',
	neutral: 'Neither direction is better',
};

export const GAP_TEXT: Record<GapReason, string> = {
	missing: 'Not in this report',
	unit: 'Recorded in another unit',
};

export const measureId = (measure: Pick<Measure, 'key' | 'target'>) =>
	measure.target === undefined ? measure.key : `${measure.key}@${measure.target}`;

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Oldest first; reports generated in the same second keep their names' order. */
export function orderReports(sources: readonly TrendSource[]): TrendSource[] {
	return sources
		.map((entry, index) => ({ entry, index }))
		.sort(
			(a, b) =>
				compareText(a.entry.report.generated_at, b.entry.report.generated_at) ||
				compareText(a.entry.source, b.entry.source) ||
				a.index - b.index
		)
		.map(({ entry }) => entry);
}

/**
 * Every measure any loaded report carries. Its label, unit and direction come from the
 * newest report that carries it, since a producer may have renamed it since.
 */
export function measureChoices(sources: readonly TrendSource[]): MeasureChoice[] {
	const choices = new Map<string, MeasureChoice>();
	const ordered = orderReports(sources);
	for (const { report } of ordered)
		for (const measure of report.measures)
			choices.set(measureId(measure), {
				id: measureId(measure),
				key: measure.key,
				...(measure.target === undefined ? {} : { target: measure.target }),
				label: measure.label,
				unit: measure.unit,
				direction: measure.direction,
				reports: 0,
			});
	// Count only the reports whose value can be plotted: those in the newest unit.
	for (const { report } of ordered)
		for (const measure of report.measures) {
			const choice = choices.get(measureId(measure));
			if (choice && choice.unit === measure.unit) choice.reports++;
		}
	return [...choices.values()].sort(
		(a, b) => compareText(a.label, b.label) || compareText(a.id, b.id)
	);
}

/** Keeps the reader's choice while a loaded report still carries it; else the first measure. */
export function resolveSelection(choices: readonly MeasureChoice[], wanted?: string): string {
	return choices.find((choice) => choice.id === wanted)?.id ?? choices[0]?.id ?? '';
}

/** The chosen measure across every loaded report; null when no report carries it. */
export function measureTrend(sources: readonly TrendSource[], id: string): Trend | null {
	const measure = measureChoices(sources).find((choice) => choice.id === id);
	if (!measure) return null;
	const points = orderReports(sources).map(({ source, report }): TrendPoint => {
		const found = report.measures.find((item) => measureId(item) === id);
		const base = { source, generatedAt: report.generated_at };
		if (!found) return { ...base, value: null, gap: 'missing' };
		// A value in another unit isn't comparable; showing it would draw a false step.
		if (found.unit !== measure.unit) return { ...base, value: null, gap: 'unit' };
		return { ...base, value: found.value };
	});
	const valued = points.filter(
		(point): point is TrendPoint & { value: number } => point.value !== null
	);
	const [from, to] = valued.slice(-2);
	if (!from || !to) return { measure, points };
	return { measure, points, change: describeChange(from, to, measure.direction) };
}

function describeChange(
	from: TrendChange['from'],
	to: TrendChange['to'],
	direction: MeasureDirection
): TrendChange {
	const delta = to.value - from.value;
	let verdict: ChangeVerdict = 'changed';
	if (delta === 0) verdict = 'unchanged';
	else if (direction !== 'neutral')
		verdict = delta > 0 === (direction === 'higher_is_better') ? 'better' : 'worse';
	return { from, to, delta, verdict };
}

/** `90.75` stays `90.75`; floating-point noise from a subtraction doesn't. */
/** Strips floating-point noise (`0.1 + 0.2`) from fractions; integers are exact already. */
const cleanFloat = (value: number) =>
	Number.isInteger(value) ? value : Number.parseFloat(value.toPrecision(12));

/** `90.75` stays `90.75`, a 15-digit count keeps every digit, and subtraction noise goes. */
export const formatValue = (value: number) => String(cleanFloat(value));

export const formatValueWithUnit = (value: number, unit: string) => `${formatValue(value)} ${unit}`;

const VERDICT_TEXT: Record<ChangeVerdict, string> = {
	better: 'better',
	worse: 'worse',
	unchanged: 'unchanged',
	changed: 'neither better nor worse',
};

/** One sentence a reader can act on, in words: never a colour or an arrow alone. */
export function describeTrend(trend: Trend): string {
	const { change, measure } = trend;
	const present = trend.points.filter((point) => point.value !== null).length;
	const of = `${present} of ${trend.points.length} ${trend.points.length === 1 ? 'report' : 'reports'}`;
	if (!change) {
		const only = trend.points.find((point) => point.value !== null);
		return only
			? `${measure.label} is ${formatValueWithUnit(only.value as number, measure.unit)} in the one report that has it (${of}).`
			: `${measure.label} has no comparable values (${of}).`;
	}
	const latest = formatValueWithUnit(change.to.value, measure.unit);
	if (change.verdict === 'unchanged')
		return `${measure.label} is ${latest}, unchanged since ${change.from.generatedAt.slice(0, 10)} (${of}).`;
	const way = change.delta > 0 ? 'up' : 'down';
	return `${measure.label} is ${latest}, ${way} ${formatValue(Math.abs(change.delta))} since ${change.from.generatedAt.slice(0, 10)}: ${VERDICT_TEXT[change.verdict]} (${of}).`;
}

export interface PlotMarker {
	x: number;
	y: number;
	point: TrendPoint & { value: number };
}

export interface PlotGeometry {
	width: number;
	height: number;
	/** One path per unbroken run; a gap ends a run. */
	runs: string[];
	markers: PlotMarker[];
	/** Where each report falls on the time axis, gap or not. */
	slots: { x: number; point: TrendPoint }[];
	yTicks: { y: number; value: number }[];
	xTicks: { x: number; label: string }[];
	plot: { left: number; right: number; top: number; bottom: number };
}

export const PLOT_SIZE = { width: 640, height: 240 };
const MARGIN = { left: 64, right: 24, top: 16, bottom: 36 };

/** Round tick steps (1, 2 or 5 times a power of ten) for about four intervals. */
function niceTicks(min: number, max: number): number[] {
	const span = max - min;
	const raw = span / 4;
	const power = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
	const start = Math.floor(min / step) * step;
	// Counted up front, never by adding: near 2^53 `v += step` can stop moving and never end.
	const count = Math.min(12, Math.max(1, Math.ceil((max - start) / step)));
	const ticks = Array.from({ length: count + 1 }, (_, index) => cleanFloat(start + index * step));
	// Too large to step through: label the ends only, as they are.
	return new Set(ticks).size === ticks.length ? ticks : [min, max];
}

/**
 * The plot in SVG user units. Time is proportional, so a missing day shows as distance;
 * the y-axis spans round ticks around the values, so a flat series doesn't fill the box.
 */
export function plotGeometry(trend: Trend, size = PLOT_SIZE): PlotGeometry {
	const plot = {
		left: MARGIN.left,
		right: size.width - MARGIN.right,
		top: MARGIN.top,
		bottom: size.height - MARGIN.bottom,
	};
	const times = trend.points.map((point) => Date.parse(point.generatedAt));
	const first = Math.min(...times);
	const last = Math.max(...times);
	const x = (time: number) =>
		last === first
			? (plot.left + plot.right) / 2
			: plot.left + ((time - first) / (last - first)) * (plot.right - plot.left);

	const values = trend.points.flatMap((point) => (point.value === null ? [] : [point.value]));
	let low = Math.min(...values);
	let high = Math.max(...values);
	if (!values.length) [low, high] = [0, 1];
	else if (low === high)
		[low, high] = [
			low - Math.max(1, Math.abs(low) * 0.1),
			high + Math.max(1, Math.abs(high) * 0.1),
		];
	// A little room past the extremes keeps the outermost markers off the axis and the box edge.
	const pad = (high - low) * 0.08;
	const ticks = niceTicks(low - pad, high + pad);
	const bottomValue = Math.min(ticks[0] as number, low);
	const topValue = Math.max(ticks.at(-1) as number, high);
	const y = (value: number) =>
		plot.bottom - ((value - bottomValue) / (topValue - bottomValue)) * (plot.bottom - plot.top);

	const round = (n: number) => Math.round(n * 100) / 100;
	const slots = trend.points.map((point, index) => ({
		x: round(x(times[index] as number)),
		point,
	}));
	const markers: PlotMarker[] = [];
	const runs: string[] = [];
	let run: string[] = [];
	for (const { x: px, point } of slots) {
		if (point.value === null) {
			if (run.length > 1) runs.push(run.join(' '));
			run = [];
			continue;
		}
		const py = round(y(point.value));
		markers.push({ x: px, y: py, point: point as TrendPoint & { value: number } });
		run.push(`${run.length ? 'L' : 'M'}${px} ${py}`);
	}
	if (run.length > 1) runs.push(run.join(' '));

	// Label at most six days, always the first and the last, so labels never collide.
	const every = Math.max(1, Math.ceil(slots.length / 6));
	const xTicks = slots
		.filter(
			(_, index) =>
				index === slots.length - 1 ||
				(index % every === 0 && (index === 0 || slots.length - 1 - index >= every / 2))
		)
		.filter((slot, index, all) => all.findIndex((other) => other.x === slot.x) === index)
		.map((slot) => ({ x: slot.x, label: slot.point.generatedAt.slice(0, 10) }));
	return {
		...size,
		runs,
		markers,
		slots,
		yTicks: ticks.map((value) => ({ value, y: round(y(value)) })),
		xTicks,
		plot,
	};
}
