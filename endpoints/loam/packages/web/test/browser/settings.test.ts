/**
 * P4-E1 in Chromium (phase 4 specification, 3.5, 3.7, 3.8, 3.10 and 15): hello's `greeting` found from the palette and
 * changed in the settings section for one project, read back by hello through its `settings` grant, heard by its open
 * surface through `settingsChanged`, and reset; a project-only key hidden with no project; the section's tree, level
 * switcher and fields by keyboard and under axe in three themes; and the three custom editors, the rail honouring the
 * person's own order. The units of E1 (the codes, the hand-off's `details`, `writable`, `expected`) are the kernel's
 * `late/settings.test.ts` and `late/settings-shell.test.ts`.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appPack } from '@lushly-dev/loam-cli';
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
	serveDeployment,
	setTheme,
	settle,
} from './harness';

let browser: Browser;
let site: DeploymentSite;
beforeAll(async () => {
	site = await serveDeployment({
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello'), { order: 10 }),
			deploymentEntry('tally', await packApp('tally'), { order: 20 })
		),
	});
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
});

const section = (page: Page) => page.locator('loam-main loam-settings-section');
const greets = (page: Page) => page.locator('hello-main .greets').textContent();

/** A shell with Atlas made and active, its id. */
async function inAtlas(): Promise<{ page: Page; atlas: string }> {
	const { page } = await openShell(browser, site.origin);
	const made = (await kernelCall(page, 'project-create', { name: 'Atlas', slug: 'atlas' })) as {
		data: { id: string };
	};
	await kernelCall(page, 'scope-set', { project: made.data.id });
	await settle(page);
	return { page, atlas: made.data.id };
}

