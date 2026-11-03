/**
 * The rail and the parts (phase 2 specification, 7.1 to 7.6 and 7.8; step 6): E3 so far, E12 so far, E11's
 * "tasks as version 2, side by side", and 7.6's guarantee that nothing of one project stays under another.
 * E3's clauses that land in the projects section wait for step 7: here they assert the state and the URL.
 * D29 is open with the owner: a dual-scope app with no project is in the bottom band, as specified, and the
 * one expectation that says so is marked below.
 */

import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	axe,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	focused,
	journal,
	kernelCall,
	openApp,
	openShell,
	packApp,
	type ShellPage,
	serveDeployment,
	settle,
	surfacesIdle,
} from '../harness';

let browser: Browser;
let site: DeploymentSite;

beforeAll(async () => {
	browser = await chromium.launch();
	site = await serveDeployment({
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello')),
			deploymentEntry('tally', await packApp('tally')),
			deploymentEntry('tasks', await packApp('tasks'))
		),
	});
});
afterAll(async () => {
	await site?.close();
	await browser?.close();
});

/** The trimmed text of each element a locator finds. */
const texts = async (locator: ReturnType<Page['locator']>) =>
	(await locator.allTextContents()).map((text) => text.trim());

const entry = (page: Page, instance: string, nav = 'rail') =>
	page.locator(`loam-${nav} loam-app-entry[instance="${instance}"]`);

const bandOf = (page: Page, instance: string) =>
	entry(page, instance).evaluate((element) =>
		element.parentElement?.classList.contains('top') ? 'top' : 'bottom'
	);

/** What `scope-get` and `section-get` say, unjournaled. */
const stateOf = (page: Page) =>
	page.evaluate(() =>
		(
			document.querySelector('loam-shell') as unknown as {
				readState(): Promise<{
					scope: { project?: string };
					project: { slug: string; name: string } | null;
					section: string | null;
					active: string | null;
				}>;
			}
		).readState()
	);

/** Every text of the page, through every open shadow root: what a person could find of a project. */
const deepText = (page: Page) =>
	page.evaluate(() => {
		const walk = (root: ParentNode): string =>
			[...root.querySelectorAll('*')]
				.map((element) => (element.shadowRoot ? walk(element.shadowRoot) : ''))
				.join(' ') +
			(root instanceof Element || root instanceof ShadowRoot ? root.textContent : '');
		return walk(document.documentElement);
	});

async function withProjects(): Promise<ShellPage> {
	const opened = await openShell(browser, site.root);
	for (const name of ['Atlas', 'Beacon']) {
		expect(await kernelCall(opened.page, 'project-create', { name })).toMatchObject({
			success: true,
		});
	}
	await settle(opened.page);
	return opened;
}

async function scopeTo(page: Page, project: string | null): Promise<unknown> {
	const result = await kernelCall(page, 'scope-set', { project });
	await surfacesIdle(page);
	return result;
}

/** Mark an element, to tell later whether the one there is the same or made again. */
const mark = (page: Page, selector: string) =>
	page.locator(selector).evaluate((element) => {
		(element as unknown as { loamMark?: boolean }).loamMark = true;
	});
const marked = (page: Page, selector: string) =>
	page
		.locator(selector)
		.evaluate((element) => (element as unknown as { loamMark?: boolean }).loamMark === true);

