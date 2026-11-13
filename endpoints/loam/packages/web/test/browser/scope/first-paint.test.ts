/**
 * P2-E1 (phase 2 specification, section 15): one first paint. Every deployment requests the same chunks
 * before the shell's mark `loam-stage-b`, byte for byte, with only `deployment.json` differing and no
 * manifest read; a frame paints with what stage B reads held; a boot record is display, and stage B
 * corrects one that lies. Step 5 adds a deep link and step 6 adds tasks. P2-E2's Chromium part is here too: Zod
 * starts `jitless`, with no CSP violation, in the empty shell and after stage B.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectionV3 } from '@lushly-dev/loam-manifest';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	type DeploymentSite,
	DIST,
	deploymentEntry,
	deploymentFile,
	kernelCall,
	type LoggedRequest,
	measureFirstPaint,
	openApp,
	openPage,
	openShell,
	packApp,
	serveDeployment,
	serveDist,
	surfacesIdle,
} from '../harness';

let browser: Browser;
let refusedPackage: string;
beforeAll(async () => {
	browser = await chromium.launch();
	// A package `readManifest` refuses: its boot record carries the refusal (2.2).
	refusedPackage = await mkdtemp(join(tmpdir(), 'loam-refused-'));
	await writeFile(join(refusedPackage, 'app-manifest.json'), '{ "manifest_version": 1 }\n');
});
afterAll(async () => {
	await browser?.close();
	await rm(refusedPackage, { recursive: true, force: true });
});

/** What stage B reads: every package's manifest and each of its chunks. */
const STAGE_B =
	/\/apps\/[^/]+\/app-manifest\.json$|\/assets\/(?:apps|validate\.generated|deployment|surfaces|late|url-sync)-[^/]*\.js$/;
// The switcher's list and the tooltip load on first use, never before the first frame (7.2, 7.5).
const STAGE_B_CHUNK =
	/\/assets\/(?:apps|validate\.generated|deployment|surfaces|late|url-sync|switcher|tooltip)-/;
/**
 * The first-paint row of `budget`: `index.html`'s entry and every chunk it imports statically, followed
 * through each chunk's own static `import` statements. A dynamic `import(...)` loads later.
 */
function budgetRow(): number {
	const html = readFileSync(join(DIST, 'index.html'), 'utf8');
	const files = new Set<string>();
	const visit = (file: string): void => {
		if (files.has(file)) return;
		files.add(file);
		const code = readFileSync(join(DIST, file), 'utf8');
		const directory = file.slice(0, file.lastIndexOf('/') + 1);
		for (const match of code.matchAll(
			/(?:^|[;}\s])import\s*(?:[\w$*{}\s,]*from\s*)?["']\.\/([^"']+\.js)["']/g
		))
			visit(`${directory}${match[1]}`);
	};
	for (const match of html.matchAll(/<script[^>]+src="\.?\/?([^"]+)"/g)) visit(match[1] as string);
	return [...files].reduce((sum, file) => sum + readFileSync(join(DIST, file)).length, 0);
}

/**
 * What a page requested before the mark, by path, with the bytes the server sent. `then` runs on the page
 * before its context closes; with `context`, the page opens in one a test has prepared.
 */
async function firstPaint(
	site: { origin: string; log: LoggedRequest[] },
	path = '/',
	context?: BrowserContext,
	then?: (page: Page) => Promise<void>
) {
	const opened = await openPage(browser, `${site.origin}${path}`, {}, context);
	const paths = await measureFirstPaint(opened.page);
	await then?.(opened.page);
	const bytes = Object.fromEntries(
		site.log
			// The palette's idle load is scheduled after the mark, so it is never in this list (#718's filter
			// went with step 6, which found `openShell` loading it early).
			.filter(({ path }) => paths.includes(path))
			.map(({ path, bytes }) => [path, bytes])
	);
	expect(opened.errors).toEqual([]);
	expect(opened.violations).toEqual([]);
	await opened.context.close();
	return { paths, bytes };
}

