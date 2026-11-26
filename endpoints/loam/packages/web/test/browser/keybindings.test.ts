/**
 * P4-E9 in Chromium (phase 4 specification, section 8; D123; the coordinator's R1 to R5): `Mod+Alt+P` reaches the page
 * and opens the project switcher; keys matched on German and Cyrillic layouts (8.2, #877), pressed through the DevTools
 * protocol with the layout's own `key` and `code`; sequences and their wait; a sequence beginning on a reserved chord
 * refused; overrides in force with `source` and `shadowed`; F6 refused; the editor's warnings and a recorded sequence;
 * the rail order by keyboard; and no key forwarded from a view (8.6). The units are the kernel's `keybindings.test.ts`
 * and `late/keybinding-commands.test.ts`, and chrome's `keyboard.test.ts` and `settings/editor-rules.test.ts`.
 */

import { type Browser, chromium, type Frame, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNote, open, typeInto } from './documents/support';
import {
	agentCall,
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
	setTheme,
	settle,
} from './harness';

let browser: Browser;
let site: DeploymentSite;
let views: DeploymentSite;
let editors: DeploymentSite;
let empty: DeploymentSite;
beforeAll(async () => {
	site = await serveDeployment({
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello'), { order: 10 }),
			deploymentEntry('tally', await packApp('tally'), { order: 20 })
		),
	});
	views = await serveDeployment({
		sandbox: true,
		config: deploymentFile(deploymentEntry('hello', await packApp('hello', 'view'))),
	});
	editors = await serveDeployment({
		config: deploymentFile(deploymentEntry('notes', await packApp('notes'))),
	});
	empty = await serveDeployment({ config: 'deployment_version = 2\n\n[apps]\n' });
	browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
	await browser?.close();
	await site?.close();
	await views?.close();
	await editors?.close();
	await empty?.close();
});

const MAC = process.platform === 'darwin';
/** The DevTools protocol's modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8. */
const MOD = MAC ? 4 : 2;

/**
 * A key pressed as a layout gives it: `key` and `code` as that layout's keyboard sends them, through the DevTools
 * protocol, so the page receives a trusted event the matcher reads as it would a real one.
 */
async function pressAs(
	page: Page,
	init: { key: string; code: string; modifiers: number; keyCode: number }
): Promise<void> {
	const session = await page.context().newCDPSession(page);
	for (const type of ['rawKeyDown', 'keyUp'] as const) {
		await session.send('Input.dispatchKeyEvent', {
			type,
			key: init.key,
			code: init.code,
			modifiers: init.modifiers,
			windowsVirtualKeyCode: init.keyCode,
			nativeVirtualKeyCode: init.keyCode,
		});
	}
	await session.detach();
}

const paletteOpen = (page: Page) =>
	page.evaluate(
		() =>
			(
				document
					.querySelector('loam-shell')
					?.shadowRoot?.querySelector('loam-palette') as unknown as {
					isOpen?: boolean;
				} | null
			)?.isOpen === true
	);

const overrides = (page: Page, value: unknown) =>
	kernelCall(page, 'setting-set', {
		section: 'loam.keybindings',
		key: 'overrides',
		value,
		level: 'person',
	}) as Promise<{ success: boolean; error?: { code: string; suggestion?: string } }>;

type Listed = { data: { bindings: Array<Record<string, unknown>> } };

const switcher = (page: Page) => page.locator('loam-rail loam-project-switcher button');

