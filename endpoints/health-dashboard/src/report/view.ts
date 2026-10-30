/** Presentation rules shared by the page and its tests: labels, order, filters, sorting. */
import { type Evidence, type Outcome, STATUSES, type Status } from './types';

export type BadgeColor = 'neutral' | 'success' | 'warning' | 'danger';
export type BadgeAppearance = 'filled' | 'outline' | 'subtle';

export interface StatusPresentation {
	/** Visible text; every status is always shown with its words, never color alone. */
	label: string;
	description: string;
	/** A `health/*` icon registered by src/app/icons.ts; a distinct shape per status. */
	icon: string;
	color: BadgeColor;
	appearance: BadgeAppearance;
	/** Sort rank: lower is more severe. */
	rank: number;
}

/**
 * Seven distinct presentations. Statuses that share a hue also differ in icon and fill
 * (failed/error; unavailable/skipped/disabled), and none of the non-passing statuses
 * uses the success treatment.
 */
export const STATUS_PRESENTATION: Record<Status, StatusPresentation> = {
	failed: {
		label: 'Failed',
		description: 'Found a problem',
		icon: 'health/failed',
		color: 'danger',
		appearance: 'filled',
		rank: 0,
	},
	error: {
		label: 'Error',
		description: "Couldn't finish running",
		icon: 'health/error',
		color: 'danger',
		appearance: 'outline',
		rank: 1,
	},
	unavailable: {
		label: 'Unavailable',
		description: "Couldn't run: input or tool missing",
		icon: 'health/unavailable',
		color: 'neutral',
		appearance: 'outline',
		rank: 2,
	},
	warn: {
		label: 'Warning',
		description: 'Needs review',
		icon: 'health/warn',
		color: 'warning',
		appearance: 'filled',
		rank: 3,
	},
	skipped: {
		label: 'Skipped',
		description: 'Not run: not applicable to the target',
		icon: 'health/skipped',
		color: 'neutral',
		appearance: 'subtle',
		rank: 4,
	},
	disabled: {
		label: 'Disabled',
		description: 'Turned off by policy; not counted in the verdict',
		icon: 'health/disabled',
		color: 'neutral',
		appearance: 'filled',
		rank: 5,
	},
	passed: {
		label: 'Passed',
		description: 'No problem found',
		icon: 'health/passed',
		color: 'success',
		appearance: 'filled',
		rank: 6,
	},
};

export const SEVERITY_LABEL = { required: 'Required', advisory: 'Advisory' } as const;

export type StatusFilter = Status | 'all';
export type SortKey = 'report' | 'status' | 'check' | 'target' | 'severity';

export const SORT_OPTIONS: readonly { value: SortKey; label: string }[] = [
	{ value: 'report', label: 'Report order' },
	{ value: 'status', label: 'Status, most serious first' },
	{ value: 'severity', label: 'Severity, required first' },
	{ value: 'check', label: 'Check, A to Z' },
	{ value: 'target', label: 'Target, A to Z' },
];

/** Which table column a sort key orders, for `aria-sort`. */
export const SORT_COLUMN: Record<SortKey, string | null> = {
	report: null,
	status: 'status',
	severity: 'severity',
	check: 'check',
	target: 'target',
};

export interface OutcomeQuery {
	status: StatusFilter;
	target: string;
	sort: SortKey;
}

export const DEFAULT_QUERY: OutcomeQuery = { status: 'all', target: 'all', sort: 'report' };

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function selectOutcomes(outcomes: readonly Outcome[], query: OutcomeQuery): Outcome[] {
	const rows = outcomes
		.map((outcome, index) => ({ outcome, index }))
		.filter(
			({ outcome }) =>
				(query.status === 'all' || outcome.status === query.status) &&
				(query.target === 'all' || outcome.target === query.target)
		);
	const order: Record<SortKey, (a: Outcome, b: Outcome) => number> = {
		report: () => 0,
		status: (a, b) => STATUS_PRESENTATION[a.status].rank - STATUS_PRESENTATION[b.status].rank,
		severity: (a, b) => Number(a.severity === 'advisory') - Number(b.severity === 'advisory'),
		check: (a, b) => compareText(a.check_id, b.check_id),
		target: (a, b) => compareText(a.target, b.target),
	};
	const compare = order[query.sort];
	// Ties keep report order, so every sort is stable and deterministic.
	rows.sort((a, b) => compare(a.outcome, b.outcome) || a.index - b.index);
	return rows.map(({ outcome }) => outcome);
}

export function countStatuses(outcomes: readonly Outcome[]): Record<Status, number> {
	const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<
		Status,
		number
	>;
	for (const outcome of outcomes) counts[outcome.status]++;
	return counts;
}

export interface EvidenceItem {
	label: string;
	values: string[];
}

/** The kind is a schema constant, explained once on the page rather than per row. */
export function describeEvidence(evidence: Evidence): EvidenceItem[] {
	const items: EvidenceItem[] = [];
	if (evidence.paths.length) items.push({ label: 'Reads', values: evidence.paths });
	if (evidence.required_tools.length)
		items.push({ label: 'Needs', values: evidence.required_tools });
	if (evidence.metric !== undefined) items.push({ label: 'Metric', values: [evidence.metric] });
	if (evidence.error_type !== undefined)
		items.push({ label: 'Error type', values: [evidence.error_type] });
	return items;
}

export const plural = (count: number, one: string, many: string) =>
	`${count} ${count === 1 ? one : many}`;

/** `2026-01-02T03:04:05Z` -> `2026-01-02 03:04:05 UTC`; the schema fixes the input format. */
export function formatGeneratedAt(value: string): string {
	return `${value.slice(0, 10)} ${value.slice(11, 19)} UTC`;
}