describe('P2-E3: two projects, and an app at each level', () => {
	it('P2-E3: places tally, tasks and hello by band, dims tasks with no project, and refuses its app-open', async () => {
		const opened = await withProjects();
		const { page } = opened;
		// No project: tally and hello at the bottom, tasks dimmed at the top.
		expect(await bandOf(page, 'tally')).toBe('bottom');
		// D29, open with the owner: a dual-scope app with no project is in the bottom band (7.1).
		expect(await bandOf(page, 'hello')).toBe('bottom');
		expect(await bandOf(page, 'tasks')).toBe('top');
		const tasks = entry(page, 'tasks').locator('button');
		expect(await tasks.getAttribute('aria-disabled')).toBe('true');
		await tasks.hover();
		const tip = page.locator('loam-rail loam-tooltip');
		await expect.poll(() => tip.textContent()).toBe('Choose a project to open Tasks');
		// A press does nothing but show its tooltip, and an app-open from anyone is refused, journaled.
		const count = (await journal(page)).length;
		await tasks.focus();
		await page.keyboard.press('Enter');
		await settle(page);
		expect((await journal(page)).slice(count).map(({ command }) => command)).not.toContain(
			'app-open'
		);
		expect(await agentCall(page, 'app-open', { instance: 'tasks' })).toMatchObject({
			success: false,
			error: { code: 'SCOPE_PROJECT_REQUIRED' },
		});
		const refused = (await journal(page)).at(-1);
		expect(refused).toMatchObject({ command: 'app-open', success: false });
		expect(refused?.error?.code).toBe('SCOPE_PROJECT_REQUIRED');

		// Atlas: hello moves to the top as one element, and tasks opens.
		await mark(page, 'loam-rail loam-app-entry[instance="hello"]');
		await scopeTo(page, 'atlas');
		await expect.poll(() => bandOf(page, 'hello')).toBe('top');
		expect(await marked(page, 'loam-rail loam-app-entry[instance="hello"]')).toBe(true);
		expect(await tasks.getAttribute('aria-disabled')).toBeNull();
		await openApp(page, 'tasks');
		await page.locator('tasks-main').waitFor();
		expect(opened.errors).toEqual([]);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});

	it('P2-E3: keeps focus on an entry that moves band (7.1)', async () => {
		const opened = await withProjects();
		const { page } = opened;
		await entry(page, 'hello').locator('button').focus();
		await mark(page, 'loam-rail loam-app-entry[instance="hello"]');
		await agentCall(page, 'scope-set', { project: 'atlas' });
		await expect.poll(() => bandOf(page, 'hello')).toBe('top');
		expect(await marked(page, 'loam-rail loam-app-entry[instance="hello"]')).toBe(true);
		expect((await focused(page)).hosts).toContain('loam-app-entry');
		expect((await focused(page)).label).toBe('Hello');
		await agentCall(page, 'scope-set', { project: null });
		await expect.poll(() => bandOf(page, 'hello')).toBe('bottom');
		expect((await focused(page)).label).toBe('Hello');
		await opened.context.close();
	});

	it("P2-E3: hello's sidebar shows In Atlas and In Personal, a value stored at each kept apart", async () => {
		const opened = await withProjects();
		const { page } = opened;
		await scopeTo(page, 'atlas');
		await openApp(page, 'hello');
		await kernelCall(page, 'hello-greet', { name: 'Ada' });
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { call(name: string, input: unknown, options: unknown): Promise<unknown> };
			};
			await shell.kernel.call('hello-greet', { name: 'Grace' }, { scope: 'workspace' });
		});
		await surfacesIdle(page);
		const group = (name: string) => page.locator(`loam-sidebar loam-list[aria-label="${name}"]`);
		await expect.poll(() => texts(group('In Atlas').locator('violet-option'))).toEqual(['Ada']);
		await expect
			.poll(() => texts(group('In Personal').locator('violet-option')))
			.toEqual(['Grace']);
		expect(await group('In Atlas').getAttribute('role')).toBe('region');
		expect(await group('In Atlas').locator('h2').textContent()).toBe('In Atlas');
		// A selection in the workspace's group is at that level.
		await group('In Personal').locator('violet-option').first().click();
		await surfacesIdle(page);
		expect(await kernelCall(page, 'app-selection-get', { instance: 'hello' })).toMatchObject({
			data: { id: 'Grace', level: 'workspace' },
		});
		// With no project, one list and no heading, as phase 1.
		await scopeTo(page, null);
		await expect.poll(() => page.locator('loam-sidebar loam-list').count()).toBe(1);
		expect(await page.locator('loam-sidebar loam-list h2').count()).toBe(0);
		await opened.context.close();
	});

	it('P2-E3: Beacon from tasks keeps tasks with nothing of Atlas, and no project leaves it for the projects section', async () => {
		const opened = await withProjects();
		const { page } = opened;
		await scopeTo(page, 'atlas');
		await openApp(page, 'tasks');
		await kernelCall(page, 'tasks-add', { title: 'Only in Atlas' });
		await surfacesIdle(page);
		await expect
			.poll(() => texts(page.locator('loam-sidebar loam-list violet-option')))
			.toEqual(['Only in Atlas']);
		await mark(page, 'tasks-main');
		await scopeTo(page, 'beacon');
		expect((await stateOf(page)).active).toBe('tasks');
		await page.locator('tasks-main').waitFor();
		// Made again, with a new port: the element is not the one Atlas had (7.6).
		expect(await marked(page, 'tasks-main')).toBe(false);
		await expect.poll(() => page.locator('loam-sidebar loam-list p.empty').count()).toBe(1);
		expect(await deepText(page)).not.toContain('Only in Atlas');
		// To no project from tasks: the projects section, which step 7 renders.
		await scopeTo(page, null);
		expect(await stateOf(page)).toMatchObject({ active: null, section: 'projects' });
		expect(new URL(page.url()).pathname).toBe('/personal/~/projects');
		expect(await deepText(page)).not.toContain('Only in Atlas');
		await opened.context.close();
	});

	it("P2-E3: from tally to Atlas lands on the project's home, and an agent's tally-add there runs at the workspace", async () => {
		const opened = await withProjects();
		const { page } = opened;
		await openApp(page, 'tally');
		await scopeTo(page, 'atlas');
		expect(await stateOf(page)).toMatchObject({ active: null, section: 'projects' });
		expect(new URL(page.url()).pathname).toBe('/personal/p/atlas');
		expect(await agentCall(page, 'tally-add')).toMatchObject({ success: true });
		const added = (await journal(page)).at(-1);
		expect(added?.command).toBe('tally-add');
		expect(added?.context?.scope).toEqual({ workspace: 'personal' });
		await opened.context.close();
	});

	it('P2-E3: the switcher by keyboard, Escape returning focus, and the live region saying where it went', async () => {
		const opened = await withProjects();
		const { page } = opened;
		const switcher = page.locator('loam-rail loam-project-switcher button');
		expect(await switcher.getAttribute('aria-label')).toBe('Project: none');
		expect(await switcher.getAttribute('aria-haspopup')).toBe('listbox');
		await switcher.focus();
		await page.keyboard.press('Enter');
		const list = page.locator('loam-rail loam-project-list violet-listbox');
		await expect.poll(() => switcher.getAttribute('aria-expanded')).toBe('true');
		await expect
			.poll(() => texts(list.locator('violet-option')))
			.toEqual(['No project', 'Atlas', 'Beacon', 'All projects']);
		await page.keyboard.press('Escape');
		await expect.poll(() => switcher.getAttribute('aria-expanded')).toBe('false');
		expect((await focused(page)).label).toBe('Project: none');

		await page.keyboard.press('Enter');
		await expect.poll(() => switcher.getAttribute('aria-expanded')).toBe('true');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
		await expect.poll(async () => (await stateOf(page)).project?.slug).toBe('atlas');
		await expect.poll(() => switcher.getAttribute('aria-label')).toBe('Project: Atlas');
		expect((await focused(page)).label).toBe('Project: Atlas');
		await expect
			.poll(() => page.locator('loam-shell .announce').textContent())
			.toBe('Project: Atlas');
		// The status bar names the workspace and the project, whose item opens the project's home.
		expect(await page.locator('loam-statusbar .workspace-status').textContent()).toContain(
			'Personal'
		);
		await page.locator('loam-statusbar .project-home').click();
		await expect.poll(async () => (await stateOf(page)).section).toBe('projects');
		await expect.poll(() => page.title()).toBe('Projects · Atlas · Personal');
		// All projects opens the section, as a press of Projects does.
		await switcher.click();
		await list.locator('violet-option', { hasText: 'No project' }).click();
		await expect.poll(async () => (await stateOf(page)).project).toBeNull();
		await expect.poll(() => page.locator('loam-shell .announce').textContent()).toBe('No project');
		expect(opened.errors).toEqual([]);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});

	it('P2-E11: loads hello and tally as version 1 and tasks as version 2, side by side', async () => {
		const opened = await openShell(browser, site.root);
		const versions = await opened.page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: {
					appsReady: Promise<void>;
					appPort(instance: string): { manifest: { manifest_version: number } };
				};
			};
			await shell.kernel.appsReady;
			return ['hello', 'tally', 'tasks'].map(
				(instance) => shell.kernel.appPort(instance).manifest.manifest_version
			);
		});
		expect(versions).toEqual([1, 1, 2]);
		await opened.context.close();
	});
});

