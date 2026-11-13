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

	it('P3-E2: the emphasized mark is not color alone: forced colors draw it in a system color, and its description says so', async () => {
		const shell = await openShell(browser, site.root);
		opened.push(shell);
		const { page } = shell;
		const made = (await kernelCall(page, 'persona-create', {
			title: 'Greeter',
			emphasis: { apps: ['hello'] },
		})) as { data: { id: string } };
		await kernelCall(page, 'persona-set', { persona: made.data.id });
		await settle(page);
		await surfacesIdle(page);
		const mark = () =>
			page.evaluate(() => {
				const entry = document
					.querySelector('loam-shell')
					?.shadowRoot?.querySelector('loam-rail')
					?.shadowRoot?.querySelector('loam-app-entry[instance="hello"]');
				const icon = entry?.shadowRoot?.querySelector('.icon') as Element;
				const style = getComputedStyle(icon, '::after');
				const button = entry?.shadowRoot?.querySelector('button');
				const described = button?.getAttribute('aria-describedby');
				return {
					emphasized: entry?.hasAttribute('emphasized'),
					width: Number.parseFloat(style.width),
					background: style.backgroundColor,
					description: described ? entry?.shadowRoot?.getElementById(described)?.textContent : null,
				};
			});
		const seen = await mark();
		expect(seen.emphasized).toBe(true);
		expect(seen.width).toBeGreaterThan(0);
		expect(seen.description).toBe('Emphasized by your persona');
		await page.emulateMedia({ forcedColors: 'active' });
		const forced = await mark();
		expect(forced.width).toBeGreaterThan(0);
		expect(forced.background).not.toBe('rgba(0, 0, 0, 0)');
		await page.emulateMedia({ forcedColors: 'none' });
		expect(await axe(page)).toEqual([]);
	});
});
