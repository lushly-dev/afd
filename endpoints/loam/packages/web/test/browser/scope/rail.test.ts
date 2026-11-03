/**
 * The rail and the parts (phase 2 specification, 7.1 to 7.6 and 7.8; step 6): E3 so far, E12 so far, E11's
 * "tasks as version 2, side by side", and 7.6's guarantee that nothing of one project stays under another.
 * E3's clauses that land in the projects section wait for step 7: here they assert the state and the URL.
 * D29 is open with the owner: a dual-scope app with no project is in the bottom band, as specified. Every
 * expectation that reads it is marked `D29`, here and in `first-paint.test.ts` and `chrome/src/rail/bands.test.ts`.
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
		// D29: from the bottom band, where it was with no project.
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
		// D29: hello moves only because, with no project, it is in the bottom band.
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
		const group = (name: string) => page.locator(`loam-sidebar loam-list[heading="${name}"]`);
		await expect.poll(() => texts(group('In Atlas').locator('violet-option'))).toEqual(['Ada']);
		await expect
			.poll(() => texts(group('In Personal').locator('violet-option')))
			.toEqual(['Grace']);
		// Each group a region named by its h3 (7.4).
		expect(await group('In Atlas').locator('.group').getAttribute('role')).toBe('region');
		expect(await group('In Atlas').locator('.group').getAttribute('aria-labelledby')).toBe(
			'heading'
		);
		expect(await group('In Atlas').locator('h3#heading').textContent()).toBe('In Atlas');
		// A selection in the workspace's group is at that level.
		await group('In Personal').locator('violet-option').first().click();
		await surfacesIdle(page);
		expect(await kernelCall(page, 'app-selection-get', { instance: 'hello' })).toMatchObject({
			data: { id: 'Grace', level: 'workspace' },
		});
		// With no project, one list and no heading, as phase 1.
		await scopeTo(page, null);
		await expect.poll(() => page.locator('loam-sidebar loam-list').count()).toBe(1);
		expect(await page.locator('loam-sidebar loam-list h3').count()).toBe(0);
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
		const home = page.locator('loam-statusbar .project-home');
		expect(await home.getAttribute('aria-label')).toBe('Project: Atlas');
		const box = await home.boundingBox();
		expect(box?.height).toBeGreaterThanOrEqual(24);
		await home.click();
		await expect.poll(async () => (await stateOf(page)).section).toBe('projects');
		await expect.poll(() => page.title()).toBe('Projects · Atlas · Personal');
		// No project, chosen by pointer.
		await switcher.click();
		await list.locator('violet-option', { hasText: 'No project' }).click();
		await expect.poll(async () => (await stateOf(page)).project).toBeNull();
		await expect.poll(() => page.locator('loam-shell .announce').textContent()).toBe('No project');
		expect(opened.errors).toEqual([]);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});

	it('P2-E3: All projects opens the projects section, and focus goes to main’s heading when it left an app', async () => {
		const opened = await withProjects();
		const { page } = opened;
		await openApp(page, 'hello');
		const switcher = page.locator('loam-rail loam-project-switcher button');
		await switcher.click();
		await page
			.locator('loam-rail loam-project-list violet-option', { hasText: 'All projects' })
			.click();
		await expect.poll(async () => (await stateOf(page)).section).toBe('projects');
		expect((await stateOf(page)).active).toBeNull();
		await expect.poll(() => new URL(page.url()).pathname).toBe('/personal/~/projects');
		await expect.poll(async () => (await focused(page)).tag).toBe('h1');
		expect(await switcher.getAttribute('aria-expanded')).toBe('false');
		await opened.context.close();
	});

	it('P2-E3: Tab out of the open list closes it, focus staying where it went (A2)', async () => {
		const opened = await withProjects();
		const { page } = opened;
		const switcher = page.locator('loam-rail loam-project-switcher button');
		await switcher.focus();
		await page.keyboard.press('Enter');
		await expect.poll(() => switcher.getAttribute('aria-expanded')).toBe('true');
		await page.keyboard.press('Tab');
		await expect.poll(() => switcher.getAttribute('aria-expanded')).toBe('false');
		expect((await focused(page)).label).toBe('Documents');
		await opened.context.close();
	});

	it('P2-E3: a workspace-only app opened in Atlas is made at the workspace, and learns no project (4.3)', async () => {
		const opened = await withProjects();
		const { page } = opened;
		await scopeTo(page, 'atlas');
		expect(await agentCall(page, 'app-open', { instance: 'tally' })).toMatchObject({
			success: true,
		});
		await surfacesIdle(page);
		await page.locator('tally-main').waitFor();
		expect(
			await page.locator('tally-main').evaluate((element) => (element as { scope?: unknown }).scope)
		).toEqual({ workspace: 'personal' });
		await page.locator('tally-main violet-button.add').click();
		await settle(page);
		const added = (await journal(page)).filter(({ command }) => command === 'tally-add').at(-1);
		expect(added?.context?.scope).toEqual({ workspace: 'personal' });
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

describe('P2-E3: a change of scope a call did not ask for (7.6, 3.4)', () => {
	it('P2-E3: drops a restricted project’s surfaces when an expired session’s own call is refused', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await kernelCall(page, 'auth-sign-in', {
			method: 'credentials',
			email: 'person@example.com',
			password: 'x',
		});
		await kernelCall(page, 'project-create', {
			name: 'Atlas',
			access: { mode: 'restricted', members: ['mock-user-person@example.com'] },
		});
		await scopeTo(page, 'atlas');
		// Hello first, so its sidebar is parked when tasks opens.
		await openApp(page, 'hello');
		await mark(page, 'loam-sidebar loam-list[heading="In Atlas"]');
		await openApp(page, 'tasks');
		await kernelCall(page, 'tasks-add', { title: 'Restricted plan' });
		await surfacesIdle(page);
		expect(new URL(page.url()).pathname).toBe('/personal/p/atlas/tasks');
		// The session expires, with no command: the next call, the Atlas surface's own, is refused.
		await page.clock.setFixedTime(Date.now() + 2 * 3600_000);
		const refused = await page.locator('tasks-main').evaluate((element) =>
			(
				element as unknown as {
					context: { client: { call(name: string): Promise<{ error?: { code: string } }> } };
				}
			).context.client.call('tasks-list')
		);
		expect(refused.error?.code).toBe('PROJECT_NOT_FOUND');
		await surfacesIdle(page);
		await expect
			.poll(() => page.locator('loam-rail loam-project-switcher button').getAttribute('aria-label'))
			.toBe('Project: none');
		await expect.poll(() => page.locator('tasks-main').count()).toBe(0);
		await expect.poll(() => new URL(page.url()).pathname).not.toContain('/p/atlas');
		expect(await deepText(page)).not.toContain('Restricted plan');
		// Hello's parked sidebar was Atlas's: it is made again.
		await openApp(page, 'hello');
		expect(await marked(page, 'loam-sidebar loam-list')).toBe(false);
		await opened.context.close();
	});

	it('P2-E3: archiving the active project recreates the app kept at the workspace', async () => {
		const opened = await withProjects();
		const { page } = opened;
		await scopeTo(page, 'atlas');
		await openApp(page, 'hello');
		await mark(page, 'hello-main');
		const archived = (await kernelCall(page, 'project-archive', { project: 'atlas' })) as {
			success: boolean;
		};
		expect(archived.success).toBe(true);
		await surfacesIdle(page);
		await page.locator('hello-main').waitFor();
		expect(await marked(page, 'hello-main')).toBe(false);
		expect(
			await page.locator('hello-main').evaluate((element) => (element as { scope?: unknown }).scope)
		).toEqual({ workspace: 'personal' });
		await expect.poll(() => new URL(page.url()).pathname).toBe('/personal/hello');
		await expect.poll(() => page.locator('loam-shell .announce').textContent()).toBe('No project');
		await opened.context.close();
	});

	it('P2-E3: ignores a selection from a list made before the change of scope (7.6)', async () => {
		const opened = await withProjects();
		const { page } = opened;
		await scopeTo(page, 'atlas');
		await openApp(page, 'hello');
		const count = (await journal(page)).length;
		const connected = await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				shadowRoot: ShadowRoot;
				kernel: { call(name: string, input: unknown): Promise<unknown> };
			};
			const list = shell.shadowRoot.querySelector('loam-sidebar loam-list') as HTMLElement;
			await shell.kernel.call('scope-set', { project: 'beacon' });
			const attached = list.isConnected;
			list.dispatchEvent(
				new CustomEvent('loam-list-select', {
					detail: { id: 'from-atlas' },
					bubbles: true,
					composed: true,
				})
			);
			return attached;
		});
		expect(connected).toBe(true);
		await surfacesIdle(page);
		expect(
			(await journal(page)).slice(count).filter(({ command }) => command === 'app-selection-set')
		).toEqual([]);
		await opened.context.close();
	});
});

describe('P2-E3: a mounted instance with projects (7.1, 9.1)', () => {
	it('P2-E3: is dimmed with no project and in a project it does not list, each with its tooltip', async () => {
		const mounted = await serveDeployment({
			config: deploymentFile(
				[
					'[apps.work]',
					'app = "hello"',
					`package = ${JSON.stringify(await packApp('hello', 'mounted'))}`,
					'title = "Work"',
					'prefix = "work"',
					'audience = "person"',
					'transport = "stdio"',
					'command = ["umbel", "serve", "--stdio"]',
					'projects = ["atlas"]',
				].join('\n')
			),
		});
		const opened = await openShell(browser, mounted.root);
		const { page } = opened;
		for (const name of ['Atlas', 'Beacon']) await kernelCall(page, 'project-create', { name });
		await settle(page);
		const work = entry(page, 'work').locator('button');
		const tip = page.locator('loam-rail loam-tooltip');
		expect(await bandOf(page, 'work')).toBe('top');
		expect(await work.getAttribute('aria-disabled')).toBe('true');
		await work.hover();
		await expect.poll(() => tip.textContent()).toBe('Choose a project to open Work');
		await page.mouse.move(700, 500);
		await scopeTo(page, 'beacon');
		await expect.poll(() => work.getAttribute('aria-disabled')).toBe('true');
		await work.hover();
		await expect.poll(() => tip.textContent()).toBe('Work is not available in Beacon');
		await page.mouse.move(700, 500);
		await scopeTo(page, 'atlas');
		await expect.poll(() => work.getAttribute('aria-disabled')).toBeNull();
		await opened.context.close();
		await mounted.close();
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

	/** The dual sidebar: hello in Atlas, its two groups in the sidebar, or the compact class's drawer. */
	const dualSidebar = async (page: Page, compact = false) => {
		await scopeTo(page, 'atlas');
		await agentCall(page, 'app-open', { instance: 'hello' });
		if (compact) await kernelCall(page, 'layout-set', { compact: { drawer: 'sidebar' } });
		await surfacesIdle(page);
		await expect.poll(() => page.locator('loam-sidebar loam-list').count()).toBe(2);
	};

	for (const theme of ['light', 'dark', 'high-contrast'] as const) {
		for (const density of ['comfortable', 'compact'] as const) {
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
				await dualSidebar(page);
				expect(await axe(page)).toEqual([]);
				await opened.context.close();
			});
		}
	}

	it('P2-E12: has no violations under forced colors and in the compact class, the dual sidebar too', async () => {
		for (const options of [
			{ forcedColors: 'active' as const },
			{ viewport: { width: 390, height: 844 } },
		]) {
			const opened = await openShell(browser, site.root, options);
			const { page } = opened;
			await scenes(page);
			expect(await axe(page)).toEqual([]);
			const compact = options.viewport !== undefined;
			const switcher = page.locator(
				`loam-${compact ? 'tabbar' : 'rail'} loam-project-switcher button`
			);
			expect(await switcher.getAttribute('aria-haspopup')).toBe(compact ? 'dialog' : 'listbox');
			await switcher.click();
			await expect.poll(() => switcher.getAttribute('aria-expanded')).toBe('true');
			expect(await axe(page)).toEqual([]);
			await page.keyboard.press('Escape');
			await expect.poll(() => switcher.getAttribute('aria-expanded')).toBe('false');
			// Escape gives focus back to the switcher it opened from, the tab bar's in the compact class.
			const back = await focused(page);
			expect(back.hosts).toContain(`loam-${compact ? 'tabbar' : 'rail'}`);
			expect(back.label).toBe('Project: none');
			await dualSidebar(page, compact);
			expect(await axe(page)).toEqual([]);
			await opened.context.close();
		}
	});
});

