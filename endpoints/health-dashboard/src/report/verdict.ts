/**
 * Overall verdict under the platform's documented aggregate rule
 * (docs/features/active/platform-monorepo/proposal.md, "Quality verdicts and command
 * effects"). Health writes the same verdict into report 1.1; the dashboard recomputes it
 * for its explanation and rejects a report whose verdict disagrees (see validate.ts).
 *
 * - a result passes only when it has at least one counted required check and every
 *   counted required check `passed`;
 * - required checks `disabled` by policy are not counted: disabling is a reviewed
 *   policy decision, unlike `skipped`, which means a check did not run;
 * - any other required status (`failed`, `error`, `unavailable`, `warn`, `skipped`)
 *   prevents a pass;
 * - advisory results stay visible but never make a result pass or fail;
 * - an empty plan, or one with no counted required checks, reports that condition,
 *   not a pass.
 */
import type { Outcome, ReportVerdictStatus, Status } from './types';

export type VerdictState = 'passed' | 'not-passed' | 'no-required-checks';

export interface Verdict {
	passed: boolean;
	state: VerdictState;
	/** Short, user-facing label: never "Passed" unless `passed` is true. */
	label: string;
	reasons: string[];
	/** Counted required outcomes; required checks disabled by policy are excluded. */
	requiredCount: number;
	/** Counted required outcomes by non-passing status. */
	blocking: Partial<Record<BlockingStatus, number>>;
}

type BlockingStatus = Exclude<Status, 'passed' | 'disabled'>;

/** Blocking statuses in the order their reasons are listed. */
const BLOCKING_ORDER: readonly BlockingStatus[] = [
	'failed',
	'error',
	'unavailable',
	'warn',
	'skipped',
];

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

function reason(status: BlockingStatus, count: number): string {
	const checks = `${count} required ${plural(count, 'check', 'checks')}`;
	switch (status) {
		case 'failed':
			return `${checks} failed.`;
		case 'error':
			return `${checks} couldn't finish because of an error.`;
		case 'unavailable':
			return `${checks} couldn't run (unavailable).`;
		case 'warn':
			return `${checks} ${plural(count, 'needs', 'need')} review (warning).`;
		case 'skipped':
			return `${checks} ${plural(count, 'was', 'were')} skipped, so ${plural(count, 'it', 'they')} verified nothing.`;
	}
}

export function deriveVerdict(outcomes: readonly Outcome[]): Verdict {
	const required = outcomes.filter(
		(outcome) => outcome.severity === 'required' && outcome.status !== 'disabled'
	);
	const disabled = outcomes.filter(
		(outcome) => outcome.severity === 'required' && outcome.status === 'disabled'
	).length;
	const disabledNote =
		disabled > 0
			? [
					`${disabled} required ${plural(disabled, 'check is', 'checks are')} disabled by policy and ${plural(disabled, "isn't", "aren't")} counted.`,
				]
			: [];
	const advisoryNotPassed = outcomes.filter(
		(outcome) => outcome.severity === 'advisory' && outcome.status !== 'passed'
	).length;
	const advisoryNote =
		advisoryNotPassed > 0
			? [
					`${advisoryNotPassed} advisory ${plural(advisoryNotPassed, 'result', 'results')} didn't pass; advisory results don't affect this verdict.`,
				]
			: [];
	if (required.length === 0)
		return {
			passed: false,
			state: 'no-required-checks',
			label: 'Not passing: no required checks',
			reasons: [
				outcomes.length === 0
					? 'This report has no check results, so nothing was verified.'
					: disabled > 0
						? 'Every required check is disabled by policy, so nothing was verified.'
						: "This report has no required checks. Advisory results alone can't make it pass.",
				...disabledNote,
				...advisoryNote,
			],
			requiredCount: 0,
			blocking: {},
		};
	const blocking: Partial<Record<BlockingStatus, number>> = {};
	for (const { status } of required)
		if (status !== 'passed' && status !== 'disabled')
			blocking[status] = (blocking[status] ?? 0) + 1;
	const reasons = BLOCKING_ORDER.flatMap((status) => {
		const count = blocking[status];
		return count ? [reason(status, count)] : [];
	});
	if (reasons.length === 0)
		return {
			passed: true,
			state: 'passed',
			label: 'Passing',
			reasons: [
				`All ${required.length} required ${plural(required.length, 'check', 'checks')} passed.`,
				...disabledNote,
				...advisoryNote,
			],
			requiredCount: required.length,
			blocking,
		};
	if (blocking.skipped === required.length)
		reasons.unshift('Every required check was skipped, so nothing was verified.');
	return {
		passed: false,
		state: 'not-passed',
		label: 'Not passing',
		reasons: [...reasons, ...disabledNote, ...advisoryNote],
		requiredCount: required.length,
		blocking,
	};
}

/** The report-1.1 `verdict` object Health should have written for these outcomes. */
export function expectedReportVerdict(verdict: Verdict): {
	status: ReportVerdictStatus;
	required_count: number;
	blocking_count: number;
} {
	const status: Record<VerdictState, ReportVerdictStatus> = {
		passed: 'passed',
		'not-passed': 'not_passed',
		'no-required-checks': 'no_required_checks',
	};
	return {
		status: status[verdict.state],
		required_count: verdict.requiredCount,
		blocking_count: Object.values(verdict.blocking).reduce((sum, count) => sum + count, 0),
	};
}
