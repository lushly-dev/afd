import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveStatic } from '../fixtures/serve-static.js';
import { createSpecimenBench, type SpecimenBench } from './bench.js';
import { loadConfig } from './config.js';
import { captureSetsDir, readCaptureSetManifest, SET_ID_PATTERN, specimenDataDir } from './sets.js';
import { startBenchServer } from './vite.js';

describe('specimen-compare and compare.html end to end', () => {
	let scratch: string;
	let bench: SpecimenBench;
	let browser: Browser;

	beforeAll(async () => {
		scratch = await mkdtemp(join(tmpdir(), 'specimen-compare-bench-'));
		await writeFile(
			join(scratch, 'toolbar.specimens.ts'),
			`
function toolbar(options: { padding: string; gap: string; grouped?: boolean; lowContrast?: boolean }) {
	const bar = document.createElement('div');
	bar.setAttribute('role', 'toolbar');
	bar.setAttribute('aria-label', 'Editor actions');
	bar.style.display = 'inline-flex';
	bar.style.alignItems = 'center';
	bar.style.padding = options.padding;
	bar.style.gap = options.gap;
	bar.style.background = '#ffffff';
	bar.style.color = '#111111';
	if (options.grouped) {
		const label = document.createElement('span');
		label.className = 'group-label';
		label.textContent = 'Format';
		label.style.fontSize = '12px';
		label.style.color = options.lowContrast ? '#d8d8d8' : '#222222';
		label.style.background = '#ffffff';
		bar.append(label);
	}
	for (const name of ['Bold', 'Italic']) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.textContent = name;
		btn.style.padding = options.padding;
		btn.style.color = '#111111';
		btn.style.background = '#f0f0f0';
		bar.append(btn);
	}
	return bar;
}

export const Dense = {
	render: () => toolbar({ padding: '4px 8px', gap: '4px' }),
};

export const Airy = {
	render: () => toolbar({ padding: '12px 20px', gap: '16px' }),
};

export const Grouped = {
	render: () => toolbar({ padding: '6px 10px', gap: '8px', grouped: true, lowContrast: true }),
};
`
		);
		await writeFile(
			join(scratch, 'specimen.config.json'),
			JSON.stringify({
				specimens: [
					{
						id: 'toolbar--dense',
						title: 'Toolbar/Dense',
						module: './toolbar.specimens.ts',
						exportName: 'Dense',
					},
					{
						id: 'toolbar--airy',
						title: 'Toolbar/Airy',
						module: './toolbar.specimens.ts',
						exportName: 'Airy',
						themes: {
							supported: ['light'],
							reason: 'Dark styles not written yet',
						},
					},
					{
						id: 'toolbar--grouped',
						title: 'Toolbar/Grouped',
						module: './toolbar.specimens.ts',
						exportName: 'Grouped',
					},
				],
			})
		);
		bench = await createSpecimenBench({ root: scratch });
		browser = await chromium.launch({ headless: true });
	}, 60_000);

	afterAll(async () => {
		await browser?.close();
		await bench?.close();
		if (scratch) await rm(scratch, { recursive: true, force: true });
	});

	it('captures variants with axe and screenshots, refuses unknown/theme-excluded variants, and renders compare.html cleanly', async () => {
		// Refuses unknown id before capturing.
		await expect(
			bench.compare({ ids: ['toolbar--dense', 'toolbar--dence'] })
		).rejects.toMatchObject({
			code: 'SPECIMEN_NOT_FOUND',
			message: expect.stringContaining('toolbar--dence'),
			suggestion: expect.stringContaining('toolbar--dense'),
		});

		// Refuses light-only variant in dark theme before capturing.
		await expect(
			bench.compare({
				ids: ['toolbar--dense', 'toolbar--airy'],
				context: { theme: 'dark' },
			})
		).rejects.toMatchObject({
			code: 'VARIANT_UNAVAILABLE',
			message: expect.stringContaining('toolbar--airy'),
			suggestion: expect.stringContaining('light'),
		});

		// Captures three variants under one light context with axe and diffs each against toolbar--dense.
		const run = await bench.compare({
			ids: ['toolbar--dense', 'toolbar--airy', 'toolbar--grouped'],
			context: { theme: 'light', viewport: { width: 1280, height: 800 } },
		});
		expect(run.set).toMatch(SET_ID_PATTERN);
		expect(run.context.theme).toBe('light');
		expect(run.checkpoint).toBe('mount');
		expect(run.page).toBe(`compare.html?set=${run.set}`);
		expect(run.captures).toHaveLength(3);
		expect(run.captures[0]).toMatchObject({
			id: 'toolbar--dense',
			status: 'captured',
			axe: 'passed',
			violations: [],
		});
		expect(run.captures[1]).toMatchObject({
			id: 'toolbar--airy',
			status: 'captured',
			axe: 'passed',
			violations: [],
		});
		expect(run.captures[2]).toMatchObject({
			id: 'toolbar--grouped',
			status: 'captured',
			axe: 'failed',
			violations: expect.arrayContaining(['color-contrast']),
		});
		for (const capture of run.captures) {
			expect(capture.screenshot).toBeTruthy();
			const info = await stat(join(scratch, capture.screenshot as string));
			expect(info.size).toBeGreaterThan(0);
		}
		expect(run.differences).toHaveLength(2);
		expect(run.differences[0]).toMatchObject({
			id: 'toolbar--airy',
			against: 'toolbar--dense',
			status: 'changed',
			channels: expect.arrayContaining(['layout']),
		});
		expect(run.differences[1]).toMatchObject({
			id: 'toolbar--grouped',
			against: 'toolbar--dense',
			status: 'changed',
		});

		// Exit criterion 1: no Observation keys in the compare response.
		const serialized = JSON.stringify(run);
		expect(serialized).not.toContain('"manifest"');
		expect(serialized).not.toContain('"completeness"');

		// Browser verification over plain static server for .specimen/ (no Vite, no observations fetched).
		const server = await serveStatic(specimenDataDir(scratch));
		try {
			const context = await browser.newContext();
			const page = await context.newPage();
			const requests: string[] = [];
			const failed: string[] = [];
			page.on('response', (response) => {
				requests.push(new URL(response.url()).pathname);
				if (response.status() >= 400) failed.push(response.url());
			});

			await page.goto(`${server.url}/${run.page}`);
			await page.waitForSelector('html[data-specimen-compare="ready"]');

			expect(failed).toEqual([]);
			// Exit criterion 1: compare.html never fetches raw observation captures.
			expect(requests.some((path) => path.includes('/captures/'))).toBe(false);

			// Renders all 3 variant cards side by side in input order.
			const cardIds = await page
				.locator('article.compare-card')
				.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-variant-id')));
			expect(cardIds).toEqual(['toolbar--dense', 'toolbar--airy', 'toolbar--grouped']);

			// Screenshots load with positive natural dimensions.
			const loadedShots = await page.locator('article.compare-card img').evaluateAll((imgs) =>
				imgs.map((img) => {
					const el = img as HTMLImageElement;
					return { alt: el.alt, complete: el.complete, width: el.naturalWidth };
				})
			);
			expect(loadedShots).toHaveLength(3);
			for (const shot of loadedShots) {
				expect(shot.complete).toBe(true);
				expect(shot.width).toBeGreaterThan(0);
			}

			// Renders axe statuses and violations clearly.
			const groupedCard = page.locator('article.compare-card[data-variant-id="toolbar--grouped"]');
			expect(await groupedCard.textContent()).toContain('axe: failed');
			expect(await groupedCard.locator('.compare-violations').textContent()).toContain(
				'color-contrast'
			);
			const denseCard = page.locator('article.compare-card[data-variant-id="toolbar--dense"]');
			expect(await denseCard.textContent()).toContain('axe: passed');

			// Renders structured differences against toolbar--dense with channels and table rows.
			const diffSection = page.getByRole('region', { name: 'Structured differences' });
			expect(await diffSection.locator('article.compare-diff').count()).toBe(2);
			const airyDiff = diffSection.locator('article.compare-diff[data-variant-id="toolbar--airy"]');
			expect(await airyDiff.textContent()).toContain('toolbar--airy vs toolbar--dense');
			expect(await airyDiff.textContent()).toContain('changed');
			expect(await airyDiff.textContent()).toContain('layout');
			expect(await airyDiff.locator('tbody tr').count()).toBeGreaterThan(0);

			// Accessibility check on compare.html itself in both light and dark themes.
			const axeSource = await readFile(
				createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
				'utf8'
			);
			for (const theme of ['light', 'dark']) {
				await page.goto(`${server.url}/${run.page}&theme=${theme}`);
				await page.waitForSelector('html[data-specimen-compare="ready"]');
				await page.addScriptTag({ content: axeSource });
				const violations = await page.evaluate(async () => {
					const result = await (
						window as unknown as {
							axe: { run(): Promise<{ violations: { id: string; nodes: unknown[] }[] }> };
						}
					).axe.run();
					return result.violations.map((v) => `${v.id} (${v.nodes.length})`);
				});
				expect(violations, `compare.html theme=${theme}`).toEqual([]);
			}

			// Invalid and missing set ids surface accessible alerts.
			await page.goto(`${server.url}/compare.html?set=../evil`);
			await page.waitForSelector('html[data-specimen-compare="error"]');
			expect(await page.getByRole('alert').textContent()).toContain('Invalid comparison set id');

			await page.goto(`${server.url}/compare.html?set=set-000000000000`);
			await page.waitForSelector('html[data-specimen-compare="error"]');
			expect(await page.getByRole('alert').textContent()).toContain('Comparison set not found');

			await context.close();
		} finally {
			await server.close();
		}

		// Verify Vite dev server serves /compare.html and compare assets while denying real saved observations.
		const manifest = await readCaptureSetManifest(scratch, run.set);
		const realObsRel = manifest.captures['toolbar--dense']?.observation;
		expect(realObsRel).toBeTruthy();
		const realObsAbs = join(captureSetsDir(scratch), run.set, realObsRel as string).replaceAll(
			'\\',
			'/'
		);
		const loaded = await loadConfig({ root: scratch });
		const devServer = await startBenchServer(loaded, { automation: true });
		try {
			const page = await browser.newPage();
			await page.goto(`${devServer.url}/${run.page}`);
			await page.waitForSelector('html[data-specimen-compare="ready"]');
			expect(await page.locator('article.compare-card').count()).toBe(3);
			// Raw saved observation files must be denied across custom routes, .specimen paths, and /@fs/.
			for (const deniedUrl of [
				`${devServer.url}/sets/${run.set}/${realObsRel}`,
				`${devServer.url}/.specimen/sets/${run.set}/${realObsRel}`,
				`${devServer.url}/@fs/${realObsAbs.replace(/^\/+/, '')}`,
				`${devServer.url}/sets/${run.set}/manifest.json`,
			]) {
				const res = await fetch(deniedUrl);
				expect(res.status, deniedUrl).toBeGreaterThanOrEqual(400);
			}
			await page.close();
		} finally {
			await devServer.close();
		}

		// Verify static build (bench.build) emits compare.html + compare assets (never observations) and loads cleanly.
		const outDir = join(scratch, 'built-site');
		const built = await bench.build(outDir);
		expect(built.files).toContain('compare.html');
		expect(built.files).toContain(`sets/${run.set}/compare.json`);
		expect(built.files.some((file) => file.includes('/captures/'))).toBe(false);
		await expect(readdir(join(outDir, 'sets', run.set, 'captures'))).rejects.toMatchObject({
			code: 'ENOENT',
		});
		const builtServer = await serveStatic(outDir);
		try {
			const page = await browser.newPage();
			const builtFailed: string[] = [];
			page.on('response', (response) => {
				if (response.status() >= 400) builtFailed.push(response.url());
			});
			await page.goto(`${builtServer.url}/${run.page}`);
			await page.waitForSelector('html[data-specimen-compare="ready"]');
			expect(builtFailed).toEqual([]);
			expect(await page.locator('article.compare-card').count()).toBe(3);
			const builtShots = await page.locator('article.compare-card img').evaluateAll((imgs) =>
				imgs.every((img) => {
					const el = img as HTMLImageElement;
					return el.complete && el.naturalWidth > 0;
				})
			);
			expect(builtShots).toBe(true);
			await page.close();
		} finally {
			await builtServer.close();
		}
	}, 120_000);
});
