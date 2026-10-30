/**
 * Overall verdict, derived because report-1.0 carries none. The rule is the platform's
 * documented aggregate rule (docs/features/active/platform-monorepo/proposal.md,
 * "Quality verdicts and command effects"):
 *
 * - a result passes only when it has at least one required check and every required
 *   check `passed`;
 * - any other required status (`failed`, `error`, `unavailable`, `warn`, `skipped`)
 *   prevents a pass;
 * - advisory results stay visible but never make a result pass or fail;
 * - an empty plan, or one with no required checks, reports that condition, not a pass.
 */
import type { Outcome, Status } from './types';

export type VerdictState = 'passed' | 'not-passed' | 'no-required-checks';

export interface Verdict {
	passed: boolean;
	state: VerdictState;
	/** Short, user-facing label: never "Passed" unless `passed` is true. */
	label: string;
	reasons: string[];
	requiredCount: number;
	/** Required outcomes by non-passing status. */
	blocking: Partial<Record<Status, number>>;
}

/** Blocking statuses in the order their reasons are listed. */
const BLOCKING_ORDER: readonly Exclude<Status, 'passed'>[] = [
	'failed',
	'error',
	'unavailable',
	'warn',
	'skipped',
];

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

function reason(status: Exclude<Status, 'passed'>, count: number): string {
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
	const required = outcomes.filter((outcome) => outcome.severity === 'required');
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
					: "This report has no required checks. Advisory results alone can't make it pass.",
				...advisoryNote,
			],
			requiredCount: 0,
			blocking: {},
		};
	const blocking: Partial<Record<Status, number>> = {};
	for (const outcome of required)
		if (outcome.status !== 'passed') blocking[outcome.status] = (blocking[outcome.status] ?? 0) + 1;
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
		reasons: [...reasons, ...advisoryNote],
		requiredCount: required.length,
		blocking,
	};
}
