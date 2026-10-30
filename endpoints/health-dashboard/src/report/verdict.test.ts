import { describe, expect, it } from 'vitest';
import { fixture } from './fixtures.test-helper';
import type { HealthReport, Outcome, Severity, Status } from './types';
import { STATUSES } from './types';
import { deriveVerdict, expectedReportVerdict } from './verdict';

const outcome = (status: Status, severity: Severity = 'required'): Outcome => ({
	schema_version: '1.1',
	check_id: 'gitattributes_lf',
	target: 'app',
	status,
	severity,
	message: 'm',
	evidence: { paths: [], required_tools: [], kind: 'local_configuration_heuristic' },
	remediation: null,
});
const report = (name: string) => JSON.parse(fixture(`reports/${name}.report.json`)) as HealthReport;

describe('deriveVerdict', () => {
	it('passes only when required checks exist and all passed', () => {
		const verdict = deriveVerdict([outcome('passed'), outcome('passed')]);
		expect(verdict).toMatchObject({ passed: true, state: 'passed', label: 'Passing' });
		expect(verdict.reasons).toEqual(['All 2 required checks passed.']);
	});

	it.each(STATUSES.filter((status) => status !== 'passed' && status !== 'disabled'))(
		'a required %s result prevents a pass',
		(status) => {
			const verdict = deriveVerdict([outcome('passed'), outcome(status)]);
			expect(verdict.passed).toBe(false);
			expect(verdict.state).toBe('not-passed');
			expect(verdict.label).not.toMatch(/^Pass/);
			expect(verdict.blocking).toEqual({ [status]: 1 });
		}
	);

	it.each(STATUSES)('an advisory %s result never decides the verdict', (status) => {
		expect(deriveVerdict([outcome('passed'), outcome(status, 'advisory')]).passed).toBe(true);
		expect(deriveVerdict([outcome('failed'), outcome(status, 'advisory')]).passed).toBe(false);
	});

	it('does not count required checks disabled by policy', () => {
		const verdict = deriveVerdict([outcome('passed'), outcome('disabled'), outcome('disabled')]);
		expect(verdict).toMatchObject({ passed: true, state: 'passed', requiredCount: 1 });
		expect(verdict.blocking).toEqual({});
		expect(verdict.reasons).toEqual([
			'All 1 required check passed.',
			"2 required checks are disabled by policy and aren't counted.",
		]);
	});

	it('never passes when every required check is disabled', () => {
		const verdict = deriveVerdict([outcome('disabled'), outcome('passed', 'advisory')]);
		expect(verdict).toMatchObject({ passed: false, state: 'no-required-checks' });
		expect(verdict.reasons).toEqual([
			'Every required check is disabled by policy, so nothing was verified.',
			"1 required check is disabled by policy and isn't counted.",
		]);
	});

	it('never passes an empty plan', () => {
		const verdict = deriveVerdict([]);
		expect(verdict).toMatchObject({ passed: false, state: 'no-required-checks' });
		expect(verdict.reasons[0]).toContain('no check results');
	});

	it('never passes advisory-only results', () => {
		const verdict = deriveVerdict([outcome('passed', 'advisory')]);
		expect(verdict).toMatchObject({ passed: false, state: 'no-required-checks' });
		expect(verdict.reasons[0]).toContain('no required checks');
	});

	it('says when every required check was skipped', () => {
		const verdict = deriveVerdict([outcome('skipped'), outcome('skipped')]);
		expect(verdict.reasons[0]).toBe('Every required check was skipped, so nothing was verified.');
		expect(verdict.reasons[1]).toBe('2 required checks were skipped, so they verified nothing.');
	});

	it('lists blocking reasons in a fixed order with advisory results noted', () => {
		const verdict = deriveVerdict([
			outcome('skipped'),
			outcome('warn'),
			outcome('unavailable'),
			outcome('error'),
			outcome('failed'),
			outcome('failed', 'advisory'),
		]);
		expect(verdict.reasons).toEqual([
			'1 required check failed.',
			"1 required check couldn't finish because of an error.",
			"1 required check couldn't run (unavailable).",
			'1 required check needs review (warning).',
			'1 required check was skipped, so it verified nothing.',
			"1 advisory result didn't pass; advisory results don't affect this verdict.",
		]);
	});

	it('matches the committed Health CLI fixtures', () => {
		expect(deriveVerdict(report('all-passed').outcomes).passed).toBe(true);
		expect(deriveVerdict(report('advisory-only').outcomes).state).toBe('no-required-checks');
		expect(deriveVerdict(report('empty-plan').outcomes).state).toBe('no-required-checks');
		expect(deriveVerdict(report('passed-with-disabled').outcomes).passed).toBe(true);
		const mixed = deriveVerdict(report('mixed-status').outcomes);
		expect(mixed.blocking).toEqual({ failed: 4, error: 1, unavailable: 3, warn: 1, skipped: 1 });
	});

	it.each(['mixed-status', 'all-passed', 'passed-with-disabled', 'advisory-only', 'empty-plan'])(
		'agrees with the verdict Health wrote into %s',
		(name) => {
			const fixture = report(name);
			expect(expectedReportVerdict(deriveVerdict(fixture.outcomes))).toEqual(fixture.verdict);
		}
	);
});
