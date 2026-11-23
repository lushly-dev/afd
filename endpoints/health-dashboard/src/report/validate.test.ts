import { describe, expect, it } from 'vitest';
import { fixture, fixtureNames } from './fixtures.test-helper';
import type { HealthReport } from './types';
import {
	MAX_REPORT_BYTES,
	parseReport,
	readReportFile,
	SUPPORTED_SCHEMA_VERSION,
} from './validate';

const mixed = () => JSON.parse(fixture('reports/mixed-status.report.json')) as HealthReport;

describe('parseReport', () => {
	it('supports exactly the schema version Health publishes', () => {
		expect(SUPPORTED_SCHEMA_VERSION).toBe('1.3');
	});

	it.each(fixtureNames('reports'))('accepts the Health CLI fixture %s', (name) => {
		const result = parseReport(fixture(`reports/${name}`), name);
		expect(result.ok).toBe(true);
	});

	it.each([
		['not-json.json', 'not-json'],
		['not-a-report.json', 'not-a-report'],
		['unsupported-version.json', 'unsupported-version'],
		['schema-violation.json', 'schema-mismatch'],
		['inconsistent-summary.json', 'inconsistent'],
		['verdict-mismatch.json', 'inconsistent'],
		['disabled-mismatch.json', 'inconsistent'],
		['report-1.0.json', 'unsupported-version'],
	])('rejects %s as %s without a partial report', (name, kind) => {
		const result = parseReport(fixture(`invalid/${name}`), name);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.kind).toBe(kind);
		expect(result).not.toHaveProperty('report');
		expect(result.message).toContain(name);
		expect(result.title.length).toBeGreaterThan(0);
	});

	it('covers every committed invalid fixture', () => {
		expect(fixtureNames('invalid')).toEqual([
			'disabled-mismatch.json',
			'inconsistent-summary.json',
			'not-a-report.json',
			'not-json.json',
			'report-1.0.json',
			'schema-violation.json',
			'unsupported-version.json',
			'verdict-mismatch.json',
		]);
	});

	it('explains schema mismatches by location', () => {
		const result = parseReport(fixture('invalid/schema-violation.json'), 'bad.json');
		expect(result.ok ? [] : result.details).toEqual([
			'outcomes[1].status must be one of: passed, failed, warn, skipped, disabled, unavailable, error.',
			'outcomes[2] is missing remediation.',
		]);
	});

	it("rejects a report whose verdict doesn't match its outcomes", () => {
		const result = parseReport(fixture('invalid/verdict-mismatch.json'), 'v.json');
		expect(result.ok ? [] : result.details).toEqual([
			'verdict.status is not_passed, but the outcomes give passed.',
			'verdict.blocking_count is 1, but the outcomes give 0.',
		]);
	});

	it('accepts disabled only for checks the policy disables, in both directions', () => {
		const claimed = parseReport(fixture('invalid/disabled-mismatch.json'), 'd.json');
		expect(claimed.ok ? [] : claimed.details).toEqual([
			"outcomes[1] is disabled, but policy.disabled doesn't list lefthook_configured.",
		]);
		const report = JSON.parse(fixture('reports/passed-with-disabled.report.json')) as HealthReport;
		const ran = report.outcomes.find((outcome) => outcome.status === 'disabled');
		if (!ran) throw new Error('fixture has a disabled outcome');
		ran.status = 'passed';
		report.summary.disabled--;
		report.summary.passed++;
		report.verdict.required_count++;
		const result = parseReport(JSON.stringify(report), 'r.json');
		expect(result.ok ? [] : result.details).toEqual([
			`outcomes[2] is passed, but policy.disabled lists ${ran.check_id}.`,
		]);
	});

	it('names the unsupported version it found', () => {
		const result = parseReport(fixture('invalid/unsupported-version.json'), 'v2.json');
		expect(result.ok ? '' : result.message).toContain('schema 2.0');
		const unknown = parseReport('{"schema_version": 2}', 'n.json');
		expect(unknown.ok ? '' : unknown.message).toContain('unknown version');
	});

	it.each(['[]', 'null', '"1.0"', '{}'])('treats %s as not a report', (text) => {
		expect(parseReport(text, 'x.json')).toMatchObject({ ok: false, kind: 'not-a-report' });
	});

	it('reports unexpected fields, wrong constants and wrong types', () => {
		const report = { ...mixed(), extra: true, effects: ['artifact_write'] } as unknown;
		const result = parseReport(JSON.stringify(report), 'x.json');
		expect(result.ok ? [] : result.details).toEqual(
			expect.arrayContaining([
				'The report has an unexpected field extra.',
				'effects must be equal to constant.',
			])
		);
	});

	it('rejects contradictions the schema cannot express', () => {
		const report = mixed();
		report.targets.push({ ...report.targets[0], language: 'go' } as HealthReport['targets'][0]);
		const first = report.outcomes[0] as HealthReport['outcomes'][0];
		first.target = 'ghost';
		first.check_id = 'not_in_policy';
		report.measures.push(
			{
				key: 'files_over_warn',
				label: 'Files over size warning',
				value: 3,
				unit: 'files',
				direction: 'lower_is_better',
			},
			{
				key: 'files_over_warn',
				label: 'Files over size warning',
				value: 4,
				unit: 'files',
				direction: 'lower_is_better',
			},
			{
				key: 'line_coverage',
				label: 'Line coverage',
				value: 90,
				unit: 'percent',
				direction: 'higher_is_better',
				target: 'ghost',
			}
		);
		const result = parseReport(JSON.stringify(report), 'x.json');
		expect(result.ok ? [] : result.details).toEqual([
			'Target web-app is listed more than once.',
			"outcomes[0] names target ghost, which isn't in targets.",
			"outcomes[0] names check not_in_policy, which isn't in policy.check_ids.",
			'Measure files_over_warn is listed more than once.',
			"measures[2] names target ghost, which isn't in targets.",
		]);
	});

	it('allows the same measure key across different targets and rejects 1.2 reports', () => {
		const report = mixed();
		report.measures = [
			{
				key: 'line_coverage',
				label: 'Line coverage',
				value: 80,
				unit: 'percent',
				direction: 'higher_is_better',
			},
			{
				key: 'line_coverage',
				label: 'Line coverage',
				value: 90,
				unit: 'percent',
				direction: 'higher_is_better',
				target: 'web-app',
			},
			{
				key: 'line_coverage',
				label: 'Line coverage',
				value: 85,
				unit: 'percent',
				direction: 'higher_is_better',
				target: 'api-service',
			},
		];
		expect(parseReport(JSON.stringify(report), 'ok.json').ok).toBe(true);

		const dupTarget = mixed();
		dupTarget.measures = [
			{
				key: 'line_coverage',
				label: 'Line coverage',
				value: 90,
				unit: 'percent',
				direction: 'higher_is_better',
				target: 'web-app',
			},
			{
				key: 'line_coverage',
				label: 'Line coverage',
				value: 91,
				unit: 'percent',
				direction: 'higher_is_better',
				target: 'web-app',
			},
		];
		const dupResult = parseReport(JSON.stringify(dupTarget), 'dup.json');
		expect(dupResult.ok ? [] : dupResult.details).toEqual([
			'Measure line_coverage for target web-app is listed more than once.',
		]);

		const older = parseReport(JSON.stringify({ ...report, schema_version: '1.2' }), 'v12.json');
		expect(older).toMatchObject({ ok: false, kind: 'unsupported-version' });
	});

	it('enforces safe integer bounds and non-blank measure labels and units', () => {
		const validBounds = mixed();
		validBounds.measures = [
			{
				key: 'max_safe',
				label: 'Max safe',
				value: 9007199254740991,
				unit: 'count',
				direction: 'neutral',
			},
			{
				key: 'min_safe',
				label: 'Min safe',
				value: -9007199254740991,
				unit: 'count',
				direction: 'neutral',
			},
		];
		expect(parseReport(JSON.stringify(validBounds), 'bounds.json').ok).toBe(true);

		for (const rawValue of ['9007199254740992', '9007199254740993', '-9007199254740992']) {
			const base = mixed();
			base.measures = [
				{
					key: 'overflow',
					label: 'Overflow',
					value: 0,
					unit: 'count',
					direction: 'neutral',
				},
			];
			const text = JSON.stringify(base).replace('"value":0', `"value":${rawValue}`);
			expect(parseReport(text, 'overflow.json')).toMatchObject({
				ok: false,
				kind: 'schema-mismatch',
			});
		}

		for (const bad of [
			{ key: 'blank_label', label: '   ', value: 1, unit: 'count', direction: 'neutral' as const },
			{ key: 'blank_unit', label: 'Label', value: 1, unit: '   ', direction: 'neutral' as const },
		]) {
			const report = mixed();
			report.measures = [bad];
			expect(parseReport(JSON.stringify(report), 'blank.json')).toMatchObject({
				ok: false,
				kind: 'schema-mismatch',
			});
		}
	});

	it('limits the number of details shown', () => {
		const report = mixed();
		for (const outcome of report.outcomes) (outcome as { status: string }).status = 'ok';
		const result = parseReport(JSON.stringify(report), 'x.json');
		expect(result.ok ? [] : result.details).toHaveLength(8);
	});

	it('refuses oversized text before parsing it', () => {
		const result = parseReport(' '.repeat(MAX_REPORT_BYTES + 1), 'big.json');
		expect(result).toMatchObject({ ok: false, kind: 'too-large' });
	});
});

describe('readReportFile', () => {
	it('reads a selected file locally', async () => {
		const text = fixture('reports/all-passed.report.json');
		const result = await readReportFile({
			name: 'a.json',
			size: text.length,
			text: async () => text,
		});
		expect(result.ok).toBe(true);
	});

	it('refuses an oversized file without reading it', async () => {
		let read = false;
		const result = await readReportFile({
			name: 'big.json',
			size: MAX_REPORT_BYTES + 1,
			text: async () => {
				read = true;
				return '';
			},
		});
		expect(result).toMatchObject({ ok: false, kind: 'too-large' });
		expect(read).toBe(false);
	});

	it('reports an unreadable file', async () => {
		const result = await readReportFile({
			name: 'gone.json',
			size: 1,
			text: () => Promise.reject(new Error('gone')),
		});
		expect(result).toMatchObject({ ok: false, kind: 'unreadable' });
	});
});
