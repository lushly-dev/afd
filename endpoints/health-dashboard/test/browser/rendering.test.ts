import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STATUSES } from '../../src/report/types';
import { STATUS_PRESENTATION } from '../../src/report/view';
import { ARTIFACTS, DIST, fixturePath, loadFiles, open, type StaticServer, serve } from './harness';

let browser: Browser;
let server: StaticServer;

beforeAll(async () => {
	browser = await chromium.launch();
	server = await serve();
	mkdirSync(ARTIFACTS, { recursive: true });
});
afterAll(async () => {
	await browser?.close();
	await server?.close();
});

async function fresh(url = pathToFileURL(DIST).href) {
	const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
	return { context, ...(await open(context, url)) };
}

describe('report rendering (Chromium, file://)', () => {
	it('shows the empty state and makes no request beyond the page itself', async () => {
		const { context, page, requests, errors, cspViolations } = await fresh();
		await expect(page.locator('violet-empty-state').getAttribute('heading')).resolves.toBe(
			'No reports loaded'
		);
		expect(requests).toEqual([pathToFileURL(DIST).href]);
		expect(errors).toEqual([]);
		expect(cspViolations).toEqual([]);
		await context.close();
	});

	it('renders all seven statuses distinctly, with text, and a non-passing verdict', async () => {
		const { context, page, requests, errors, cspViolations } = await fresh();
		await loadFiles(page, [fixturePath('reports/mixed-status.report.json')]);
		const report = page.locator('section.report');
		await expect(report.count()).resolves.toBe(1);
		await expect(report.locator('h2').innerText()).resolves.toBe('mixed-status.report.json');
		const generated = report.locator('.report-meta time');
		await expect(generated.getAttribute('datetime')).resolves.toBe('2026-01-01T00:00:00Z');
		await expect(generated.innerText()).resolves.toBe('2026-01-01 00:00:00 UTC');
		await expect(report.locator('.verdict-label').innerText()).resolves.toBe(
			'Overall: Not passing'
		);
		await expect(report.locator('.verdict').getAttribute('data-passed')).resolves.toBe('false');

		const summary = await report.locator('.summary-item').evaluateAll((items) =>
			items.map((item) => ({
				status: item.getAttribute('data-status'),
				label: item.querySelector('violet-badge')?.textContent?.trim(),
				count: item.querySelector('.summary-count')?.textContent?.trim(),
			}))
		);
		expect(summary).toEqual([
			{ status: 'passed', label: 'Passed', count: '3' },
			{ status: 'failed', label: 'Failed', count: '8' },
			{ status: 'warn', label: 'Warning', count: '1' },
			{ status: 'skipped', label: 'Skipped', count: '2' },
			{ status: 'disabled', label: 'Disabled', count: '3' },
			{ status: 'unavailable', label: 'Unavailable', count: '3' },
			{ status: 'error', label: 'Error', count: '1' },
		]);

		const rows = report.locator('table.checks tbody tr');
		await expect(rows.count()).resolves.toBe(21);
		// Each status renders its own words, icon and color/fill in the table.
		const looks = await report.locator('table.checks violet-badge').evaluateAll((badges) =>
			badges.map((badge) => ({
				status: badge.getAttribute('data-status') ?? '',
				text: badge.textContent?.trim(),
				icon: badge.getAttribute('icon'),
				look: `${badge.getAttribute('color')}/${badge.getAttribute('appearance')}`,
				background: getComputedStyle(badge.shadowRoot?.querySelector('.badge') ?? badge)
					.backgroundColor,
			}))
		);
		const byStatus = new Map(looks.map((look) => [look.status, look]));
		expect([...byStatus.keys()].sort()).toEqual([...STATUSES].sort());
		for (const status of STATUSES) {
			const look = byStatus.get(status);
			expect(look?.text).toBe(STATUS_PRESENTATION[status].label);
			expect(look?.icon).toBe(`health/${status}`);
		}
		expect(new Set(looks.map((look) => look.look)).size).toBe(7);
		expect(new Set([...byStatus.values()].map((look) => look.background)).size).toBeGreaterThan(3);
		// Icons resolve to registered shapes, not the registry's fallback glyph.
		const shapes = await report
			.locator('table.checks violet-badge')
			.evaluateAll((badges) =>
				badges.map(
					(badge) => badge.shadowRoot?.querySelector('violet-icon')?.shadowRoot?.innerHTML ?? ''
				)
			);
		expect(new Set(shapes).size).toBe(7);

		const errorRow = report.locator('tr[data-status="error"]');
		await expect(errorRow.innerText()).resolves.toContain('JSONDecodeError');
		await expect(errorRow.innerText()).resolves.toContain('Validate configuration syntax');
		const targets = report.locator('table.targets tbody tr');
		await expect(targets.count()).resolves.toBe(3);
		await expect(targets.first().innerText()).resolves.toContain('<fixture>/web-app');

		await page.screenshot({ path: join(ARTIFACTS, 'mixed-status.png'), fullPage: true });
		expect(requests).toEqual([pathToFileURL(DIST).href]);
		expect(errors).toEqual([]);
		expect(cspViolations).toEqual([]);
		await context.close();
	});

	it.each([
		['all-passed.report.json', 'Overall: Passing', 'true'],
		['advisory-only.report.json', 'Overall: Not passing: no required checks', 'false'],
		['empty-plan.report.json', 'Overall: Not passing: no required checks', 'false'],
	])('derives the verdict for %s', async (name, label, passed) => {
		const { context, page } = await fresh();
		await loadFiles(page, [fixturePath(`reports/${name}`)]);
		await expect(page.locator('.verdict-label').innerText()).resolves.toBe(label);
		await expect(page.locator('.verdict').getAttribute('data-passed')).resolves.toBe(passed);
		await context.close();
	});

	it('shows an actionable error for every invalid file and renders none of them', async () => {
		const { context, page, errors } = await fresh();
		const invalid = [
			'not-json.json',
			'not-a-report.json',
			'unsupported-version.json',
			'schema-violation.json',
			'inconsistent-summary.json',
		];
		await loadFiles(page, [
			...invalid.map((name) => fixturePath(`invalid/${name}`)),
			fixturePath('reports/all-passed.report.json'),
		]);
		const alerts = page.locator('violet-alert.load-failure');
		await expect(alerts.count()).resolves.toBe(5);
		const kinds = await alerts.evaluateAll((items) =>
			items.map((item) => [item.getAttribute('data-source'), item.getAttribute('data-kind')])
		);
		expect(kinds).toEqual([
			['not-json.json', 'not-json'],
			['not-a-report.json', 'not-a-report'],
			['unsupported-version.json', 'unsupported-version'],
			['schema-violation.json', 'schema-mismatch'],
			['inconsistent-summary.json', 'inconsistent'],
		]);
		for (const text of await alerts.allInnerTexts()) expect(text).toMatch(/Write|Select/);
		await expect(page.locator('section.report').count()).resolves.toBe(1);
		await expect(page.locator('section.report h2').innerText()).resolves.toBe(
			'all-passed.report.json'
		);
		await expect(page.locator('.status-line').innerText()).resolves.toBe(
			"Showing 1 report. 5 files can't be shown."
		);
		expect(errors).toEqual([]);
		await context.close();
	});

	it('removes a report when its file is removed', async () => {
		const { context, page } = await fresh();
		await loadFiles(page, [
			fixturePath('reports/all-passed.report.json'),
			fixturePath('reports/mixed-status.report.json'),
		]);
		await expect(page.locator('section.report').count()).resolves.toBe(2);
		await page.locator('violet-file-upload violet-icon-button').first().click();
		await page.waitForFunction(() => document.querySelectorAll('section.report').length === 1);
		await expect(page.locator('section.report h2').innerText()).resolves.toBe(
			'mixed-status.report.json'
		);
		await context.close();
	});

	it('accepts dropped files', async () => {
		const { context, page } = await fresh();
		const text = (await import('node:fs')).readFileSync(
			fixturePath('reports/all-passed.report.json'),
			'utf8'
		);
		await page.evaluate((body) => {
			const transfer = new DataTransfer();
			transfer.items.add(new File([body], 'dropped.json', { type: 'application/json' }));
			const surface = document
				.querySelector('violet-file-upload')
				?.shadowRoot?.querySelector('.surface');
			for (const type of ['dragenter', 'dragover', 'drop'])
				surface?.dispatchEvent(
					new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true })
				);
		}, text);
		await page.waitForSelector('section.report');
		await expect(page.locator('section.report h2').innerText()).resolves.toBe('dropped.json');
		await context.close();
	});
});

