/**
 * E7's runtime check and E10's second tab (phase 0 specification, sections 3, 6.6 and 11).
 * `runDataAdapterContract` runs in Vitest's browser mode (test/conformance).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundlePage } from './bundle';
import { openPage, openShell, serveDist } from './harness';

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

describe('E10: a second tab', () => {
	it('shows "Loam is open in another tab" and creates no kernel while the first holds the journal', async () => {
		const first = await openShell(browser, site.origin);
		const second = await openPage(browser, site.origin, {}, first.context);
		await second.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'locked');
		const notice = second.page.locator('loam-notice h1');
		expect(await notice.textContent()).toBe('Loam is open in another tab');
		expect(await second.page.locator('loam-shell').count()).toBe(0);
		expect(second.violations).toEqual([]);

		// The first tab keeps working.
		await first.page.keyboard.press('ControlOrMeta+B');
		await first.page.waitForFunction(
			() => document.querySelector('loam-shell')?.getAttribute('data-sidebar') === 'closed'
		);

		// Once the first tab is gone, a new one takes the lock.
		await first.page.close();
		const third = await openPage(browser, site.origin, {}, first.context);
		await third.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await first.context.close();
	});
});

describe('E7: VioletRuntime with the preloaded source', () => {
	it('gives the same computed values for every component id as the stylesheet, for loam/dark', async () => {
		const contract = JSON.parse(
			readFileSync(
				createRequire(import.meta.url).resolve('@lushly-dev/loam-theme/contract.json'),
				'utf8'
			)
		) as { tokens: Record<string, { property: string; kind: string }> };
		const properties = Object.values(contract.tokens)
			.filter((token) => token.kind === 'component')
			.map((token) => token.property);
		expect(properties).toHaveLength(108);

		const opened = await openShell(browser, site.origin, { colorScheme: 'light' });
		await opened.page.evaluate(await bundlePage('violet-runtime'));
		const result = await opened.page.evaluate(
			(list) =>
				(
					window as unknown as {
						loamVioletRuntime: (list: string[]) => Promise<{
							stylesheet: Record<string, string>;
							light: Record<string, string>;
							applied: Record<string, string>;
						}>;
					}
				).loamVioletRuntime(list),
			properties
		);
		expect(result.applied).toEqual(result.stylesheet);
		// The comparison means something only if dark differs from light.
		expect(result.applied).not.toEqual(result.light);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});
});
