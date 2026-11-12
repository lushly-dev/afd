import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveStatic } from '../fixtures/serve-static.js';
import { createSpecimenBench, type SpecimenBench } from './bench.js';

// Declared theme support end to end: discovery, the pixel comparison and the review page.
const fixtures = resolve(import.meta.dirname, '../fixtures/themes');

describe('theme support', () => {
	let bench: SpecimenBench;
	beforeAll(async () => {
		bench = await createSpecimenBench({ root: fixtures });
	});
	afterAll(async () => {
		await bench.close();
	});

	it('carries a declaration from a story’s tag or a native specimen’s configuration', () => {
		const themes = Object.fromEntries(bench.list().map((entry) => [entry.id, entry.themes]));
		expect(themes).toEqual({
			follows: undefined,
			'light-declared': {
				supported: ['light'],
				basis: 'declared',
				reason: 'Matches the marketing site.',
			},
			'light-undeclared': undefined,
			'light-contradicted': { supported: ['light'], basis: 'declared' },
			'themes-stories--light-only': { supported: ['light'], basis: 'declared' },
			'themes-stories--pinned': undefined,
		});
	});

	it('finds the frames that stay the same in every theme, and fails on the undeclared one', async () => {
		const run = await bench.themes({ workers: 2 });
		const status = Object.fromEntries(run.reports.map((report) => [report.id, report.status]));
		expect(status).toEqual({
			follows: 'follows',
			'light-declared': 'declared',
			'light-undeclared': 'undeclared',
			'light-contradicted': 'contradicted',
			'themes-stories--light-only': 'declared',
			'themes-stories--pinned': 'pinned',
		});
		expect(run).toMatchObject({
			themes: ['light', 'dark', 'high-contrast'],
			checkpoint: 'mount',
			threshold: 0.02,
			valid: false,
			counts: {
				total: 6,
				follows: 1,
				declared: 2,
				pinned: 1,
				undeclared: 1,
				contradicted: 1,
				unavailable: 0,
			},
		});
		const follows = run.reports.find((report) => report.id === 'follows');
		// High contrast is the light color scheme, so only dark changes this plain page.
		expect(follows?.frames.map((frame) => frame.theme)).toEqual(['light', 'dark', 'high-contrast']);
		expect(follows?.frames[1]?.changed).toBeGreaterThan(0.5);
		const pinned = run.reports.find((report) => report.id === 'themes-stories--pinned');
		expect(pinned?.frames.map((frame) => frame.rendered)).toEqual(['dark', 'dark', 'dark']);
		const undeclared = run.reports.find((report) => report.id === 'light-undeclared');
		expect(undeclared?.frames.map((frame) => frame.changed)).toEqual([0, 0, 0]);
	}, 120_000);

	it('selects entries and themes, and is valid when nothing is undeclared', async () => {
		const run = await bench.themes({ filter: { match: 'declared' }, themes: ['light', 'dark'] });
		expect(run.reports.map((report) => [report.id, report.status])).toEqual([
			['light-declared', 'declared'],
			['light-undeclared', 'undeclared'],
		]);
		const one = await bench.themes({ id: 'follows', themes: ['dark', 'light'] });
		expect(one).toMatchObject({ valid: true, reports: [{ status: 'follows' }] });
		await expect(bench.themes({ id: 'missing' })).rejects.toThrow('Specimen not found');
	}, 120_000);
});

describe('theme support on the review page', () => {
	let scratch: string;
	let server: Awaited<ReturnType<typeof serveStatic>>;
	let browser: Browser;
	beforeAll(async () => {
		scratch = await mkdtemp(join(tmpdir(), 'specimen-themes-page-'));
		const bench = await createSpecimenBench({ root: fixtures });
		try {
			await bench.build(join(scratch, 'site'));
		} finally {
			await bench.close();
		}
		server = await serveStatic(join(scratch, 'site'));
		browser = await chromium.launch({ headless: true });
	}, 120_000);
	afterAll(async () => {
		await browser?.close();
		await server?.close();
		await rm(scratch, { recursive: true, force: true });
	});

	it('tags a declared entry on the index, with its reason', async () => {
		const page = await browser.newPage();
		await page.goto(`${server.url}/index.html`);
		const tag = page.locator('li', { hasText: 'LightDeclared' }).locator('.specimen-tag');
		await expect(tag.textContent()).resolves.toBe('light only');
		await expect(tag.getAttribute('title')).resolves.toBe('Matches the marketing site.');
		await expect(
			page.locator('li', { hasText: 'Follows' }).locator('.specimen-tag').count()
		).resolves.toBe(0);
		await page.close();
	});

	it('explains a light frame under Dark, and says nothing under a supported theme', async () => {
		const page = await browser.newPage();
		await page.goto(`${server.url}/specimen.html?id=light-declared&theme=dark`);
		await expect(page.locator('.specimen-meta .specimen-tag').textContent()).resolves.toBe(
			'light only'
		);
		await expect(page.locator('#specimen-page-theme-notice').textContent()).resolves.toBe(
			'Declared light only: Matches the marketing site. Under dark it keeps that look by design.'
		);
		await page.goto(`${server.url}/specimen.html?id=light-declared&theme=light`);
		await page.locator('.specimen-stage').waitFor();
		await expect(page.locator('#specimen-page-theme-notice').count()).resolves.toBe(0);
		await page.close();
	});
});