const entryOf = (page: Page, instance: string) =>
	page.locator(`loam-rail loam-app-entry[instance="${instance}"] button`);
const railOrder = (page: Page) =>
	page
		.locator('loam-rail loam-app-entry')
		.evaluateAll((entries) => entries.map((entry) => entry.getAttribute('instance')));

describe('P2-E1: one first paint', () => {
	it('P2-E1: the empty shell, hello, hello with tally, and with tasks request the same chunks, byte for byte', async () => {
		const hello = await packApp('hello');
		const sites = [
			await serveDist(),
			await serveDeployment({ config: deploymentFile(deploymentEntry('hello', hello)) }),
			await serveDeployment({
				config: deploymentFile(
					deploymentEntry('hello', hello),
					deploymentEntry('tally', await packApp('tally'))
				),
			}),
		];
		const measured = [];
		for (const site of sites) measured.push(await firstPaint(site));
		// Step 5's deep link, into a project that exists, with all of stage B held: the same chunks, and stage
		// A has entered the project for the first frame (6.2, 6.3).
		const deep = sites[1] as DeploymentSite;
		const setup = await openShell(browser, deep.origin);
		expect(await kernelCall(setup.page, 'project-create', { name: 'Atlas' })).toMatchObject({
			success: true,
		});
		await setup.page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { flush(): Promise<void> };
			};
			await shell.kernel.flush();
		});
		await setup.page.close();
		deep.hold(STAGE_B);
		measured.push(
			await firstPaint(deep, '/personal/p/atlas/hello/items', setup.context, async (page) => {
				const scoped = (await kernelCall(page, 'scope-get')) as {
					data: { scope: { project?: string }; project: { slug: string } | null };
				};
				expect(scoped.data.project?.slug).toBe('atlas');
				expect(scoped.data.scope.project).toMatch(/^prj_/);
				expect(deep.held.some((path) => STAGE_B.test(path))).toBe(true);
			})
		);
		deep.release();
		// Step 6's: the project-only tasks, version 2, beside hello and tally (E1, E11).
		const withTasks = await serveDeployment({
			config: deploymentFile(
				deploymentEntry('hello', hello),
				deploymentEntry('tally', await packApp('tally')),
				deploymentEntry('tasks', await packApp('tasks'))
			),
		});
		sites.push(withTasks);
		measured.push(await firstPaint(withTasks));
		const assets = measured.map(({ bytes }) =>
			Object.fromEntries(Object.entries(bytes).filter(([path]) => path.startsWith('/assets/')))
		);
		expect(assets[1]).toEqual(assets[0]);
		expect(assets[2]).toEqual(assets[0]);
		expect(assets[3]).toEqual(assets[0]);
		expect(assets[4]).toEqual(assets[0]);
		const deploymentJson = measured.map(({ bytes }) => bytes['/deployment.json']);
		expect(deploymentJson.every((size) => typeof size === 'number' && size > 0)).toBe(true);
		expect(new Set(deploymentJson).size).toBe(4);
		expect(deploymentJson[3]).toBe(deploymentJson[1]);
		for (const { paths } of measured) {
			expect(paths.filter((path) => path.endsWith('app-manifest.json'))).toEqual([]);
			expect(paths.filter((path) => STAGE_B_CHUNK.test(path))).toEqual([]);
			// Only the page, its assets and the projection.
			expect(
				paths.filter(
					(path) => !path.startsWith('/assets/') && path !== paths[0] && path !== '/deployment.json'
				)
			).toEqual([]);
		}
		const javascript = Object.entries(assets[0] as Record<string, number>)
			.filter(([path]) => path.endsWith('.js'))
			.reduce((sum, [, size]) => sum + size, 0);
		expect(javascript).toBeLessThanOrEqual(300_000);
		expect(javascript).toBe(budgetRow());
		// Stage B still runs in every deployment: `late` loads after the mark, on the empty shell too.
		await expect
			.poll(() => sites[0]?.log.some(({ path }) => /\/assets\/late-/.test(path)))
			.toBe(true);
		for (const site of sites) await site.close();
	});

	it('P2-E1: records first-contentful-paint under 4x CPU and an 8 Mbit/s, 70 ms network', async () => {
		const site = await serveDeployment({
			config: deploymentFile(
				deploymentEntry('hello', await packApp('hello')),
				deploymentEntry('tally', await packApp('tally'))
			),
		});
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		const page = await context.newPage();
		const cdp = await context.newCDPSession(page);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
		await cdp.send('Network.enable');
		await cdp.send('Network.emulateNetworkConditions', {
			offline: false,
			latency: 70,
			downloadThroughput: (8 * 1024 * 1024) / 8,
			uploadThroughput: (8 * 1024 * 1024) / 8,
		});
		await page.goto(site.origin);
		await page.waitForFunction(
			() => performance.getEntriesByName('first-contentful-paint').length > 0,
			undefined,
			{ timeout: 60_000 }
		);
		const timings = await page.evaluate(() => ({
			fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0,
			stageB: performance.getEntriesByName('loam-stage-b')[0]?.startTime ?? null,
		}));
		// Recorded in the run, not asserted (E1).
		console.info(
			`P2-E1 first-contentful-paint, hello and tally, throttled: ${Math.round(timings.fcp)} ms`
		);
		expect(timings.fcp).toBeGreaterThan(0);
		await context.close();
		await site.close();
	}, 90_000);

	it('P2-E1: with the manifests and stage B held, a frame paints, with the rail and a busy main', async () => {
		const site = await serveDeployment({
			config: deploymentFile(
				deploymentEntry('hello', await packApp('hello')),
				deploymentEntry('tally', await packApp('tally')),
				deploymentEntry('broken', refusedPackage)
			),
		});
		// A first visit opens tally, so the next one has a persisted active app.
		const first = await openShell(browser, site.origin);
		await openApp(first.page, 'tally');
		await kernelCall(first.page, 'layout-get');
		await first.page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { flush(): Promise<void> };
			};
			await shell.kernel.flush();
		});

		site.hold(STAGE_B);
		const { page, errors } = first;
		await page.reload();
		await page.waitForFunction(
			() => performance.getEntriesByName('first-contentful-paint').length > 0
		);
		await page.waitForFunction(() => performance.getEntriesByName('loam-stage-b').length > 0);
		expect(
			site.held.some((path) => /app-manifest\.json$/.test(path) || STAGE_B_CHUNK.test(path))
		).toBe(true);
		expect((await railOrder(page)).sort()).toEqual(['broken', 'hello', 'tally']);
		expect(await entryOf(page, 'broken').getAttribute('aria-label')).toBe('broken (unavailable)');
		expect(await entryOf(page, 'hello').getAttribute('aria-label')).toBe('Hello (loading)');
		expect(await entryOf(page, 'tally').getAttribute('aria-current')).toBe('page');
		const main = await page.evaluate(() => {
			const element = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main') as HTMLElement;
			const landing = element.shadowRoot?.querySelector('.landing') as HTMLElement | null;
			return {
				busy: element.getAttribute('aria-busy'),
				landing: landing ? getComputedStyle(landing).display : 'none',
			};
		});
		expect(main).toEqual({ busy: 'true', landing: 'none' });

		site.release();
		await page.locator('tally-main').waitFor();
		await expect.poll(() => entryOf(page, 'hello').getAttribute('aria-label')).toBe('Hello');
		expect(await entryOf(page, 'broken').getAttribute('aria-label')).toBe('broken (unavailable)');
		expect(errors).toEqual([]);
		await first.context.close();
		await site.close();
	});

	it('P2-E1: a hostile boot record renders as text, and an entry with a bad instance is dropped', async () => {
		const title = '<img src="/pwned" onerror="document.title=\'pwned\'">Hi';
		const site = await serveDeployment({
			config: deploymentFile(deploymentEntry('hello', await packApp('hello'))),
			rewrite(projection: ProjectionV3) {
				const [hello] = projection.apps;
				if (!hello?.boot) throw new Error('expected a boot record');
				hello.boot.title = title;
				return {
					...projection,
					apps: [hello, { ...hello, instance: '../x', app: 'x', package: 'apps/x/' }],
				};
			},
		});
		site.hold(STAGE_B);
		const opened = await openPage(browser, site.origin);
		const { page } = opened;
		await measureFirstPaint(page);
		expect(await railOrder(page)).toEqual(['hello']);
		expect(await entryOf(page, 'hello').getAttribute('aria-label')).toBe(`${title} (loading)`);
		expect(
			await page
				.locator('loam-rail loam-app-entry[instance="hello"]')
				.evaluate((entry) => entry.shadowRoot?.querySelector('img') === null)
		).toBe(true);
		// Stage B's reader refuses the projection, so each entry says why, in the rail (D66).
		site.release();
		await expect
			.poll(() => entryOf(page, 'hello').getAttribute('aria-label'))
			.toBe(`${title} (unavailable)`);
		expect(await page.title()).not.toBe('pwned');
		expect(site.log.some(({ path }) => path === '/pwned')).toBe(false);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
		await site.close();
	});

	it('P2-E1: a workspace id off its pattern shows "Loam cannot start", with the refusal', async () => {
		const site = await serveDeployment({
			config: deploymentFile(deploymentEntry('hello', await packApp('hello'))),
			rewrite: (projection) => ({ ...projection, workspace: { id: 'Not An Id', name: 'X' } }),
		});
		const opened = await openPage(browser, site.origin);
		const { page } = opened;
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'failed');
		expect(await page.locator('loam-notice h1').textContent()).toBe('Loam cannot start');
		const message = await page.locator('loam-notice p').first().textContent();
		expect(message).toContain('workspace.id');
		expect(message).toContain('DEPLOYMENT_INVALID');
		await opened.context.close();
		await site.close();
	});

	it('P2-E1: a record that lies about title, order, levels and parts is corrected by stage B', async () => {
		const site = await serveDeployment({
			config: deploymentFile(
				deploymentEntry('hello', await packApp('hello')),
				deploymentEntry('tally', await packApp('tally'))
			),
			rewrite(projection: ProjectionV3) {
				const [hello] = projection.apps;
				if (!hello?.boot) throw new Error('expected a boot record');
				// Hello's manifest says order 10 and tally's 20: the lie puts hello after tally.
				hello.boot = {
					...hello.boot,
					title: 'Liar',
					order: 99,
					scope_levels: ['project'],
					parts: ['panel'],
				};
				return projection;
			},
		});
		site.hold(STAGE_B);
		const opened = await openPage(browser, site.origin);
		const { page } = opened;
		await measureFirstPaint(page);
		expect(await entryOf(page, 'hello').getAttribute('aria-label')).toBe('Liar (loading)');
		// Amended by phase 2's step 6: a record saying `project` alone puts hello in the top band, dimmed with
		// no project, and stage B's manifest moves it to the bottom band, before tally by its order (7.1).
		const bandOf = (instance: string) =>
			page
				.locator(`loam-rail loam-app-entry[instance="${instance}"]`)
				.evaluate((entry) => (entry.parentElement?.classList.contains('top') ? 'top' : 'bottom'));
		expect(await bandOf('hello')).toBe('top');
		expect(await entryOf(page, 'hello').getAttribute('aria-disabled')).toBe('true');
		expect(await railOrder(page)).toEqual(['hello', 'tally']);
		site.release();
		await expect.poll(() => entryOf(page, 'hello').getAttribute('aria-label')).toBe('Hello');
		// D29, open with the owner: a dual-scope app with no project is in the bottom band (7.1).
		await expect.poll(() => bandOf('hello')).toBe('bottom');
		expect(await entryOf(page, 'hello').getAttribute('aria-disabled')).toBeNull();
		await expect.poll(() => railOrder(page)).toEqual(['hello', 'tally']);
		const list = (await kernelCall(page, 'app-list')) as {
			data: { apps: Array<{ instance: string; title: string; scopeLevels: string[] }> };
		};
		expect(list.data.apps.map((app) => app.instance)).toEqual(['hello', 'tally']);
		expect(list.data.apps[0]).toMatchObject({
			instance: 'hello',
			title: 'Hello',
			scopeLevels: ['workspace', 'project'],
		});
		await openApp(page, 'hello');
		const detail = (await kernelCall(page, 'app-get', { instance: 'hello' })) as {
			data: { surfaces: string[] };
		};
		expect(detail.data.surfaces).not.toContain('panel');
		const refused = (await kernelCall(page, 'layout-set', { panel: { open: true } })) as {
			error?: { code: string };
		};
		expect(refused.error?.code).toBe('LAYOUT_PART_UNDECLARED');
		expect(opened.errors).toEqual([]);
		await opened.context.close();
		await site.close();
	});

	it('P2-E1: a projection the reader refuses still paints, with each app unavailable in the rail', async () => {
		const site: DeploymentSite = await serveDeployment({
			config: deploymentFile(deploymentEntry('hello', await packApp('hello'))),
			rewrite(projection: ProjectionV3) {
				const [hello] = projection.apps;
				return { ...projection, apps: [{ ...hello, url: 'http://127.0.0.1:1/secret' }] };
			},
		});
		const opened = await openPage(browser, site.origin);
		const { page } = opened;
		expect(await page.evaluate(() => document.documentElement.dataset.loamHost)).toBe('web');
		await expect
			.poll(() => entryOf(page, 'hello').getAttribute('aria-label'))
			.toBe('Hello (unavailable)');
		const list = (await kernelCall(page, 'app-list')) as {
			data: { apps: Array<{ error?: { code: string; message: string } }> };
		};
		expect(list.data.apps[0]?.error?.code).toBe('DEPLOYMENT_INVALID');
		expect(list.data.apps[0]?.error?.message).not.toContain('secret');
		await opened.context.close();
		await site.close();
	});
});

