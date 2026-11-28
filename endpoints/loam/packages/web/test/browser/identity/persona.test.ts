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
		// The palette ranks the active app's commands first, before the persona (phase 4's A-P1-1): the searches are made
		// with no app active, so the persona's order alone decides between hello's and tasks'.
		await kernelCall(page, 'section-open', { section: 'projects' });
		await settle(page);
		const plain = await search(page, 'list');
		const emphasized = (name: string | undefined) =>
			emphasis.some((instance) => name?.startsWith(`${instance}-`));
		expect(emphasized(plain[0])).toBe(false);
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
		// Both apps' commands are listed (A-P0-1): theirs come first, hello's `hello-list` and tasks' `tasks-list`, which
		// score the same, in either order.
		expect(emphasized(ranked[0])).toBe(true);
		expect(emphasized(ranked[1])).toBe(true);
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

	it("P3-E2: the account section's personas tab makes, switches to, edits and removes a persona, each a command, and the active one is said in words", async () => {
		const shell = await openShell(browser, site.root);
		opened.push(shell);
		const { page } = shell;
		const section = page.locator('loam-shell').locator('loam-main loam-account-section');
		const opening = (await kernelCall(page, 'section-open', {
			section: 'account',
			path: 'personas',
		})) as { success: boolean };
		expect(opening.success).toBe(true);
		await expect.poll(() => section.getByRole('tab', { name: 'Personas' }).count()).toBe(1);
		expect(await section.getByRole('tab', { name: 'Personas' }).getAttribute('aria-selected')).toBe(
			'true'
		);
		expect(new URL(page.url()).pathname).toBe('/personal/~/account/personas');
		const table = section.getByRole('table', { name: 'Your personas' });
		await expect.poll(() => table.count()).toBe(1);
		// `default` first, in use, with nothing to edit or remove.
		const plain = table.getByRole('row', { name: /^Default/ });
		expect(await plain.getByRole('cell', { name: 'In use' }).count()).toBe(1);
		expect(await plain.getByRole('button').count()).toBe(0);
		// Made from the form.
		const form = section.getByRole('form', { name: 'Make a persona' });
		await form.getByLabel('Title').fill('Reviewer');
		await form.getByLabel('Name others see (optional)').fill('Bea R.');
		await form.getByLabel('Pronouns (optional)').fill('she/her');
		await form.getByRole('button', { name: 'Make persona' }).click();
		const row = table.getByRole('row', { name: /^Reviewer/ });
		await expect.poll(() => row.count()).toBe(1);
		expect(await row.getByRole('cell', { name: 'Bea R. (she/her)' }).count()).toBe(1);
		const listed = (await kernelCall(page, 'persona-list')) as {
			data: { personas: { id: string; title: string }[]; active: string };
		};
		const made = listed.data.personas.find((persona) => persona.title === 'Reviewer') as {
			id: string;
		};
		expect(listed.data.active).toBe('default');
		// Switched to: the shell announces it, and the tab says which is in use.
		await row.getByRole('button', { name: 'Use Reviewer' }).click();
		await expect.poll(() => announcement(page)).toBe('Persona: Reviewer');
		await expect.poll(() => row.getByRole('cell', { name: 'In use' }).count()).toBe(1);
		expect(await plain.getByRole('cell', { name: 'In use' }).count()).toBe(0);
		expect(await row.getByRole('button', { name: 'Use Reviewer' }).count()).toBe(0);
		// Edited: the title and how others see it.
		await row.getByRole('button', { name: 'Edit Reviewer' }).click();
		const edit = section.getByRole('form', { name: 'Edit Reviewer' });
		await edit.getByLabel('Title').fill('Editor');
		await edit.getByLabel('Pronouns (optional)').fill('');
		await edit.getByRole('button', { name: 'Save persona' }).click();
		const edited = table.getByRole('row', { name: /^Editor/ });
		await expect.poll(() => edited.count()).toBe(1);
		expect(await edited.getByRole('cell', { name: 'Bea R.', exact: true }).count()).toBe(1);
		expect(await axe(page)).toEqual([]);
		// Removed after the modal says what follows: the active one, so `default` is in use again.
		await edited.getByRole('button', { name: 'Remove Editor' }).click();
		const dialog = section.getByRole('dialog', { name: 'Remove Editor?' });
		await expect.poll(() => dialog.count()).toBe(1);
		expect(await dialog.textContent()).toContain('you go back to Default');
		await dialog.getByRole('button', { name: 'Remove persona' }).click();
		await expect.poll(() => edited.count()).toBe(0);
		await expect.poll(() => plain.getByRole('cell', { name: 'In use' }).count()).toBe(1);
		const after = (await kernelCall(page, 'persona-list')) as {
			data: { personas: { id: string }[]; active: string };
		};
		expect(after.data.active).toBe('default');
		expect(after.data.personas.map((persona) => persona.id)).not.toContain(made.id);
		// Each change was the command it names, journaled as any other.
		const commands = (await journal(page)).map((entry) => entry.command);
		for (const name of ['persona-create', 'persona-set', 'persona-update', 'persona-remove'])
			expect(commands, name).toContain(name);
	});

	it("P3-E2: the personas tab's edit keeps what its form does not show, and a switch made elsewhere shows in the open tab", async () => {
		const shell = await openShell(browser, site.root);
		opened.push(shell);
		const { page } = shell;
		const section = page.locator('loam-shell').locator('loam-main loam-account-section');
		const made = (await kernelCall(page, 'persona-create', {
			title: 'Focus',
			presentation: { name: 'Bea F.', avatar: 'system/calendar' },
			defaults: { density: 'compact' },
			emphasis: { sections: ['projects'] },
		})) as { data: { id: string } };
		await kernelCall(page, 'section-open', { section: 'account', path: 'personas' });
		const table = section.getByRole('table', { name: 'Your personas' });
		const row = table.getByRole('row', { name: /^Focus/ });
		await expect.poll(() => row.count()).toBe(1);
		expect(await row.getByRole('cell', { name: 'Bea F. with an avatar' }).count()).toBe(1);
		// A switch made elsewhere in the page (the account menu's, here its command) shows in the open tab.
		await kernelCall(page, 'persona-set', { persona: made.data.id });
		await expect.poll(() => row.getByRole('cell', { name: 'In use' }).count()).toBe(1);
		// Cancel closes the editor and gives focus back to its Edit button.
		await row.getByRole('button', { name: 'Edit Focus' }).click();
		const edit = section.getByRole('form', { name: 'Edit Focus' });
		await edit.getByRole('button', { name: 'Cancel' }).click();
		await expect.poll(() => edit.count()).toBe(0);
		expect((await focused(page)).label).toBe('Edit Focus');
		// A title of spaces alone is refused in words, before any command.
		await row.getByRole('button', { name: 'Edit Focus' }).click();
		await edit.getByLabel('Title').fill('   ');
		await edit.getByRole('button', { name: 'Save persona' }).click();
		await expect
			.poll(() => section.getByRole('status').textContent())
			.toBe('Give the persona a title.');
		// Saved with a new title: the avatar, defaults and emphasis it does not show are kept.
		await edit.getByLabel('Title').fill('Deep work');
		await edit.getByRole('button', { name: 'Save persona' }).click();
		await expect.poll(() => table.getByRole('row', { name: /^Deep work/ }).count()).toBe(1);
		const listed = (await kernelCall(page, 'persona-list')) as {
			data: {
				personas: {
					id: string;
					title: string;
					presentation: unknown;
					defaults: unknown;
					emphasis: unknown;
				}[];
			};
		};
		expect(listed.data.personas.find((persona) => persona.id === made.data.id)).toMatchObject({
			title: 'Deep work',
			presentation: { name: 'Bea F.', avatar: 'system/calendar' },
			defaults: { density: 'compact' },
			emphasis: { sections: ['projects'] },
		});
		// Focus is back on the row the change was made in.
		await expect.poll(async () => (await focused(page)).label).toBe('Deep work');
	});
});
