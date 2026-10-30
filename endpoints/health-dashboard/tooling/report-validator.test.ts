import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileReportValidator, REPORT_SCHEMA_PATH, reportValidator } from './report-validator';
import { contentSecurityPolicy } from './single-file';

describe('report validator plugin', () => {
	it('reads the schema Health publishes, not a copy', () => {
		expect(REPORT_SCHEMA_PATH.replaceAll('\\', '/')).toMatch(
			/endpoints\/health\/src\/botcore_health\/schemas\/report-1\.0\.json$/
		);
		const schema = JSON.parse(readFileSync(REPORT_SCHEMA_PATH, 'utf8'));
		expect(schema.$id).toBe('urn:lushly-health:report:1.0');
	});

	it('emits ESM with no runtime eval or require', () => {
		const source = compileReportValidator();
		expect(source).toContain('export const validateReport');
		expect(source).toContain('export const schemaVersion = "1.0";');
		expect(source).not.toMatch(/\brequire\(|new Function|\beval\(/);
	});

	it('serves only its virtual module', () => {
		const plugin = reportValidator();
		const resolve = plugin.resolveId as (id: string) => string | undefined;
		expect(resolve('virtual:health-report-schema')).toBe('\0virtual:health-report-schema');
		expect(resolve('other')).toBeUndefined();
		const load = plugin.load as (this: { addWatchFile(path: string): void }, id: string) => unknown;
		const watched: string[] = [];
		const context = { addWatchFile: (path: string) => watched.push(path) };
		expect(load.call(context, 'other')).toBeUndefined();
		expect(String(load.call(context, '\0virtual:health-report-schema'))).toContain(
			'validateReport'
		);
		expect(watched).toEqual([REPORT_SCHEMA_PATH]);
	});

	it('refuses a schema without a version constant', () => {
		const bad = new URL('../fixtures/invalid/not-a-report.json', import.meta.url);
		expect(() => compileReportValidator(bad.pathname)).toThrow();
	});
});

describe('content security policy', () => {
	it('allows only hashed inline code and same-origin report fetches', () => {
		const policy = contentSecurityPolicy("'sha256-a'", "'sha256-b'");
		expect(policy).toContain("default-src 'none'");
		expect(policy).toContain("script-src 'sha256-a'");
		expect(policy).toContain("style-src 'sha256-b'");
		expect(policy).toContain("connect-src 'self'");
		expect(policy).not.toContain('unsafe');
	});
});