/** Zod's shared configuration, as the page holds it: `jitless` once the build has started it (2.4, #664). */
const jitless = (page: Page) =>
	page.evaluate(
		() =>
			(globalThis as { __zod_globalConfig?: { jitless?: boolean } }).__zod_globalConfig?.jitless ??
			null
	);

/** Stage B's end: the kernel's `startApps` is the promise the shell started at the mark. */
const stageBEnded = (page: Page) =>
	page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			kernel: { startApps(): Promise<void> };
		};
		await shell.kernel.startApps();
	});

describe('P2-E2: Zod starts jitless, with no CSP violation, in the empty shell and after stage B', () => {
	it('P2-E2: __zod_globalConfig.jitless is true at the first paint and once stage B has ended, empty or with apps', async () => {
		const empty = await serveDist();
		const withApps = await serveDeployment({
			config: deploymentFile(
				deploymentEntry('hello', await packApp('hello')),
				deploymentEntry('tally', await packApp('tally'))
			),
		});
		for (const [site, apps] of [
			[empty, false],
			[withApps, true],
		] as const) {
			const opened = await openPage(browser, site.origin);
			const { page } = opened;
			// The first paint: the mark is taken, and Zod's core, in the kernel's first-paint chunks, has run.
			await measureFirstPaint(page);
			expect(await jitless(page), `${site.origin} at first paint`).toBe(true);
			await stageBEnded(page);
			if (apps) {
				// The apps' chunks, classic Zod among them, load with stage B; their surfaces start once it ends.
				await surfacesIdle(page);
				expect(site.log.some(({ path }) => /\/assets\/apps-/.test(path))).toBe(true);
			}
			await expect.poll(() => site.log.some(({ path }) => /\/assets\/late-/.test(path))).toBe(true);
			expect(await jitless(page), `${site.origin} after stage B`).toBe(true);
			expect(opened.violations).toEqual([]);
			expect(opened.errors).toEqual([]);
			await opened.context.close();
			await site.close();
		}
	});
});