describe('?report= loading (Chromium, loopback server)', () => {
	it('loads relative paths from the serving origin only', async () => {
		const context = await browser.newContext();
		const absolute = encodeURIComponent('https://example.com/report.json');
		const url = `${server.origin}/dist/index.html?report=../fixtures/reports/mixed-status.report.json&report=${absolute}`;
		const { page, requests, cspViolations } = await open(context, url);
		await expect(page.locator('section.report h2').innerText()).resolves.toBe(
			'../fixtures/reports/mixed-status.report.json'
		);
		await expect(page.locator('violet-alert.load-failure').getAttribute('data-kind')).resolves.toBe(
			'not-relative'
		);
		expect(requests.every((request) => request.startsWith(server.origin))).toBe(true);
		expect(requests).toHaveLength(2);
		expect(cspViolations).toEqual([]);
		await context.close();
	});

	it('explains that ?report= needs a server when opened from a file', async () => {
		const context = await browser.newContext();
		const { page, requests } = await open(context, `${pathToFileURL(DIST).href}?report=a.json`);
		await expect(page.locator('violet-alert.load-failure').getAttribute('data-kind')).resolves.toBe(
			'needs-server'
		);
		expect(requests).toHaveLength(1);
		await context.close();
	});

	it('explains a missing report path', async () => {
		const context = await browser.newContext();
		const { page } = await open(context, `${server.origin}/dist/index.html?report=missing.json`);
		await expect(page.locator('violet-alert.load-failure').getAttribute('data-kind')).resolves.toBe(
			'unreachable'
		);
		await context.close();
	});
});