describe('P2-E3: nothing of one project stays under another (7.6)', () => {
	it('P2-E3: recreates a kept app’s surfaces, parked or not, and a route is a property that recreates nothing', async () => {
		const opened = await withProjects();
		const { page } = opened;
		// Tally's panel is parked when hello opens.
		await openApp(page, 'tally');
		await page.locator('tally-history').waitFor();
		await mark(page, 'tally-history');
		await openApp(page, 'hello');
		await mark(page, 'hello-main');
		await scopeTo(page, 'atlas');
		await page.locator('hello-main').waitFor();
		expect(await marked(page, 'hello-main')).toBe(false);
		const scope = await page
			.locator('hello-main')
			.evaluate((element) => (element as unknown as { scope?: { project?: string } }).scope);
		expect(scope?.project).toMatch(/^prj_/);
		// The parked panel was made in the workspace: it is dropped, and made again.
		await openApp(page, 'tally');
		await page.locator('tally-history').waitFor();
		expect(await marked(page, 'tally-history')).toBe(false);

		// A route is a property: hello's main stays, and its header's crumbs follow.
		await openApp(page, 'hello');
		await mark(page, 'hello-main');
		const crumbs = () => texts(page.locator('loam-part-header violet-breadcrumb-item'));
		await expect.poll(crumbs).toEqual(['Personal', 'Atlas', 'Hello']);
		await agentCall(page, 'app-route-set', { instance: 'hello', path: 'items/one' });
		await surfacesIdle(page);
		await expect.poll(crumbs).toEqual(['Personal', 'Atlas', 'Hello', 'items', 'one']);
		expect(await marked(page, 'hello-main')).toBe(true);
		expect(
			await page
				.locator('hello-main')
				.evaluate((element) => (element as unknown as { route?: string }).route)
		).toBe('items/one');
		expect(
			await page.locator('loam-part-header violet-breadcrumb-item').nth(1).getAttribute('href')
		).toBe(`${site.origin}/personal/p/atlas`);
		await opened.context.close();
	});
});

