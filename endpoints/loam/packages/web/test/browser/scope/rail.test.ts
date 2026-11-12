/**
 * The rail and the parts (phase 2 specification, 7.1 to 7.6 and 7.8; step 6): E3 so far, E12 so far, E11's
 * "tasks as version 2, side by side", and 7.6's guarantee that nothing of one project stays under another.
 * E3's clauses that land in the projects section assert what it shows, since step 7 renders it.
 * D29 is open with the owner: a dual-scope app with no project is in the bottom band, as specified. Every
 * expectation that reads it is marked `D29`, here and in `first-paint.test.ts` and `chrome/src/rail/bands.test.ts`.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
		// To no project from tasks: the projects section, its list, with focus on its heading as the app left.
		await page.locator('tasks-main').locator('input, button').first().focus();
		await scopeTo(page, null);
		expect(await stateOf(page)).toMatchObject({ active: null, section: 'projects' });
		expect(new URL(page.url()).pathname).toBe('/personal/~/projects');
		const heading = page.locator('loam-main loam-projects-section h1');
		await expect.poll(() => heading.textContent()).toBe('Projects');
		await expect
			.poll(() => page.locator('loam-projects-section tbody a').allTextContents())
			.toEqual(['Atlas', 'Beacon']);
		await expect.poll(async () => (await focused(page)).tag).toBe('h1');
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
		// The project's home: its name, and tasks' card, the one app here with a summary.
		await expect.poll(() => page.locator('loam-projects-section h1').textContent()).toBe('Atlas');
		await expect
			.poll(() => page.locator('loam-projects-section .card h2').allTextContents())
			.toEqual([expect.stringContaining('Tasks')]);
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
		// Told apart from the switcher's "Project: Atlas", its visible text kept in its name (N3a).
		expect(await home.getAttribute('aria-label')).toBe('Project: Atlas, home');
		const box = await home.boundingBox();
		expect(box?.height).toBeGreaterThanOrEqual(24);
		await home.click();
		await expect.poll(async () => (await stateOf(page)).section).toBe('projects');
		await expect.poll(() => page.title()).toBe('Projects · Atlas · Personal');
		await expect.poll(() => page.locator('loam-projects-section h1').textContent()).toBe('Atlas');
		// No project, chosen by pointer.
		await switcher.click();
		await list.locator('violet-option', { hasText: 'No project' }).click();
		await expect.poll(async () => (await stateOf(page)).project).toBeNull();
		await expect.poll(() => page.locator('loam-shell .announce').textContent()).toBe('No project');
		expect(opened.errors).toEqual([]);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});

	it('P2-E3: No project leaves the project: the state, the URL and the announcement (G4)', async () => {
		const opened = await withProjects();
		const { page } = opened;
		await scopeTo(page, 'atlas');
		await expect.poll(() => new URL(page.url()).pathname).toBe('/personal/p/atlas');
		const switcher = page.locator('loam-rail loam-project-switcher button');
		await switcher.click();
		await page
			.locator('loam-rail loam-project-list violet-option', { hasText: 'No project' })
			.click();
		await expect.poll(async () => (await stateOf(page)).scope.project).toBeUndefined();
		expect((await stateOf(page)).project).toBeNull();
		// The workspace with nothing open: the scheme's `/` (6.1, 6.3).
		await expect.poll(() => new URL(page.url()).pathname).toBe('/');
		await expect.poll(() => page.locator('loam-shell .announce').textContent()).toBe('No project');
		expect(await switcher.getAttribute('aria-label')).toBe('Project: none');
		expect((await focused(page)).label).toBe('Project: none');
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
		// The section's heading, in its own shadow root, not main's hidden landing.
		expect((await focused(page)).hosts).toContain('loam-projects-section');
		expect((await focused(page)).label).toBe('Projects');
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

	it('P2-E3: a refused choice stays open and says why, and a press on that text keeps it open (N2a)', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await restrictedAtlas(page);
		await scopeTo(page, null);
		const switcher = page.locator('loam-rail loam-project-switcher button');
		await switcher.click();
		const list = page.locator('loam-rail loam-project-list');
		await expect.poll(() => texts(list.locator('violet-option'))).toContain('Atlas');
		// Signed out while it is open: Atlas, still listed, is now refused.
		await agentCall(page, 'auth-sign-out');
		await list.locator('violet-option', { hasText: 'Atlas' }).click();
		const failure = list.locator('p.failure');
		await expect.poll(() => failure.textContent()).toContain('No project with that name');
		expect(await failure.textContent()).not.toContain('..');
		await failure.click();
		expect(await switcher.getAttribute('aria-expanded')).toBe('true');
		expect((await focused(page)).tag).not.toBe('body');
		// The same refusal twice is announced twice: the alert is emptied, so hidden, and shown anew.
		const refuse = () =>
			list.evaluate((element) =>
				(
					element as unknown as { choose(event: CustomEvent<{ value: string }>): Promise<void> }
				).choose(new CustomEvent('change', { detail: { value: 'prj_missing' } }))
			);
		await refuse();
		// `choose` resolves with `failure` set and the line's `hidden` removed only at FAST's next update:
		// wait for the line to show, so the observer below sees the second refusal alone, not that update.
		await expect
			.poll(() => failure.evaluate((element) => element.hasAttribute('hidden')))
			.toBe(false);
		const first = await failure.textContent();
		await failure.evaluate((element) => {
			const seen: boolean[] = [];
			(window as unknown as { seen: boolean[] }).seen = seen;
			new MutationObserver(() => seen.push(element.hasAttribute('hidden'))).observe(element, {
				attributes: true,
				attributeFilter: ['hidden'],
			});
		});
		await refuse();
		// The same refusal, once FAST's update has rendered it.
		await expect.poll(() => failure.textContent()).toBe(first);
		await expect
			.poll(() => page.evaluate(() => (window as unknown as { seen: boolean[] }).seen))
			.toEqual([true, false]);
		await opened.context.close();
	});

	it('P2-E3: a scope-set to the active project with an app shows that app, with no change of scope (M1)', async () => {
		const opened = await withProjects();
		const { page } = opened;
		await scopeTo(page, 'atlas');
		await combinedOpen(page);
		expect(await page.locator('loam-shell loam-main').getAttribute('data-app')).toBe('tasks');
		expect((await stateOf(page)).active).toBe('tasks');
		await opened.context.close();
	});

	it('P2-E3: its undo, the same project with app: null, closes the app, with no change of scope (M1)', async () => {
		const opened = await withProjects();
		const { page } = opened;
		await scopeTo(page, 'atlas');
		const { undoCommand, undoArgs } = await combinedOpen(page);
		expect(undoArgs).toEqual({ project: expect.stringMatching(/^prj_/), app: null });
		const undone = (await kernelCall(page, undoCommand as string, undoArgs)) as {
			success: boolean;
		};
		expect(undone.success).toBe(true);
		await surfacesIdle(page);
		await expect.poll(() => page.locator('tasks-main').count()).toBe(0);
		expect(await page.locator('loam-shell loam-main').getAttribute('data-app')).toBeNull();
		expect(await stateOf(page)).toMatchObject({ active: null, section: 'projects' });
		await opened.context.close();
	});

	it("P2-E3: a press on the list's own padding keeps focus in it, and the arrow keys still move (R3)", async () => {
		const opened = await withProjects();
		const { page } = opened;
		const switcher = page.locator('loam-rail loam-project-switcher button');
		await switcher.click();
		const list = page.locator('loam-rail loam-project-list');
		await expect.poll(() => texts(list.locator('violet-option'))).toContain('Beacon');
		// A point of the popover's surface below the listbox: neither it nor the failure line. Sizes, not
		// positions, so Playwright's click, which waits for the surface to stop moving, finds the same spot.
		const surface = list.locator('violet-popover .surface');
		const size = await list.evaluate((element) => {
			const root = element.shadowRoot as ShadowRoot;
			const popover = root.querySelector('violet-popover') as HTMLElement;
			const outer = (
				(popover.shadowRoot as ShadowRoot).querySelector('.surface') as HTMLElement
			).getBoundingClientRect();
			const inner = (root.querySelector('violet-listbox') as HTMLElement).getBoundingClientRect();
			return { width: outer.width, height: outer.height, gap: outer.bottom - inner.bottom };
		});
		expect(size.gap).toBeGreaterThan(2);
		const before = await list.evaluate(
			(element) => (element as unknown as { listbox: { activeValue: string } }).listbox.activeValue
		);
		await surface.click({ position: { x: size.width / 2, y: size.height - size.gap / 2 } });
		expect(await switcher.getAttribute('aria-expanded')).toBe('true');
		expect((await focused(page)).tag).not.toBe('body');
		await page.keyboard.press('ArrowDown');
		await expect
			.poll(() =>
				list.evaluate(
					(element) =>
						(element as unknown as { listbox: { activeValue: string } }).listbox.activeValue
				)
			)
			.not.toBe(before);
		await opened.context.close();
	});

	it("P2-E3: a press outside the compact list's client area, where a scrollbar sits, is not cancelled (item 1)", async () => {
		const opened = await openShell(browser, site.root, { viewport: { width: 320, height: 256 } });
		const { page } = opened;
		for (const name of ['Atlas', 'Beacon', 'Citadel'])
			await kernelCall(page, 'project-create', { name });
		await page.locator('loam-tabbar loam-project-switcher button').click();
		const list = page.locator('loam-tabbar loam-project-list');
		await expect.poll(() => list.locator('dialog[open]').count()).toBe(1);
		// A long failure makes the modal dialog itself scroll. Headless Chromium's scrollbars take no room
		// and take no press, so a 12 px border stands where a classic one would: both are outside the client
		// area, the one test `press` makes. Set through CSSOM, which the page's `style-src 'self'` allows.
		const points = await list.evaluate(async (element) => {
			const long = 'This project cannot open now. '.repeat(12);
			(element as unknown as { failure: string }).failure = long;
			const root = element.shadowRoot as ShadowRoot;
			const dialog = root.querySelector('dialog') as HTMLDialogElement;
			dialog.style.setProperty('border-inline-end', '12px solid gray', 'important');
			await new Promise(requestAnimationFrame);
			const box = dialog.getBoundingClientRect();
			const seen: boolean[] = [];
			(window as unknown as { seen: boolean[] }).seen = seen;
			document.addEventListener('mousedown', (event) => seen.push(event.defaultPrevented));
			return {
				scrolls: dialog.scrollHeight > dialog.clientHeight,
				border: box.width - dialog.clientWidth - dialog.clientLeft,
				outside: { x: box.right - 4, y: box.top + box.height / 2 },
				padding: { x: box.left + dialog.clientLeft + 2, y: box.top + dialog.clientTop + 2 },
			};
		});
		expect(points.scrolls).toBe(true);
		expect(points.border).toBeGreaterThanOrEqual(12);
		for (const point of [points.outside, points.padding]) {
			await page.mouse.move(point.x, point.y);
			await page.mouse.down();
			await page.mouse.up();
		}
		expect(await page.evaluate(() => (window as unknown as { seen: boolean[] }).seen)).toEqual([
			false,
			true,
		]);
		await opened.context.close();
	});

	it('P2-E3: a choice refused after an expired session moved the scope reads its rows again (N6)', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await restrictedAtlas(page);
		await kernelCall(page, 'project-create', {
			name: 'Citadel',
			access: { mode: 'restricted', members: ['mock-user-person@example.com'] },
		});
		const switcher = page.locator('loam-rail loam-project-switcher button');
		await switcher.click();
		const list = page.locator('loam-rail loam-project-list');
		await expect.poll(() => texts(list.locator('violet-option'))).toContain('Citadel');
		// The session expires while it is open: the choice's own call leaves Atlas, then is refused.
		await expire(page);
		await list.locator('violet-option', { hasText: 'Citadel' }).click();
		await expect
			.poll(() => list.locator('p.failure').textContent())
			.toContain('No project with that name');
		expect(await switcher.getAttribute('aria-expanded')).toBe('true');
		// Its rows are the workspace's now: neither restricted project, and no project the active one.
		await expect.poll(() => texts(list.locator('violet-option'))).not.toContain('Citadel');
		expect(await texts(list.locator('violet-option'))).not.toContain('Atlas');
		expect(
			await list.evaluate((element) => (element as unknown as { active: string }).active)
		).toBe('~none');
		await opened.context.close();
	});

	it("P2-E12: the project item keeps 4.5:1 in every theme and state, and leaving an app it focuses main's h1 (A4, N5a, R4)", async () => {
		const opened = await withProjects();
		const { page } = opened;
		await scopeTo(page, 'atlas');
		await openApp(page, 'hello');
		const home = page.locator('loam-statusbar .project-home');
		const away = async () => page.mouse.move(2, 2);
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			await kernelCall(page, 'appearance-set', { theme });
			await settle(page);
			const states: Record<string, () => Promise<unknown>> = {
				rest: away,
				hover: () => home.hover(),
				'active, hovered': async () => {
					await home.hover();
					await page.mouse.down();
				},
				// Pressed, then the pointer moved off: `:active` stays, `:hover` goes.
				'active, not hovered': async () => {
					await home.hover();
					await page.mouse.down();
					await away();
				},
			};
			for (const [state, enter] of Object.entries(states)) {
				await enter();
				const measured = await measureHome(home);
				const where = `${theme}, ${state}`;
				if (state.startsWith('active')) {
					expect(measured.active, where).toBe(true);
					expect(measured.hover, where).toBe(!state.includes('not'));
				}
				expect(measured.value, where).toBeGreaterThanOrEqual(4.5);
				expect(measured.label, where).toBeGreaterThanOrEqual(4.5);
				if (state.startsWith('active')) {
					// Released away from it, so no click lands.
					await away();
					await page.mouse.up();
				}
			}
		}
		await kernelCall(page, 'appearance-set', { theme: 'light' });
		await settle(page);
		await away();
		await home.click();
		await expect.poll(async () => (await stateOf(page)).active).toBeNull();
		await expect.poll(async () => (await focused(page)).tag).toBe('h1');
		await opened.context.close();
	});

	it('P2-E12: under forced colours the project item keeps its text and a visible ring, focused and hovered (R2, R4)', async () => {
		const opened = await openShell(browser, site.root, { forcedColors: 'active' });
		const { page } = opened;
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await scopeTo(page, 'atlas');
		const home = page.locator('loam-statusbar .project-home');
		await page.mouse.move(2, 2);
		// At rest it is a button on ButtonFace, as loam-status-action is, not the bar's Canvas.
		const rest = await home.evaluate((button) => {
			const probe = document.createElement('span');
			probe.style.background = 'ButtonFace';
			button.after(probe);
			const face = getComputedStyle(probe).backgroundColor;
			probe.remove();
			return { face, own: getComputedStyle(button).backgroundColor };
		});
		expect(rest.own).toBe(rest.face);
		await home.focus();
		for (const state of ['focused', 'focused, hovered', 'focused, hovered, active'] as const) {
			if (state !== 'focused') await home.hover();
			if (state.endsWith('active')) await page.mouse.down();
			const measured = await measureHome(home);
			expect(measured.focusVisible, state).toBe(true);
			expect(measured.value, state).toBeGreaterThanOrEqual(4.5);
			// The ring against what it is drawn over, inside the button: 3:1 for a non-text indicator.
			expect(measured.outline, state).toBeGreaterThanOrEqual(3);
		}
		await page.mouse.move(2, 2);
		await page.mouse.up();
		await opened.context.close();
	});

	it('P2-E12: a one-letter project keeps the project item at 24 × 24, its name centred (R1, R4)', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await kernelCall(page, 'project-create', { name: 'Q' });
		await scopeTo(page, 'q');
		const measured = await measureHome(page.locator('loam-statusbar .project-home'));
		expect(measured.width).toBeGreaterThanOrEqual(24);
		expect(measured.height).toBeGreaterThanOrEqual(24);
		expect(Math.abs(measured.offsetX)).toBeLessThanOrEqual(1);
		expect(Math.abs(measured.offsetY)).toBeLessThanOrEqual(1);
		await opened.context.close();
	});

	it('a long project name ends in an ellipsis in the status bar, and the item keeps the whole name (#866)', async () => {
		// The narrowest width with a status bar: below 640 the layout is compact and hides it.
		const opened = await openShell(browser, site.root, { viewport: { width: 640, height: 480 } });
		const { page } = opened;
		// 80 characters, the most a name may have (records.ts), and wide ones.
		const name = 'Quarterly Planning Workshop for the Northern Market, Warehouses and Many Members';
		expect(await kernelCall(page, 'project-create', { name, slug: 'quarterly' })).toMatchObject({
			success: true,
		});
		await scopeTo(page, 'quarterly');
		const home = page.locator('loam-statusbar .project-home');
		await expect.poll(() => home.textContent()).toContain(name);
		const shown = await home.evaluate((button) => {
			const bar = (button.getRootNode() as ShadowRoot).querySelector('loam-statusbar') as Element;
			const journal = bar.querySelector('.journal-status') as Element;
			const style = getComputedStyle(button);
			return {
				truncated: button.scrollWidth > button.clientWidth,
				textOverflow: style.textOverflow,
				whiteSpace: style.whiteSpace,
				width: button.getBoundingClientRect().width,
				barEnd: bar.getBoundingClientRect().right,
				journalStart: journal.getBoundingClientRect().left,
				journalEnd: journal.getBoundingClientRect().right,
				itemEnd: (button.closest('loam-status-item') as Element).getBoundingClientRect().right,
			};
		});
		expect(shown.truncated).toBe(true);
		expect(shown.textOverflow).toBe('ellipsis');
		expect(shown.whiteSpace).toBe('nowrap');
		expect(shown.width).toBeGreaterThanOrEqual(24);
		// The project item gives way, and the journal's item at the end stays whole, inside the bar.
		expect(shown.itemEnd).toBeLessThanOrEqual(shown.journalStart + 0.5);
		expect(shown.journalEnd).toBeLessThanOrEqual(shown.barEnd + 0.5);
		expect(await home.getAttribute('aria-label')).toBe(`Project: ${name}, home`);
		await opened.context.close();
	});

	it('a long workspace name and account end in an ellipsis too, the labels and the journal whole (#1014)', async () => {
		const opened = await openShell(browser, site.root, { viewport: { width: 640, height: 480 } });
		const { page } = opened;
		const workspace = 'Northern Region Operations and Planning Workspace for Partners';
		const account = 'quarterly.planning.coordinator@northern-region.example.org';
		// Set on the shell directly, once boot's session read is done so none resets them: what is
		// measured is the bar's layout, not how the names arrive.
		await settle(page);
		await page.locator('loam-shell').evaluate((shell, names) => Object.assign(shell, names), {
			workspaceName: workspace,
			account,
		});
		const bar = page.locator('loam-statusbar');
		await expect.poll(() => bar.locator('.actor-status').textContent()).toContain(account);
		const shown = await bar.evaluate((element) => {
			// overflow: hidden, nowrap and a block box are what make Chromium paint the ellipsis.
			const box = (selector: string) => element.querySelector(selector)?.getBoundingClientRect();
			const item = (selector: string) => {
				const host = element.querySelector(selector) as Element;
				const root = host.shadowRoot as ShadowRoot;
				const value = root.querySelector('.value') as HTMLElement;
				const label = root.querySelector('.label') as HTMLElement;
				return {
					truncated: value.scrollWidth > value.clientWidth,
					textOverflow: getComputedStyle(value).textOverflow,
					labelWhole: label.hidden || label.scrollWidth <= label.clientWidth + 0.5,
					end: host.getBoundingClientRect().right,
				};
			};
			return {
				workspace: item('.workspace-status'),
				actor: item('.actor-status'),
				barEnd: element.getBoundingClientRect().right,
				journalStart: box('.journal-status')?.left ?? 0,
				journalEnd: box('.journal-status')?.right ?? 0,
			};
		});
		for (const [which, item] of Object.entries({
			workspace: shown.workspace,
			actor: shown.actor,
		})) {
			expect(item.truncated, which).toBe(true);
			expect(item.textOverflow, which).toBe('ellipsis');
			expect(item.labelWhole, which).toBe(true);
			expect(item.end, which).toBeLessThanOrEqual(shown.journalStart + 0.5);
		}
		expect(shown.journalEnd).toBeLessThanOrEqual(shown.barEnd + 0.5);
		// The whole text stays in the item, for assistive technology.
		expect(await bar.locator('.workspace-status').textContent()).toContain(workspace);
		expect(await bar.locator('.actor-status').textContent()).toContain(account);
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

/**
 * The status bar's project button, measured: its text and its label against what they sit on, its ring
 * against its own background, its size, how far its text's centre is from its own, and its states.
 */
