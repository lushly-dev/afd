/**
 * P2-E8 (phase 2 specification, section 15): the URL scheme, so far its workspace, project and app shapes.
 * Over `serveDeployment`, with `base_path = "/"` and with `/loam/`: a deep link to each shape loads under
 * the CSP with `base-uri 'none'` and shows what it names; Back and Forward run journaled commands without
 * growing history; `scope-set` from `kernel.agent` moves the URL; a missing and a refused project show the
 * same "Nothing here"; a reload inside a restricted project is journaled as `scope-set { project: null }`;
 * `/` stays on an empty shell and is replaced for a persisted app; `deployment write`'s `index.html` and
 * `404.html` hold the rewritten URLs. Step 7 adds the projects section's shape, and step 11 the
 * documents section's and a document's.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	type EntrySummary,
	journal,
	kernelCall,
	openApp,
	openShell,
	packApp,
	type ShellPage,
	serveDeployment,
	serveDist,
	settle,
	surfacesIdle,
} from '../harness';

let browser: Browser;
let hello: string;
let tally: string;
beforeAll(async () => {
	browser = await chromium.launch();
	[hello, tally] = await Promise.all([packApp('hello'), packApp('tally')]);
}, 120_000);
afterAll(async () => {
	await browser?.close();
});

const PERSON = 'mock-user-person@example.com';

interface ShownState {
	scope: { workspace: string; project?: string };
	project: { slug: string } | null;
	pending?: boolean;
	section: string | null;
	path: string;
	active: string | null;
}

/** Stage B has ended, and what it and the boot's route ran has settled. */
async function ready(page: Page): Promise<void> {
	await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
	await page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			ready: Promise<void>;
			kernel: { appsReady: Promise<void> };
		};
		await shell.ready;
		await shell.kernel.appsReady;
	});
	await surfacesIdle(page);
}

/** What the URL shows: `scope-get` and `section-get`, unjournaled. */
const stateOf = (page: Page): Promise<ShownState> =>
	page.evaluate(() =>
		(
			document.querySelector('loam-shell') as unknown as { readState(): Promise<ShownState> }
		).readState()
	);

const pathOf = (page: Page) => new URL(page.url()).pathname;
const heading = (page: Page) => page.locator('loam-main h1').textContent();
const historyLength = (page: Page) => page.evaluate(() => history.length);

/** A same-document navigation, as a link or the address bar inside the page makes it. */
function navigate(page: Page, url: string): Promise<void> {
	return page.evaluate(async (url) => {
		const navigation = (
			window as unknown as {
				navigation: { navigate(url: string): { finished: Promise<unknown> } };
			}
		).navigation;
		await navigation.navigate(url).finished;
	}, url);
}

/** A traverse, by the Navigation API's own Back or Forward. */
function traverse(page: Page, way: 'back' | 'forward'): Promise<void> {
	return page.evaluate(async (way) => {
		const navigation = (
			window as unknown as {
				navigation: Record<'back' | 'forward', () => { finished: Promise<unknown> }>;
			}
		).navigation;
		await navigation[way]().finished;
	}, way);
}

/** Main shows its app's surface. */
async function showsApp(page: Page, instance: string): Promise<void> {
	await page.waitForFunction((instance) => {
		const main = document
			.querySelector('loam-shell')
			?.shadowRoot?.querySelector('loam-main') as HTMLElement | null;
		return main?.dataset.app === instance && !main.hasAttribute('aria-busy');
	}, instance);
}

/** What `pagehide` starts, finished before a reload, so the persisted records are written (as E1 does). */
const flush = (page: Page) =>
	page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			kernel: { flush(): Promise<void> };
		};
		await shell.kernel.flush();
	});

/** Main's own heading if it shows one, and whether an app's surface shows in it. */
const mainShows = (page: Page) =>
	page.evaluate(() => {
		const main = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-main');
		const shown = (element: Element | null | undefined) =>
			!!element && (element as HTMLElement).getBoundingClientRect().height > 0;
		const heading = main?.shadowRoot?.querySelector('h1');
		return {
			heading: shown(heading) ? (heading?.textContent ?? '') : '',
			app: [...(main?.children ?? [])].some((child) => shown(child)),
		};
	});

const signIn = (page: Page) =>
	kernelCall(page, 'auth-sign-in', { method: 'credentials', email: 'person@example.com' });

