import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	deploymentEntry,
	deploymentFile,
	openPage,
	openShell,
	packApp,
	serveDeployment,
	serveDist,
} from './harness';

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

describe('the built shell', () => {
	it('boots under its content security policy with no errors', async () => {
		const context = await browser.newContext();
		const page = await context.newPage();
		const errors: string[] = [];
		page.on('console', (message) => {
			if (message.type() === 'error') errors.push(message.text());
		});
		page.on('pageerror', (error) => errors.push(error.message));
		await page.addInitScript(() => {
			document.addEventListener('securitypolicyviolation', (event) => {
				console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
			});
		});
		await page.goto(site.origin);
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		expect(await page.title()).toBe('Loam');
		const csp = await page
			.locator('meta[http-equiv="Content-Security-Policy"]')
			.getAttribute('content');
		expect(csp).toContain("object-src 'none'");
		expect(errors).toEqual([]);
		await context.close();
	});

	it('loads the late commands under the same policy, and no chunk of the apps', async () => {
		const opened = await openShell(browser, site.origin);
		await opened.page.waitForFunction(() =>
			performance.getEntriesByType('resource').some((entry) => /\/late-/.test(entry.name))
		);
		const paths = await opened.page.evaluate(() =>
			performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname)
		);
		// Classic Zod belongs to apps and the MCP client, and an empty shell loads neither.
		expect(paths.filter((path) => /\/(apps|iso|validate\.generated)-/.test(path))).toEqual([]);
		expect(await agentCall(opened.page, 'shell-info-get')).toMatchObject({
			success: true,
			data: { host: 'browser' },
		});
		await expect
			.poll(() =>
				opened.page.evaluate(() => {
					const shell = document.querySelector('loam-shell') as unknown as {
						kernel: { listCommands(): unknown[] };
					};
					return shell.kernel.listCommands().length;
				})
			)
			.toBeGreaterThan(4);
		expect(opened.violations).toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('paints with the late chunk held, and runs a chord pressed before it answers', async () => {
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await context.route('**/assets/late-*', async (route) => {
			await held;
			await route.continue();
		});
		const { page, errors } = await openPage(browser, site.origin, {}, context);
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await page.waitForFunction(
			() => performance.getEntriesByName('first-contentful-paint').length > 0
		);
		await page.keyboard.press('ControlOrMeta+K');
		const paletteOpen = () => {
			const palette = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-palette') as unknown as { isOpen?: boolean } | null;
			return palette?.isOpen === true;
		};
		expect(await page.evaluate(paletteOpen)).toBe(false);
		release();
		await page.waitForFunction(paletteOpen);
		expect(errors).toEqual([]);
		await context.close();
	});

	it('keeps the shell up and says so when the late chunk does not load', async () => {
		const context = await browser.newContext();
		await context.route('**/assets/late-*', (route) => route.abort());
		const { page } = await openPage(browser, site.origin, {}, context);
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await expect
			.poll(() =>
				page.evaluate(() => {
					const main = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-main');
					return main?.shadowRoot?.querySelector('h1')?.textContent;
				})
			)
			.toBe('Could not load. Reload to try again.');
		expect(await agentCall(page, 'layout-get')).toMatchObject({ success: true });
		expect(await agentCall(page, 'layout-reset')).toMatchObject({
			success: false,
			error: { code: 'LATE_COMMANDS_UNAVAILABLE', retryable: true },
		});
		await context.close();
	});

	it('says so in main and the rail when the late chunk does not load and apps are listed', async () => {
		const hello = await serveDeployment({
			config: deploymentFile(deploymentEntry('hello', await packApp('hello'))),
		});
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		await context.route('**/assets/late-*', (route) => route.abort());
		const { page } = await openPage(browser, hello.origin, {}, context);
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		const entry = page.locator('loam-rail loam-app-entry[instance="hello"] button');
		await expect.poll(() => entry.getAttribute('aria-label')).toBe('Hello (unavailable)');
		expect(await entry.getAttribute('aria-busy')).toBeNull();
		const main = () =>
			page.evaluate(() => {
				const element = document
					.querySelector('loam-shell')
					?.shadowRoot?.querySelector('loam-main');
				return {
					heading: element?.shadowRoot?.querySelector('h1')?.textContent,
					busy: element?.getAttribute('aria-busy') ?? null,
				};
			});
		await expect
			.poll(main)
			.toEqual({ heading: 'Could not load. Reload to try again.', busy: null });
		// What the surfaces chunk would set never replaces it.
		await page.waitForTimeout(300);
		expect(await main()).toEqual({ heading: 'Could not load. Reload to try again.', busy: null });
		await context.close();
		await hello.close();
	});
});
