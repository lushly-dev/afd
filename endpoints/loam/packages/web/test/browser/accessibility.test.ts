/**
 * E4's axe runs (phase 0 specification, section 11): the Health dashboard's tags on the shell,
 * with the palette open and closed, in each theme and density, plus once under forced colors.
 * Every part is present, so each is checked.
 */
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentCall, axe, openShell, serveDist, settle } from './harness';

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

async function everyPart(page: Page) {
	await agentCall(page, 'layout-set', {
		sidebar: { open: true },
		inspector: { open: true },
		panel: { open: true },
	});
	await settle(page);
}

async function openPalette(page: Page) {
	await page.keyboard.press('ControlOrMeta+K');
	await page.waitForFunction(() => {
		const palette = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-palette');
		return palette?.shadowRoot?.querySelector('violet-option') !== null;
	});
	await settle(page);
}

const THEMES = ['light', 'dark', 'high-contrast'] as const;
const DENSITIES = ['comfortable', 'compact'] as const;

describe('E4: axe in every theme and density', () => {
	for (const theme of THEMES)
		for (const density of DENSITIES)
			it(`has no violations in ${theme}, ${density}, with the palette closed and open`, async () => {
				const opened = await openShell(browser, site.origin, {
					viewport: { width: 1600, height: 900 },
					reducedMotion: 'reduce',
				});
				const { page } = opened;
				await agentCall(page, 'appearance-set', { theme, density });
				await everyPart(page);
				expect(await page.evaluate(() => document.documentElement.dataset.loamTheme)).toBe(theme);
				expect(await axe(page)).toEqual([]);
				await openPalette(page);
				expect(await axe(page)).toEqual([]);
				expect(opened.violations).toEqual([]);
				await opened.context.close();
			});

	it('has no violations under forced colors, with the palette closed and open', async () => {
		const opened = await openShell(browser, site.origin, {
			viewport: { width: 1600, height: 900 },
			forcedColors: 'active',
			reducedMotion: 'reduce',
		});
		const { page } = opened;
		await everyPart(page);
		expect(await page.evaluate(() => document.documentElement.dataset.loamTheme)).toBe(
			'high-contrast'
		);
		expect(await axe(page)).toEqual([]);
		await openPalette(page);
		expect(await axe(page)).toEqual([]);
		await opened.context.close();
	});

	it('has no violations in the compact class with a drawer open, and on the not-found route', async () => {
		const opened = await openShell(browser, site.origin, { viewport: { width: 390, height: 844 } });
		const { page } = opened;
		expect(await axe(page)).toEqual([]);
		await page.keyboard.press('ControlOrMeta+B');
		await settle(page);
		expect(await axe(page)).toEqual([]);
		await page.keyboard.press('Escape');
		await page.evaluate(() =>
			(window as unknown as { navigation: { navigate(url: string): unknown } }).navigation.navigate(
				'/elsewhere'
			)
		);
		await settle(page);
		expect(await axe(page)).toEqual([]);
		await opened.context.close();
	});
});

describe('names, roles and the palette keyboard', () => {
	it('exposes every part as a named landmark, and the handles as separators', async () => {
		const opened = await openShell(browser, site.origin, {
			viewport: { width: 1600, height: 900 },
		});
		const { page } = opened;
		await everyPart(page);
		const snapshot = await page.locator('loam-shell').ariaSnapshot();
		for (const line of [
			'banner "Loam"',
			'navigation "Apps"',
			'complementary "Sidebar"',
			'main',
			'complementary "Inspector"',
			'region "Panel"',
			'contentinfo "Status"',
			'separator "Resize sidebar"',
			'separator "Resize inspector"',
			'separator "Resize panel"',
			'heading "No apps yet" [level=1]',
		])
			expect(snapshot).toContain(line);
		await opened.context.close();
	});

	it('runs the palette from the keyboard: arrows move the active result, Escape closes and returns focus', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await page.locator('loam-titlebar button.search').focus();
		await page.keyboard.press('Enter');
		await page.waitForFunction(() => {
			const palette = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-palette');
			return palette?.shadowRoot?.querySelector('violet-option') !== null;
		});
		const field = page.locator('loam-palette input[role="combobox"]');
		const active = () =>
			field.evaluate((input) => {
				const id = input.getAttribute('aria-activedescendant');
				const root = input.getRootNode() as ShadowRoot;
				return id ? root.getElementById(id)?.getAttribute('value') : null;
			});
		const first = await active();
		expect(first).toBeTruthy();
		await page.keyboard.press('ArrowDown');
		expect(await active()).not.toBe(first);
		await page.keyboard.press('ArrowUp');
		expect(await active()).toBe(first);
		await page.keyboard.press('Escape');
		await settle(page);
		expect(
			await page.evaluate(() => {
				let element: Element | null = document.activeElement;
				while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
				return element?.className;
			})
		).toContain('search');
		await opened.context.close();
	});

	it('shows a failure and its suggestion in the palette footer', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openPalette(page);
		await page.evaluate(async () => {
			const palette = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-palette') as unknown as {
				results: { name: string; description: string; disabled: boolean }[];
				run(name: string): Promise<void>;
			};
			palette.results = [{ name: 'notes-create', description: 'Not registered', disabled: false }];
			await palette.run('notes-create');
		});
		const footer = page.locator('loam-palette .footer[role="status"]');
		await expect.poll(() => footer.textContent()).toMatch(/notes-create/);
		expect(await page.locator('loam-palette .suggestion').textContent()).not.toBe('');
		expect(await axe(page)).toEqual([]);
		await opened.context.close();
	});
});
