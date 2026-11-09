/**
 * E7 in a browser, and D66 (phase 1 specification, sections 10 and 14): a refused or failed app is listed
 * with its reason and never stops the shell or another app, even when the code that reads apps cannot
 * load.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	axe,
	deploymentEntry,
	deploymentFile,
	journal,
	openApp,
	openShell,
	packApp,
	serveDeployment,
	serveDist,
	surfacesIdle,
} from '../harness';

let browser: Browser;
let scratch: string;
beforeAll(async () => {
	browser = await chromium.launch();
	scratch = await mkdtemp(join(tmpdir(), 'loam-refusal-'));
});
afterAll(async () => {
	await browser?.close();
	await rm(scratch, { recursive: true, force: true });
});

/** A package holding `manifest` raw, as `deployment write` carries it. */
async function rawPackage(name: string, manifest: unknown, files: Record<string, string> = {}) {
	const directory = join(scratch, name);
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, 'app-manifest.json'), JSON.stringify(manifest));
	for (const [file, text] of Object.entries(files)) {
		await mkdir(join(directory, file, '..'), { recursive: true });
		await writeFile(join(directory, file), text);
	}
	return directory;
}

const entryButton = (page: Page, instance: string) =>
	page.locator(`loam-rail loam-app-entry[instance="${instance}"] button`);

/** Hello's packed manifest, changed. */
async function helloManifest(change: (manifest: Record<string, unknown>) => void) {
	const manifest = JSON.parse(
		await readFile(join(await packApp('hello'), 'app-manifest.json'), 'utf8')
	) as Record<string, unknown>;
	change(manifest);
	return manifest;
}

describe('P2-E13: E7: a manifest that declares an unknown surface', () => {
	it('is refused with the list of surfaces; the rail shows it, and the rest of the shell works', async () => {
		const manifest = await helloManifest((raw) => {
			(raw.ui as { surfaces: Record<string, unknown> }).surfaces.tray = { element: 'hello-tray' };
		});
		const site = await serveDeployment({
			config: deploymentFile(
				deploymentEntry('hello', await rawPackage('tray', manifest)),
				deploymentEntry('tally', await packApp('tally'))
			),
		});
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		const list = (await agentCall(page, 'app-list')) as {
			data: {
				apps: Array<{
					instance: string;
					state: string;
					error?: { code: string; suggestion: string };
				}>;
			};
		};
		const refused = list.data.apps.find(({ instance }) => instance === 'hello');
		expect(refused?.state).toBe('refused');
		expect(refused?.error?.code).toBe('MANIFEST_UNKNOWN_SURFACE');

		await expect
			.poll(() => entryButton(page, 'hello').getAttribute('aria-label'))
			.toBe('hello (unavailable)');
		expect(
			await page
				.locator('loam-rail loam-app-entry[instance="hello"] violet-icon')
				.getAttribute('icon')
		).toBe('system/warning');

		await openApp(page, 'hello');
		const notice = page.locator('loam-main loam-notice');
		expect(await notice.locator('h1').textContent()).toBe('hello');
		expect(await notice.locator('p').first().textContent()).toContain('MANIFEST_UNKNOWN_SURFACE');
		expect(await notice.locator('p').first().textContent()).toContain('tray');
		expect(await notice.locator('p.suggestion').textContent()).not.toBe('');
		// Every part is undeclared, so its toggle says so and does nothing.
		const toggle = page.locator('loam-titlebar [data-toggle="sidebar"]');
		expect(await toggle.getAttribute('aria-disabled')).toBe('true');
		const before = (await journal(page)).length;
		await toggle.click({ force: true });
		await surfacesIdle(page);
		expect((await journal(page)).slice(before).map(({ command }) => command)).not.toContain(
			'layout-set'
		);
		expect(await axe(page)).toEqual([]);

		// The rest of the shell works.
		await openApp(page, 'tally');
		await page.locator('tally-main').waitFor();
		expect(await page.locator('loam-main loam-notice').count()).toBe(0);
		expect(await toggle.getAttribute('aria-disabled')).toBe('true');
		expect(opened.violations).toEqual([]);
		await opened.context.close();
		await site.close();
	});
});

