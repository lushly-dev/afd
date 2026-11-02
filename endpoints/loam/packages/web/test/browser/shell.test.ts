/**
 * E6 and theme application (phase 0 specification, sections 6.3, 6.5, 7 and 11): Mock sign-in
 * from the title bar, appearance on the document element under media and settings, and view
 * state flushed on `pagehide`.
 */
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentCall, journal, layoutOf, openShell, serveDist, settle } from './harness';

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

const rootTheme = (page: Page) =>
	page.evaluate(() => ({
		theme: document.documentElement.dataset.loamTheme,
		density: document.documentElement.dataset.loamDensity ?? 'comfortable',
		surface: getComputedStyle(document.documentElement)
			.getPropertyValue('--color-surface-page')
			.trim(),
	}));

describe('E6: sign-in through the Mock adapter', () => {
	it('signs in from the title bar; the status bar shows the actor and the journal keeps no password', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await expect
			.poll(() => page.locator('loam-status-item.actor-status').textContent())
			.toBe('Signed out');
		const before = (await journal(page)).length;
		await page.locator('loam-titlebar button.account').click();
		await settle(page);
		await expect
			.poll(() => page.locator('loam-status-item.actor-status').textContent())
			.toBe('Signed in as person');
		expect(await page.locator('loam-titlebar .actor').textContent()).toBe('person');

		const added = (await journal(page)).slice(before);
		const signIn = added.findIndex((entry) => entry.command === 'auth-sign-in');
		expect(added[signIn]?.input).toEqual({
			method: 'credentials',
			email: 'person@example.com',
		});
		expect(JSON.stringify(added[signIn])).not.toContain('password');
		const next = added[signIn + 1];
		expect(next?.actor).toMatchObject({ kind: 'human', id: expect.any(String) });

		// A password an agent sends is redacted before it reaches the journal.
		await agentCall(page, 'auth-sign-out');
		await agentCall(page, 'auth-sign-in', {
			method: 'credentials',
			email: 'person@example.com',
			password: 'not-kept',
		});
		await settle(page);
		expect(JSON.stringify(await journal(page))).not.toContain('not-kept');

		await page.locator('loam-titlebar button.account').click();
		await expect
			.poll(() => page.locator('loam-status-item.actor-status').textContent())
			.toBe('Signed out');
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});
});

describe('theme and density application', () => {
	it('follows the media under appearance system', async () => {
		for (const [options, theme] of [
			[{ colorScheme: 'light' }, 'light'],
			[{ colorScheme: 'dark' }, 'dark'],
			[{ colorScheme: 'light', contrast: 'more' }, 'high-contrast'],
			[{ colorScheme: 'dark', forcedColors: 'active' }, 'high-contrast'],
		] as const) {
			const opened = await openShell(browser, site.origin, options);
			expect((await rootTheme(opened.page)).theme, JSON.stringify(options)).toBe(theme);
			await opened.context.close();
		}
	});

	it('follows a media change without a reload, and appearance-set over it', async () => {
		const opened = await openShell(browser, site.origin, { colorScheme: 'light' });
		const { page } = opened;
		const light = await rootTheme(page);
		await page.emulateMedia({ colorScheme: 'dark' });
		await expect.poll(async () => (await rootTheme(page)).theme).toBe('dark');
		expect((await rootTheme(page)).surface).not.toBe(light.surface);

		await agentCall(page, 'appearance-set', { theme: 'high-contrast', density: 'compact' });
		await expect
			.poll(() => rootTheme(page))
			.toMatchObject({ theme: 'high-contrast', density: 'compact' });
		const titlebar = await page
			.locator('loam-titlebar')
			.evaluate((element) => element.getBoundingClientRect().height);
		expect(titlebar).toBe(32);
		await agentCall(page, 'appearance-set', { theme: 'system', density: 'comfortable' });
		await expect
			.poll(() => rootTheme(page))
			.toMatchObject({ theme: 'dark', density: 'comfortable' });
		const adopted = await page.evaluate(() => ({
			sheets: document.adoptedStyleSheets.length,
			styleElements: document.querySelectorAll('style').length,
			styled: document.querySelectorAll('[style]').length,
		}));
		expect(adopted.sheets).toBeGreaterThanOrEqual(2);
		expect(adopted.styleElements).toBe(0);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});
});

describe('persistence', () => {
	it('flushes the layout on pagehide, inside the 300 ms debounce, and reads it back', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await agentCall(page, 'layout-set', { sidebar: { width: 333 } });
		// The event alone, so the write can finish: during a real reload the IndexedDB adapter's
		// read-then-write update can be cut off (a follow-up in the specification).
		await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
		await page.waitForTimeout(100);
		await page.reload();
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await page.evaluate(
			() => (document.querySelector('loam-shell') as unknown as { ready: Promise<void> }).ready
		);
		expect((await layoutOf(page)).sidebar.width).toBe(333);
		expect(
			await page
				.locator('loam-sidebar')
				.evaluate((element) => Math.round(element.getBoundingClientRect().width))
		).toBe(333);
		await opened.context.close();
	});
});