describe('P4-E9: keybindings', () => {
	it('Mod+Alt+P reaches the page and opens the project switcher (8.4, #857)', async () => {
		const { page } = await openShell(browser, site.origin);
		expect(await switcher(page).getAttribute('aria-expanded')).toBe('false');
		await page.keyboard.press('ControlOrMeta+Alt+KeyP');
		await expect.poll(() => switcher(page).getAttribute('aria-expanded')).toBe('true');
		await page.keyboard.press('Escape');
		await expect.poll(() => switcher(page).getAttribute('aria-expanded')).toBe('false');
		await page.close();
	});

	it('matches a German layout’s Z by its key, and a Cyrillic letter by its code (8.2, #877)', async () => {
		const { page } = await openShell(browser, site.origin);
		// Cyrillic: Mod+K's key types "л", read by its code, KeyK.
		await pressAs(page, { key: 'л', code: 'KeyK', modifiers: MOD, keyCode: 75 });
		await expect.poll(() => paletteOpen(page)).toBe(true);
		await page.keyboard.press('Escape');
		await expect.poll(() => paletteOpen(page)).toBe(false);
		// German (QWERTZ): a person's Mod+Z is the key that types "z", which sits where QWERTY's Y is.
		expect((await overrides(page, [{ command: 'palette-open', keys: 'Mod+Z' }])).success).toBe(
			true
		);
		await pressAs(page, { key: 'y', code: 'KeyZ', modifiers: MOD, keyCode: 89 });
		await settle(page);
		expect(await paletteOpen(page)).toBe(false);
		await pressAs(page, { key: 'z', code: 'KeyY', modifiers: MOD, keyCode: 90 });
		await expect.poll(() => paletteOpen(page)).toBe(true);
		await page.keyboard.press('Escape');
		// Mod+K no longer opens it: the override replaced it.
		await page.keyboard.press('ControlOrMeta+K');
		await settle(page);
		expect(await paletteOpen(page)).toBe(false);
		await page.close();
	});

	it('runs a sequence pressed within 1,500 ms, and not one whose second key comes later (8.1)', async () => {
		const { page } = await openShell(browser, site.origin);
		await overrides(page, [{ command: 'section-open', target: 'documents', keys: 'Mod+G D' }]);
		const path = () => decodeURIComponent(new URL(page.url()).pathname);
		await page.keyboard.press('ControlOrMeta+G');
		await page.keyboard.press('KeyD');
		await expect.poll(path).toMatch(/~\/documents$/);
		await kernelCall(page, 'section-open', { section: 'projects' });
		await expect.poll(path).toMatch(/~\/projects$/);
		await page.keyboard.press('ControlOrMeta+G');
		await page.waitForTimeout(1_700);
		await page.keyboard.press('KeyD');
		await settle(page);
		expect(path()).toMatch(/~\/projects$/);
		await page.close();
	});

	it('refuses a sequence beginning on a reserved chord, and F6, with KEYBINDING_RESERVED', async () => {
		const { page } = await openShell(browser, site.origin);
		for (const value of [
			[{ command: 'palette-open', keys: 'Mod+K P' }],
			[{ command: 'palette-open', keys: 'Mod+Alt+P G' }],
			[{ command: 'palette-open', keys: 'F6' }],
			[{ command: 'shell-focus-next', keys: null }],
		]) {
			expect((await overrides(page, value)).error, JSON.stringify(value)).toMatchObject({
				code: 'KEYBINDING_RESERVED',
				suggestion: 'Bind another key',
			});
		}
		// F6 still moves focus between the parts.
		await page.keyboard.press('F6');
		await expect.poll(async () => (await focused(page)).part).toBeTruthy();
		await page.close();
	});

	it('puts an override in force with its source and what it shadows, and keeps its action (8.3, 8.5)', async () => {
		const { page } = await openShell(browser, site.origin);
		expect(
			(await kernelCall(page, 'keybinding-list', { command: 'shell-project-switcher' })) as Listed
		).toMatchObject({
			data: { bindings: [{ keys: 'Mod+Alt+P', source: 'shell', active: true }] },
		});
		await overrides(page, [{ command: 'shell-project-switcher', keys: 'Mod+Shift+O' }]);
		const listed = (await kernelCall(page, 'keybinding-list', {
			command: 'shell-project-switcher',
			all: true,
		})) as Listed;
		expect(listed.data.bindings).toEqual([
			{ keys: 'Mod+Alt+P', command: 'shell-project-switcher', source: 'shell', active: false },
			{
				keys: 'Mod+Shift+O',
				command: 'shell-project-switcher',
				source: 'you',
				shadowed: [{ source: 'shell', command: 'shell-project-switcher' }],
				active: true,
			},
		]);
		await page.keyboard.press('ControlOrMeta+Alt+KeyP');
		await settle(page);
		expect(await switcher(page).getAttribute('aria-expanded')).toBe('false');
		await page.keyboard.press('ControlOrMeta+Shift+KeyO');
		await expect.poll(() => switcher(page).getAttribute('aria-expanded')).toBe('true');
		await page.keyboard.press('Escape');
		expect(await kernelCall(page, 'shell-project-switcher', {})).toMatchObject({ success: true });
		await expect.poll(() => switcher(page).getAttribute('aria-expanded')).toBe('true');
		await page.keyboard.press('Escape');
		expect(await kernelCall(page, 'shell-focus-next', {})).toMatchObject({ success: true });
		await expect.poll(async () => (await focused(page)).part).toBeTruthy();
		// A layout toggle rebound by its part (R2), and hello's own chord shadowed by the person's while hello is open.
		await overrides(page, [
			{ command: 'layout-set', target: 'sidebar', keys: 'Mod+Shift+J' },
			{ command: 'palette-open', keys: 'Mod+Shift+H' },
		]);
		await openApp(page, 'hello');
		const hello = (await kernelCall(page, 'keybinding-list', { all: true })) as Listed;
		expect(
			hello.data.bindings.find((entry) => entry.keys === 'Mod+Shift+H' && entry.source === 'you')
		).toMatchObject({
			shadowed: [
				{ source: 'shell', command: 'palette-open' },
				{ source: 'app', command: 'hello-greet' },
			],
		});
		const sidebarOpen = () =>
			kernelCall(page, 'layout-get', {}).then(
				(read) => (read as { data: { sidebar: { open: boolean } } }).data.sidebar.open
			);
		const before = await sidebarOpen();
		await page.keyboard.press('ControlOrMeta+Shift+KeyJ');
		await expect.poll(sidebarOpen).toBe(!before);
		await page.close();
	});

	it('P4-E13: P4-E9: records a sequence in the editor, warns before it shadows or begins on a reserved chord, and passes axe', async () => {
		const { page } = await openShell(browser, site.origin);
		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'loam.keybindings.overrides',
		});
		const keys = page.locator('loam-main loam-settings-section loam-keybinding-editor');
		const said = () => keys.locator('#override-said').textContent();
		const add = () => keys.getByRole('button', { name: 'Add' });
		// Shadowing hello's chord: said with the recorded keys, before Add.
		await keys.locator('#override-command').fill('section-open');
		await keys.locator('#override-target').fill('projects');
		await keys.locator('#override-record').click();
		await page.keyboard.press('ControlOrMeta+Shift+KeyH');
		await expect
			.poll(said)
			.toBe(
				"Recorded Mod+Shift+H. Mod+Shift+H runs hello-greet, the app's; this binding would shadow it."
			);
		// Said by the editor's live region (15): a `status`, polite, that holds the chord and the shadowing.
		const region = keys.getByRole('status');
		expect(await region.count()).toBe(1);
		expect(await region.getAttribute('aria-live')).toBe('polite');
		expect(await region.textContent()).toBe(
			"Recorded Mod+Shift+H. Mod+Shift+H runs hello-greet, the app's; this binding would shadow it."
		);
		// A sequence: a second key pressed at once after the Mod chord.
		await keys.locator('#override-record').click();
		await page.keyboard.press('ControlOrMeta+KeyG');
		await page.keyboard.press('KeyP');
		await expect.poll(said).toBe('Recorded Mod+G P.');
		expect(await add().getAttribute('aria-disabled')).toBe('false');
		await add().click();
		await expect
			.poll(() =>
				kernelCall(page, 'setting-get', { section: 'loam.keybindings', key: 'overrides' })
			)
			.toMatchObject({
				data: { value: [{ command: 'section-open', target: 'projects', keys: 'Mod+G P' }] },
			});
		await expect.poll(said).toBe('Added section-open: Mod+G P.');
		// One that begins on Mod+K: said, and Add stays disabled.
		await keys.locator('#override-command').fill('section-open');
		await keys.locator('#override-target').fill('documents');
		await keys.locator('#override-record').click();
		await page.keyboard.press('ControlOrMeta+KeyK');
		await page.keyboard.press('KeyD');
		await expect
			.poll(said)
			.toBe(
				'Recorded Mod+K D. A sequence cannot begin on Mod+K, which the shell keeps: begin it on another chord.'
			);
		expect(await add().getAttribute('aria-disabled')).toBe('true');
		// F6's own binding is never rebound.
		await keys.locator('#override-command').fill('shell-focus-next');
		await expect
			.poll(said)
			.toBe('F6 moves focus between the parts: it is never rebound or unbound.');
		await settle(page);
		expect(await axe(page)).toEqual([]);
		await page.close();
	});

	it('P4-E13: P4-E9: the editor with a shadowing warning passes axe in light, dark and high contrast', async () => {
		const { page } = await openShell(browser, site.origin);
		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'loam.keybindings.overrides',
		});
		const keys = page.locator('loam-main loam-settings-section loam-keybinding-editor');
		await keys.locator('#override-command').fill('section-open');
		await keys.locator('#override-target').fill('projects');
		await keys.locator('#override-record').click();
		await page.keyboard.press('ControlOrMeta+Shift+KeyH');
		const warning =
			"Recorded Mod+Shift+H. Mod+Shift+H runs hello-greet, the app's; this binding would shadow it.";
		await expect.poll(() => keys.getByRole('status').textContent()).toBe(warning);
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			await setTheme(page, theme);
			// The warning stays through a change of theme, which writes no override.
			expect(await keys.getByRole('status').textContent(), theme).toBe(warning);
			expect(await axe(page), theme).toEqual([]);
		}
		await page.close();
	});

	it('reorders the rail from the keyboard (P4-E9, 3.7)', async () => {
		const { page } = await openShell(browser, site.origin);
		const rail = () =>
			page
				.locator('loam-rail loam-app-entry')
				.evaluateAll((entries) => entries.map((entry) => entry.getAttribute('instance')));
		await expect.poll(rail).toEqual(['hello', 'tally']);
		await kernelCall(page, 'section-open', { section: 'settings', target: 'loam.rail.order' });
		const editor = page.locator('loam-main loam-settings-section loam-rail-order-editor');
		await editor.getByRole('button', { name: 'Move up: Tally' }).focus();
		await page.keyboard.press('Enter');
		await expect.poll(rail).toEqual(['tally', 'hello']);
		expect((await focused(page)).label).toBe('Move up: Tally');
		await page.keyboard.press('Space');
		await settle(page);
		// Already first: its Move up does nothing, and the order holds.
		expect(await rail()).toEqual(['tally', 'hello']);
		await page.close();
	});

	it('forwards no key from a view: Mod+K inside the frame opens nothing (8.6)', async () => {
		const { page } = await openShell(browser, views.origin);
		await openApp(page, 'hello');
		const element = await page.locator('loam-view-frame iframe').first().elementHandle();
		const outer = (await element?.contentFrame()) as Frame;
		await expect.poll(() => outer.childFrames().length).toBe(1);
		const inner = outer.childFrames()[0] as Frame;
		await inner.locator('body').click();
		await page.keyboard.press('ControlOrMeta+K');
		await settle(page);
		expect(await paletteOpen(page)).toBe(false);
		await page.close();
	});
});