describe('P4-E1: an app’s setting, from the palette, scoped per project', () => {
	it("finds hello's greeting from the palette, sets it for Atlas, and hello reads it and hears it", async () => {
		const { page, atlas } = await inAtlas();
		await openApp(page, 'hello');
		await expect.poll(() => greets(page)).toBe('Greets with Hello, on the Guests board');

		// From the palette: the setting's row, named with its section and key, opens the section at the key.
		await page.keyboard.press('ControlOrMeta+K');
		await page.locator('loam-palette input').fill('greeting');
		await expect
			.poll(() => page.locator('loam-palette violet-option').first().getAttribute('data-command'))
			.toBe('hello.general.greeting');
		expect(
			await page
				.locator('loam-palette violet-option')
				.first()
				.locator('.result-description')
				.textContent()
		).toContain('Setting of Hello');
		await page.keyboard.press('Enter');
		await expect.poll(() => section(page).count()).toBe(1);
		await expect
			.poll(() => new URL(page.url()).pathname + new URL(page.url()).hash)
			.toMatch(/\/p\/atlas\/~\/settings\/hello\.general#greeting$/);
		const view = section(page);
		await expect
			.poll(() => view.locator('[role="treeitem"][aria-selected="true"]').textContent())
			.toBe('General');
		// The level switcher: the section's levels here, the project's chosen, as the narrowest.
		expect(await view.locator('[role="tab"]').allTextContents()).toEqual([
			'Workspace',
			'Project Atlas',
		]);
		expect(await view.locator('[role="tab"][aria-selected="true"]').textContent()).toBe(
			'Project Atlas'
		);
		expect(await view.locator('.field[data-target]').getAttribute('data-key')).toBe('greeting');
		expect(await view.locator('#from-greeting').textContent()).toBe('The default.');
		expect(
			await view.getByRole('button', { name: 'Reset Greeting' }).getAttribute('aria-disabled')
		).toBe('true');

		// Changed there, for Atlas alone.
		await view.locator('#field-greeting').fill('Hi Atlas');
		await view.locator('#field-greeting').press('Tab');
		await expect.poll(() => view.locator('.status').textContent()).toBe('Greeting is saved.');
		await expect
			.poll(() => view.locator('#from-greeting').textContent())
			.toMatch(/^Set for this project, by you, on .+\.$/);
		expect(
			await kernelCall(page, 'setting-get', { section: 'hello.general', key: 'greeting' })
		).toMatchObject({ data: { value: 'Hi Atlas', from: 'project' } });
		// The workspace keeps the default.
		await view.getByRole('tab', { name: 'Workspace' }).click();
		await expect.poll(() => view.locator('#field-greeting').inputValue()).toBe('Hello');

		// Hello reads it through its grant, and hears a change while it shows (`settingsChanged`, 3.8).
		await openApp(page, 'hello');
		await expect.poll(() => greets(page)).toBe('Greets with Hi Atlas, on the Guests board');
		await page.locator('hello-main violet-text-field input').fill('Ada');
		await page.locator('hello-main violet-button.greet').click();
		await expect
			.poll(() => page.locator('hello-main .greeting').textContent())
			.toBe('Hi Atlas, Ada!');
		await kernelCall(page, 'setting-set', {
			section: 'hello.general',
			key: 'greeting',
			value: 'Hey',
			level: 'project',
			expected: 'Hi Atlas',
		});
		await expect.poll(() => greets(page)).toBe('Greets with Hey, on the Guests board');

		// Reset in the section: Atlas reads the workspace's again, and hello hears it.
		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'hello.general.greeting',
		});
		await expect.poll(() => section(page).count()).toBe(1);
		await view.getByRole('tab', { name: 'Project Atlas' }).click();
		await expect.poll(() => view.locator('#field-greeting').inputValue()).toBe('Hey');
		await view.getByRole('button', { name: 'Reset Greeting' }).click();
		await expect.poll(() => view.locator('.status').textContent()).toBe('Greeting is reset.');
		await expect.poll(() => view.locator('#from-greeting').textContent()).toBe('The default.');
		expect(
			await kernelCall(page, 'setting-get', { section: 'hello.general', key: 'greeting' })
		).toMatchObject({ data: { value: 'Hello', from: 'default' } });
		expect(atlas).toMatch(/^prj_/);
		await page.close();
	});

	it('lists a project-only key only while a project is active, and its section says why it is empty', async () => {
		const { page } = await inAtlas();
		const search = async (query: string) => {
			await page.keyboard.press('ControlOrMeta+K');
			await page.locator('loam-palette input').fill(query);
			await settle(page);
			const rows = await page
				.locator('loam-palette violet-option')
				.evaluateAll((options) => options.map((option) => option.getAttribute('data-command')));
			await page.keyboard.press('Escape');
			return rows;
		};
		await expect.poll(() => search('board')).toContain('hello.project.board');
		await kernelCall(page, 'scope-set', { project: null });
		await settle(page);
		expect(await search('board')).not.toContain('hello.project.board');
		await kernelCall(page, 'section-open', { section: 'settings', target: 'hello.project' });
		await expect
			.poll(() => section(page).locator('.note').allTextContents())
			.toContain('These settings are a project’s: open a project to set them.');
		await page.close();
	});
});