function measureHome(home: ReturnType<Page['locator']>) {
	return home.evaluate((button) => {
		const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
		const luminance = ([r = 0, g = 0, b = 0]: number[]) => {
			const channel = (c: number) => {
				const v = c / 255;
				return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
			};
			return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
		};
		const over = (top: number[], under: number[]) => {
			const alpha = top[3] ?? 1;
			return [0, 1, 2].map((i) => (top[i] ?? 0) * alpha + (under[i] ?? 0) * (1 - alpha));
		};
		const ratio = (a: number[], b: number[]) => {
			const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
			return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
		};
		const item = button.parentElement as HTMLElement;
		const bar = rgb(getComputedStyle(item.closest('loam-statusbar') as Element).backgroundColor);
		const style = getComputedStyle(button);
		const background = over(rgb(style.backgroundColor), bar);
		const label = item.shadowRoot?.querySelector('.label') as Element;
		const range = document.createRange();
		range.selectNodeContents(button);
		const text = range.getBoundingClientRect();
		const own = button.getBoundingClientRect();
		return {
			value: ratio(rgb(style.color), background),
			label: ratio(rgb(getComputedStyle(label).color), bar),
			outline: ratio(rgb(style.outlineColor), background),
			width: own.width,
			height: own.height,
			offsetX: text.x + text.width / 2 - (own.x + own.width / 2),
			offsetY: text.y + text.height / 2 - (own.y + own.height / 2),
			hover: button.matches(':hover'),
			active: button.matches(':active'),
			focusVisible: button.matches(':focus-visible'),
		};
	});
}

