/**
 * E9 (phase 0 specification, 8.1 and 8.2): A1 to A3 measured in Chromium against their budgets,
 * reported with each run. The bundle budget is the `budget` script, a step of its own in loam.yml.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundlePage } from './bundle';
import { serveDist } from './harness';

let browser: Browser;
let site: Awaited<ReturnType<typeof serveDist>>;
beforeAll(async () => {
	site = await serveDist();
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
});

/** The budgets of 8.2, in milliseconds. */
const BUDGETS = { a1P95: 8, a2Total: 2_000, a3Total: 500 };

describe('E9: the accelerator operations A1 to A3', () => {
	it('stay within budget on the reference workspace', async () => {
		const source = await bundlePage('accelerators');
		const context = await browser.newContext();
		const page = await context.newPage();
		// The journal digests context with WebCrypto, which needs a secure context: loopback is one.
		await page.goto(`${site.origin}/__accelerators__`);
		await page.evaluate(source);
		const result = await page.evaluate(() =>
			(
				window as unknown as {
					loamAccelerators: () => Promise<{
						a1: { queries: number; entries: number; p95Ms: number };
						a2: { entries: number; totalMs: number; diverged: boolean };
						a3: { entries: number[]; totalMs: number; equal: boolean };
					}>;
				}
			).loamAccelerators()
		);
		const browserVersion = browser.version();
		// Recorded with each run: test-results/ is uploaded by loam.yml, and printed here.
		const results = fileURLToPath(new URL('../../test-results/', import.meta.url));
		mkdirSync(results, { recursive: true });
		writeFileSync(
			`${results}accelerators.json`,
			`${JSON.stringify({ chromium: browserVersion, budgets: BUDGETS, ...result }, null, '\t')}\n`
		);
		process.stderr.write(
			`A1 p95 ${result.a1.p95Ms.toFixed(2)} ms over ${result.a1.queries} queries on ${result.a1.entries} entries (budget ${BUDGETS.a1P95}); ` +
				`A2 ${result.a2.totalMs.toFixed(0)} ms for ${result.a2.entries} entries (budget ${BUDGETS.a2Total}); ` +
				`A3 ${result.a3.totalMs.toFixed(0)} ms for 2 × ${result.a3.entries[0]} entries (budget ${BUDGETS.a3Total}); Chromium ${browserVersion}\n`
		);
		expect(result.a1).toMatchObject({ queries: 200, entries: 5_000 });
		expect(result.a2).toMatchObject({ entries: 10_000, diverged: false });
		expect(result.a1.p95Ms).toBeLessThanOrEqual(BUDGETS.a1P95);
		expect(result.a2.totalMs).toBeLessThanOrEqual(BUDGETS.a2Total);
		expect(result.a3.totalMs).toBeLessThanOrEqual(BUDGETS.a3Total);
		await context.close();
	}, 180_000);
});
