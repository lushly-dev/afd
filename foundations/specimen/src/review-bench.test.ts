import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './bench.js';
import { loadConfig } from './config.js';
import { startBenchServer } from './vite.js';

describe('specimen-review and review.html end to end', () => {
	let scratch: string;
	let bench: SpecimenBench;
	let browser: Browser;

	beforeAll(async () => {
		scratch = await mkdtemp(join(tmpdir(), 'specimen-review-bench-'));
		await writeFile(
			join(scratch, 'cards.specimens.ts'),
			`
function card(label: string, pad: string) {
	const box = document.createElement('div');
	box.setAttribute('role', 'region');
	box.setAttribute('aria-label', label);
	box.style.display = 'inline-flex';
	box.style.padding = pad;
	box.style.background = '#ffffff';
	box.style.color = '#111111';
	box.style.border = '1px solid #333333';
	box.textContent = label;
	return box;
}

export const Alpha = { render: () => card('Alpha', '8px') };
export const Beta = { render: () => card('Beta', '8px') };
export const Gamma = { render: () => card('Gamma', '8px') };
export const Stable = { render: () => card('Stable', '8px') };
`
		);
		await writeFile(
			join(scratch, 'specimen.config.json'),
			JSON.stringify({
				specimens: [
					{
						id: 'card--alpha',
						title: 'Card/Alpha',
						module: './cards.specimens.ts',
						exportName: 'Alpha',
					},
					{
						id: 'card--beta',
						title: 'Card/Beta',
						module: './cards.specimens.ts',
						exportName: 'Beta',
					},
					{
						id: 'card--gamma',
						title: 'Card/Gamma',
						module: './cards.specimens.ts',
						exportName: 'Gamma',
					},
					{
						id: 'card--stable',
						title: 'Card/Stable',
						module: './cards.specimens.ts',
						exportName: 'Stable',
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

	it('renders open items, blocking rejections, and script-actor badges in review.html cleanly in light and dark themes', async () => {
		const beforeRun = await bench.captureSet({
			label: 'before',
			context: { theme: 'light', viewport: { width: 1280, height: 800 } },
		});

		// Modify Alpha (stays open), Beta (will be rejected via script), Gamma (will be accepted via script); Stable unchanged.
		await writeFile(
			join(scratch, 'cards.specimens.ts'),
			`
function card(label: string, pad: string) {
	const box = document.createElement('div');
	box.setAttribute('role', 'region');
	box.setAttribute('aria-label', label);
	box.style.display = 'inline-flex';
	box.style.padding = pad;
	box.style.background = '#ffffff';
	box.style.color = '#111111';
	box.style.border = '1px solid #333333';
	box.textContent = label;
	return box;
}

export const Alpha = { render: () => card('Alpha', '16px') };
export const Beta = { render: () => card('Beta', '20px') };
export const Gamma = { render: () => card('Gamma', '24px') };
export const Stable = { render: () => card('Stable', '8px') };
`
		);

		const afterRun = await bench.captureSet({
			label: 'after',
			context: { theme: 'light', viewport: { width: 1280, height: 800 } },
		});

		// Reject Beta's change(s) and accept Gamma's change(s) with default script provenance.
		const betaReview = await bench.review({
			before: 'before',
			after: 'after',
			ids: ['card--beta'],
		});
		expect(betaReview.open.length).toBeGreaterThan(0);
		await bench.recordDecision(
			{
				items: betaReview.open.map((item) => item.item),
				chosen: 'reject',
				reason: 'Beta padding 20px overflows compact list rows.',
			},
			{ decidedBy: { kind: 'script' } }
		);

		const gammaReview = await bench.review({
			before: 'before',
			after: 'after',
			ids: ['card--gamma'],
		});
		expect(gammaReview.open.length).toBeGreaterThan(0);
		await bench.recordDecision(
			{
				items: gammaReview.open.map((item) => item.item),
				chosen: 'accept',
				reason: 'Gamma hero spacing approved via terminal script.',
			},
			{ decidedBy: { kind: 'script' } }
		);

		const fullReview = await bench.review({ before: 'before', after: 'after' });
		expect(fullReview.open.some((item) => item.ids.includes('card--alpha'))).toBe(true);
		expect(
			fullReview.blocking.some((b) => b.kind === 'rejected' && b.ids.includes('card--beta'))
		).toBe(true);
		expect(fullReview.settled.unchanged).toBe(1);
		expect(fullReview.settled.answered).toBe(gammaReview.open.length);
		expect(fullReview.page).toBe(`review.html?before=${beforeRun.set}&after=${afterRun.set}`);

		// Verify static build emits review.html alongside compare.html.
		const outDir = join(scratch, 'static-site');
		const built = await bench.build(outDir);
		expect(built.files).toContain('review.html');
		expect((await stat(join(outDir, 'review.html'))).size).toBeGreaterThan(0);

		// Serve live via startBenchServer and verify review.html in real Chromium.
		const config = await loadConfig({ root: scratch });
		const server = await startBenchServer(config, { automation: true });
		try {
			// API error handling
			const badParams = await fetch(`${server.url}/api/review.json`);
			expect(badParams.status).toBe(400);
			const missingSet = await fetch(
				`${server.url}/api/review.json?before=nonexistent&after=${afterRun.set}`
			);
			expect(missingSet.status).toBe(404);

			const require = createRequire(import.meta.url);
			const axePath = require.resolve('axe-core/axe.min.js');

			for (const theme of ['light', 'dark'] as const) {
				const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
				const page = await context.newPage();
				try {
					const pageUrl = `${server.url}/${fullReview.page}&theme=${theme}`;
					await page.goto(pageUrl, { waitUntil: 'networkidle' });
					await page.waitForFunction(
						() => document.documentElement.dataset.specimenReview === 'ready'
					);

					// Open section shows Alpha
					const openText = await page.locator('[data-section="open"]').textContent();
					expect(openText).toContain('card--alpha');

					// Blocking section shows Beta rejection with reason and script badge
					const blocking = page.locator('[data-section="blocking"]');
					expect(await blocking.textContent()).toContain('card--beta');
					expect(await blocking.textContent()).toContain('Beta padding 20px overflows');
					expect(await blocking.locator('[data-actor-badge="script"]').count()).toBeGreaterThan(0);

					// Settled answers section shows Gamma with script badge
					const answered = page.locator('[data-section="answered"]');
					expect(await answered.textContent()).toContain('card--gamma');
					expect(await answered.locator('[data-actor-badge="script"]').count()).toBeGreaterThan(0);

					// Accessibility check on review.html itself
					await page.addScriptTag({ path: axePath });
					const axeResult = await page.evaluate(async () => {
						const win = window as unknown as {
							axe: { run: () => Promise<{ violations: { id: string; help: string }[] }> };
						};
						return win.axe.run();
					});
					expect(axeResult.violations).toEqual([]);
				} finally {
					await context.close();
				}
			}
		} finally {
			await server.close();
		}
	}, 90_000);
});
