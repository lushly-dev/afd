import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
});