describe('P4-E1: the settings section by keyboard, and under axe (15)', () => {
	it('P4-E13: P4-E1: moves through the tree and the level switcher, and passes axe in three themes', async () => {
		const { page } = await inAtlas();
		await kernelCall(page, 'section-open', { section: 'settings' });
		const view = section(page);
		await expect.poll(() => view.count()).toBe(1);
		// The heading takes focus as the section opens.
		await expect.poll(async () => (await focused(page)).tag).toBe('h1');
		// The tree: the shell's sections first, then each enabled app's; Appearance is shown first.
		const groups = await view
			.locator('[role="tree"] > [role="treeitem"] > .label')
			.allTextContents();
		expect(groups).toEqual(['Shell', 'Hello']);
		expect(
			await view
				.locator('[role="treeitem"][data-group="shell"] [role="treeitem"]')
				.allTextContents()
		).toEqual([
			'Appearance',
			'Rail',
			'Keybindings',
			'Autonomy',
			'Experiments',
			'Notifications',
			'Limits',
			'Documents',
		]);
		await view.locator('[role="treeitem"][aria-selected="true"]').focus();
		await page.keyboard.press('ArrowDown');
		expect((await focused(page)).label).toBe('Rail');
		await page.keyboard.press('Enter');
		await expect
			.poll(() => view.locator('[role="treeitem"][aria-selected="true"]').textContent())
			.toBe('Rail');
		// Focus stays on the tree's item as the section changes.
		expect((await focused(page)).role).toBe('treeitem');
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await expect
			.poll(() => view.locator('[role="treeitem"][aria-selected="true"]').textContent())
			.toBe('Project');
		// The level switcher's arrows choose a level.
		await kernelCall(page, 'section-open', { section: 'settings', target: 'hello.general' });
		// Wait for General to paint (Project also had a "Project Atlas" tab, alone).
		await expect.poll(() => view.locator('#settings-section-title').textContent()).toBe('General');
		await expect
			.poll(() => view.locator('[role="tab"][aria-selected="true"]').textContent())
			.toBe('Project Atlas');
		await view.locator('[role="tab"][aria-selected="true"]').focus();
		await page.keyboard.press('ArrowLeft');
		await expect
			.poll(() => view.locator('[role="tab"][aria-selected="true"]').textContent())
			.toBe('Workspace');
		expect((await focused(page)).role).toBe('tab');

		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			await setTheme(page, theme);
			for (const [target, title] of [
				['loam.appearance', 'Appearance'],
				['hello.general', 'General'],
				['loam.keybindings', 'Keybindings'],
			] as const) {
				expect(
					await kernelCall(page, 'section-open', { section: 'settings', target }),
					`${theme} ${target}`
				).toMatchObject({ success: true });
				// The intended section shows, its tree item selected and its heading in, before the scan.
				await expect
					.poll(() => view.locator('[role="treeitem"][aria-selected="true"]').textContent())
					.toBe(title);
				await expect.poll(() => view.locator('#settings-section-title').textContent()).toBe(title);
				await settle(page);
				expect(await axe(page), `${theme} ${target}`).toEqual([]);
			}
		}
		await page.close();
	});
});

describe("P4-E13: the settings section's roles and names (15)", () => {
	it('P4-E13: is a tree, a tab list of its levels ("You, everywhere", "Workspace", "Project <name>"), and a panel of labelled fields', async () => {
		const { page } = await inAtlas();
		const view = section(page);
		// A person's section: one level, "You, everywhere".
		await kernelCall(page, 'section-open', { section: 'settings', target: 'loam.appearance' });
		await expect.poll(() => view.getByRole('tree', { name: 'Settings sections' }).count()).toBe(1);
		const people = view.getByRole('tablist', { name: 'Where Appearance applies' });
		await expect.poll(() => people.count()).toBe(1);
		expect(await people.getByRole('tab').allTextContents()).toEqual(['You, everywhere']);
		expect(
			await people
				.getByRole('tab', { name: 'You, everywhere', exact: true, selected: true })
				.count()
		).toBe(1);
		// The fields' panel is named by its tab, and each field by its key's title.
		expect(await view.getByRole('tabpanel', { name: 'You, everywhere', exact: true }).count()).toBe(
			1
		);
		// A section of the workspace and the project: "Workspace" and "Project Atlas", the project's chosen.
		await kernelCall(page, 'section-open', { section: 'settings', target: 'hello.general' });
		const levels = view.getByRole('tablist', { name: 'Where General applies' });
		await expect
			.poll(() => levels.getByRole('tab').allTextContents())
			.toEqual(['Workspace', 'Project Atlas']);
		expect(
			await levels.getByRole('tab', { name: 'Project Atlas', exact: true, selected: true }).count()
		).toBe(1);
		const panel = view.getByRole('tabpanel', { name: 'Project Atlas', exact: true });
		expect(await panel.count()).toBe(1);
		expect(await panel.getByRole('textbox', { name: 'Greeting', exact: true }).count()).toBe(1);
		expect(await view.getByRole('button', { name: 'Reset Greeting', exact: true }).count()).toBe(1);
		// A custom editor's form, named (3.7).
		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'loam.keybindings.overrides',
		});
		const form = view
			.locator('loam-keybinding-editor')
			.getByRole('form', { name: 'Add an override' });
		await expect.poll(() => form.count()).toBe(1);
		expect(await form.getByRole('combobox', { name: 'Command', exact: true }).count()).toBe(1);
		expect(await form.getByRole('button', { name: 'Add', exact: true }).count()).toBe(1);
		await page.close();
	});
});