describe("P4-E9: step 7's reviews", () => {
	/** The note's stored text, as an agent reads it. */
	const stored = async (page: Page, document: string) =>
		((await agentCall(page, 'notes-content-get', { document })) as { data?: { text: string } }).data
			?.text;
	const sidebarOpen = (page: Page) =>
		kernelCall(page, 'layout-get', {}).then(
			(read) => (read as { data: { sidebar: { open: boolean } } }).data.sidebar.open
		);

	it('R6: runs no binding for a key a script dispatched, and saves nothing for an event a script sent', async () => {
		const opened = await openShell(browser, editors.origin);
		const { page } = opened;
		await page.evaluate((mac) => {
			window.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'k',
					code: 'KeyK',
					ctrlKey: !mac,
					metaKey: mac,
					bubbles: true,
					cancelable: true,
				})
			);
		}, MAC);
		await settle(page);
		expect(await paletteOpen(page)).toBe(false);
		const note = await createNote(page, 'Kept');
		await open(page, note);
		await typeInto(page, 't1', 'Not by a script');
		const before = await stored(page, note);
		await page.evaluate((mac) => {
			const shell = document.querySelector('loam-shell') as HTMLElement;
			// The old public ask, and a dispatched Mod+S: neither saves.
			shell.dispatchEvent(
				new CustomEvent('loam-save-asked', { detail: { path: [] }, bubbles: true, composed: true })
			);
			window.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 's',
					code: 'KeyS',
					ctrlKey: !mac,
					metaKey: mac,
					bubbles: true,
					cancelable: true,
				})
			);
		}, MAC);
		await page.waitForTimeout(300);
		// Inside autosave's 2,000 ms, nothing saved it.
		expect(await stored(page, note)).toBe(before);
		await opened.context.close();
	});

	it("3: runs a shell command's binding in a workspace with no apps", async () => {
		const { page } = await openShell(browser, empty.origin);
		await overrides(page, [{ command: 'section-open', target: 'documents', keys: 'Mod+G D' }]);
		const path = () => decodeURIComponent(new URL(page.url()).pathname);
		await page.keyboard.press('ControlOrMeta+G');
		await page.keyboard.press('KeyD');
		await expect.poll(path).toMatch(/~\/documents$/);
		await page.close();
	});

	it('4: keeps a sequence waiting through a held first chord’s repeats', async () => {
		const { page } = await openShell(browser, site.origin);
		await overrides(page, [{ command: 'section-open', target: 'documents', keys: 'Mod+G D' }]);
		const path = () => decodeURIComponent(new URL(page.url()).pathname);
		const mod = MAC ? 'Meta' : 'Control';
		await page.keyboard.down(mod);
		await page.keyboard.down('KeyG');
		// Held: the browser repeats it, `repeat` set.
		await page.keyboard.down('KeyG');
		await page.keyboard.up('KeyG');
		await page.keyboard.up(mod);
		await page.keyboard.press('KeyD');
		await expect.poll(path).toMatch(/~\/documents$/);
		await page.close();
	});

	it('4: resolves a key once: a sequence ending on Mod+S runs its binding, and the editor saves nothing', async () => {
		const opened = await openShell(browser, editors.origin);
		const { page } = opened;
		await overrides(page, [{ command: 'layout-set', target: 'sidebar', keys: 'Mod+G Mod+S' }]);
		const note = await createNote(page, 'Sequenced');
		await open(page, note);
		const sidebar = await sidebarOpen(page);
		await typeInto(page, 't1', 'Not by the sequence');
		const before = await stored(page, note);
		await page.keyboard.press('ControlOrMeta+KeyG');
		await page.keyboard.press('ControlOrMeta+KeyS');
		await expect.poll(() => sidebarOpen(page)).toBe(!sidebar);
		expect(await stored(page, note)).toBe(before);
		// Mod+S alone still saves.
		await page.keyboard.press('ControlOrMeta+KeyS');
		await expect.poll(() => stored(page, note), { timeout: 1500 }).not.toBe(before);
		const saved = await stored(page, note);
		await typeInto(page, 't1', 'Saved by the command');
		expect(await kernelCall(page, 'shell-save', {})).toMatchObject({ success: true });
		await expect.poll(() => stored(page, note), { timeout: 1500 }).not.toBe(saved);
		await opened.context.close();
	});

	it("8: the editor warns on your own binding's keys, saying which wins, and refuses what the kernel would before Add", async () => {
		const { page } = await openShell(browser, site.origin);
		await overrides(page, [{ command: 'palette-open', keys: 'Mod+Shift+L' }]);
		await kernelCall(page, 'section-open', {
			section: 'settings',
			target: 'loam.keybindings.overrides',
		});
		const keys = page.locator('loam-main loam-settings-section loam-keybinding-editor');
		const said = () => keys.locator('#override-said').textContent();
		const add = () => keys.getByRole('button', { name: 'Add' });
		await keys.locator('#override-command').fill('section-open');
		await keys.locator('#override-target').fill('projects');
		await keys.locator('#override-record').click();
		await page.keyboard.press('ControlOrMeta+Shift+KeyL');
		await expect
			.poll(said)
			.toBe(
				'Recorded Mod+Shift+L. Mod+Shift+L is already yours, for palette-open, which would win: this binding would be shadowed.'
			);
		// A name no command has the kernel would refuse: said, and Add disabled.
		await keys.locator('#override-target').fill('');
		await keys.locator('#override-command').fill('Palette');
		await expect.poll(said).toBe("'Palette' is not a command's name, such as palette-open.");
		expect(await add().getAttribute('aria-disabled')).toBe('true');
		await page.close();
	});
});