/**
 * `scope-set { project: 'atlas', app: 'tasks' }` with Atlas already active: its event carries `mainChanged`
 * and no `scopeChanged` (M1). Resolves once tasks' main is in, with the call's result.
 */
async function combinedOpen(page: Page): Promise<{ undoCommand?: string; undoArgs?: unknown }> {
	const result = (await kernelCall(page, 'scope-set', { project: 'atlas', app: 'tasks' })) as {
		success: boolean;
		undoCommand?: string;
		undoArgs?: unknown;
	};
	expect(result.success).toBe(true);
	await surfacesIdle(page);
	await page.locator('tasks-main').waitFor();
	return result;
}

/** Signed in, Atlas restricted to the person, entered, with `apps` opened in it in turn. */
async function restrictedAtlas(page: Page, ...apps: string[]): Promise<void> {
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
	for (const app of apps) await openApp(page, app);
}

/** The Mock's session expires, with no command: the next call moves the scope (3.4). */
const expire = (page: Page) => page.clock.setFixedTime(Date.now() + 2 * 3600_000);

describe('P2-E3: a change of scope a call did not ask for (7.6, 3.4)', () => {
	it('P2-E3: makes a kept app again when the call that moved the scope is a refused app-open (N1)', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await restrictedAtlas(page, 'hello');
		await mark(page, 'hello-main');
		await expire(page);
		// A press of tasks, project-only: the middleware leaves Atlas, keeping hello, then refuses the open.
		await entry(page, 'tasks').locator('button').click();
		await surfacesIdle(page);
		const refused = (await journal(page)).filter(({ command }) => command === 'app-open').at(-1);
		expect(refused?.error?.code).toBe('SCOPE_PROJECT_REQUIRED');
		await page.locator('hello-main').waitFor();
		expect(await marked(page, 'hello-main')).toBe(false);
		expect(
			await page.locator('hello-main').evaluate((element) => (element as { scope?: unknown }).scope)
		).toEqual({ workspace: 'personal' });
		await opened.context.close();
	});

	it('P2-E3: makes a kept app again when that call is an app-instance-refresh, and its cancelled modal goes (N1, F1)', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await restrictedAtlas(page, 'hello');
		await mark(page, 'hello-main');
		void kernelCall(page, 'modal-open', { title: 'Sure?', body: 'Say so.' });
		const dialog = page.locator('loam-modal dialog');
		await expect
			.poll(() => dialog.evaluate((element) => (element as HTMLDialogElement).open))
			.toBe(true);
		await expire(page);
		// The refresh moves the scope, which cancels the shell's modal: it must go as the app is made again.
		await kernelCall(page, 'app-instance-refresh', { instance: 'hello' });
		await surfacesIdle(page);
		await page.locator('hello-main').waitFor();
		expect(await marked(page, 'hello-main')).toBe(false);
		await expect.poll(() => page.locator('loam-modal dialog[open]').count()).toBe(0);
		await opened.context.close();
	});

	it('P2-E3: reads the overlays again after a failed call moved the scope, so a cancelled modal goes (N2)', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await restrictedAtlas(page, 'hello');
		void kernelCall(page, 'modal-open', { title: 'Sure?', body: 'Say so.' });
		const dialog = page.locator('loam-modal dialog');
		await expect
			.poll(() => dialog.evaluate((element) => (element as HTMLDialogElement).open))
			.toBe(true);
		await expire(page);
		// Its dismiss is the call that moves the scope, which cancels the shell's modal first, so the
		// dismiss itself is refused: the modal must go all the same.
		await page.locator('loam-modal button.cancel').click();
		await surfacesIdle(page);
		await expect.poll(() => page.locator('loam-modal dialog[open]').count()).toBe(0);
		await opened.context.close();
	});

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

	it('P2-E8: a deep link to it in a project it does not list switches nothing, and shows "Nothing here" (N4)', async () => {
		// A server that never answers, so the instance stays `loading`, which the chrome lets through: only
		// the kernel knows it does not list Beacon.
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
					'projects = ["atlas"]',
				].join('\n')
			),
		});
		const opened = await openShell(browser, mounted.root);
		const { page } = opened;
		for (const name of ['Atlas', 'Beacon']) await kernelCall(page, 'project-create', { name });
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { flush(): Promise<void> };
			};
			await shell.kernel.flush();
		});
		await page.goto(`${mounted.root}personal/p/beacon/work`);
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				ready: Promise<void>;
				kernel: { appsReady: Promise<void> };
			};
			await shell.ready;
			await shell.kernel.appsReady;
		});
		await settle(page);
		await expect.poll(() => page.locator('loam-main').getAttribute('route')).toBe('not-found');
		expect((await stateOf(page)).scope.project).toBeUndefined();
		const sets = (await journal(page)).filter(({ command }) => command === 'scope-set');
		expect(
			sets.find(
				({ input, success }) => success && (input as { project?: unknown }).project !== null
			)
		).toBeUndefined();
		expect(sets.at(-2)).toMatchObject({ input: { app: 'work' }, success: false });
		expect(sets.at(-2)?.error?.code).toBe('SCOPE_PROJECT_REQUIRED');
		await opened.context.close();
		await mounted.close();
		silent.closeAllConnections();
		silent.close();
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
