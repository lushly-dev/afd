/**
 * Phase 4's I8 (#706): whether the project switcher's chord, `Mod+Alt+P` (phase 4 specification, 8.4, #857), reaches
 * a Firefox or WebKit page. Chromium's is P4-E9's (`keybindings.test.ts`), and `vitest.browser.config.ts` leaves this
 * file out; `vitest.engines.config.ts` runs it in Firefox and WebKit.
 */
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	ENGINE,
	launchEngine,
	openShell,
	packApp,
	serveDeployment,
} from '../harness';

let browser: Browser;
let site: DeploymentSite;
beforeAll(async () => {
	site = await serveDeployment({
		config: deploymentFile(deploymentEntry('hello', await packApp('hello'))),
	});
	browser = await launchEngine();
}, 120_000);
afterAll(async () => {
	await browser?.close();
	await site?.close();
});

const switcher = (page: Page) => page.locator('loam-rail loam-project-switcher button');

describe(`I8: the project switcher's chord in ${ENGINE}`, () => {
	it('Mod+Alt+P reaches the page and opens the project switcher (8.4, #857)', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		expect(await switcher(page).getAttribute('aria-expanded')).toBe('false');
		await page.keyboard.press('ControlOrMeta+Alt+KeyP');
		await expect.poll(() => switcher(page).getAttribute('aria-expanded')).toBe('true');
		await page.keyboard.press('Escape');
		await expect.poll(() => switcher(page).getAttribute('aria-expanded')).toBe('false');
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});
});
