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
		// Wait for stage B's shell work (rail refresh, URL boot, app surfaces and resolved keybindings)
		// to settle so cold-loading the switcher chunk on Mod+Alt+P does not race them (#2323).
		await page.waitForFunction(() => {
			const shell = document.querySelector('loam-shell') as unknown as {
				urlBooted?: boolean;
				apps?: { start?: () => Promise<void>; idle?: Promise<void> } | null;
				kernel?: { listKeybindings(): Array<{ chord: string }> };
			} | null;
			return (
				shell?.urlBooted === true &&
				shell.apps != null &&
				shell.kernel?.listKeybindings().some((binding) => binding.chord === 'Mod+Alt+P') === true
			);
		});
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				apps?: { start?: () => Promise<void>; idle?: Promise<void> } | null;
			} | null;
			await shell?.apps?.start?.();
			await shell?.apps?.idle;
		});
		await page.bringToFront();
		expect(await switcher(page).getAttribute('aria-expanded')).toBe('false');
		await page.keyboard.press('ControlOrMeta+Alt+KeyP');
		// First press dynamically imports the switcher chunk and Violet listbox/popover; allow >1 s under WebKit CI load.
		await expect
			.poll(() => switcher(page).getAttribute('aria-expanded'), { timeout: 5_000 })
			.toBe('true');
		await page.keyboard.press('Escape');
		await expect
			.poll(() => switcher(page).getAttribute('aria-expanded'), { timeout: 5_000 })
			.toBe('false');
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});
});
