/**
 * E1 (phase 1 specification, section 14): hello loads native, under a scoped registry, and tally's
 * `x-card` stays apart from its own.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	ENGINE,
	FIREFOX_SCOPED_REGISTRIES,
	journal,
	kernelCall,
	launchEngine,
	openApp,
	openShell,
	packApp,
	serveDeployment,
	surfacesIdle,
} from '../harness';

let browser: Browser;
let site: DeploymentSite;
/**
 * Explicit poll ceiling inside `vitest.engines.config.ts`'s 30 s `testTimeout`: Vitest's 1 s
 * default is too short when Firefox loads native app modules and syncs surfaces under host load (#2743).
 */
const POLL = { timeout: 10_000 };

beforeAll(async () => {
	site = await serveDeployment({
		config: deploymentFile(
			`${deploymentEntry('hello', await packApp('hello'))}\nconfig = { default_name = "friend" }`,
			deploymentEntry('tally', await packApp('tally'))
		),
	});
	browser = await launchEngine();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
});

describe('P2-E13: E1: hello loads native', () => {
	it('lists, opens and runs it, from main, the palette and an agent', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		const native = (app: string) =>
			site.log.filter(({ path }) => path.startsWith(`/apps/${app}/dist/`));

		// The rail lists it, and no module is requested before first use.
		await expect.poll(() => page.locator('loam-rail loam-app-entry').count(), POLL).toBe(2);
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
		expect(
			await page
				.locator('hello-main h1')
				.evaluate((heading) => getComputedStyle(heading).fontFamily)
		).toMatch(/^"?Space Grotesk"?,/);

		// The registry is the app's own: the element is not global, and `kit` reached its template.
		expect(await page.evaluate(() => customElements.get('hello-main') === undefined)).toBe(true);
		expect(await page.evaluate(() => customElements.get('x-card') === undefined)).toBe(true);
		await expect
			.poll(
				() =>
					page
						.locator('hello-main x-card')
						.evaluate((card) => (card as unknown as { app?: string }).app),
				POLL
			)
			.toBe('hello');
		// Exactly one status item, as the first open renders it, whatever raced to set it.
		await expect
			.poll(() => page.locator('[data-status-item="count"]').textContent(), POLL)
			.toBe('0');
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
		await expect.poll(greets, POLL).toBe(1);
		await expect.poll(names, POLL).toEqual([expect.stringContaining('Ada')]);
		await expect
			.poll(() => page.locator('loam-statusbar [data-status-item="count"]').textContent(), POLL)
			.toBe('1');
		expect(await page.locator('hello-main .greeting').textContent()).toBe('Hello, Ada!');

		// From the palette: `hello-greet` needs no input, so it runs with the deployment's default.
		await page.keyboard.press('ControlOrMeta+K');
		await page.locator('loam-palette input').fill('Greet someone');
		// The whole list is there before the search narrows it, and Enter runs its first row.
		await expect
			.poll(
				() => page.locator('loam-palette violet-option').first().getAttribute('data-command'),
				POLL
			)
			.toBe('hello-greet');
		await page.keyboard.press('Enter');
		await expect.poll(greets, POLL).toBe(2);
		await expect
			.poll(names, POLL)
			.toEqual([expect.stringContaining('Ada'), expect.stringContaining('friend')]);

		// From an agent, which is labeled by its interface.
		await agentCall(page, 'hello-greet', { name: 'Bot' });
		await expect.poll(greets, POLL).toBe(3);
		await expect.poll(async () => (await names()).length, POLL).toBe(3);
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
		// Amended by phase 4's step 9 (P4-E14): hello's inspector is present only while `hello.inspector-v2` is on (5.3).
		await kernelCall(page, 'experiment-enable', {
			experiment: 'hello.inspector-v2',
			audience: 'person',
		});
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
			.poll(() => page.locator('hello-main x-card.selected').textContent(), POLL)
			.toContain('Selected: Ada');
		await expect
			.poll(() => page.locator('hello-inspector x-card').textContent(), POLL)
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
			.poll(() => page.locator('hello-main x-card.selected').textContent(), POLL)
			.toContain('Selected: Ada');
		await expect
			.poll(() => page.locator('loam-list violet-option[selected]').count(), POLL)
			.toBe(1);
		await opened.context.close();
	});

	// Phase 4's step 2 reviews, 7: the selection is sent before the open's queued sync starts, in the same task.
	it('reaches a selection set before the surfaces start to show the app', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await agentCall(page, 'hello-greet', { name: 'Ada' });
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: {
					subscribe(listener: (event: { command?: string }) => void): () => void;
					agent: { call(name: string, input: unknown): Promise<unknown> };
				};
			};
			// Fire `app-selection-set` synchronously in `app-open`'s own emit task (after `open()`'s
			// `unselect(record)`, before `AppSurfaces`' queued microtask `#sync()` starts) so the two
			// calls cannot invert through async autonomy-gate reads under load (#2743).
			let select: Promise<unknown> | undefined;
			const stop = shell.kernel.subscribe((event) => {
				if (event.command === 'app-open' && !select) {
					select = shell.kernel.agent.call('app-selection-set', { instance: 'hello', id: 'Ada' });
				}
			});
			try {
				await shell.kernel.agent.call('app-open', { instance: 'hello' });
				if (!select) throw new Error('app-open did not emit before resolving');
				await select;
			} finally {
				stop();
			}
		});
		await expect
			.poll(() => page.locator('hello-main x-card.selected').textContent(), POLL)
			.toContain('Selected: Ada');
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
		await expect.poll(greets, POLL).toBe(1);

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
			main.style.setProperty('--violet-color-text-secondary', 'rgb(0, 128, 0)');
			const element = main
				.querySelector('loam-mount')
				?.shadowRoot?.querySelector('hello-main') as HTMLElement;
			const paragraph = element.shadowRoot?.querySelector('p') as HTMLElement;
			const answer = {
				font: getComputedStyle(element).fontFamily,
				color: getComputedStyle(element).color,
				token: getComputedStyle(element).getPropertyValue('--violet-color-text-secondary').trim(),
				inherited: getComputedStyle(paragraph).color,
			};
			main.style.removeProperty('font-family');
			main.style.removeProperty('color');
			main.style.removeProperty('--violet-color-text-secondary');
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

	it(`D174: mounts through the platform's scoped registry in ${ENGINE}, with nothing polyfilled (#706, #2254)`, async () => {
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		const opened = await openShell(browser, site.origin, {}, context);
		const { page } = opened;
		await openApp(page, 'hello');
		await page.locator('hello-main x-card').waitFor();
		const branch = await page.evaluate(() => {
			const mount = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main loam-mount') as HTMLElement;
			const root = mount.shadowRoot as ShadowRoot & { customElementRegistry?: unknown };
			const element = root.querySelector('hello-main') as HTMLElement;
			return {
				scoped:
					root.customElementRegistry !== undefined && root.customElementRegistry !== customElements,
				polyfill:
					(globalThis as { __scopedRegistryPolyfillApplied?: boolean })
						.__scopedRegistryPolyfillApplied === true,
				upgraded: element?.matches(':defined') === true,
				global: customElements.get('hello-main') !== undefined,
			};
		});
		expect(branch).toEqual({ scoped: true, polyfill: false, upgraded: true, global: false });
		// Which engine and version ran is in the log, once it held: phase 1's W3 and D174 read it.
		console.info(`${ENGINE} ${browser.version()}: scoped registries native`);
		expect(opened.errors).toEqual([]);
		await context.close();
	});

	// Firefox is the one engine here whose scoped registries can be turned off, so it stands for every engine below the
	// floor: Firefox before 159 and the WebKit GTK port Playwright ships (D174).
	// Registered in Firefox alone, so no other engine's log shows a skip, which the exit check refuses.
	if (ENGINE === 'firefox') {
		it('D174: below the support floor, a native app says why it cannot run, and loads none of its code', async () => {
			const below = await launchEngine({
				firefoxUserPrefs: { [FIREFOX_SCOPED_REGISTRIES]: false },
			});
			try {
				const opened = await openShell(below, site.origin);
				const { page } = opened;
				const loaded = () =>
					site.log.filter(({ path }) => path.startsWith('/apps/hello/dist/')).length;
				const before = loaded();
				await openApp(page, 'hello');
				await page
					.locator('loam-main loam-notice')
					.getByText('no scoped custom element registries', { exact: false })
					.waitFor();
				expect(loaded()).toBe(before);
				expect(await page.locator('hello-main').count()).toBe(0);
				// The chrome and Violet still run: nothing replaced the platform's registry under them.
				expect(opened.errors).toEqual([]);
			} finally {
				await below.close();
			}
		});

		it("D174: below the support floor, a mounted app's console still opens, on the global registry", async () => {
			// A server that never answers: the console shows the instance, whatever its state, with no app code.
			const silent = createServer(() => {});
			await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
			const { port } = silent.address() as AddressInfo;
			const mounted = await serveDeployment({
				mounts: true,
				config: deploymentFile(
					[
						'[apps.work]',
						'app = "hello"',
						`package = ${JSON.stringify(await packApp('hello', 'mounted'))}`,
						'title = "Work"',
						'prefix = "work"',
						'audience = "person"',
						'transport = "http"',
						`url = "http://127.0.0.1:${port}/mcp"`,
					].join('\n')
				),
			});
			const below = await launchEngine({
				firefoxUserPrefs: { [FIREFOX_SCOPED_REGISTRIES]: false },
			});
			try {
				const opened = await openShell(below, mounted.root);
				const { page } = opened;
				await openApp(page, 'work');
				await page.locator('loam-main loam-mount loam-console').waitFor();
				expect(
					await page.evaluate(() => {
						const mount = document
							.querySelector('loam-shell')
							?.shadowRoot?.querySelector('loam-main loam-mount') as HTMLElement;
						return mount.shadowRoot?.querySelector('loam-console')?.matches(':defined') === true;
					})
				).toBe(true);
				expect(await page.locator('loam-main loam-notice').count()).toBe(0);
				expect(opened.errors).toEqual([]);
			} finally {
				await below.close();
				await mounted.close();
				await new Promise((resolve) => silent.close(resolve));
			}
		});
	}
});
