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
		expect(SUPPORTED_SCHEMA_VERSION).toBe('1.0');
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
			'inconsistent-summary.json',
			'not-a-report.json',
			'not-json.json',
			'schema-violation.json',
			'unsupported-version.json',
		]);
	});

	it('explains schema mismatches by location', () => {
		const result = parseReport(fixture('invalid/schema-violation.json'), 'bad.json');
		expect(result.ok ? [] : result.details).toEqual([
			'outcomes[1].status must be one of: passed, failed, warn, skipped, unavailable, error.',
			'outcomes[2] is missing remediation.',
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
		const result = parseReport(JSON.stringify(report), 'x.json');
		expect(result.ok ? [] : result.details).toEqual([
			'Target web-app is listed more than once.',
			"outcomes[0] names target ghost, which isn't in targets.",
			"outcomes[0] names check not_in_policy, which isn't in policy.check_ids.",
		]);
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
