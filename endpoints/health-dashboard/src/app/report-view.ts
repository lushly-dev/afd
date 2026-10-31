/** One validated report as the page shows it, with its own filter and sort state. */
import { observable } from '@lushly-dev/fast-element';
import type { HealthReport, Outcome, ReportTarget, Status } from '../report/types';
import { STATUSES } from '../report/types';
import { deriveVerdict, type Verdict } from '../report/verdict';
import {
	countStatuses,
	DEFAULT_QUERY,
	type OutcomeQuery,
	SORT_COLUMN,
	SORT_OPTIONS,
	type SortKey,
	STATUS_PRESENTATION,
	type StatusFilter,
	selectOutcomes,
} from '../report/view';

let sequence = 0;

export interface TargetRow {
	target: ReportTarget;
	verdict: Verdict;
	counts: Record<Status, number>;
	total: number;
}

export interface SummaryItem {
	status: Status;
	count: number;
}

export interface Choice {
	value: string;
	label: string;
}

export class ReportView {
	declare query: OutcomeQuery;
	readonly id: string;
	readonly verdict: Verdict;
	readonly summary: SummaryItem[];
	readonly targetRows: TargetRow[];
	readonly statusChoices: Choice[];
	readonly targetChoices: Choice[];
	readonly sortChoices: Choice[] = SORT_OPTIONS.map(({ value, label }) => ({ value, label }));

	constructor(
		readonly source: string,
		readonly origin: 'file' | 'url',
		readonly report: HealthReport
	) {
		this.id = `report-${++sequence}`;
		this.query = DEFAULT_QUERY;
		this.verdict = deriveVerdict(report.outcomes);
		this.summary = STATUSES.map((status) => ({ status, count: report.summary[status] }));
		this.targetRows = report.targets.map((target) => {
			const outcomes = report.outcomes.filter((outcome) => outcome.target === target.id);
			return {
				target,
				verdict: deriveVerdict(outcomes),
				counts: countStatuses(outcomes),
				total: outcomes.length,
			};
		});
		this.statusChoices = [
			{ value: 'all', label: `All statuses (${report.outcomes.length})` },
			...STATUSES.map((status) => ({
				value: status,
				label: `${STATUS_PRESENTATION[status].label} (${report.summary[status]})`,
			})),
		];
		this.targetChoices = [
			{ value: 'all', label: 'All targets' },
			...report.targets.map((target) => ({ value: target.id, label: target.id })),
		];
	}

	get rows(): Outcome[] {
		return selectOutcomes(this.report.outcomes, this.query);
	}

	get filtered(): boolean {
		return this.query.status !== 'all' || this.query.target !== 'all';
	}

	ariaSort(column: string): 'ascending' | null {
		return SORT_COLUMN[this.query.sort] === column ? 'ascending' : null;
	}

	setStatus(value: string): void {
		const status = (
			value === 'all' || STATUSES.includes(value as Status) ? value : 'all'
		) as StatusFilter;
		this.query = { ...this.query, status };
	}

	setTarget(value: string): void {
		const known = value === 'all' || this.report.targets.some((target) => target.id === value);
		this.query = { ...this.query, target: known ? value : 'all' };
	}

	setSort(value: string): void {
		const sort = SORT_OPTIONS.some((option) => option.value === value)
			? (value as SortKey)
			: 'report';
		this.query = { ...this.query, sort };
	}

	clearFilters(): void {
		this.query = { ...this.query, status: 'all', target: 'all' };
	}
}

observable(ReportView.prototype, 'query');