/** A project restricted to the person, created while signed in. */
async function createVault(page: Page): Promise<void> {
	await signIn(page);
	const created = (await kernelCall(page, 'project-create', {
		name: 'Vault',
		access: { mode: 'restricted', members: [PERSON] },
	})) as { success: boolean };
	expect(created.success).toBe(true);
}

const noFailures = (opened: ShellPage) => {
	expect(opened.violations).toEqual([]);
	expect(opened.errors).toEqual([]);
};

const since = async (page: Page, count: number): Promise<EntrySummary[]> =>
	(await journal(page)).slice(count);

describe.each(['/', '/loam/'])('P2-E8: the URL scheme, with base_path = %s', (basePath) => {
	let site: DeploymentSite;
	beforeAll(async () => {
		site = await serveDeployment({
			config: deploymentFile(deploymentEntry('hello', hello), deploymentEntry('tally', tally)),
			basePath,
		});
	});
	afterAll(async () => {
		await site?.close();
	});
	const at = (path: string) => `${site.root}${path}`;

	it('P2-E8: a deep link to each shape loads under the CSP, with base-uri none, and shows what it names', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const csp = await page
			.locator('meta[http-equiv="Content-Security-Policy"]')
			.getAttribute('content');
		expect(csp).toContain("base-uri 'none'");
		expect(await kernelCall(page, 'project-create', { name: 'Atlas' })).toMatchObject({
			success: true,
		});

		/** Load `path` as a deep link, and what its route ran, as the person, in the boot's journal. */
		const visit = async (path: string) => {
			await flush(page);
			const count = (await journal(page)).length;
			await page.goto(at(path));
			await ready(page);
			return (await since(page, count))
				.filter((entry) =>
					['scope-set', 'app-open', 'app-close', 'app-route-set', 'section-open'].includes(
						entry.command
					)
				)
				.map(({ command, input, success, interface: iface }) => ({
					command,
					input,
					success,
					iface,
				}));
		};
		const ran = (command: string, input: unknown) => ({
			command,
			input,
			success: true,
			iface: 'palette',
		});
		const atlasId = expect.stringMatching(/^prj_/);

		// The workspace: what `/` shows, and the URL stays.
		expect(await visit('personal')).toEqual([]);
		expect(await heading(page)).not.toBe('Nothing here');
		expect(await stateOf(page)).toMatchObject({ scope: { workspace: 'personal' }, active: null });
		expect(pathOf(page)).toBe(`${basePath}personal`);

		// An app at workspace level.
		expect(await visit('personal/hello')).toEqual([ran('app-open', { instance: 'hello' })]);
		await showsApp(page, 'hello');
		expect(await stateOf(page)).toMatchObject({
			scope: { workspace: 'personal' },
			active: 'hello',
		});
		expect(pathOf(page)).toBe(`${basePath}personal/hello`);

		// An app in a project, with its route: the first frame is already in the project (stage A), and stage
		// B journals the switch from the record, then the route.
		expect(await visit('personal/p/atlas/hello/items/a%20b')).toEqual([
			ran('scope-set', { project: atlasId }),
			ran('app-route-set', { instance: 'hello', path: 'items/a b' }),
		]);
		await showsApp(page, 'hello');
		const inAtlas = await stateOf(page);
		expect(inAtlas).toMatchObject({
			project: { slug: 'atlas' },
			active: 'hello',
			path: 'items/a b',
		});
		expect(inAtlas.scope.project).toMatch(/^prj_/);
		expect(pathOf(page)).toBe(`${basePath}personal/p/atlas/hello/items/a%20b`);

		// A project's home: the projects section in it.
		expect(await visit('personal/p/atlas')).toEqual([
			ran('section-open', { section: 'projects', path: '' }),
		]);
		expect(await heading(page)).not.toBe('Nothing here');
		expect(await stateOf(page)).toMatchObject({
			project: { slug: 'atlas' },
			section: 'projects',
			active: null,
		});
		expect(pathOf(page)).toBe(`${basePath}personal/p/atlas`);

		// A workspace-level link with `loam.scope` in Atlas: stage A paints the workspace, and stage B
		// journals the move from the record (6.3, as step 5 amends it).
		await flush(page);
		site.hold(/\/assets\/(?:late|apps|surfaces|url-sync)-[^/]*\.js$/);
		await page.goto(at('personal/hello'));
		await page.waitForFunction(() => performance.getEntriesByName('loam-stage-b').length > 0);
		expect((await stateOf(page)).scope).toEqual({ workspace: 'personal' });
		site.release();
		await ready(page);
		await showsApp(page, 'hello');
		expect((await stateOf(page)).scope).toEqual({ workspace: 'personal' });
		noFailures(opened);
		await opened.context.close();
	});

	it('P2-E8: Back and Forward run commands, journaled, with history unchanged and Forward still there', async () => {
		const opened = await openShell(browser, at('personal/hello'));
		const { page } = opened;
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await ready(page);
		await showsApp(page, 'hello');
		const start = await historyLength(page);

		// `scope-set` from `kernel.agent` moves the URL, by a push.
		const agent = (await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { agent: { call(name: string, input: unknown): Promise<unknown> } };
			};
			return shell.kernel.agent.call('scope-set', { project: 'atlas' });
		})) as { success: boolean };
		expect(agent.success).toBe(true);
		await expect.poll(() => pathOf(page)).toBe(`${basePath}personal/p/atlas/hello`);
		const pushed = await historyLength(page);
		expect(pushed).toBe(start + 1);

		let count = (await journal(page)).length;
		await traverse(page, 'back');
		await settle(page);
		expect(pathOf(page)).toBe(`${basePath}personal/hello`);
		expect((await stateOf(page)).scope).toEqual({ workspace: 'personal' });
		expect(
			(await since(page, count)).map(({ command, input, success, interface: iface }) => ({
				command,
				input,
				success,
				iface,
			}))
		).toEqual([
			{ command: 'scope-set', input: { project: null }, success: true, iface: 'palette' },
		]);
		expect(await historyLength(page)).toBe(pushed);
		expect(
			await page.evaluate(
				() =>
					(window as unknown as { navigation: { canGoForward: boolean } }).navigation.canGoForward
			)
		).toBe(true);

		count = (await journal(page)).length;
		await traverse(page, 'forward');
		await settle(page);
		expect(pathOf(page)).toBe(`${basePath}personal/p/atlas/hello`);
		expect((await stateOf(page)).project?.slug).toBe('atlas');
		expect((await since(page, count)).map(({ command, input }) => [command, input])).toEqual([
			['scope-set', { project: 'atlas' }],
		]);
		expect(await historyLength(page)).toBe(pushed);
		await showsApp(page, 'hello');
		noFailures(opened);
		await opened.context.close();
	});

	it('P2-E8: a route to a missing project and to a refused one both show "Nothing here", identically', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await createVault(page);
		await kernelCall(page, 'auth-sign-out');
		await settle(page);

		const shown: Array<{ main: string; failures: EntrySummary[] }> = [];
		for (const slug of ['vault', 'nowhere']) {
			const count = (await journal(page)).length;
			await navigate(page, at(`personal/p/${slug}`));
			await settle(page);
			await expect.poll(() => heading(page)).toBe('Nothing here');
			expect(pathOf(page)).toBe(`${basePath}personal/p/${slug}`);
			const main = await page
				.locator('loam-main')
				.evaluate((element) => element.shadowRoot?.innerHTML ?? '');
			// Through the kernel's own refusal, the same bytes for both.
			const failures = (await since(page, count)).map(({ command, input, success, error }) => ({
				command,
				input: { ...(input as object), project: '…' },
				success,
				error,
			})) as unknown as EntrySummary[];
			shown.push({ main, failures });
		}
		expect(shown[0]).toEqual(shown[1]);
		expect(shown[0]?.failures).toMatchObject([
			{ command: 'scope-set', success: false, error: { code: 'PROJECT_NOT_FOUND' } },
		]);

		// A deep link to each: stage A refuses both alike, and the boot journals no refusal for either.
		const deep: string[] = [];
		for (const slug of ['vault', 'nowhere']) {
			const count = (await journal(page)).length;
			await page.goto(at(`personal/p/${slug}`));
			await ready(page);
			expect(await heading(page)).toBe('Nothing here');
			expect((await since(page, count)).filter((entry) => entry.command === 'scope-set')).toEqual(
				[]
			);
			deep.push(
				await page.locator('loam-main').evaluate((element) => element.shadowRoot?.innerHTML ?? '')
			);
			expect(await stateOf(page)).toMatchObject({
				scope: { workspace: 'personal' },
				project: null,
			});
		}
		expect(deep[0]).toBe(deep[1]);
		// The link home leaves "Nothing here".
		await page.locator('loam-main a').click();
		await expect.poll(() => heading(page)).not.toBe('Nothing here');
		expect(pathOf(page)).toBe(basePath);
		noFailures(opened);
		await opened.context.close();
	});

	it('P2-E8: a reload inside a restricted project leaves it by a journaled scope-set { project: null }', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await createVault(page);
		await kernelCall(page, 'scope-set', { project: 'vault' });
		await expect.poll(() => pathOf(page)).toBe(`${basePath}personal/p/vault`);
		await settle(page);
		await flush(page);

		// The Mock signs out at a reload (6.3): stage A refuses the project, and stage B journals the move.
		let count = (await journal(page)).length;
		await page.reload();
		await ready(page);
		expect(await heading(page)).toBe('Nothing here');
		const moved = (await since(page, count)).filter((entry) => entry.command === 'scope-set');
		expect(moved).toMatchObject([
			{ input: { project: null }, success: true, interface: 'palette' },
		]);
		expect(await stateOf(page)).toMatchObject({
			scope: { workspace: 'personal' },
			project: null,
			pending: false,
		});
		// The URL names the project, and nothing of it is shown or written to history.
		expect(pathOf(page)).toBe(`${basePath}personal/p/vault`);
		expect(
			await page.locator('loam-shell').evaluate((shell) => shell.shadowRoot?.textContent ?? '')
		).not.toContain('Vault');

		// The record followed, so the next reload journals nothing more.
		await flush(page);
		count = (await journal(page)).length;
		await page.goto(site.root);
		await ready(page);
		expect((await since(page, count)).filter((entry) => entry.command === 'scope-set')).toEqual([]);
		expect(pathOf(page)).toBe(basePath);
		noFailures(opened);
		await opened.context.close();
	});

	it('P2-E8: Back to the first entry, /, closes the app, and Forward opens it again', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await ready(page);
		await openApp(page, 'hello');
		await expect.poll(() => pathOf(page)).toBe(`${basePath}personal/hello`);
		const count = (await journal(page)).length;
		await traverse(page, 'back');
		await settle(page);
		expect(pathOf(page)).toBe(basePath);
		// The route's own commands; the surfaces then re-read what they show.
		expect(
			(await since(page, count))
				.map(({ command }) => command)
				.filter((command) => /^(scope-set|app-(open|close|route-set)|section-open)$/.test(command))
		).toEqual(['app-close']);
		expect(await stateOf(page)).toMatchObject({ active: null, section: null });
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(
							document
								.querySelector('loam-shell')
								?.shadowRoot?.querySelector('loam-main') as HTMLElement | null
						)?.dataset.app
				)
			)
			.toBeUndefined();
		expect(await heading(page)).toBe('Choose an app');
		await traverse(page, 'forward');
		await settle(page);
		await showsApp(page, 'hello');
		expect(pathOf(page)).toBe(`${basePath}personal/hello`);
		noFailures(opened);
		await opened.context.close();
	});

	it('P2-E8: an app route that cannot open shows "Nothing here", and leaves the scope as recorded', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await flush(page);
		for (const path of ['personal/p/atlas/bogus', 'personal/p/atlas/tally']) {
			await page.goto(at(path));
			await ready(page);
			expect(await heading(page)).toBe('Nothing here');
			expect(pathOf(page)).toBe(`${basePath}${path}`);
			// Stage A painted Atlas in memory; stage B put the scope back to the record's, the workspace.
			expect(await stateOf(page)).toMatchObject({
				scope: { workspace: 'personal' },
				project: null,
				pending: false,
			});
		}
		noFailures(opened);
		await opened.context.close();
	});

	it('P2-E8: with the URL chunk refused, the apps still open, and the shell keeps working', async () => {
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		await context.route(/\/assets\/url-sync-[^/]*\.js$/, (route) => route.abort());
		const opened = await openShell(browser, site.root, {}, context);
		const { page } = opened;
		await ready(page);
		await openApp(page, 'hello');
		await openApp(page, 'tally');
		expect(opened.violations).toEqual([]);
		// Each try to load it is reported, and none is left unhandled.
		expect(opened.errors.length).toBeGreaterThan(0);
		// Only the request and the import that failed, each reported; nothing unhandled.
		expect(
			opened.errors.every((error) =>
				/^Failed to (load resource: net::ERR_FAILED|fetch dynamically imported module: .*\/assets\/url-sync-)/.test(
					error
				)
			)
		).toBe(true);
		expect(opened.errors.some((error) => /uncaught|unhandled/i.test(error))).toBe(false);
		await context.close();
	});

	it('P2-E8: a URL chunk that failed once loads again at the next navigation, which it applies', async () => {
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		let refused = 0;
		await context.route(/\/assets\/url-sync-[^/]*\.js$/, (route) =>
			refused++ === 0 ? route.abort() : route.continue()
		);
		const opened = await openShell(browser, site.root, {}, context);
		const { page } = opened;
		await ready(page);
		expect(refused).toBe(1);
		// A person's navigation loads the chunk again, which starts late and applies it, and it settles.
		await navigate(page, at('personal/hello'));
		await settle(page);
		await showsApp(page, 'hello');
		expect(pathOf(page)).toBe(`${basePath}personal/hello`);
		expect(refused).toBe(2);
		// Back runs its command; a later command moves the URL.
		await traverse(page, 'back');
		await settle(page);
		expect(pathOf(page)).toBe(basePath);
		expect(await stateOf(page)).toMatchObject({ active: null });
		await openApp(page, 'tally');
		await expect.poll(() => pathOf(page)).toBe(`${basePath}personal/tally`);
		expect(opened.violations).toEqual([]);
		// Only the first load failed, and it was reported.
		expect(opened.errors.every((error) => /ERR_FAILED|url-sync-/.test(error))).toBe(true);
		await context.close();
	});

	it('P2-E8: Back to an entry that names nothing shows "Nothing here", and not the app it left', async () => {
		const opened = await openShell(browser, at('personal/'));
		const { page } = opened;
		await ready(page);
		expect(await mainShows(page)).toEqual({ heading: 'Nothing here', app: false });
		await openApp(page, 'hello');
		await expect.poll(() => pathOf(page)).toBe(`${basePath}personal/hello`);
		expect((await mainShows(page)).app).toBe(true);
		await traverse(page, 'back');
		await settle(page);
		expect(pathOf(page)).toBe(`${basePath}personal/`);
		expect(await mainShows(page)).toEqual({ heading: 'Nothing here', app: false });
		noFailures(opened);
		await opened.context.close();
	});

	it('P2-E8: / is replaced for a persisted app, and stays while nothing is persisted', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await ready(page);
		expect(pathOf(page)).toBe(basePath);
		await openApp(page, 'hello');
		await expect.poll(() => pathOf(page)).toBe(`${basePath}personal/hello`);
		await flush(page);
		const before = await historyLength(page);
		await page.goto(site.root);
		await ready(page);
		await showsApp(page, 'hello');
		await expect.poll(() => pathOf(page)).toBe(`${basePath}personal/hello`);
		// Replaced, not pushed: the entry `/` loaded into now holds the app's URL.
		expect(await historyLength(page)).toBe(before + 1);
		noFailures(opened);
		await opened.context.close();
	});

	it("P2-E8: deployment write's index.html and 404.html hold the rewritten URLs", async () => {
		const page = await readFile(join(site.out, 'index.html'), 'utf8');
		expect(page).toMatch(new RegExp(`src="${basePath}assets/index-[^"]+\\.js"`));
		expect(page).not.toContain('./assets/');
		expect(await readFile(join(site.out, '404.html'), 'utf8')).toBe(page);
		// A path with no file is the shell; a missing asset is still a 404, and so is outside the base.
		const html = { accept: 'text/html' };
		expect((await fetch(at('personal/p/atlas/hello/a.b'), { headers: html })).status).toBe(200);
		expect((await fetch(at('assets/missing.js'))).status).toBe(404);
		if (basePath !== '/')
			expect((await fetch(`${site.origin}/`, { headers: html })).status).toBe(404);
	});
});

describe('P2-E8: an empty shell', () => {
	it('P2-E8: / stays, and its journal gains nothing for the URL', async () => {
		const dist = await serveDist();
		const opened = await openShell(browser, dist.origin);
		const { page } = opened;
		await ready(page);
		expect(pathOf(page)).toBe('/');
		const commands = (await journal(page)).map((entry) => entry.command);
		for (const name of ['scope-set', 'app-open', 'section-open', 'app-route-set']) {
			expect(commands).not.toContain(name);
		}
		noFailures(opened);
		await opened.context.close();
		await dist.close();
	});
});
