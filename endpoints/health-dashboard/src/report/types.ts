/**
 * TypeScript view of Health report schema 1.0 (endpoints/health
 * `src/botcore_health/schemas/report-1.0.json`). The schema, not these types, is the
 * contract: every file is validated against it before any of these types apply.
 */

export const STATUSES = ['passed', 'failed', 'warn', 'skipped', 'unavailable', 'error'] as const;
export type Status = (typeof STATUSES)[number];

export const SEVERITIES = ['required', 'advisory'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface ReportTarget {
	id: string;
	/** Caller-local path recorded by Health; private data when sharing a report. */
	path: string;
	language: string;
}

export interface Evidence {
	paths: string[];
	required_tools: string[];
	kind: 'local_configuration_heuristic';
	metric?: string;
	error_type?: string;
}

export interface Outcome {
	schema_version: '1.0';
	check_id: string;
	target: string;
	status: Status;
	severity: Severity;
	message: string;
	evidence: Evidence;
	remediation: string | null;
}

export type Summary = Record<Status, number>;

export interface HealthReport {
	schema_version: '1.0';
	generator: { name: 'lushly-health'; version: string };
	targets: ReportTarget[];
	policy: {
		check_ids: string[];
		disabled: string[];
		severity: Record<string, Severity>;
		remediation: 'none';
	};
	outcomes: Outcome[];
	summary: Summary;
	effects: ['target_read'];
	artifacts_written: [];
}