describe('P2-E3: a layout per app and scope (7.6)', () => {
	it("P2-E3: keeps hello's workspace layout and its Atlas layout apart, and the shell shows the one in scope", async () => {
		const opened = await withProjects();
		const { page } = opened;
		await openApp(page, 'hello');
		const shown = () =>
			page.evaluate(
				() =>
					(
						document.querySelector('loam-shell') as unknown as {
							layout: { sidebar: { width: number } };
						}
					).layout.sidebar.width
			);
		await kernelCall(page, 'layout-set', { sidebar: { width: 320 } });
		await expect.poll(shown).toBe(320);
		await scopeTo(page, 'atlas');
		// The project's record starts from the manifest's preset.
		await expect.poll(shown).toBe(260);
		await kernelCall(page, 'layout-set', { sidebar: { width: 400 } });
		await expect.poll(shown).toBe(400);
		await scopeTo(page, null);
		await expect.poll(shown).toBe(320);
		await scopeTo(page, 'atlas');
		await expect.poll(shown).toBe(400);
		await opened.context.close();
	});
});

describe('P2-E12: accessibility of the rail and the parts', () => {
	const scenes = async (page: Page) => {
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await settle(page);
	};

	for (const [theme, density] of [
		['light', 'comfortable'],
		['dark', 'compact'],
		['high-contrast', 'comfortable'],
	] as const) {
		it(`P2-E12: has no violations with bands and a dimmed entry, the switcher open and a dual sidebar, ${theme} ${density}`, async () => {
			const opened = await openShell(browser, site.root);
			const { page } = opened;
			await scenes(page);
			await kernelCall(page, 'appearance-set', { theme, density });
			await settle(page);
			expect(await axe(page)).toEqual([]);
			await page.locator('loam-rail loam-project-switcher button').click();
			await expect
				.poll(() =>
					page.locator('loam-rail loam-project-switcher button').getAttribute('aria-expanded')
				)
				.toBe('true');
			expect(await axe(page)).toEqual([]);
			await page.keyboard.press('Escape');
			await scopeTo(page, 'atlas');
			await openApp(page, 'hello');
			await expect.poll(() => page.locator('loam-sidebar loam-list').count()).toBe(2);
			expect(await axe(page)).toEqual([]);
			await opened.context.close();
		});
	}

	it('P2-E12: has no violations under forced colors and in the compact class', async () => {
		for (const options of [
			{ forcedColors: 'active' as const },
			{ viewport: { width: 390, height: 844 } },
		]) {
			const opened = await openShell(browser, site.root, options);
			const { page } = opened;
			await scenes(page);
			expect(await axe(page)).toEqual([]);
			const nav = options.viewport ? 'tabbar' : 'rail';
			await page.locator(`loam-${nav} loam-project-switcher button`).click();
			await expect
				.poll(() =>
					page.locator(`loam-${nav} loam-project-switcher button`).getAttribute('aria-expanded')
				)
				.toBe('true');
			expect(await axe(page)).toEqual([]);
			await page.keyboard.press('Escape');
			await opened.context.close();
		}
	});
});

