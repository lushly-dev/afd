/**
 * Turn untrusted file text into a validated report or an actionable failure.
 *
 * Nothing is rendered from a file until it parses as JSON, declares the supported
 * schema_version, validates against Health's report-1.1 schema and is internally
 * consistent, including Health's own verdict against the outcomes. A failure never carries a partially accepted report.
 */
import { schemaVersion, validateReport } from 'virtual:health-report-schema';
import { type HealthReport, STATUSES, type Status } from './types';
import { deriveVerdict, expectedReportVerdict } from './verdict';

/** Health reports are small; anything this large is almost certainly the wrong file. */
export const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const MAX_DETAILS = 8;

export type FailureKind =
	| 'too-large'
	| 'unreadable'
	| 'not-json'
	| 'not-a-report'
	| 'unsupported-version'
	| 'schema-mismatch'
	| 'inconsistent'
	| 'not-relative'
	| 'needs-server'
	| 'unreachable';

export interface LoadFailure {
	ok: false;
	source: string;
	kind: FailureKind;
	title: string;
	message: string;
	details: string[];
}

export interface LoadedReport {
	ok: true;
	source: string;
	report: HealthReport;
}

export type LoadResult = LoadedReport | LoadFailure;

export const SUPPORTED_SCHEMA_VERSION = schemaVersion;
const AUDIT_COMMAND = 'python -m lushly_health audit --output-dir <directory>';

export function failure(
	source: string,
	kind: FailureKind,
	details: string[] = [],
	found?: string
): LoadFailure {
	const rerun = `Write it again with \`${AUDIT_COMMAND}\`.`;
	const copy: Record<FailureKind, [string, string]> = {
		'too-large': [
			'File is too large',
			`${source} is over ${MAX_REPORT_BYTES / 1024 / 1024} MB, so it wasn't read. Check that you selected a Health report.`,
		],
		unreadable: [
			"Couldn't read the file",
			`${source} couldn't be read. Check that it still exists and that you can open it, then try again.`,
		],
		'not-json': [
			'Not valid JSON',
			`${source} isn't valid JSON, so nothing from it is shown. Check that the file is complete. ${rerun}`,
		],
		'not-a-report': [
			'Not a Health report',
			`${source} isn't a Health report: it has no schema_version. Select a JSON file written by \`${AUDIT_COMMAND}\`.`,
		],
		'unsupported-version': [
			'Unsupported report version',
			`${source} uses report schema ${found ?? 'with an unknown version'}. This dashboard reads schema ${SUPPORTED_SCHEMA_VERSION} only, so nothing from it is shown. Write the report with a Health version that produces schema ${SUPPORTED_SCHEMA_VERSION}.`,
		],
		'schema-mismatch': [
			"Doesn't match the report schema",
			`${source} declares schema ${SUPPORTED_SCHEMA_VERSION} but doesn't match it, so nothing from it is shown. ${rerun}`,
		],
		'not-relative': [
			'Report path not allowed',
			`${source} isn't a relative path on this server, so it wasn't loaded. Use ?report=<relative path>, or select the file instead.`,
		],
		'needs-server': [
			'Report paths need a local server',
			`${source} wasn't loaded because this page was opened from a file, where browsers block reading other files. Serve the dashboard from a local server, or select the file instead.`,
		],
		unreachable: [
			"Couldn't load the report",
			`${source} couldn't be loaded. Serve the dashboard and the report from the same local server and check the path, or select the file instead.`,
		],
		inconsistent: [
			"Report contents don't agree",
			`${source} matches the schema, but its contents contradict each other, so nothing from it is shown. ${rerun}`,
		],
	};
	const [title, message] = copy[kind];
	return { ok: false, source, kind, title, message, details: details.slice(0, MAX_DETAILS) };
}

