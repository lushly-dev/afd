/**
 * E1 (phase 1 specification, section 14): hello loads native, under a scoped registry, and tally's
 * `x-card` stays apart from its own.
 */
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	journal,
	openApp,
	openShell,
	packApp,
	serveDeployment,
	surfacesIdle,
} from '../harness';

let browser: Browser;
let site: DeploymentSite;
beforeAll(async () => {
	site = await serveDeployment({
		config: deploymentFile(
			`${deploymentEntry('hello', await packApp('hello'))}\nconfig = { default_name = "friend" }`,
			deploymentEntry('tally', await packApp('tally'))
		),
	});
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
});

describe('E1: hello loads native', () => {
	it('lists, opens and runs it, from main, the palette and an agent', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		const native = (app: string) =>
			site.log.filter(({ path }) => path.startsWith(`/apps/${app}/dist/`));

		// The rail lists it, and no module is requested before first use.
		await expect.poll(() => page.locator('loam-rail loam-app-entry').count()).toBe(2);
		expect(await page.locator('loam-main h1').textContent()).toBe('Choose an app');
		expect(native('hello')).toEqual([]);
		expect(native('tally')).toEqual([]);

		await openApp(page, 'hello');
		expect(native('hello').map(({ path }) => path)).toContain('/apps/hello/dist/native.js');
		expect(native('tally')).toEqual([]);
		expect(
			await page
				.locator('loam-rail loam-app-entry[instance="hello"] button')
				.getAttribute('aria-current')
		).toBe('page');
		expect(await page.locator('loam-main h1:visible').allTextContents()).toEqual(['Hello']);
		expect(await page.locator('loam-part-header .title').textContent()).toBe('Hello');
		expect(await page.locator('loam-sidebar .title').textContent()).toBe('Greetings');
		expect(await page.locator('hello-main').count()).toBe(1);

		// The registry is the app's own: the element is not global, and `kit` reached its template.
		expect(await page.evaluate(() => customElements.get('hello-main') === undefined)).toBe(true);
		expect(await page.evaluate(() => customElements.get('x-card') === undefined)).toBe(true);
		await expect
			.poll(() =>
				page
					.locator('hello-main x-card')
					.evaluate((card) => (card as unknown as { app?: string }).app)
			)
			.toBe('hello');
		// Exactly one status item, as the first open renders it, whatever raced to set it.
		await expect.poll(() => page.locator('[data-status-item="count"]').textContent()).toBe('0');
		expect(await page.locator('[data-status-item="count"]').count()).toBe(1);
		// Amended by phase 2's step 6: `<app or section> · <project> · <workspace>` (7.4).
		expect(await page.title()).toBe('Hello · Personal');
		expect(await page.locator('loam-toast-region .announcement').textContent()).toBe(
			'Hello opened'
		);

		const greets = async () =>
			(await journal(page)).filter(({ command }) => command === 'hello-greet').length;
		const names = () => page.locator('loam-list violet-option').allTextContents();

		// From main, through the kit's text field and button.
		await page.locator('hello-main violet-text-field input').fill('Ada');
		await page.locator('hello-main violet-button.greet').click();
		await expect.poll(greets).toBe(1);
		await expect.poll(names).toEqual([expect.stringContaining('Ada')]);
		await expect
			.poll(() => page.locator('loam-statusbar [data-status-item="count"]').textContent())
			.toBe('1');
		expect(await page.locator('hello-main .greeting').textContent()).toBe('Hello, Ada!');

		// From the palette: `hello-greet` needs no input, so it runs with the deployment's default.
		await page.keyboard.press('ControlOrMeta+K');
		await page.locator('loam-palette input').fill('Greet someone');
		// The whole list is there before the search narrows it, and Enter runs its first row.
		await expect
			.poll(() => page.locator('loam-palette violet-option').first().getAttribute('data-command'))
			.toBe('hello-greet');
		await page.keyboard.press('Enter');
		await expect.poll(greets).toBe(2);
		await expect
			.poll(names)
			.toEqual([expect.stringContaining('Ada'), expect.stringContaining('friend')]);

		// From an agent, which is labeled by its interface.
		await agentCall(page, 'hello-greet', { name: 'Bot' });
		await expect.poll(greets).toBe(3);
		await expect.poll(async () => (await names()).length).toBe(3);
		const entries = (await journal(page)).filter(({ command }) => command === 'hello-greet');
		expect(entries.map((entry) => entry.interface)).toEqual(['palette', 'palette', 'agent']);

		// The kernel says what it is.
		const detail = (await agentCall(page, 'app-get', { instance: 'hello' })) as {
			data: { trust: string; trustLine: string };
		};
		expect(detail.data.trust).toBe('trusted');
		expect(detail.data.trustLine).toContain('Trusted, not sandboxed');

		expect(opened.violations).toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('reaches main and the inspector with a selection', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'hello');
		await agentCall(page, 'hello-greet', { name: 'Ada' });
		await page.locator('loam-list violet-option').first().waitFor();
		// The preset leaves the inspector closed, and hello declares it.
		await agentCall(page, 'layout-set', { inspector: { open: true } });
		await page.locator('hello-inspector x-card').waitFor();
		expect(await page.locator('hello-inspector x-card').textContent()).toContain(
			'Select a name in the list'
		);
		await page.locator('loam-list violet-option').first().click();
		await expect
			.poll(() => page.locator('hello-main x-card.selected').textContent())
			.toContain('Selected: Ada');
		await expect
			.poll(() => page.locator('hello-inspector x-card').textContent())
			.toContain('Greeted Ada');
		const selection = (await agentCall(page, 'app-selection-get', { instance: 'hello' })) as {
			data: { id: string };
		};
		expect(selection.data.id).toBe('Ada');
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('reaches a selection set straight after an open', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await agentCall(page, 'hello-greet', { name: 'Ada' });
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { agent: { call(name: string, input: unknown): Promise<unknown> } };
			};
			await shell.kernel.agent.call('app-open', { instance: 'hello' });
			await shell.kernel.agent.call('app-selection-set', { instance: 'hello', id: 'Ada' });
		});
		await expect
			.poll(() => page.locator('hello-main x-card.selected').textContent())
			.toContain('Selected: Ada');
		await expect.poll(() => page.locator('loam-list violet-option[selected]').count()).toBe(1);
		await opened.context.close();
	});

	it('runs its chord only while it is active', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		const greets = async () =>
			(await journal(page)).filter(({ command }) => command === 'hello-greet').length;
		await page.keyboard.press('ControlOrMeta+Shift+H');
		await surfacesIdle(page);
		expect(await greets()).toBe(0);

		await openApp(page, 'hello');
		await page.keyboard.press('ControlOrMeta+Shift+H');
		await expect.poll(greets).toBe(1);

		await openApp(page, 'tally');
		await page.keyboard.press('ControlOrMeta+Shift+H');
		await surfacesIdle(page);
		expect(await greets()).toBe(1);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('keeps each app to its own x-card, and the shell out of its mount but for tokens', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'hello');
		expect(
			await page
				.locator('hello-main x-card')
				.evaluate((card) => (card as unknown as { app: string }).app)
		).toBe('hello');
		const helloClass = await page
			.locator('hello-main x-card')
			.evaluate((card) => card.constructor.name);

		// A font and a color set on the shell's part stop at the mount; a token flows through.
		const styled = await page.evaluate(() => {
			const main = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main') as HTMLElement;
			main.style.setProperty('font-family', 'monospace');
			main.style.setProperty('color', 'rgb(255, 0, 0)');
			main.style.setProperty('--color-text-secondary', 'rgb(0, 128, 0)');
			const element = main
				.querySelector('loam-mount')
				?.shadowRoot?.querySelector('hello-main') as HTMLElement;
			const paragraph = element.shadowRoot?.querySelector('p') as HTMLElement;
			const answer = {
				font: getComputedStyle(element).fontFamily,
				color: getComputedStyle(element).color,
				token: getComputedStyle(element).getPropertyValue('--color-text-secondary').trim(),
				inherited: getComputedStyle(paragraph).color,
			};
			main.style.removeProperty('font-family');
			main.style.removeProperty('color');
			main.style.removeProperty('--color-text-secondary');
			return answer;
		});
		expect(styled.font).not.toContain('monospace');
		expect(styled.color).not.toBe('rgb(255, 0, 0)');
		expect(styled.token).toBe('rgb(0, 128, 0)');
		expect(styled.inherited).toBe('rgb(0, 128, 0)');

		await openApp(page, 'tally');
		await page.locator('tally-main x-card').waitFor();
		const tally = page.locator('tally-main x-card');
		expect(await tally.evaluate((card) => (card as unknown as { app: string }).app)).toBe('tally');
		expect(await tally.evaluate((card) => card.constructor.name)).not.toBe(helloClass);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});
});