describe('P2-E12: 40 rail entries at 600 pixels (7.5, #709)', () => {
	it('P2-E12: scrolls every entry into reach by keyboard, its tooltip unclipped, and F6 keeps its order', async () => {
		const tally = await packApp('tally');
		const many = await serveDeployment({
			config: deploymentFile(
				...Array.from({ length: 40 }, (_, index) =>
					deploymentEntry(`t${String(index).padStart(2, '0')}`, tally, {
						title: `Tally ${index + 1}`,
					})
				)
			),
		});
		// Forty instances of one app: past the first, each is refused for its commands' names, which does
		// not matter here, as each still has an entry.
		const opened = await openShell(browser, many.root, { viewport: { width: 1280, height: 600 } });
		const { page } = opened;
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { appsReady: Promise<void> };
			};
			await shell.kernel.appsReady;
		});
		await settle(page);
		expect(await page.locator('loam-rail loam-app-entry').count()).toBe(40);
		const tip = page.locator('loam-rail loam-tooltip');
		// Seen, not only displayed: nothing clips it, and it is on screen.
		const tipShows = () =>
			tip.evaluate((element) => {
				const box = element.getBoundingClientRect();
				if (box.width === 0) return false;
				const root = element.getRootNode() as ShadowRoot;
				return (
					box.bottom <= innerHeight &&
					box.top >= 0 &&
					root.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === element
				);
			});
		await page.keyboard.press('F6');
		await page.keyboard.press('F6');
		expect((await focused(page)).part).toBe('rail');
		// Projects, the switcher and Documents, then the 40.
		for (let index = 0; index < 3; index++) await page.keyboard.press('Tab');
		for (let index = 0; index < 40; index++) {
			await page.keyboard.press('Tab');
			const label = `Tally ${index + 1}`;
			const named = (await focused(page)).label;
			expect([label, `${label} (unavailable)`]).toContain(named);
			const inView = await page
				.locator(`loam-rail loam-app-entry[label="${label}"]`)
				.evaluate((element) => {
					const box = element.getBoundingClientRect();
					return box.top >= 0 && box.bottom <= innerHeight;
				});
			expect(inView, label).toBe(true);
			await expect.poll(() => tip.textContent()).toBe(named);
			expect(await tipShows(), label).toBe(true);
		}
		await page.keyboard.press('Tab');
		expect((await focused(page)).label).toContain('Settings');
		expect(opened.errors).toEqual([]);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
		await many.close();
	});
});
