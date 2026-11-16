/**
 * E2 in Chromium (phase 3 specification, 6.2, 6.3, 14 and 18): `persona-set` reorders and marks hello and tasks in
 * the rail, ranks their commands first in the palette, applies the persona's density, announces the switch, and
 * moves no scope. A `local` deployment: persona is in both modes, and needs no provider. The account menu's switch,
 * which only a `provider` deployment shows, is `sign-in.test.ts`'s.
 */

import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	axe,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
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
const opened: ShellPage[] = [];

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
	await Promise.all(opened.splice(0).map((page) => page.context.close()));
	await site?.close();
	await browser?.close();
});

/** The rail's top band, in order: its app entries' instances and whether each is emphasized. */
const topBand = (page: Page) =>
	page.evaluate(() => {
		const rail = document
			.querySelector('loam-shell')
			?.shadowRoot?.querySelector('loam-rail')?.shadowRoot;
		return [...(rail?.querySelectorAll('.top loam-app-entry') ?? [])].map((entry) => ({
			instance: entry.getAttribute('instance') as string,
			emphasized: entry.hasAttribute('emphasized'),
		}));
	});

const announcement = (page: Page) =>
	page.evaluate(
		() =>
			document.querySelector('loam-shell')?.shadowRoot?.querySelector('.announce')?.textContent ??
			''
	);

const scopeOf = (page: Page) =>
	page.evaluate(async () =>
		(
			document.querySelector('loam-shell') as unknown as {
				readState(): Promise<{ scope: unknown; section: string | null; active: string | null }>;
			}
		).readState()
	);

const search = async (page: Page, query: string) =>
	(
		(await kernelCall(page, 'palette-search', { query, limit: 50 })) as {
			data: { items: { name: string }[] };
		}
	).data.items.map((item) => item.name);