describe("P4-E9: step 7's re-check", () => {
	const stored = async (page: Page, document: string) =>
		((await agentCall(page, 'notes-content-get', { document })) as { data?: { text: string } }).data
			?.text;
	const sidebarOpen = (page: Page) =>
		kernelCall(page, 'layout-get', {}).then(
			(read) => (read as { data: { sidebar: { open: boolean } } }).data.sidebar.open
		);
	const path = (page: Page) => decodeURIComponent(new URL(page.url()).pathname);
	/** A script's key on the element `path` names, each step searched through the shadow roots below the last. */
	const untrusted = (page: Page, path: string[], init: { key: string; code: string }) =>
		page.evaluate(
			({ path, init }) => {
				const find = (root: ParentNode, selector: string): Element | null => {
					const hit = root.querySelector(selector);
					if (hit) return hit;
					for (const host of root.querySelectorAll('*')) {
						const inner = host.shadowRoot ? find(host.shadowRoot, selector) : null;
						if (inner) return inner;
					}
					return null;
				};
				let at: Element | null = null;
				for (const selector of path) {
					at = find(at ? (at.shadowRoot ?? at) : document, selector);
					if (!at) throw new Error(`No ${selector}`);
				}
				at?.dispatchEvent(
					new KeyboardEvent('keydown', { bubbles: true, composed: true, cancelable: true, ...init })
				);
			},
			{ path, init }
		);

	it("2: saves nothing for an editor save event a script sends to an editor's frame", async () => {
		const opened = await openShell(browser, editors.origin);
		const { page } = opened;
		const note = await createNote(page, 'Framed');
		await open(page, note);
		await typeInto(page, 't1', 'Not by an event');
		const before = await stored(page, note);
		await page.evaluate(() => {
			const find = (root: Document | ShadowRoot): Element | null => {
				const hit = root.querySelector('loam-editor-frame');
				if (hit) return hit;
				for (const host of root.querySelectorAll('*')) {
					const inner = host.shadowRoot ? find(host.shadowRoot) : null;
					if (inner) return inner;
				}
				return null;
			};
			find(document)?.dispatchEvent(
				new CustomEvent('loam-editor-save', { bubbles: true, composed: true })
			);
		});
		await page.waitForTimeout(300);
		expect(await stored(page, note)).toBe(before);
		await opened.context.close();
	});

	it("3: the switcher's list and the palette choose nothing on a script's Enter", async () => {
		const { page } = await openShell(browser, site.origin);
		await kernelCall(page, 'project-create', { name: 'Atlas', slug: 'atlas' });
		await switcher(page).click();
		await expect.poll(() => switcher(page).getAttribute('aria-expanded')).toBe('true');
		const listbox = ['loam-project-list', 'violet-listbox', '[role="listbox"]'];
		// A person's own ArrowDown moves to Atlas; a script's Enter must not choose it.
		await page.keyboard.press('ArrowDown');
		await untrusted(page, listbox, { key: 'Enter', code: 'Enter' });
		await settle(page);
		expect(
			((await kernelCall(page, 'scope-get')) as { data: { project?: unknown } }).data.project ??
				null
		).toBe(null);
		// A person's own Enter does choose it.
		await page.keyboard.press('Enter');
		await expect
			.poll(
				async () =>
					((await kernelCall(page, 'scope-get')) as { data: { project?: { slug?: string } } }).data
						.project?.slug
			)
			.toBe('atlas');
		await page.keyboard.press('ControlOrMeta+K');
		await expect.poll(() => paletteOpen(page)).toBe(true);
		await page.locator('loam-palette input').fill('close the palette');
		await settle(page);
		await untrusted(page, ['loam-palette', 'input'], { key: 'Enter', code: 'Enter' });
		await settle(page);
		expect(await paletteOpen(page)).toBe(true);
		// A person's own Enter runs it, and the palette closes.
		await page.keyboard.press('Enter');
		await expect.poll(() => paletteOpen(page)).toBe(false);
		await page.close();
	});

	it('4: a held second key of Mod+G Mod+G keeps the wait; a fresh one completes it', async () => {
		const { page } = await openShell(browser, site.origin);
		await overrides(page, [{ command: 'layout-set', target: 'sidebar', keys: 'Mod+G Mod+G' }]);
		const before = await sidebarOpen(page);
		const mod = MAC ? 'Meta' : 'Control';
		await page.keyboard.down(mod);
		await page.keyboard.down('KeyG');
		await page.keyboard.down('KeyG');
		await page.keyboard.up('KeyG');
		await page.keyboard.down('KeyG');
		await page.keyboard.up('KeyG');
		await page.keyboard.up(mod);
		await expect.poll(() => sidebarOpen(page)).toBe(!before);
		await page.close();
	});

	it('4: a prefix the page stops replaces the one that waited, so its sequence never runs', async () => {
		const { page } = await openShell(browser, site.origin);
		await overrides(page, [
			{ command: 'section-open', target: 'documents', keys: 'Mod+G D' },
			{ command: 'section-open', target: 'projects', keys: 'Mod+Shift+Y D' },
		]);
		// The page stops Mod+Shift+Y before the window's bubble phase.
		await page.evaluate(() =>
			document.addEventListener('keydown', (event) => {
				if (event.code === 'KeyY' && event.shiftKey) event.stopPropagation();
			})
		);
		await page.keyboard.press('ControlOrMeta+KeyG');
		await page.keyboard.press('ControlOrMeta+Shift+KeyY');
		await page.keyboard.press('KeyD');
		await settle(page);
		expect(path(page)).not.toMatch(/~\/documents$/);
		await page.close();
	});

	it('4: save honours a key the page prevented before the shell', async () => {
		const context = await browser.newContext();
		await context.addInitScript(() =>
			window.addEventListener(
				'keydown',
				(event) => {
					if (event.code === 'KeyS' && (event.ctrlKey || event.metaKey)) event.preventDefault();
				},
				{ capture: true }
			)
		);
		const opened = await openShell(browser, editors.origin, {}, context);
		const { page } = opened;
		const note = await createNote(page, 'Prevented');
		await open(page, note);
		await typeInto(page, 't1', 'Not by a prevented key');
		const before = await stored(page, note);
		await page.keyboard.press('ControlOrMeta+KeyS');
		await page.waitForTimeout(300);
		expect(await stored(page, note)).toBe(before);
		await context.close();
	});
});

