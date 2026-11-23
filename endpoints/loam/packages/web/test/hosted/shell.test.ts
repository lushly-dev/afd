/**
 * P6-H2 (phase 6 specification, section 19): the shell hosted, as it was static. In `local` mode, through
 * `startDevHost`: the first paint's chunks equal `serveDeployment`'s byte for byte, a reload restores
 * scope, phase 0's axe scenarios pass, every page's response CSP is 3.5's with no violation, and a view
 * renders through the sandbox on `https://127.0.0.1:<port>`, another site.
 */
import { createHash } from 'node:crypto';
import { type DevHost, startDevHost } from '@lushly-dev/loam-host/testing';
import type { Browser, Frame, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	axe,
	deploymentEntry,
	deploymentFile,
	hostedDeploymentFile,
	kernelCall,
	launchForDevHost,
	measureFirstPaint,
	openApp,
	openPage,
	openShell,
	packApp,
	type ShellPage,
	serveDeployment,
	settle,
} from '../browser/harness';
import { hosted, writtenPolicy } from './support';

let browser: Browser;
let host: DevHost;
let viewHost: DevHost;
let config: string;
let staticConfig: string;

beforeAll(async () => {
	const entries = [
		deploymentEntry('hello', await packApp('hello')),
		deploymentEntry('tally', await packApp('tally')),
	];
	config = hostedDeploymentFile([], ...entries);
	// The same entries for a static host, as phase 2's E1 serves them, which P6-H2 compares the hosted shell with.
	staticConfig = deploymentFile(...entries);
	host = await startDevHost({ config });
	viewHost = await startDevHost({
		config: hostedDeploymentFile([], deploymentEntry('hello', await packApp('hello', 'view'))),
	});
	browser = await launchForDevHost(host, viewHost);
}, 180_000);
afterAll(async () => {
	await browser?.close();
	await host?.close();
	await viewHost?.close();
});

/** Every page a scenario opens carries 3.5's header: the written `<meta>` policy and `frame-ancestors 'none'`. */
function expectHostedPolicy(opened: ShellPage, of: DevHost): void {
	expect(opened.responsePolicy).toBe(`${writtenPolicy(of)}; frame-ancestors 'none'`);
	expect(opened.violations).toEqual([]);
}

/**
 * The first paint's assets, by path, with the SHA-256 of the bytes each response carried, in a fresh context. Both
 * servers serve the same built files under content-hashed names, so equal digests are the same bytes.
 */
async function firstPaintAssets(url: string): Promise<Record<string, string>> {
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const digests = new Map<string, Promise<string>>();
	context.on('response', (response) => {
		const path = new URL(response.url()).pathname;
		if (path.startsWith('/assets/') && !digests.has(path))
			digests.set(
				path,
				// A chunk loaded after the first paint may still be in flight when the context closes; one of the
				// first paint's that cannot be read fails the comparison below, never matching another's failure.
				response.body().then(
					(body) => `sha256:${createHash('sha256').update(body).digest('hex')}`,
					(error: Error) => `unread: ${error.message}`
				)
			);
	});
	const opened = await openPage(browser, url, {}, context);
	// A typeface loads when text first needs its weight, before the mark or after it, so the fonts are left out
	// as phase 2's E1 leaves them (D159): what is compared is the chunks.
	const paths = (await measureFirstPaint(opened.page, { waitForFonts: true })).filter(
		(path) => !/\.woff2$/.test(path)
	);
	const assets: Record<string, string> = {};
	for (const path of paths.filter((path) => path.startsWith('/assets/')))
		assets[path] = (await digests.get(path)) ?? 'no response';
	expect(
		Object.entries(assets).filter(([, digest]) => !digest.startsWith('sha256:')),
		url
	).toEqual([]);
	expect(opened.errors).toEqual([]);
	expect(opened.violations).toEqual([]);
	await context.close();
	return assets;
}