describe('P4-E1: the three custom editors (3.7)', () => {
	it('reorders the rail for the person, mutes an app, and records an override with its warning', async () => {
		const { page } = await openShell(browser, site.origin);
		const rail = () =>
			page
				.locator('loam-rail loam-app-entry')
				.evaluateAll((entries) => entries.map((entry) => entry.getAttribute('instance')));
		await expect.poll(rail).toEqual(['hello', 'tally']);
		await kernelCall(page, 'section-open', { section: 'settings', target: 'loam.rail.order' });
		const view = section(page);
		const editor = view.locator('loam-rail-order-editor');
		await expect
			.poll(() => editor.locator('li').allTextContents())
			.toEqual(['HelloMove upMove down', 'TallyMove upMove down']);
		await editor.getByRole('button', { name: 'Move up: Tally' }).click();
		await expect.poll(rail).toEqual(['tally', 'hello']);
		// Focus follows the app it moved.
		expect((await focused(page)).label).toBe('Move up: Tally');
		expect(
			await kernelCall(page, 'setting-get', { section: 'loam.rail', key: 'order' })
		).toMatchObject({ data: { value: ['tally', 'hello'], from: 'person' } });

		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'loam.notifications.muted',
		});
		const picker = view.locator('loam-instance-picker');
		await picker.getByLabel('Hello').click();
		await expect
			.poll(
				async () =>
					(await kernelCall(page, 'setting-get', {
						section: 'loam.notifications',
						key: 'muted',
					})) as {
						data: { value: string[] };
					}
			)
			.toMatchObject({ data: { value: ['hello'] } });

		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'loam.keybindings.overrides',
		});
		const keys = view.locator('loam-keybinding-editor');
		await keys.locator('#override-command').fill('palette-open');
		await keys.locator('#override-record').click();
		await page.keyboard.press('ControlOrMeta+Shift+L');
		await expect
			.poll(() => keys.locator('#override-said').textContent())
			.toBe('Recorded Mod+Shift+L. Mod+K would no longer open the command palette.');
		await keys.getByRole('button', { name: 'Add' }).click();
		await expect
			.poll(
				async () =>
					(await kernelCall(page, 'setting-get', {
						section: 'loam.keybindings',
						key: 'overrides',
					})) as {
						data: { value: unknown };
					}
			)
			.toMatchObject({ data: { value: [{ command: 'palette-open', keys: 'Mod+Shift+L' }] } });
		await expect.poll(() => keys.locator('li').count()).toBe(1);
		// F6 is never recorded as a binding: it says so before anything is added, and Add stays disabled.
		await keys.locator('#override-command').fill('layout-set');
		await keys.locator('#override-record').click();
		await page.keyboard.press('F6');
		await expect
			.poll(() => keys.locator('#override-said').textContent())
			.toBe('Recorded F6. F6 cannot be bound: bind another key.');
		// The Record button's name stays; only its pressed state says it records (APG).
		expect(await keys.locator('#override-record').textContent()).toBe('Record keys');
		expect(await keys.getByRole('button', { name: 'Add' }).getAttribute('aria-disabled')).toBe(
			'true'
		);
		// Still pressable, as `aria-disabled` keeps it in the Tab order, and it says why nothing is added.
		await keys.getByRole('button', { name: 'Add' }).click({ force: true });
		await settle(page);
		// Nothing was written, and no row for it shows.
		expect(await keys.locator('li').allTextContents()).toEqual(['palette-open: Mod+Shift+LRemove']);
		// Choosing to unbind Mod+K's command warns as soon as it is chosen, before Add.
		await keys.locator('#override-command').fill('palette-open');
		await keys.locator('#override-unbind').check();
		await expect
			.poll(() => keys.locator('#override-said').textContent())
			.toBe('This unbinds Mod+K, which opens the command palette.');
		await page.close();
	});
});