describe('P2-E12: the tooltip loaded on first use (7.5)', () => {
	it('P2-E12: does not open for an entry the pointer has left while its chunk loaded, nor take Escape', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await opened.context.route(/\/assets\/tooltip-[^/]*\.js$/, async (route) => {
			await held;
			await route.continue();
		});
		await entry(page, 'hello').hover();
		await page.mouse.move(700, 500);
		release();
		const tip = page.locator('loam-rail loam-tooltip');
		await tip.waitFor({ state: 'attached' });
		await settle(page);
		expect(await tip.evaluate((element) => element.matches(':popover-open'))).toBe(false);
		// Escape reaches the page: nothing showing took it.
		await page.evaluate(() => {
			(window as unknown as { escapes: boolean[] }).escapes = [];
			window.addEventListener('keydown', (event) => {
				if (event.key === 'Escape') {
					(window as unknown as { escapes: boolean[] }).escapes.push(event.defaultPrevented);
				}
			});
		});
		await page.keyboard.press('Escape');
		expect(
			await page.evaluate(() => (window as unknown as { escapes: boolean[] }).escapes)
		).toEqual([false]);
		// From now on it is the tooltip's own listeners that show it.
		await entry(page, 'hello').hover();
		await expect.poll(() => tip.textContent()).toBe('Hello');
		await opened.context.close();
	});

	it('P2-E12: tries the chunk again after a failed load', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		let refused = 0;
		await opened.context.route(/\/assets\/tooltip-[^/]*\.js$/, (route) =>
			refused++ === 0 ? route.abort() : route.continue()
		);
		await entry(page, 'hello').hover();
		await expect.poll(() => refused).toBe(1);
		await page.mouse.move(700, 500);
		await entry(page, 'hello').hover();
		await expect.poll(() => page.locator('loam-rail loam-tooltip').textContent()).toBe('Hello');
		// The failed import was reported, as a chunk that does not load is.
		expect(opened.errors.filter((error) => !/tooltip|ERR_FAILED/.test(error))).toEqual([]);
		await opened.context.close();
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