/** Phase 0's E4 palette: open, with its options rendered (as `browser/accessibility.test.ts` opens it). */
async function openPalette(page: Page) {
	await page.keyboard.press('ControlOrMeta+K');
	await page.waitForFunction(() => {
		const palette = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-palette');
		return (
			(palette as unknown as { isOpen?: boolean } | null | undefined)?.isOpen === true &&
			!!palette?.shadowRoot?.querySelector('violet-option')
		);
	});
	await settle(page);
}

describe('P6-H2: the shell hosted, as it was static', () => {
	it("P6-H2: in local mode, the first paint requests phase 2's E1 chunks, the same as serveDeployment's, byte for byte", async () => {
		const site = await serveDeployment({ config: staticConfig });
		try {
			const staticAssets = await firstPaintAssets(site.root);
			const hostedAssets = await firstPaintAssets(host.root);
			expect(Object.keys(hostedAssets).length).toBeGreaterThan(0);
			expect(hostedAssets).toEqual(staticAssets);
		} finally {
			await site.close();
		}
	});

	it('P6-H2: a reload restores scope', async () => {
		const opened = await openShell(browser, host.root);
		const { page } = opened;
		expect(await kernelCall(page, 'project-create', { name: 'Reload' })).toMatchObject({
			success: true,
		});
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { flush(): Promise<void> };
			};
			await shell.kernel.flush();
		});
		// Every page's response carries 3.5's policy: the deep link's and the reload's, not only the first.
		const expected = `${writtenPolicy(host)}; frame-ancestors 'none'`;
		const deep = await page.goto(`${host.root}personal/p/reload/hello/items`);
		expect(deep?.status()).toBe(200);
		expect(deep?.headers()['content-security-policy']).toBe(expected);
		const scopeOf = async (page: Page) =>
			(
				(await kernelCall(page, 'scope-get')) as {
					data: { project: { slug: string } | null };
				}
			).data.project?.slug;
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await expect.poll(() => scopeOf(page)).toBe('reload');
		const reloaded = await page.reload();
		expect(reloaded?.status()).toBe(200);
		expect(reloaded?.headers()['content-security-policy']).toBe(expected);
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await expect.poll(() => scopeOf(page)).toBe('reload');
		expectHostedPolicy(opened, host);
		await opened.context.close();
	});

	const everyPart = async (page: Page) => {
		await agentCall(page, 'layout-set', {
			sidebar: { open: true },
			inspector: { open: true },
			panel: { open: true },
		});
		await settle(page);
	};

	for (const theme of ['light', 'dark', 'high-contrast'] as const)
		for (const density of ['comfortable', 'compact'] as const)
			it(`P6-H2: phase 0's axe scenario has no violations hosted, in ${theme}, ${density}`, async () => {
				const opened = await openShell(browser, host.root, {
					viewport: { width: 1600, height: 900 },
					reducedMotion: 'reduce',
				});
				const { page } = opened;
				// The person's: a hosted deployment keeps no autonomy rows, so an agent's write of it would ask (phase 5's 6.1).
				await kernelCall(page, 'appearance-set', { theme, density });
				await everyPart(page);
				expect(await page.evaluate(() => document.documentElement.dataset.loamTheme)).toBe(theme);
				expect(
					await page.evaluate(() => document.documentElement.dataset.loamDensity ?? 'comfortable')
				).toBe(density);
				expect(await axe(page)).toEqual([]);
				await openPalette(page);
				expect(await axe(page)).toEqual([]);
				expectHostedPolicy(opened, host);
				await opened.context.close();
			});

	it("P6-H2: phase 0's axe scenario has no violations hosted, under forced colors", async () => {
		const opened = await openShell(browser, host.root, {
			viewport: { width: 1600, height: 900 },
			forcedColors: 'active',
			reducedMotion: 'reduce',
		});
		await everyPart(opened.page);
		expect(await opened.page.evaluate(() => document.documentElement.dataset.loamTheme)).toBe(
			'high-contrast'
		);
		expect(await axe(opened.page)).toEqual([]);
		await openPalette(opened.page);
		expect(await axe(opened.page)).toEqual([]);
		expectHostedPolicy(opened, host);
		await opened.context.close();
	});

	it("P6-H2: phase 0's axe scenario has no violations hosted, in the compact class with a drawer open, and on the not-found route", async () => {
		const opened = await openShell(browser, host.root, {
			viewport: { width: 390, height: 844 },
			reducedMotion: 'reduce',
		});
		const { page } = opened;
		expect(await axe(page)).toEqual([]);
		await page.keyboard.press('ControlOrMeta+B');
		await settle(page);
		expect(
			await page
				.locator('loam-sidebar')
				.evaluate(
					(element) => element.shadowRoot?.querySelector('dialog')?.matches(':modal') === true
				)
		).toBe(true);
		expect(await axe(page)).toEqual([]);
		await page.keyboard.press('Escape');
		const elsewhere = new URL('elsewhere', host.root).pathname;
		await page.evaluate(
			(path) =>
				(
					window as unknown as { navigation: { navigate(url: string): unknown } }
				).navigation.navigate(path),
			elsewhere
		);
		await settle(page);
		await expect.poll(() => page.locator('loam-main h1').textContent()).toBe('Nothing here');
		expect(await axe(page)).toEqual([]);
		expectHostedPolicy(opened, host);
		await opened.context.close();
	});

	it('P6-H2: a view renders through the sandbox on https://127.0.0.1:<port>, another site, framed only by the shell', async () => {
		expect(viewHost.sandboxOrigin).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/);
		const opened = await openShell(browser, viewHost.root);
		const { page } = opened;
		await openApp(page, 'hello');
		const frame = page.locator('loam-view-frame iframe');
		const src = new URL((await frame.getAttribute('src')) as string);
		expect(src.origin).toBe(viewHost.sandboxOrigin);
		expect(new URL(src.origin).hostname).not.toBe(new URL(viewHost.origin).hostname);
		const outer = (await (await frame.elementHandle())?.contentFrame()) as Frame;
		expect(await outer.evaluate(() => self.origin)).toBe(viewHost.sandboxOrigin);
		await expect.poll(() => outer.childFrames().length).toBe(1);
		// The view renders: Hello's own page, its `hello-list` answered through the sandbox and shown.
		const inner = outer.childFrames()[0] as Frame;
		await expect
			.poll(() => inner.evaluate(() => document.getElementById('count')?.textContent ?? ''))
			.toMatch(/^\d+ greeted$/);
		expect(opened.responsePolicy).toContain(`frame-src ${viewHost.sandboxOrigin}`);
		expectHostedPolicy(opened, viewHost);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
		// The sandbox's own listener serves `sandbox/` alone, for the shell's origin to frame.
		const sandbox = viewHost.sandboxOrigin as string;
		const proxy = await hosted(viewHost, '/sandbox/proxy.html', { origin: sandbox });
		expect(proxy.status).toBe(200);
		expect(proxy.headers['content-security-policy']).toBe(`frame-ancestors ${viewHost.origin}`);
		for (const path of ['/', '/index.html', '/deployment.json'])
			expect((await hosted(viewHost, path, { origin: sandbox })).status, path).toBe(404);
		expect(
			(
				await hosted(viewHost, '/sandbox/proxy.html', {
					origin: sandbox,
					host: new URL(viewHost.origin).host,
				})
			).status
		).toBe(421);
	});
});

describe('P6-E9: only a hosted provider shell loads `late-hosted` (phase 6 specification, 14)', () => {
	it('a `local` shell on the hosted server finishes stage B without requesting it', async () => {
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		const urls: string[] = [];
		context.on('request', (request) => urls.push(request.url()));
		const page = await openShell(browser, host.root, {}, context);
		await page.page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { appsReady: Promise<void> };
			};
			await shell.kernel.appsReady;
		});
		expect(urls.filter((url) => /\/late-hosted-[^/]+\.js$/.test(url))).toEqual([]);
		await context.close();
	});
});