describe("P4-E9: step 7's third round", () => {
	// The person's read: an agent's resolves its mode from the person's cap, which this test makes unreadable (phase 5's 6.1).
	const stored = async (page: Page, document: string) =>
		((await kernelCall(page, 'notes-content-get', { document })) as { data?: { text: string } })
			.data?.text;

	it("B, R9: holds Mod+S while the person's settings cannot be read, saves nothing, and says the keys are not ready", async () => {
		const context = await browser.newContext();
		// The person's settings record fails to read once `__failSettings` is set, as a broken store would.
		await context.addInitScript(() => {
			const get = IDBObjectStore.prototype.get;
			IDBObjectStore.prototype.get = function (
				this: IDBObjectStore,
				key: IDBValidKey | IDBKeyRange
			) {
				const held = (window as unknown as { __failSettings?: boolean }).__failSettings;
				if (
					held &&
					Array.isArray(key) &&
					key[0] === 'settings' &&
					String(key[1]).startsWith('loam.settings')
				)
					throw new DOMException('The store failed', 'UnknownError');
				return get.call(this, key);
			};
		});
		const opened = await openShell(browser, editors.origin, {}, context);
		const { page } = opened;
		const note = await createNote(page, 'Held');
		await open(page, note);
		await typeInto(page, 't1', 'Not while the keys are unknown');
		const before = await stored(page, note);
		await page.evaluate(() => {
			(window as unknown as { __failSettings: boolean }).__failSettings = true;
		});
		// A sign-in changes the person, whose overrides then cannot be read.
		await kernelCall(page, 'auth-sign-in', {
			method: 'credentials',
			email: 'ada@example.com',
			password: 'x',
		});
		await page.evaluate(() =>
			window.addEventListener('keydown', (event) => {
				(window as unknown as { prevented: boolean }).prevented = event.defaultPrevented;
			})
		);
		await page.keyboard.press('ControlOrMeta+KeyS');
		expect(await page.evaluate(() => (window as unknown as { prevented: boolean }).prevented)).toBe(
			true
		);
		await expect
			.poll(() =>
				page
					.locator('loam-toast[message="Your keys are not ready yet. Try again in a moment."]')
					.count()
			)
			.toBe(1);
		expect(await stored(page, note)).toBe(before);
		await context.close();
	});

	it("Opus 2: the palette's listbox chooses nothing on a script's Enter or Space", async () => {
		const { page } = await openShell(browser, site.origin);
		await page.keyboard.press('ControlOrMeta+K');
		await expect.poll(() => paletteOpen(page)).toBe(true);
		await page.locator('loam-palette input').fill('close the palette');
		await settle(page);
		for (const key of ['Enter', ' ']) {
			await page.evaluate((key) => {
				const palette = document
					.querySelector('loam-shell')
					?.shadowRoot?.querySelector('loam-palette');
				const listbox = palette?.shadowRoot?.querySelector('violet-listbox');
				listbox?.shadowRoot
					?.querySelector('[role="listbox"]')
					?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
			}, key);
			await settle(page);
			expect(await paletteOpen(page), key).toBe(true);
		}
		await page.close();
	});

	it('shows a toast when a reserved action cannot run after the palette closes', async () => {
		const { page } = await openShell(browser, site.origin);
		await page.keyboard.press('ControlOrMeta+K');
		await page.locator('loam-palette input').fill('shell-save');
		await page.locator('loam-palette violet-option[data-command="shell-save"]').click();
		await expect.poll(() => paletteOpen(page)).toBe(false);
		await page.getByText('The shell cannot perform this action now').waitFor({ timeout: 5_000 });
		await page.close();
	});

	it('#1670: renders a command’s in-force shortcut in the palette row, and none when unbound or absent', async () => {
		const { page } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await page.keyboard.press('ControlOrMeta+K');
		await expect.poll(() => paletteOpen(page)).toBe(true);

		// Unconditional shell binding (`palette-open` -> `Mod+K`).
		await page.locator('loam-palette input').fill('palette-open');
		const openRow = page.locator('loam-palette violet-option[data-command="palette-open"]');
		await expect.poll(() => openRow.count()).toBe(1);
		await expect.poll(() => openRow.locator('kbd.result-shortcut').textContent()).toBe('Mod+K');

		// Unconditional app binding (`hello-greet` -> `Mod+Shift+H`).
		await page.locator('loam-palette input').fill('hello-greet');
		const greetRow = page.locator('loam-palette violet-option[data-command="hello-greet"]');
		await expect.poll(() => greetRow.count()).toBe(1);
		await expect
			.poll(() => greetRow.locator('kbd.result-shortcut').textContent())
			.toBe('Mod+Shift+H');

		// A command with no binding renders no shortcut element.
		await page.locator('loam-palette input').fill('palette-close');
		const closeRow = page.locator('loam-palette violet-option[data-command="palette-close"]');
		await expect.poll(() => closeRow.count()).toBe(1);
		expect(await closeRow.locator('kbd.result-shortcut').count()).toBe(0);

		// The open palette with rendered shortcuts passes axe in every theme.
		await page.locator('loam-palette input').fill('hello-greet');
		await expect.poll(() => greetRow.locator('kbd.result-shortcut').count()).toBe(1);
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			await setTheme(page, theme);
			expect(await axe(page), theme).toEqual([]);
		}

		// Unbinding `hello-greet` removes the shortcut from its rendered palette row.
		await page.keyboard.press('Escape');
		await expect.poll(() => paletteOpen(page)).toBe(false);
		expect((await overrides(page, [{ command: 'hello-greet', keys: null }])).success).toBe(true);
		await page.keyboard.press('ControlOrMeta+K');
		await expect.poll(() => paletteOpen(page)).toBe(true);
		await page.locator('loam-palette input').fill('hello-greet');
		await expect.poll(() => greetRow.count()).toBe(1);
		expect(await greetRow.locator('kbd.result-shortcut').count()).toBe(0);
		await page.close();
	});
});
