/** The trend across every loaded report: which measure is chosen, and its series. */
import { observable } from '@lushly-dev/fast-element';
import {
	DIRECTION_TEXT,
	describeTrend,
	formatValueWithUnit,
	GAP_TEXT,
	type MeasureChoice,
	measureChoices,
	measureTrend,
	resolveSelection,
	type Trend,
	type TrendPoint,
	type TrendSource,
} from '../report/trend';
import { formatGeneratedAt } from '../report/view';
import type { Choice } from './report-view';

export interface TrendRow {
	when: string;
	generatedAt: string;
	source: string;
	value: string;
	gap: boolean;
}

export class TrendView {
	declare selected: string;
	readonly choices: MeasureChoice[];
	readonly measureOptions: Choice[];

	/** `previous` keeps the reader's choice when reports are added or removed. */
	constructor(
		readonly sources: readonly TrendSource[],
		previous?: string
	) {
		this.choices = measureChoices(sources);
		this.measureOptions = this.choices.map((choice) => ({
			value: choice.id,
			label: choice.target === undefined ? choice.label : `${choice.label} (${choice.target})`,
		}));
		this.selected = resolveSelection(this.choices, previous);
	}

	get trend(): Trend | null {
		return measureTrend(this.sources, this.selected);
	}

	get measure(): MeasureChoice | undefined {
		return this.trend?.measure;
	}

	get direction(): string {
		return this.measure ? DIRECTION_TEXT[this.measure.direction] : '';
	}

	get summary(): string {
		const trend = this.trend;
		return trend ? describeTrend(trend) : '';
	}

	get rows(): TrendRow[] {
		const trend = this.trend;
		if (!trend) return [];
		return trend.points.map((point: TrendPoint) => ({
			when: formatGeneratedAt(point.generatedAt),
			generatedAt: point.generatedAt,
			source: point.source,
			value:
				point.value === null
					? GAP_TEXT[point.gap ?? 'missing']
					: formatValueWithUnit(point.value, trend.measure.unit),
			gap: point.value === null,
		}));
	}

	select(value: string): void {
		if (this.choices.some((choice) => choice.id === value)) this.selected = value;
	}
}

observable(TrendView.prototype, 'selected');