/** `/outcomes/1/status` -> `outcomes[1].status`; the root is "the report". */
function location(pointer: string): string {
	if (!pointer) return 'The report';
	return pointer
		.split('/')
		.slice(1)
		.map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
		.reduce(
			(path, part) => (/^\d+$/.test(part) ? `${path}[${part}]` : path ? `${path}.${part}` : part),
			''
		);
}

function schemaDetails(): string[] {
	return (validateReport.errors ?? []).map((error) => {
		const where = location(error.instancePath);
		if (error.keyword === 'required')
			return `${where} is missing ${String(error.params.missingProperty)}.`;
		if (error.keyword === 'additionalProperties')
			return `${where} has an unexpected field ${String(error.params.additionalProperty)}.`;
		if (error.keyword === 'enum' && Array.isArray(error.params.allowedValues))
			return `${where} must be one of: ${error.params.allowedValues.join(', ')}.`;
		return `${where} ${error.message ?? 'is invalid'}.`;
	});
}

/** Contradictions the schema can't express; Health never writes them. */
function consistencyDetails(report: HealthReport): string[] {
	const details: string[] = [];
	const targets = new Set<string>();
	for (const target of report.targets) {
		if (targets.has(target.id)) details.push(`Target ${target.id} is listed more than once.`);
		targets.add(target.id);
	}
	const checks = new Set(report.policy.check_ids);
	const disabled = new Set(report.policy.disabled);
	const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<
		Status,
		number
	>;
	report.outcomes.forEach((outcome, index) => {
		counts[outcome.status]++;
		if (!targets.has(outcome.target))
			details.push(`outcomes[${index}] names target ${outcome.target}, which isn't in targets.`);
		if (!checks.has(outcome.check_id))
			details.push(
				`outcomes[${index}] names check ${outcome.check_id}, which isn't in policy.check_ids.`
			);
		// Only the policy may exclude a check from the verdict, and it always does.
		if ((outcome.status === 'disabled') !== disabled.has(outcome.check_id))
			details.push(
				outcome.status === 'disabled'
					? `outcomes[${index}] is disabled, but policy.disabled doesn't list ${outcome.check_id}.`
					: `outcomes[${index}] is ${outcome.status}, but policy.disabled lists ${outcome.check_id}.`
			);
	});
	for (const status of STATUSES)
		if (report.summary[status] !== counts[status])
			details.push(
				`summary.${status} is ${report.summary[status]}, but ${counts[status]} outcomes have status ${status}.`
			);
	const expected = expectedReportVerdict(deriveVerdict(report.outcomes));
	for (const key of ['status', 'required_count', 'blocking_count'] as const)
		if (report.verdict[key] !== expected[key])
			details.push(
				`verdict.${key} is ${report.verdict[key]}, but the outcomes give ${expected[key]}.`
			);
	return details;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseReport(text: string, source: string): LoadResult {
	if (text.length > MAX_REPORT_BYTES) return failure(source, 'too-large');
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (error) {
		return failure(source, 'not-json', [error instanceof Error ? error.message : String(error)]);
	}
	if (!isObject(data) || !Object.hasOwn(data, 'schema_version'))
		return failure(source, 'not-a-report');
	const version = data.schema_version;
	if (version !== SUPPORTED_SCHEMA_VERSION)
		return failure(
			source,
			'unsupported-version',
			[],
			typeof version === 'string' ? version : undefined
		);
	if (!validateReport(data)) return failure(source, 'schema-mismatch', schemaDetails());
	const report = data as unknown as HealthReport;
	const contradictions = consistencyDetails(report);
	if (contradictions.length) return failure(source, 'inconsistent', contradictions);
	return { ok: true, source, report };
}

/** Read a user-selected file without uploading it anywhere. */
export async function readReportFile(
	file: Pick<File, 'name' | 'size' | 'text'>
): Promise<LoadResult> {
	if (file.size > MAX_REPORT_BYTES) return failure(file.name, 'too-large');
	let text: string;
	try {
		text = await file.text();
	} catch {
		return failure(file.name, 'unreadable');
	}
	return parseReport(text, file.name);
}