describe('D66: nothing an app does stops the shell', () => {
	it('shows a throwing activate in main, and keeps its text out of the journal', async () => {
		const manifest = await helloManifest((raw) => {
			(raw.ui as { surfaces: Record<string, unknown> }).surfaces = {
				rail: { label: 'Broken' },
				main: { element: 'broken-main' },
			};
			(raw.ui as { compositions?: unknown }).compositions = undefined;
			(raw.ui as { layout?: unknown }).layout = undefined;
		});
		const directory = await rawPackage('throws', manifest, {
			'dist/native.js': `export default {
	sdk: 1,
	handlers: {
		'hello-greet': async () => ({ success: true, data: {} }),
		'hello-list': async () => ({ success: true, data: { items: [] } }),
		'hello-forget': async () => ({ success: true, data: {} }),
	},
	activate() { throw new Error('secret-activate-text'); },
};
`,
		});
		const site = await serveDeployment({
			config: deploymentFile(deploymentEntry('hello', directory)),
		});
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await entryButton(page, 'hello').click();
		await page.locator('loam-main loam-notice').waitFor();
		expect(await page.locator('loam-notice p').first().textContent()).toContain(
			'secret-activate-text'
		);
		await expect
			.poll(() => entryButton(page, 'hello').getAttribute('aria-label'))
			.toBe('Broken (unavailable)');
		const entries = await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				journal: { read(): Promise<unknown[]> };
			};
			return JSON.stringify(await shell.journal.read());
		});
		expect(entries).not.toContain('secret-activate-text');
		expect(opened.errors.join(' ')).toContain('secret-activate-text');
		await opened.context.close();
		await site.close();
	});

	it('keeps an import that throws out of the journal, and calls deactivate only for what activated', async () => {
		const bare = (raw: Record<string, unknown>) => {
			(raw.ui as { surfaces: Record<string, unknown> }).surfaces = { main: { element: 'x-y' } };
			(raw.ui as { compositions?: unknown }).compositions = undefined;
			(raw.ui as { layout?: unknown }).layout = undefined;
		};
		const throwing = await rawPackage('import-throws', await helloManifest(bare), {
			'dist/native.js': "throw new Error('secret-import-text');\n",
		});
		const site = await serveDeployment({
			config: deploymentFile(deploymentEntry('hello', throwing)),
		});
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await entryButton(page, 'hello').click();
		await page.locator('loam-main loam-notice').waitFor();
		const entries = await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				journal: { read(): Promise<unknown[]> };
			};
			return JSON.stringify(await shell.journal.read());
		});
		expect(entries).not.toContain('secret-import-text');
		expect(opened.errors.join(' ')).toContain('secret-import-text');
		await opened.context.close();
		await site.close();

		const activating = await rawPackage('deactivates', await helloManifest(bare), {
			'dist/native.js': `export default {
	sdk: 1,
	handlers: {
		'hello-greet': async () => ({ success: true, data: {} }),
		'hello-list': async () => ({ success: true, data: { items: [] } }),
		'hello-forget': async () => ({ success: true, data: {} }),
	},
	activate(context) { context.registry.define('x-y', class extends HTMLElement {}); },
	deactivate() { globalThis.helloDeactivated = (globalThis.helloDeactivated ?? 0) + 1; },
};
`,
		});
		const second = await serveDeployment({
			config: deploymentFile(deploymentEntry('hello', activating)),
		});
		const back = await openShell(browser, second.origin);
		await openApp(back.page, 'hello');
		expect(await back.page.locator('loam-main x-y').count()).toBe(1);
		expect(
			await back.page.evaluate(() => (globalThis as { helloDeactivated?: number }).helloDeactivated)
		).toBeUndefined();
		// `deactivate` runs at the chrome's teardown, and what it put in the parts goes with it.
		const left = await back.page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as HTMLElement;
			const root = shell.shadowRoot as ShadowRoot;
			shell.remove();
			await new Promise((resolve) => setTimeout(resolve, 0));
			return {
				calls: (globalThis as { helloDeactivated?: number }).helloDeactivated,
				mounts: root.querySelectorAll('loam-mount').length,
				entries: root.querySelectorAll('loam-app-entry').length,
			};
		});
		expect(left).toEqual({ calls: 1, mounts: 0, entries: 0 });
		await back.context.close();
		await second.close();
	});

	it('shows a surface that names an undefined element, in its mount', async () => {
		const manifest = await helloManifest((raw) => {
			(raw.ui as { surfaces: { main: { element: string } } }).surfaces.main.element = 'hello-gone';
		});
		const packed = await packApp('hello');
		const directory = await rawPackage('undefined-element', manifest);
		await mkdir(join(directory, 'dist'), { recursive: true });
		for (const file of await (await import('node:fs/promises')).readdir(join(packed, 'dist'))) {
			await writeFile(join(directory, 'dist', file), await readFile(join(packed, 'dist', file)));
		}
		const site = await serveDeployment({
			config: deploymentFile(deploymentEntry('hello', directory)),
		});
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'hello');
		const message = page.locator('loam-main loam-mount [data-code="APP_ELEMENT_UNDEFINED"]');
		expect(await message.textContent()).toContain('hello-gone');
		expect(await message.getAttribute('role')).toBe('alert');
		await opened.context.close();
		await site.close();
	});

	for (const [label, pattern] of [
		["the kernel's apps chunk", /\/assets\/apps-[^/]*\.js$/],
		['the readers', /\/assets\/(validate\.generated|deployment)-[^/]*\.js$/],
	] as const) {
		it(`renders the shell with each app unavailable when ${label} cannot load`, async () => {
			const site = await serveDeployment({
				config: deploymentFile(
					deploymentEntry('hello', await packApp('hello'), { title: 'Hello there', order: 2 }),
					deploymentEntry('tally', await packApp('tally'), { order: 1 })
				),
			});
			const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
			await context.route(pattern, (route) => route.abort());
			const opened = await openShell(browser, site.origin, {}, context);
			const { page } = opened;
			expect(await page.evaluate(() => document.documentElement.dataset.loamHost)).toBe('web');
			await expect.poll(() => page.locator('loam-rail loam-app-entry').count()).toBe(2);
			await expect
				.poll(() => entryButton(page, 'hello').getAttribute('aria-label'))
				.toBe('Hello there (unavailable)');
			// The title is the boot record's, which is the manifest's rail label (phase 2 specification, 2.2).
			expect(await entryButton(page, 'tally').getAttribute('aria-label')).toBe(
				'Tally (unavailable)'
			);
			// Deployment order means nothing here: `order`, then the instance id.
			expect(
				await page
					.locator('loam-rail loam-app-entry')
					.evaluateAll((entries) => entries.map((entry) => entry.getAttribute('instance')))
			).toEqual(['tally', 'hello']);

			// The shell works, and opening an app says why it is unavailable.
			await page.keyboard.press('ControlOrMeta+K');
			await page.locator('loam-palette input').waitFor();
			await page.keyboard.press('Escape');
			await page.locator('loam-rail loam-app-entry[instance="hello"] button').click();
			const notice = page.locator('loam-main loam-notice');
			await notice.waitFor();
			expect(await notice.locator('p').first().textContent()).toContain('APP_RUNTIME_UNAVAILABLE');
			expect(await notice.locator('p').first().textContent()).toContain('could not load');
			expect(await notice.locator('p.suggestion').textContent()).toContain('Reload');
			expect(opened.violations).toEqual([]);
			await context.close();
			await site.close();
		});
	}

	it("says so when the chrome's own app chunk cannot load", async () => {
		const site = await serveDeployment({
			config: deploymentFile(deploymentEntry('hello', await packApp('hello'))),
		});
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		await context.route(/\/assets\/surfaces-[^/]*\.js$/, (route) => route.abort());
		const opened = await openShell(browser, site.origin, {}, context);
		const { page } = opened;
		await expect
			.poll(() => page.locator('loam-main h1').textContent())
			.toBe('Apps could not load. Reload to try again.');
		await context.close();
		await site.close();
	});

	it('shows "Loam cannot start" for a deployment.json that fails readProjection or does not parse', async () => {
		const site = await serveDist();
		for (const body of [
			'{"deployment_version":1,"apps":[{"instance":"x","url":"http://secret"}]}',
			'not json',
		]) {
			const context = await browser.newContext();
			await context.route(/\/deployment\.json$/, (route) =>
				route.fulfill({ status: 200, contentType: 'application/json', body })
			);
			const page = await context.newPage();
			await page.goto(site.origin);
			await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'failed');
			expect(await page.locator('loam-notice h1').textContent()).toBe('Loam cannot start');
			expect(await page.locator('loam-notice p').first().textContent()).toContain(
				'DEPLOYMENT_INVALID'
			);
			await context.close();
		}
		await site.close();
	});
});
