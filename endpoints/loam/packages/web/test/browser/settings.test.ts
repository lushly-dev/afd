/**
 * P4-E1 in Chromium (phase 4 specification, 3.5, 3.7, 3.8, 3.10 and 15): hello's `greeting` found from the palette and
 * changed in the settings section for one project, read back by hello through its `settings` grant, heard by its open
 * surface through `settingsChanged`, and reset; a project-only key hidden with no project; the section's tree, level
 * switcher and fields by keyboard and under axe in three themes; and the three custom editors, the rail honouring the
 * person's own order. The units of E1 (the codes, the hand-off's `details`, `writable`, `expected`) are the kernel's
 * `late/settings.test.ts` and `late/settings-shell.test.ts`.
 */

import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	axe,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	focused,
	kernelCall,
	openApp,
	openShell,
	packApp,
	serveDeployment,
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
	it('moves through the tree and the level switcher, and passes axe in three themes', async () => {
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
			await kernelCall(page, 'appearance-set', { theme });
			await settle(page);
			for (const target of ['loam.appearance', 'hello.general', 'loam.keybindings']) {
				await kernelCall(page, 'section-open', { section: 'settings', target });
				await settle(page);
				expect(await axe(page), `${theme} ${target}`).toEqual([]);
			}
		}
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
		await page.keyboard.press('Control+Shift+L');
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
		await page.keyboard.press('Control+Shift+L');
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
		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'loam.appearance.density',
		});
		await expect.poll(target).toBe('density');
		await expect.poll(() => new URL(page.url()).hash).toBe('#density');
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
});
