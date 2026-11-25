import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	journal,
	kernelCall,
	measureFirstPaint,
	openApp,
	openPage,
	openShell,
	packApp,
	serveDeployment,
	serveDist,
	settle,
	surfacesIdle,
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

	it("#663: reads only the journal's last entry at boot, walking back from the end", async () => {
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		// Every cursor opened on the journal's store, from the page's first script.
		await context.addInitScript(() => {
			const opened: { method: string; direction: string }[] = [];
			(window as unknown as { journalCursors: typeof opened }).journalCursors = opened;
			const proto = IDBObjectStore.prototype as unknown as Record<
				string,
				(this: IDBObjectStore, ...args: unknown[]) => unknown
			>;
			for (const method of ['openCursor', 'openKeyCursor']) {
				const original = proto[method] as (this: IDBObjectStore, ...args: unknown[]) => unknown;
				proto[method] = function (this: IDBObjectStore, ...args: unknown[]) {
					if (this.name === 'entries')
						opened.push({ method, direction: String(args[1] ?? 'next') });
					return original.apply(this, args);
				};
			}
		});
		const first = await openShell(browser, site.origin, {}, context);
		await agentCall(first.page, 'layout-get');
		const before = await journal(first.page);
		await first.page.close();
		// A second boot over the same journal, which now holds entries.
		const { page } = await openShell(browser, site.origin, {}, context);
		const cursors = await page.evaluate(
			() => (window as unknown as { journalCursors: unknown[] }).journalCursors
		);
		// Only a read with `last` walks the keys back from the end; a whole read, as the shell's before #663, never does.
		// The harness's own polling reads the whole journal forward, so those cursors say nothing about the boot.
		expect(cursors).toContainEqual({ method: 'openKeyCursor', direction: 'prev' });
		const lastSeq = await page.evaluate(
			() => (document.querySelector('loam-shell') as unknown as { lastSeq: number }).lastSeq
		);
		expect(lastSeq).toBeGreaterThanOrEqual(before.at(-1)?.seq ?? Number.POSITIVE_INFINITY);
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
	it('P4-E12: paints with the late chunk held, runs no chord pressed before it answers, and one pressed after', async () => {
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

/** A built chunk's path by its name, with Vite's eight-character hash. */
const chunk = (name: string) => new RegExp(`/assets/${name}-[\\w-]{8}\\.js$`);
/** Which of `names` a page has requested, in `names`' order. */
const requestedOf = (requested: readonly string[], names: readonly string[]) =>
	names.filter((name) => requested.some((path) => chunk(name).test(path)));
const LAZY = ['settings', 'inbox', 'overlays'] as const;

/** Through stage B's end: its mark taken, then the kernel's apps ready, which waits on `late` and its chunks. */
const stageB = async (page: Page) => {
	await page.waitForFunction(() => performance.getEntriesByName('loam-stage-b').length > 0);
	await page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			kernel: { appsReady: Promise<void> };
		};
		await shell.kernel.appsReady;
	});
};

/** A fresh context whose every request is recorded from the navigation on, by path. */
async function recorded(): Promise<{ context: BrowserContext; requested: string[] }> {
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const requested: string[] = [];
	context.on('request', (request) => requested.push(new URL(request.url()).pathname));
	return { context, requested };
}

describe("P4-E12: phase 4's chunks in Chromium", () => {
	let hello: DeploymentSite;
	beforeAll(async () => {
		hello = await serveDeployment({
			config: deploymentFile(deploymentEntry('hello', await packApp('hello'))),
		});
	});
	afterAll(async () => {
		await hello?.close();
	});

	it("P4-E12: an empty local shell's stage B requests `late-settings`, and none of `settings`, `inbox` or `overlays`", async () => {
		const { context, requested } = await recorded();
		try {
			// A plain page, and no command run on it: `late-settings` is stage B's own load, never a call's.
			const { page, errors } = await openPage(browser, site.origin, {}, context);
			await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
			await stageB(page);
			const atStageB = [...requested];
			expect(requestedOf(atStageB, ['late-settings'])).toEqual(['late-settings']);
			expect(requestedOf(atStageB, LAZY)).toEqual([]);
			// Nor once the surfaces are idle.
			await surfacesIdle(page);
			expect(requestedOf(requested, LAZY)).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});

	/**
	 * A shell over hello in a fresh context, at stage B's end with no lazy chunk requested, `before` run, and then the
	 * paths requested from `trigger` on.
	 */
	async function requestedSince(
		trigger: (page: Page) => Promise<void>,
		before: (page: Page) => Promise<void> = async () => {}
	): Promise<string[]> {
		const { context, requested } = await recorded();
		try {
			// `agents: 'ask'` runs no `autonomy-set`, so the shell opens with no command of `late-settings`.
			const { page, errors } = await openShell(browser, hello.origin, { agents: 'ask' }, context);
			await stageB(page);
			await surfacesIdle(page);
			await before(page);
			expect(requestedOf(requested, LAZY)).toEqual([]);
			const checkpoint = requested.length;
			await trigger(page);
			// Let the trigger's loads finish, so a second chunk requested a moment later is counted too.
			await surfacesIdle(page);
			await settle(page);
			expect(errors).toEqual([]);
			return requested.slice(checkpoint);
		} finally {
			await context.close();
		}
	}

	it('P4-E12: opening the settings section requests `settings` alone of the three', async () => {
		const since = await requestedSince(async (page) => {
			await kernelCall(page, 'section-open', { section: 'settings' });
			await expect
				.poll(() => page.locator('loam-main loam-settings-section [role="tree"]').count())
				.toBe(1);
		});
		expect(requestedOf(since, LAZY)).toEqual(['settings']);
	});

	it("P4-E12: pressing the title bar's Inbox requests `inbox` alone of the three", async () => {
		const since = await requestedSince(async (page) => {
			await page.locator('loam-titlebar button.inbox').click();
			await expect.poll(() => page.locator('loam-main loam-inbox h1').count()).toBe(1);
		});
		expect(requestedOf(since, LAZY)).toEqual(['inbox']);
	});

	it("P4-E12: an app's dialog requests `overlays` alone of the three", async () => {
		const since = await requestedSince(
			async (page) => {
				const opened = (await page.evaluate(() => {
					const shell = document.querySelector('loam-shell') as unknown as {
						kernel: {
							appPort(instance: string): { call(name: string, input: unknown): Promise<unknown> };
						};
					};
					return shell.kernel.appPort('hello').call('dialog-open', { title: 'A card', body: 'B' });
				})) as { success: boolean };
				expect(opened.success).toBe(true);
				await expect.poll(() => page.locator('loam-modal dialog[open]').count()).toBe(1);
			},
			// Hello opens first, and requests none of the three itself.
			async (page) => {
				await openApp(page, 'hello');
				await surfacesIdle(page);
			}
		);
		expect(requestedOf(since, LAZY)).toEqual(['overlays']);
	});

	it("P4-E12: an empty local shell's first paint requests exactly `budget`'s first-paint chunks", async () => {
		// The list `budget` holds first paint to, read from its own source so the two cannot part (as P3-E10's).
		const source = readFileSync(
			fileURLToPath(new URL('../../scripts/budget.mjs', import.meta.url)),
			'utf8'
		);
		const listed = /const FIRST_PAINT_CHUNKS = \[([^\]]+)\]/.exec(source)?.[1] ?? '';
		const expected = [...listed.matchAll(/'([\w.-]+)'/g)].map((match) => match[1]).sort();
		expect(expected).toEqual(['index']);
		const opened = await openShell(browser, site.origin);
		try {
			const requested = (await measureFirstPaint(opened.page))
				.filter((path) => /\/assets\/[\w.-]+\.js$/.test(path))
				.map((path) => path.replace(/^.*\/assets\//, '').replace(/-[\w-]{8}\.js$/, ''))
				.sort();
			expect(requested).toEqual(expected);
			// None of phase 4's chunks is among them.
			expect(requested.filter((name) => ['late-settings', ...LAZY].includes(name))).toEqual([]);
		} finally {
			await opened.context.close();
		}
	});
});
