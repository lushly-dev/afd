/**
 * P6-H2 (phase 6 specification, section 19): the shell hosted, as it was static. In `local` mode, through
 * `startDevHost`: the first paint's chunks equal `serveDeployment`'s byte for byte, a reload restores
 * scope, phase 0's axe scenarios pass, every page's response CSP is 3.5's with no violation, and a view
 * renders through the sandbox on `https://127.0.0.1:<port>`, another site.
 */
import { type DevHost, startDevHost } from '@lushly-dev/loam-host/testing';
import type { Browser, Frame, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	axe,
	deploymentEntry,
	deploymentFile,
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

beforeAll(async () => {
	config = deploymentFile(
		deploymentEntry('hello', await packApp('hello')),
		deploymentEntry('tally', await packApp('tally'))
	);
	host = await startDevHost({ config });
	viewHost = await startDevHost({
		config: deploymentFile(deploymentEntry('hello', await packApp('hello', 'view'))),
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

/** The first paint's assets, by path, with the bytes each response carried, in a fresh context. */
async function firstPaintAssets(url: string): Promise<Record<string, number>> {
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const sizes = new Map<string, Promise<number>>();
	context.on('response', (response) => {
		const path = new URL(response.url()).pathname;
		if (path.startsWith('/assets/') && !sizes.has(path))
			sizes.set(
				path,
				// A chunk loaded after the first paint may still be in flight when the context closes.
				response.body().then(
					(body) => body.length,
					() => -1
				)
			);
	});
	const opened = await openPage(browser, url, {}, context);
	const paths = await measureFirstPaint(opened.page);
	const assets: Record<string, number> = {};
	for (const path of paths.filter((path) => path.startsWith('/assets/')))
		assets[path] = (await sizes.get(path)) ?? -1;
	expect(opened.errors).toEqual([]);
	expect(opened.violations).toEqual([]);
	await context.close();
	return assets;
}

describe('P6-H2: the shell hosted, as it was static', () => {
	it("P6-H2: in local mode, the first paint requests phase 2's E1 chunks, the same as serveDeployment's, byte for byte", async () => {
		const site = await serveDeployment({ config });
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
		await page.goto(`${host.root}personal/p/reload/hello/items`);
		const scopeOf = async (page: Page) =>
			(
				(await kernelCall(page, 'scope-get')) as {
					data: { project: { slug: string } | null };
				}
			).data.project?.slug;
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await expect.poll(() => scopeOf(page)).toBe('reload');
		await page.reload();
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
				await agentCall(page, 'appearance-set', { theme, density });
				await everyPart(page);
				expect(await page.evaluate(() => document.documentElement.dataset.loamTheme)).toBe(theme);
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
		expect(await axe(opened.page)).toEqual([]);
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
