/**
 * E11's axe runs and keyboard (phase 1 specification, section 14): the shell with hello native open, and
 * with a toast and a modal, in each theme and density, under forced colors, and in the compact class
 * with the tab bar's app entries.
 */
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	axe,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	focused,
	kernelCall,
	openApp,
	openShell,
	packApp,
	parts,
	serveDeployment,
	surfacesIdle,
} from '../harness';

let browser: Browser;
let site: DeploymentSite;
beforeAll(async () => {
	site = await serveDeployment({
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello')),
			deploymentEntry('tally', await packApp('tally'))
		),
	});
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
});

async function helloWithEverything(page: Page) {
	await openApp(page, 'hello');
	await agentCall(page, 'hello-greet', { name: 'Ada' });
	await agentCall(page, 'layout-set', { inspector: { open: true } });
	await surfacesIdle(page);
	await page.locator('loam-list violet-option').first().waitFor();
	await page.locator('hello-inspector').waitFor();
	await page.locator('loam-list violet-option').first().click();
	await page.locator('loam-list violet-option[selected]').waitFor();
	await page.mouse.move(800, 400);
	await surfacesIdle(page);
}

async function withOverlays(page: Page) {
	await kernelCall(page, 'toast-show', { message: 'Saved', tone: 'success', durationMs: 30000 });
	await kernelCall(page, 'toast-show', { message: 'Failed', tone: 'danger', durationMs: 30000 });
	await page.locator('loam-toast[tone="danger"]').waitFor();
	await page.locator('hello-main violet-button.modal').click();
	await page.locator('loam-modal dialog[open]').waitFor();
	await surfacesIdle(page);
}

const THEMES = ['light', 'dark', 'high-contrast'] as const;
const DENSITIES = ['comfortable', 'compact'] as const;

describe('E11: axe with apps', () => {
	for (const theme of THEMES)
		for (const density of DENSITIES)
			it(`has no violations in ${theme}, ${density}, with hello open and with its overlays`, async () => {
				const opened = await openShell(browser, site.origin, {
					viewport: { width: 1600, height: 900 },
					reducedMotion: 'reduce',
				});
				const { page } = opened;
				await agentCall(page, 'appearance-set', { theme, density });
				await helloWithEverything(page);
				expect(await page.evaluate(() => document.documentElement.dataset.loamTheme)).toBe(theme);
				expect(await axe(page)).toEqual([]);
				await withOverlays(page);
				expect(await axe(page)).toEqual([]);
				expect(opened.violations).toEqual([]);
				expect(opened.errors).toEqual([]);
				await opened.context.close();
			});

	it('has no violations under forced colors', async () => {
		const opened = await openShell(browser, site.origin, {
			viewport: { width: 1600, height: 900 },
			forcedColors: 'active',
			reducedMotion: 'reduce',
		});
		const { page } = opened;
		await helloWithEverything(page);
		expect(await axe(page)).toEqual([]);
		await withOverlays(page);
		expect(await axe(page)).toEqual([]);
		await opened.context.close();
	});

	it('has no violations in the compact class, with the tab bar entries', async () => {
		const opened = await openShell(browser, site.origin, {
			viewport: { width: 390, height: 844 },
			reducedMotion: 'reduce',
		});
		const { page } = opened;
		const layout = await parts(page);
		expect(layout.tabbar.present).toBe(true);
		expect(await page.locator('loam-tabbar loam-app-entry').count()).toBe(2);
		expect(await axe(page)).toEqual([]);
		await page.locator('loam-tabbar loam-app-entry[instance="hello"] button').click();
		await page.locator('hello-main').waitFor();
		await surfacesIdle(page);
		expect(
			await page
				.locator('loam-tabbar loam-app-entry[instance="hello"] button')
				.getAttribute('aria-current')
		).toBe('page');
		expect(await axe(page)).toEqual([]);
		await opened.context.close();
	});
});

describe('E11: the keyboard with apps', () => {
	it("reaches and operates the rail's entries, and F6's order is unchanged", async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await page.keyboard.press('F6');
		await page.keyboard.press('F6');
		expect((await focused(page)).part).toBe('rail');
		await page.keyboard.press('Tab');
		expect((await focused(page)).label).toBe('Hello');
		await page.keyboard.press('Enter');
		await page.locator('hello-main').waitFor();
		await surfacesIdle(page);
		expect(
			await page
				.locator('loam-rail loam-app-entry[instance="hello"] button')
				.getAttribute('aria-current')
		).toBe('page');
		await page.keyboard.press('Tab');
		expect((await focused(page)).label).toBe('Tally');
		await page.keyboard.press('Tab');
		expect((await focused(page)).label).toContain('Settings');

		// F6 goes on: sidebar, main, then the status bar, for what is present.
		const order: (string | null)[] = [];
		for (let index = 0; index < 4; index++) {
			await page.keyboard.press('F6');
			order.push((await focused(page)).part);
		}
		expect(order).toEqual(['sidebar', 'main', 'statusbar', 'titlebar']);
		await opened.context.close();
	});

	it("shows a rail entry's tooltip on hover and focus, and Escape dismisses it", async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		const entry = page.locator('loam-rail loam-app-entry[instance="hello"]');
		const tip = entry.locator('.tip');
		expect(await tip.isVisible()).toBe(false);
		await entry.hover();
		expect(await tip.isVisible()).toBe(true);
		expect(await tip.textContent()).toBe('Hello');
		await page.keyboard.press('Escape');
		expect(await tip.isVisible()).toBe(false);
		await page.mouse.move(800, 400);
		await entry.locator('button').focus();
		await page.keyboard.press('Shift+Tab');
		await page.keyboard.press('Tab');
		expect(await tip.isVisible()).toBe(true);
		await opened.context.close();
	});

	it('moves focus to main when the surface holding it leaves', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'hello');
		await page.locator('hello-main violet-button.toast').focus();
		await agentCall(page, 'app-open', { instance: 'tally' });
		await page.locator('tally-main').waitFor();
		expect((await focused(page)).part).toBe('main');
		await opened.context.close();
	});
});
