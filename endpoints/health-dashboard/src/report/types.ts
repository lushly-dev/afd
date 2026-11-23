/**
 * TypeScript view of Health report schema 1.3 (endpoints/health
 * `src/lushly_health/schemas/report-1.3.json`). The schema, not these types, is the
 * contract: every file is validated against it before any of these types apply.
 */

export const STATUSES = [
	'passed',
	'failed',
	'warn',
	'skipped',
	'disabled',
	'unavailable',
	'error',
] as const;
export type Status = (typeof STATUSES)[number];

export const SEVERITIES = ['required', 'advisory'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const MEASURE_DIRECTIONS = ['higher_is_better', 'lower_is_better', 'neutral'] as const;
export type MeasureDirection = (typeof MEASURE_DIRECTIONS)[number];

export interface Measure {
	key: string;
	label: string;
	value: number;
	unit: string;
	direction: MeasureDirection;
	target?: string;
	source?: string;
}

export interface ReportTarget {
	id: string;
	/** Caller-local path recorded by Health; private data when sharing a report. */
	path: string;
	language: string;
	/** The repository containing this target, when it declares one; private like `path`. */
	repository_root?: string;
}

export interface Evidence {
	paths: string[];
	/** Present when `paths` are relative to the target's repository root. */
	base?: 'repository_root';
	required_tools: string[];
	kind: 'local_configuration_heuristic';
	metric?: string;
	error_type?: string;
}

export interface Outcome {
	schema_version: '1.3';
	check_id: string;
	target: string;
	status: Status;
	severity: Severity;
	message: string;
	evidence: Evidence;
	remediation: string | null;
}

export type Summary = Record<Status, number>;

export const REPORT_VERDICTS = ['passed', 'not_passed', 'no_required_checks'] as const;
export type ReportVerdictStatus = (typeof REPORT_VERDICTS)[number];

/** Health's own verdict; the dashboard recomputes it and rejects a report that disagrees. */
export interface ReportVerdict {
	status: ReportVerdictStatus;
	required_count: number;
	blocking_count: number;
}

export interface HealthReport {
	schema_version: '1.3';
	generator: { name: 'lushly-health'; version: string };
	/** UTC, whole seconds: `YYYY-MM-DDTHH:MM:SSZ`. */
	generated_at: string;
	targets: ReportTarget[];
	policy: {
		check_ids: string[];
		disabled: string[];
		severity: Record<string, Severity>;
		remediation: 'none';
	};
	outcomes: Outcome[];
	measures: Measure[];
	summary: Summary;
	verdict: ReportVerdict;
	effects: ['target_read'];
	artifacts_written: [];
}
