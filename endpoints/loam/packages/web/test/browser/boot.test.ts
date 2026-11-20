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
		// Amended by phase 2's step 6: the title names the workspace, `<app or section> · <project> · <workspace>` (7.4).
		await expect.poll(() => page.title()).toBe('Personal');
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

	// Amended by phase 4's step 7 (its 8.3, R9): a chord pressed before the person's overrides are known runs nothing,
	// so the palette opens on a fresh press once they are, never on the early one.
	it('paints with the late chunk held, runs no chord pressed before it answers, and one pressed after', async () => {
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
		// Every call the kernel runs from here, to show the early press ran no `palette-open` (the fifth round's 7).
		await page.evaluate(() => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { subscribe(listener: (event: { command: string }) => void): () => void };
			};
			const ran: string[] = [];
			(globalThis as { loamRan?: string[] }).loamRan = ran;
			shell.kernel.subscribe(({ command }) => ran.push(command));
		});
		const ran = () => (globalThis as { loamRan?: string[] }).loamRan ?? [];
		await page.keyboard.press('ControlOrMeta+K');
		const paletteOpen = () => {
			const palette = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-palette') as unknown as { isOpen?: boolean } | null;
			return palette?.isOpen === true;
		};
		expect(await page.evaluate(paletteOpen)).toBe(false);
		release();
		// Ready: the keybindings list more than F6, Shift+F6 and the held save.
		await page.waitForFunction(() => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel?: { listKeybindings(): Array<{ chord: string }> };
			};
			return (shell.kernel?.listKeybindings() ?? []).some(({ chord }) => chord === 'Mod+K');
		});
		// Stage B has ended, and a call made now runs after anything queued before it: an early press's late run would
		// have come by then (the fifth round's 7).
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { appsReady: Promise<void>; call(name: string, input: unknown): Promise<unknown> };
			};
			await shell.kernel.appsReady;
			await shell.kernel.call('keybinding-list', {});
		});
		expect(await page.evaluate(ran)).not.toContain('palette-open');
		expect(await page.evaluate(paletteOpen)).toBe(false);
		await page.keyboard.press('ControlOrMeta+K');
		await page.waitForFunction(paletteOpen);
		// The positive control: the fresh press is heard as `palette-open`.
		expect(await page.evaluate(ran)).toContain('palette-open');
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
		// The person's boot commands keep working; the agent interface waits for stage B, whose `late/` names
		// its actor, so with `late` down it is refused (phase 3 specification, 3.1 and 13, step 1).
		expect(
			await page.evaluate(() =>
				(
					document.querySelector('loam-shell') as unknown as {
						kernel: { call(name: string): Promise<unknown> };
					}
				).kernel.call('layout-get')
			)
		).toMatchObject({ success: true });
		expect(await agentCall(page, 'layout-get')).toMatchObject({
			success: false,
			error: { code: 'LATE_COMMANDS_UNAVAILABLE', retryable: true },
		});
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