describe("P4-E1: step 2's reviews", () => {
	it('2: a control left from before a change of scope never writes in the new scope', async () => {
		const { page, atlas } = await inAtlas();
		const beacon = (
			(await kernelCall(page, 'project-create', { name: 'Beacon', slug: 'beacon' })) as {
				data: { id: string };
			}
		).data.id;
		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'hello.general.greeting',
		});
		const view = section(page);
		await expect
			.poll(() => view.locator('[role="tab"][aria-selected="true"]').textContent())
			.toBe('Project Atlas');
		// The tab is selected before its fields render: on a loaded host the field read below was not there yet (#1959).
		await expect.poll(() => view.locator('#field-greeting').count()).toBe(1);
		// The scope moves to Beacon, and the person's edit to Atlas's field lands after it, before the section reads again.
		await page.evaluate(async (beacon) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				shadowRoot: ShadowRoot;
				kernel: { call(name: string, input: unknown): Promise<unknown> };
			};
			const field = shell.shadowRoot
				.querySelector('loam-settings-section')
				?.shadowRoot?.querySelector('#field-greeting') as HTMLInputElement;
			await shell.kernel.call('scope-set', { project: beacon });
			field.value = 'Kept';
			field.dispatchEvent(new Event('change'));
		}, beacon);
		await settle(page);
		const read = (project: string) =>
			page.evaluate(
				(project) =>
					(
						document.querySelector('loam-shell') as unknown as {
							kernel: {
								call(name: string, input: unknown, options: unknown): Promise<{ data: unknown }>;
							};
						}
					).kernel
						.call(
							'setting-get',
							{ section: 'hello.general', key: 'greeting' },
							{ scope: { workspace: 'personal', project } }
						)
						.then((result) => result.data),
				project
			);
		// Beacon's value is untouched; Atlas's is what was edited, or nothing if the edit came after the panel forgot.
		expect(await read(beacon)).toMatchObject({ value: 'Hello', from: 'default' });
		expect(['Kept', 'Hello']).toContain(((await read(atlas)) as { value: string }).value);
		await page.close();
	});

	it('3: the list editors keep what they do not show', async () => {
		const { page } = await openShell(browser, site.origin);
		const get = async (section: string, key: string) =>
			((await kernelCall(page, 'setting-get', { section, key })) as { data: { value: unknown } })
				.data.value;
		const set = (section: string, key: string, value: unknown) =>
			kernelCall(page, 'setting-set', { section, key, value, level: 'person' });
		// An id no app has now, as a disabled app's would be, in each list; and two overrides of one command.
		await set('loam.rail', 'order', ['ghost', 'hello', 'tally']);
		await set('loam.notifications', 'muted', ['ghost']);
		await set('loam.keybindings', 'overrides', [
			{ command: 'section-open', target: 'documents', keys: 'Mod+G D' },
			{ command: 'section-open', target: 'projects', keys: 'Mod+G P' },
		]);
		const view = section(page);
		await kernelCall(page, 'section-open', { section: 'settings', target: 'loam.rail.order' });
		await view
			.locator('loam-rail-order-editor')
			.getByRole('button', { name: 'Move up: Tally' })
			.click();
		await expect.poll(() => get('loam.rail', 'order')).toEqual(['tally', 'hello', 'ghost']);
		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'loam.notifications.muted',
		});
		await view.locator('loam-instance-picker').getByLabel('Hello').click();
		await expect.poll(() => get('loam.notifications', 'muted')).toEqual(['ghost', 'hello']);
		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'loam.keybindings.overrides',
		});
		const keys = view.locator('loam-keybinding-editor');
		await keys.locator('#override-command').fill('palette-open');
		await keys.locator('#override-record').click();
		await page.keyboard.press('ControlOrMeta+Shift+L');
		await keys.getByRole('button', { name: 'Add' }).click();
		await expect
			.poll(() => get('loam.keybindings', 'overrides'))
			.toEqual([
				{ command: 'section-open', target: 'documents', keys: 'Mod+G D' },
				{ command: 'section-open', target: 'projects', keys: 'Mod+G P' },
				{ command: 'palette-open', keys: 'Mod+Shift+L' },
			]);
		await expect
			.poll(() => keys.locator('#override-said').textContent())
			.toBe('Added palette-open: Mod+Shift+L.');
		// axe over the rail editor and the instance picker too (15).
		for (const target of ['loam.rail.order', 'loam.notifications.muted']) {
			await kernelCall(page, 'section-open', { section: 'settings', target });
			await settle(page);
			expect(await axe(page), target).toEqual([]);
		}
		await page.close();
	});

	it("6: Back between two keys' links selects the key, and a key's own levels choose the tab", async () => {
		const { page } = await inAtlas();
		const view = section(page);
		const target = () => view.locator('.field[data-target]').getAttribute('data-key');
		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'loam.appearance.theme',
		});
		await expect.poll(target).toBe('theme');
		const beforeDensity = (await journal(page)).filter(
			({ command }) => command === 'section-open'
		).length;
		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'loam.appearance.density',
		});
		await expect.poll(target).toBe('density');
		await expect.poll(() => new URL(page.url()).hash).toBe('#density');
		await settle(page);
		// #2098: the shell's own `#density` write must not trigger a duplicate journaled `section-open`.
		expect((await journal(page)).filter(({ command }) => command === 'section-open').length).toBe(
			beforeDensity + 1
		);
		await page.goBack();
		await expect.poll(() => new URL(page.url()).hash).toBe('#theme');
		await expect.poll(target).toBe('theme');
		// `signoff` is the workspace's alone, in a section of workspace and project: from Atlas, the Workspace tab.
		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'hello.general.signoff',
		});
		await expect
			.poll(() => view.locator('[role="tab"][aria-selected="true"]').textContent())
			.toBe('Workspace');
		await expect.poll(target).toBe('signoff');
		await page.close();
	});

	it('9: hello says no board outside a project, and a free string may be set empty', async () => {
		const { page } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await expect.poll(() => greets(page)).toBe('Greets with Hello');
		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'hello.general.signoff',
		});
		const view = section(page);
		await view.locator('#field-signoff').fill('');
		await view.locator('#field-signoff').press('Tab');
		await expect.poll(() => view.locator('.status').textContent()).toBe('Sign-off is saved.');
		expect(
			await kernelCall(page, 'setting-get', { section: 'hello.general', key: 'signoff' })
		).toMatchObject({ data: { value: '', from: 'workspace' } });
		await page.close();
	});

	it('keeps the new project tree and level tabs when a panel re-read lands mid-show() (#2097)', async () => {
		const { page } = await inAtlas();
		const beacon = (
			(await kernelCall(page, 'project-create', { name: 'Beacon', slug: 'beacon' })) as {
				data: { id: string };
			}
		).data.id;
		// Give Beacon its own project-level greeting so we can verify the panel also reflects Beacon.
		await kernelCall(page, 'scope-set', { project: beacon });
		await kernelCall(page, 'setting-set', {
			section: 'hello.general',
			key: 'greeting',
			value: 'Hi Beacon',
			level: 'project',
		});
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'hello.general.greeting',
		});
		const view = section(page);
		await expect
			.poll(() => view.locator('[role="tab"][aria-selected="true"]').textContent())
			.toBe('Project Atlas');

		// Hold show()'s setting-schema-get when switching to Beacon, fire a settings mutation while show() is
		// paused, and confirm the panel neither calls setting-list nor repaints Beacon values under the stale
		// Project Atlas tab, and does not abort show() once the schema read resolves.
		const paused = await page.evaluate(async (beaconId) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				shadowRoot: ShadowRoot;
				kernel: {
					call(name: string, input?: unknown, options?: unknown): Promise<unknown>;
				};
			};
			const orig = shell.kernel.call.bind(shell.kernel);
			let releaseSchema: (() => void) | undefined;
			let schemaHeld = false;
			let settingListWhilePaused = false;
			let resolveSchemaStarted!: () => void;
			const schemaStarted = new Promise<void>((resolve) => {
				resolveSchemaStarted = resolve;
			});

			shell.kernel.call = async (name: string, input?: unknown, options?: unknown) => {
				if (name === 'setting-schema-get' && !schemaHeld) {
					schemaHeld = true;
					resolveSchemaStarted();
					await new Promise<void>((resolve) => {
						releaseSchema = resolve;
					});
				}
				if (name === 'setting-list' && schemaHeld && releaseSchema) {
					settingListWhilePaused = true;
				}
				return orig(name, input, options);
			};

			try {
				await orig('scope-set', { project: beaconId });
				await schemaStarted;
				// Trigger a settings event while show() is paused on Beacon's schema read.
				await orig('setting-set', {
					section: 'hello.general',
					key: 'signoff',
					value: 'Best',
					level: 'workspace',
				});
				await new Promise((resolve) => setTimeout(resolve, 25));
				const fields =
					shell.shadowRoot
						.querySelector('loam-settings-section')
						?.shadowRoot?.querySelectorAll('#settings-panel .field').length ?? -1;
				const release = releaseSchema;
				releaseSchema = undefined;
				release?.();
				return { fields, settingListWhilePaused };
			} finally {
				shell.kernel.call = orig;
			}
		}, beacon);

		// While Beacon's schema read was held, #readPanel() neither read setting-list nor painted Beacon fields under Project Atlas.
		expect(paused).toEqual({ fields: 0, settingListWhilePaused: false });
		// scope-set resets path to '', so show() completed and painted the updated tree (not stuck on Project Atlas).
		await expect
			.poll(() => view.locator('[role="treeitem"][aria-selected="true"]').textContent())
			.toBe('Appearance');
		// Selecting General in Beacon shows Project Beacon's tab and value (not Atlas).
		await view.locator('[role="treeitem"][data-section="hello.general"]').click();
		await expect
			.poll(() => view.locator('[role="tab"]').allTextContents())
			.toEqual(['Workspace', 'Project Beacon']);
		await expect
			.poll(() => view.locator('[role="tab"][aria-selected="true"]').textContent())
			.toBe('Project Beacon');
		await expect.poll(() => view.locator('#field-greeting').inputValue()).toBe('Hi Beacon');
		await page.close();
	});
});

