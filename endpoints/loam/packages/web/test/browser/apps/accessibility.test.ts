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

	it('has no violations with tally open, its panel, its status action, and a danger modal', async () => {
		for (const theme of THEMES) {
			const opened = await openShell(browser, site.origin, {
				viewport: { width: 1600, height: 900 },
				reducedMotion: 'reduce',
			});
			const { page } = opened;
			await agentCall(page, 'appearance-set', { theme });
			await openApp(page, 'tally');
			await page.locator('tally-history').waitFor();
			await page.locator('loam-status-action button').waitFor();
			await surfacesIdle(page);
			expect(await axe(page)).toEqual([]);
			await kernelCall(page, 'modal-open', { title: 'Delete?', body: 'Gone.', danger: true });
			await page.locator('loam-modal dialog[open]').waitFor();
			await surfacesIdle(page);
			expect(await axe(page)).toEqual([]);
			await opened.context.close();
		}
	});

	it('has no violations under forced colors', async () => {
		const opened = await openShell(browser, site.origin, {
			viewport: { width: 1600, height: 900 },
			forcedColors: 'active',
			reducedMotion: 'reduce',
		});
		const { page } = opened;
		await helloWithEverything(page);
		// A second row, so the active and the selected row can differ.
		await agentCall(page, 'hello-greet', { name: 'Bo' });
		await surfacesIdle(page);
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
		// Amended by phase 2's step 6: the tab bar holds the bands' sections and switcher too (7.2).
		expect(await page.locator('loam-tabbar loam-section-entry').count()).toBe(3);
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
		// Amended by phase 2's step 6: the top band opens with Projects, the switcher and Documents (7.1).
		await page.keyboard.press('Tab');
		expect((await focused(page)).label).toBe('Projects');
		await page.keyboard.press('Tab');
		expect((await focused(page)).label).toBe('Project: none');
		await page.keyboard.press('Tab');
		expect((await focused(page)).label).toBe('Documents');
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

		// F6 goes on, for what is present, through every part hello declares.
		await agentCall(page, 'layout-set', { inspector: { open: true } });
		await page.locator('hello-inspector').waitFor();
		const order: (string | null)[] = [];
		for (let index = 0; index < 5; index++) {
			await page.keyboard.press('F6');
			order.push((await focused(page)).part);
		}
		expect(order).toEqual(['sidebar', 'main', 'inspector', 'statusbar', 'titlebar']);
		await opened.context.close();
	});

	it("shows a rail entry's tooltip on hover and focus, and Escape dismisses it", async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		const entry = page.locator('loam-rail loam-app-entry[instance="hello"]');
		// Amended by phase 2's step 6: one `loam-tooltip` in the rail's shadow root, in the top layer (7.5).
		const tip = page.locator('loam-rail loam-tooltip');
		// Seen, not only displayed: the rail's list must not clip what shows beside it.
		const tipShows = () =>
			tip.evaluate((element) => {
				const box = element.getBoundingClientRect();
				if (box.width === 0) return false;
				const root = element.getRootNode() as ShadowRoot;
				return (
					root.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === element
				);
			});
		expect(await tip.count()).toBe(0);
		await entry.hover();
		await expect.poll(tipShows).toBe(true);
		expect(await tip.textContent()).toBe('Hello');
		await page.keyboard.press('Escape');
		expect(await tipShows()).toBe(false);
		await page.mouse.move(800, 400);
		await entry.locator('button').focus();
		await page.keyboard.press('Shift+Tab');
		await page.keyboard.press('Tab');
		await expect.poll(tipShows).toBe(true);
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

	it("marks the list's active and selected rows, so the keyboard's place shows", async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'hello');
		await agentCall(page, 'hello-greet', { name: 'Ada' });
		await agentCall(page, 'hello-greet', { name: 'Bo' });
		await expect.poll(() => page.locator('loam-list violet-option').count()).toBe(2);
		await page.locator('loam-list violet-listbox [role="listbox"]').focus();
		await page.keyboard.press('ArrowDown');
		const active = () =>
			page
				.locator('loam-list violet-option[data-active]')
				.evaluateAll((all) => all.map((option) => (option as unknown as { value: string }).value));
		await expect.poll(active).toEqual(['Bo']);
		await page.keyboard.press('Enter');
		await expect
			.poll(() => page.locator('hello-main x-card.selected').textContent())
			.toContain('Selected: Bo');
		const edge = await page.locator('loam-list violet-option[selected]').evaluate((option) => {
			const control = option.shadowRoot?.querySelector('[part="control"]') as Element;
			return getComputedStyle(control).borderInlineStartWidth;
		});
		expect(Number.parseFloat(edge)).toBeGreaterThan(1);
		await opened.context.close();
	});
});