describe('P3-E2: persona changes emphasis, never what anyone may do', () => {
	it('P3-E2: persona-set reorders and marks hello and tasks, ranks their commands first, applies density, announces it, and moves no scope', async () => {
		const shell = await openShell(browser, site.root);
		opened.push(shell);
		const { page } = shell;
		expect(await kernelCall(page, 'project-create', { name: 'Atlas' })).toMatchObject({
			success: true,
		});
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await openApp(page, 'tasks');
		await settle(page);
		const before = await topBand(page);
		const apps = before
			.map((entry) => entry.instance)
			.filter((id) => id === 'hello' || id === 'tasks');
		expect(apps.sort()).toEqual(['hello', 'tasks']);
		expect(before.some((entry) => entry.emphasized)).toBe(false);
		// The reverse of their order now, so the switch must move them.
		const emphasis = before
			.map((entry) => entry.instance)
			.filter((id) => id === 'hello' || id === 'tasks')
			.reverse();
		const plain = await search(page, 'list');
		expect(plain[0]?.startsWith('tasks-')).toBe(false);
		const scope = await scopeOf(page);
		const made = (await kernelCall(page, 'persona-create', {
			title: 'Reviewer',
			defaults: { density: 'compact' },
			emphasis: { apps: emphasis },
		})) as { success: boolean; data: { id: string } };
		expect(made.success).toBe(true);

		const set = await kernelCall(page, 'persona-set', { persona: made.data.id });
		expect(set).toMatchObject({
			success: true,
			data: { persona: made.data.id, previous: 'default' },
		});
		await page.waitForFunction(
			() =>
				document.querySelector('loam-shell')?.shadowRoot?.querySelector('.announce')
					?.textContent === 'Persona: Reviewer'
		);
		await settle(page);
		// Reordered and marked, first in their band; nothing hidden.
		const after = await topBand(page);
		expect(after.slice(0, 2)).toEqual(emphasis.map((instance) => ({ instance, emphasized: true })));
		expect(after.map((entry) => entry.instance).sort()).toEqual(
			before.map((entry) => entry.instance).sort()
		);
		expect(after.slice(2).some((entry) => entry.emphasized)).toBe(false);
		// Their commands first; the same commands.
		const ranked = await search(page, 'list');
		expect([...ranked].sort()).toEqual([...plain].sort());
		expect(ranked[0]?.startsWith('tasks-')).toBe(true);
		// The persona's density, through appearance-set's code.
		expect(
			await page.evaluate(() => document.documentElement.getAttribute('data-loam-density'))
		).toBe('compact');
		expect(await announcement(page)).toBe('Persona: Reviewer');
		// A switch never moves the person.
		expect(await scopeOf(page)).toEqual(scope);
		// The journal names the persona on the entries after the switch, as the `persona` context field.
		const entries = await journal(page);
		const switched = entries.find((entry) => entry.command === 'persona-set') as { seq: number };
		const later = entries.filter((entry) => entry.seq > switched.seq);
		expect(later.length).toBeGreaterThan(0);
		for (const entry of later) expect(entry.context?.persona, entry.command).toBe(made.data.id);
	});

	it("P3-E2: the emphasized mark is not color alone: in forced colors it takes the entry's own system color, resting, hovered and dimmed, and the description says so", async () => {
		const shell = await openShell(browser, site.root);
		opened.push(shell);
		const { page } = shell;
		// No project: tasks, a project-only app, is dimmed; hello is not.
		const made = (await kernelCall(page, 'persona-create', {
			title: 'Greeter',
			emphasis: { apps: ['hello', 'tasks'] },
		})) as { data: { id: string } };
		await kernelCall(page, 'persona-set', { persona: made.data.id });
		await settle(page);
		await surfacesIdle(page);
		const mark = (instance: string) =>
			page.evaluate((instance) => {
				const entry = document
					.querySelector('loam-shell')
					?.shadowRoot?.querySelector('loam-rail')
					?.shadowRoot?.querySelector(`loam-app-entry[instance="${instance}"]`);
				const icon = entry?.shadowRoot?.querySelector('.icon') as Element;
				const style = getComputedStyle(icon, '::after');
				const button = entry?.shadowRoot?.querySelector('button') as HTMLElement;
				const described = button.getAttribute('aria-describedby') ?? '';
				return {
					emphasized: entry?.hasAttribute('emphasized'),
					dimmed: button.getAttribute('aria-disabled') === 'true',
					width: Number.parseFloat(style.width),
					background: style.backgroundColor,
					color: getComputedStyle(button).color,
					description: described
						.split(' ')
						.filter(Boolean)
						.map((id) => entry?.shadowRoot?.getElementById(id)?.textContent?.trim())
						.join(' '),
				};
			}, instance);
		const hello = await mark('hello');
		expect(hello).toMatchObject({ emphasized: true, dimmed: false });
		expect(hello.width).toBeGreaterThan(0);
		expect(hello.description).toBe('Emphasized by your persona');
		// Dimmed and emphasized: both are said, why first.
		const tasks = await mark('tasks');
		expect(tasks).toMatchObject({ emphasized: true, dimmed: true });
		expect(tasks.description).toBe('Choose a project to open Tasks Emphasized by your persona');
		// Under axe with both entries emphasized and one dimmed, before forced colors, whose switch back transitions.
		expect(await axe(page)).toEqual([]);
		await page.emulateMedia({ forcedColors: 'active' });
		// What each system color resolves to in this page, read raw.
		const system = (name: string) =>
			page.evaluate((name) => {
				const probe = document.createElement('span');
				probe.style.setProperty('forced-color-adjust', 'none');
				probe.style.setProperty('background-color', name);
				document.body.append(probe);
				const color = getComputedStyle(probe).backgroundColor;
				probe.remove();
				return color;
			}, name);
		const [buttonText, highlightText, grayText] = [
			await system('ButtonText'),
			await system('HighlightText'),
			await system('GrayText'),
		];
		// The mark is in the entry's own system color in each state, as its forced-colors rules draw the entry.
		const resting = await mark('hello');
		expect(resting.width).toBeGreaterThan(0);
		expect(resting.background).toBe(buttonText);
		expect((await mark('tasks')).background).toBe(grayText);
		await page.locator('loam-rail loam-app-entry[instance="hello"] button').hover();
		expect((await mark('hello')).background).toBe(highlightText);
		expect(new Set([buttonText, highlightText, grayText]).size).toBe(3);
		await page.mouse.move(640, 500);
		await page.emulateMedia({ forcedColors: 'none' });
	});

	it("P3-E2: a change of person never shows the leaving person's persona in the title bar or the rail", async () => {
		const shell = await openShell(browser, site.root);
		opened.push(shell);
		const { page } = shell;
		await kernelCall(page, 'auth-sign-in', {
			method: 'credentials',
			email: 'bea@example.com',
			password: 'x',
		});
		const made = (await kernelCall(page, 'persona-create', {
			title: 'Reviewer',
			emphasis: { apps: ['hello'] },
		})) as { data: { id: string } };
		await kernelCall(page, 'persona-set', { persona: made.data.id });
		await settle(page);
		await page.waitForFunction(() =>
			document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-titlebar')
				?.shadowRoot?.textContent?.includes('Reviewer')
		);
		// From the moment the change of person is heard, every frame: neither Bea's title nor her emphasis.
		await page.evaluate(() => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: {
					subscribe(listener: (event: { command: string; success: boolean }) => void): void;
				};
				shadowRoot: ShadowRoot;
			};
			const seen: string[] = [];
			(window as unknown as { seen: string[] }).seen = seen;
			// The next person's persona answers late, as it does in `provider` mode behind the membership read after a
			// sign-in (4.4): the window in which the last person's could still show.
			const kernel = shell.kernel as unknown as {
				call(name: string, ...rest: unknown[]): Promise<unknown>;
			};
			const call = kernel.call.bind(kernel);
			kernel.call = async (name: string, ...rest: unknown[]) => {
				if (name === 'persona-list') await new Promise((resolve) => setTimeout(resolve, 400));
				return call(name, ...rest);
			};
			let heard = false;
			let frames = 0;
			shell.kernel.subscribe((event) => {
				if (event.command === 'auth-sign-in' && event.success) heard = true;
			});
			const until = performance.now() + 3_000;
			// From the frame after the change is heard: the event's own frame paints after the shell's updates.
			const look = () => {
				if (heard && frames++ > 0) {
					const bar =
						shell.shadowRoot.querySelector('loam-titlebar')?.shadowRoot?.textContent ?? '';
					if (bar.includes('Reviewer')) seen.push('title');
					const rail = shell.shadowRoot.querySelector('loam-rail')?.shadowRoot;
					if (rail?.querySelector('loam-app-entry[emphasized]')) seen.push('emphasis');
				}
				if (performance.now() < until) requestAnimationFrame(look);
			};
			requestAnimationFrame(look);
		});
		await kernelCall(page, 'auth-sign-in', {
			method: 'credentials',
			email: 'olu@example.com',
			password: 'x',
		});
		await settle(page);
		await page.waitForTimeout(500);
		expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen)).toEqual([]);
		// Olu has no persona: the title bar names Olu alone.
		const bar = await page.evaluate(
			() =>
				document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-titlebar')?.shadowRoot
					?.textContent ?? ''
		);
		expect(bar).not.toContain('Reviewer');
	});
});