describe('P4-E1: oversized settings section key-by-key fallback (#2099)', () => {
	/**
	 * A native app whose `oversized.large` section fits the 16 KiB defaults limit (tiny defaults, small `setting-list`)
	 * while its full schema exceeds `setting-schema-get`'s 16 KiB output budget, forcing `loam-settings-section` to fall
	 * back to reading each key individually.
	 */
	async function packOversizedApp(dir: string): Promise<{ packed: string; keys: string[] }> {
		const src = join(dir, 'app');
		const packed = join(dir, 'packed');
		await mkdir(join(src, 'dist'), { recursive: true });
		const keys = Array.from({ length: 30 }, (_, index) => `k${index}`);
		const choices = Array.from({ length: 8 }, (_, index) => `choice-option-value-${index}`);
		const titles = choices.map((_, index) => `Choice Option Label Number ${index}`);
		const description =
			'Detailed plain-text description explaining how this setting configures the fixture app so the section schema exceeds the 16 KiB output budget.';
		const keyBlocks = keys.map(
			(key, index) =>
				`[ui.settings.schema.properties.${key}]\ntype = "string"\ntitle = "Setting ${index}"\ndescription = ${JSON.stringify(description)}\nenum = ${JSON.stringify(choices)}\nenumTitles = ${JSON.stringify(titles)}\ndefault = ${JSON.stringify(choices[0])}\n`
		);
		const manifest = [
			'manifest_version = 2',
			'protocol = 1',
			'',
			'[plugin]',
			'id = "oversized"',
			'title = "Oversized"',
			'version = "0.1.0"',
			'description = "Fixture app with an oversized settings section schema."',
			'kind = "native"',
			'domains = ["oversized"]',
			'',
			'[native]',
			'entry = "dist/native.js"',
			'',
			'[app]',
			'scope_levels = ["workspace"]',
			'',
			'[[commands]]',
			'name = "oversized-ping"',
			'title = "Ping"',
			'description = "No-op command for the oversized settings fixture."',
			'effects = ["inspect"]',
			'input_schema = { type = "object", properties = {}, additionalProperties = false }',
			'',
			'[[ui.settings]]',
			'id = "large"',
			'title = "Large"',
			'description = "Section whose full schema exceeds setting-schema-get budget."',
			'levels = ["workspace"]',
			'',
			'[ui.settings.schema]',
			'type = "object"',
			'additionalProperties = false',
			'',
			...keyBlocks,
		].join('\n');
		await writeFile(join(src, 'loam-app.toml'), manifest);
		await writeFile(
			join(src, 'dist/native.js'),
			'export default { sdk: 1, handlers: { "oversized-ping": async () => ({ success: true, data: {} }) } };\n'
		);
		const result = await appPack({ dir: src, out: packed });
		if (!result.out) throw new Error(JSON.stringify(result.report.refusals));
		return { packed: result.out, keys };
	}

	it('renders and saves an oversized section through the key-by-key setting-schema-get fallback', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'loam-oversized-settings-'));
		let oversizedSite: DeploymentSite | undefined;
		let opened: Awaited<ReturnType<typeof openShell>> | undefined;
		try {
			const fixture = await packOversizedApp(dir);
			oversizedSite = await serveDeployment({
				config: deploymentFile(deploymentEntry('oversized', fixture.packed, { order: 10 })),
			});
			opened = await openShell(browser, oversizedSite.origin);
			const { page } = opened;

			// Confirm the kernel genuinely refuses the whole section with OUTPUT_BUDGET_EXCEEDED.
			const whole = (await kernelCall(page, 'setting-schema-get', {
				section: 'oversized.large',
			})) as { success: boolean; error?: { code?: string } };
			expect(whole.success).toBe(false);
			expect(whole.error?.code).toBe('OUTPUT_BUDGET_EXCEEDED');

			// Open Settings directly to the oversized section; the chrome must fall back to key-by-key reads.
			const before = (await journal(page)).length;
			await kernelCall(page, 'section-open', { section: 'settings', target: 'oversized.large' });
			const view = section(page);
			await expect.poll(() => view.locator('#settings-section-title').textContent()).toBe('Large');
			await expect
				.poll(() => view.locator('#settings-panel .field').count())
				.toBe(fixture.keys.length);

			// Verify the journal recorded the failed whole-section read followed by per-key reads for every key.
			const schemaCalls = (await journal(page))
				.slice(before)
				.filter((entry) => entry.command === 'setting-schema-get');
			expect(schemaCalls).toContainEqual(
				expect.objectContaining({
					command: 'setting-schema-get',
					input: { section: 'oversized.large' },
					success: false,
					error: expect.objectContaining({ code: 'OUTPUT_BUDGET_EXCEEDED' }),
				})
			);
			const readKeys = schemaCalls
				.filter((entry) => entry.success && (entry.input as { key?: string }).key !== undefined)
				.map((entry) => (entry.input as { key: string }).key);
			expect(readKeys).toEqual(fixture.keys);

			// Edit the last key through the rendered control and confirm it persists.
			const lastSelect = view.locator('#field-k29');
			await expect.poll(() => lastSelect.inputValue()).toBe('choice-option-value-0');
			await lastSelect.selectOption('choice-option-value-3');
			await expect.poll(() => view.locator('.status').textContent()).toBe('Setting 29 is saved.');
			expect(
				await kernelCall(page, 'setting-get', { section: 'oversized.large', key: 'k29' })
			).toMatchObject({ data: { value: 'choice-option-value-3', from: 'workspace' } });

			expect(opened.errors).toEqual([]);
			expect(opened.violations).toEqual([]);
		} finally {
			await opened?.context.close();
			await oversizedSite?.close();
			await rm(dir, { recursive: true, force: true });
		}
	});
});
