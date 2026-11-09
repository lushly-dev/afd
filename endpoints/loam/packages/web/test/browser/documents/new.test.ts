/**
 * New and the documents section in Chromium (documents specification, 7 and 8; step 11): D8, and E8's last
 * shapes, the documents section's and a document's, under `base_path = "/"` and `/loam/`. With hello, notes,
 * tasks and `memos`, a fixture with a project-only type and a creator that fails; `checklist` is step 13's.
 * D10's axe runs are `documents/accessibility.test.ts`, the captures `specimen.test.ts`; the kernel's half of
 * D8, `new-list`, its recents and the palette's rows through `decideAccess`, is `kernel/src/late/new-list.test.ts`.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	journal,
	kernelCall,
	openShell,
	packApp,
	serveDeployment,
	settle,
	surfacesIdle,
} from '../harness';
import { createNote, editorIdle, editorView } from './support';

const HOSTILE = '<img src=x onerror="document.title=1">';

/**
 * `memos`: a native type, `Memo`, project-only, and a creator, `Broken memo`, whose command always fails, at
 * either level. Its editor is never mounted here.
 */
async function memosApp(directory: string, creator = true): Promise<string> {
	const manifest = {
		manifest_version: 2,
		protocol: 1,
		afd_contract: '1.0',
		plugin: {
			id: 'memos',
			title: 'Memos',
			version: '0.1.0',
			description: 'A memos fixture for New.',
			kind: 'native',
			domains: ['memos'],
			license: 'MIT',
		},
		native: { entry: 'native.js' },
		app: { scope_levels: ['workspace', 'project'] },
		grants: [{ name: 'store', reason: "Keeps each memo's content." }],
		commands: [
			{
				name: 'memos-get',
				title: 'Read a memo',
				description: 'Read a memo.',
				effects: ['inspect'],
				input_schema: {
					type: 'object',
					properties: { document: { type: 'string' } },
					required: ['document'],
					additionalProperties: false,
				},
			},
			{
				name: 'memos-break',
				title: 'Break',
				description: 'Fail, always.',
				effects: ['store-write'],
				input_schema: { type: 'object', properties: {}, additionalProperties: false },
			},
		],
		ui: {
			...(creator
				? { new: [{ title: 'Broken memo', icon: 'system/warning', command: 'memos-break' }] }
				: {}),
			documents: [
				{
					id: 'memos',
					title: 'Memo',
					icon: 'system/document',
					content_schema: { type: 'object' },
					content_version: 1,
					scope_levels: ['project'],
					instance_commands: ['memos-get'],
					editor: { element: 'memos-editor' },
					binding: {
						model: 'command',
						selection: 'none',
						locator: 'none',
						conflict: 'last-writer-wins',
					},
					templates: [{ id: 'blank', title: 'Blank memo', content: {} }],
				},
			],
		},
	};
	const at = join(directory, creator ? 'memos' : 'memos-alone');
	await mkdir(at, { recursive: true });
	await writeFile(join(at, 'app-manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	await writeFile(
		join(at, 'native.js'),
		`export default { sdk: 1, handlers: {
			'memos-get': async () => ({ success: true, data: {} }),
			'memos-break': async () => ({ success: false, error: { code: 'MEMO_BROKEN', message: 'The memo broke', suggestion: 'Try again later' } }),
		} };\n`
	);
	return at;
}

/** `outline`: a native app whose sidebar is a `tree`, three levels deep, its main the console. */
async function outlineApp(directory: string): Promise<string> {
	const manifest = {
		manifest_version: 2,
		protocol: 1,
		afd_contract: '1.0',
		plugin: {
			id: 'outline',
			title: 'Outline',
			version: '0.1.0',
			description: 'A tree sidebar fixture.',
			kind: 'native',
			domains: ['outline'],
			license: 'MIT',
		},
		native: { entry: 'native.js' },
		app: { scope_levels: ['workspace'] },
		commands: [
			{
				name: 'outline-tree',
				title: 'List the outline',
				description: 'The outline, as a tree.',
				effects: ['inspect'],
				input_schema: { type: 'object', properties: {}, additionalProperties: false },
			},
		],
		ui: {
			surfaces: {
				rail: { label: 'Outline', icon: 'system/folder', order: 10 },
				sidebar: { shape: 'tree', command: 'outline-tree', title: 'Outline' },
			},
		},
	};
	const at = join(directory, 'outline');
	await mkdir(at, { recursive: true });
	await writeFile(join(at, 'app-manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	await writeFile(
		join(at, 'native.js'),
		`export default { sdk: 1, handlers: { 'outline-tree': async () => ({ success: true, data: { items: [
			{ id: 'guides', title: 'Guides', children: [{ id: 'start', title: 'Getting started', children: [{ id: 'install', title: 'Install', description: 'Five minutes' }] }] },
			{ id: 'reference', title: ${JSON.stringify(HOSTILE)} },
		] } }) } };\n`
	);
	return at;
}

let browser: Browser;
let fixtures: string;
let memos: string;
let memosAlone: string;
let notes: string;
let tasks: string;
let hello: string;

beforeAll(async () => {
	browser = await chromium.launch();
	fixtures = await mkdtemp(join(tmpdir(), 'loam-new-'));
	[memos, memosAlone, notes, tasks, hello] = await Promise.all([
		memosApp(fixtures),
		memosApp(fixtures, false),
		packApp('notes'),
		packApp('tasks'),
		packApp('hello'),
	]);
}, 120_000);

afterAll(async () => {
	await browser?.close();
	await rm(fixtures, { recursive: true, force: true });
});

const fullDeployment = (basePath?: string) =>
	serveDeployment({
		config: deploymentFile(
			deploymentEntry('hello', hello),
			deploymentEntry('notes', notes),
			deploymentEntry('tasks', tasks),
			deploymentEntry('memos', memos)
		),
		...(basePath ? { basePath } : {}),
	});

/** What the shell's deep DOM holds of `selector`'s text, through every open shadow root. */
const deepText = (page: Page, selector: string) =>
	page.evaluate((selector) => {
		const out: string[] = [];
		const walk = (root: Document | ShadowRoot) => {
			for (const element of root.querySelectorAll(selector))
				out.push(element.textContent?.trim() ?? '');
			for (const element of root.querySelectorAll('*'))
				if (element.shadowRoot) walk(element.shadowRoot);
		};
		walk(document);
		return out;
	}, selector);

/** The focused element, through open shadow roots. */
const focusedOn = (page: Page) =>
	page.evaluate(() => {
		let element: Element | null = document.activeElement;
		const chain: Element[] = [];
		while (element) {
			chain.push(element);
			element = element.shadowRoot?.activeElement ?? null;
		}
		const last = chain.at(-1);
		// A menu item delegates focus to its control, whose text is its host's, slotted.
		const named = [...chain].reverse().find((each) => each.textContent?.trim());
		return {
			tag: last?.localName ?? '',
			role: last?.getAttribute('role') ?? null,
			text: named?.textContent?.trim() ?? '',
		};
	});

const newButton = (page: Page) => page.locator('loam-titlebar .new > button');
const menuItems = (page: Page) => page.locator('loam-new-menu violet-menu-item');
const tree = (page: Page) => page.locator('loam-sidebar loam-documents-sidebar loam-tree');
const row = (page: Page, id: string) => tree(page).locator(`violet-tree-item[data-id="${id}"]`);

async function documentsSection(page: Page, project?: string): Promise<void> {
	if (project !== undefined) await kernelCall(page, 'scope-set', { project });
	await kernelCall(page, 'section-open', { section: 'documents' });
	await editorIdle(page);
	await tree(page).locator('violet-tree').waitFor();
	await settle(page);
}

describe('P2-D8: New', () => {
	let site: DeploymentSite;
	beforeAll(async () => {
		site = await fullDeployment();
	});
	afterAll(async () => {
		await site?.close();
	});

	it('P2-D8: the menu by keyboard: Enter opens it on its first item, a heading per plugin, Escape returns to the button', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		const button = newButton(page);
		expect(await button.getAttribute('aria-haspopup')).toBe('menu');
		expect(await button.getAttribute('aria-expanded')).toBe('false');
		await button.focus();
		await page.keyboard.press('Enter');
		await expect.poll(() => button.getAttribute('aria-expanded')).toBe('true');
		// At workspace level: memos' creator and notes' template, by the rail's order, `order` then the
		// instance; tasks is project-only, as memos' type is.
		await expect
			.poll(() => menuItems(page).allTextContents())
			.toEqual(['Broken memo', 'Blank note']);
		expect(await page.locator('loam-new-menu [role="group"] .heading').allTextContents()).toEqual([
			'Memos',
			'Notes',
		]);
		await expect.poll(async () => (await focusedOn(page)).text).toBe('Broken memo');
		await page.keyboard.press('ArrowDown');
		expect((await focusedOn(page)).text).toBe('Blank note');
		await page.keyboard.press('Home');
		expect((await focusedOn(page)).text).toBe('Broken memo');
		await page.keyboard.press('End');
		expect((await focusedOn(page)).text).toBe('Blank note');
		await page.keyboard.press('Escape');
		await expect.poll(() => button.getAttribute('aria-expanded')).toBe('false');
		await expect.poll(async () => (await focusedOn(page)).text).toBe('New');
		// A second press of the button while it is open closes it.
		await button.click();
		await expect.poll(() => button.getAttribute('aria-expanded')).toBe('true');
		await button.click();
		await expect.poll(() => button.getAttribute('aria-expanded')).toBe('false');
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('P2-D8: a template creates, opens and focuses a document, kept as a recent and first by scope; a creator runs', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		await newButton(page).click();
		await menuItems(page).first().waitFor();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await editorIdle(page);
		await expect
			.poll(async () => (await editorView(page))?.[0]?.tabs.map((tab) => tab.name))
			.toEqual(['Blank note']);
		// Focus goes to the new editor (7).
		await expect.poll(async () => (await focusedOn(page)).tag).toBe('textarea');
		const entries = await journal(page);
		const created = entries.find((entry) => entry.command === 'document-create');
		expect(created?.input).toMatchObject({ type: 'notes', template: 'blank', recent: true });
		const open = entries.find((entry) => entry.command === 'document-open');
		expect(open?.input).toMatchObject({ preview: false });
		// In Atlas: the recent first, then by the rail's order.
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await settle(page);
		const listed = (await kernelCall(page, 'new-list')) as {
			data: { items: Array<{ title: string; recent?: boolean }> };
		};
		// Tasks' rail order is 30; notes and memos have no rail entry, so they come after it.
		expect(listed.data.items.map((item) => `${item.title}${item.recent ? '*' : ''}`)).toEqual([
			'Blank note*',
			'Task',
			'Blank memo',
			'Broken memo',
		]);
		await newButton(page).click();
		await expect
			.poll(() => menuItems(page).allTextContents())
			.toEqual(['Blank note', 'Task', 'Blank memo', 'Broken memo']);
		// A creator's command runs: tasks' blank task, in Atlas.
		await menuItems(page).filter({ hasText: 'Task' }).click();
		await settle(page);
		const tasksAdded = (await journal(page)).filter((entry) => entry.command === 'tasks-add-blank');
		expect(tasksAdded.map((entry) => entry.success)).toEqual([true]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it("P2-D8: a creator's failure is a danger toast", async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		await newButton(page).click();
		await menuItems(page).filter({ hasText: 'Broken memo' }).click();
		const toast = page.locator('loam-toast[tone="danger"]');
		await toast.waitFor();
		const said = await toast.evaluate((element) => element.shadowRoot?.textContent ?? '');
		expect(said).toContain('Broken memo could not be created: The memo broke (MEMO_BROKEN)');
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('P2-D8: the palette lists New: <title> for a query starting new, and opens a document by its title', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		await createNote(page, 'Roadmap');
		await settle(page);
		await page.evaluate(() =>
			(
				document.querySelector('loam-shell') as unknown as {
					openPalette(q?: string): Promise<void>;
				}
			).openPalette()
		);
		const field = page.locator('loam-palette input.field');
		await field.waitFor();
		await field.fill('new');
		await expect
			.poll(() => page.locator('loam-palette violet-option .result-name').allTextContents())
			.toEqual(expect.arrayContaining(['New: Blank note', 'New: Broken memo']));
		await field.fill('roadmap');
		await expect
			.poll(() => page.locator('loam-palette violet-option .result-name').allTextContents())
			.toContain('Roadmap');
		await page.locator('loam-palette violet-option', { hasText: 'Roadmap' }).click();
		await editorIdle(page);
		await expect
			.poll(async () => (await editorView(page))?.[0]?.tabs.map((tab) => tab.name))
			.toEqual(['Roadmap']);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});
});

describe('P2-D8: New with only a project-only type', () => {
	it('P2-D8: says Nothing to create here at workspace level, naming the project-only type, and offers it in a project', async () => {
		const site = await serveDeployment({
			config: deploymentFile(deploymentEntry('memos', memosAlone)),
		});
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		await newButton(page).click();
		await expect
			.poll(() => menuItems(page).allTextContents())
			.toEqual(['Nothing to create here', 'Choose a project to create a Memo']);
		expect(
			await menuItems(page).evaluateAll((items) =>
				items.map((item) => item.hasAttribute('disabled'))
			)
		).toEqual([true, true]);
		await page.keyboard.press('Escape');
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await settle(page);
		await newButton(page).click();
		await expect.poll(() => menuItems(page).allTextContents()).toEqual(['Blank memo']);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
		await site.close();
	});
});

describe('P2-D8: the documents section', () => {
	let site: DeploymentSite;
	beforeAll(async () => {
		site = await fullDeployment();
	});
	afterAll(async () => {
		await site?.close();
	});

	it('P2-D8: the tree shows Recent, each type, and Trash; a press opens a preview, a second press keeps it, Enter keeps it', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		const one = await createNote(page, 'One');
		const two = await createNote(page, 'Two');
		await documentsSection(page);
		expect(
			await tree(page)
				.locator(':scope violet-tree > violet-tree-item')
				.evaluateAll((items) =>
					items.map(
						(item) => `${item.getAttribute('aria-label')} ${item.getAttribute('aria-expanded')}`
					)
				)
		).toEqual(['Recent true', 'Notes false', 'Trash false']);
		expect(await tree(page).locator('violet-tree').getAttribute('aria-label')).toBe('Documents');
		expect(await row(page, `recent:${two}`).getAttribute('aria-label')).toBe('Two, Note');
		// With no tab, main is the list.
		expect(await page.locator('loam-main loam-documents-section h1').textContent()).toBe(
			'Documents'
		);
		// A press opens a preview.
		await row(page, `recent:${one}`).locator(':scope > .label').click();
		await editorIdle(page);
		await expect
			.poll(async () => (await editorView(page))?.[0]?.tabs.map((tab) => tab.name))
			.toEqual(['One (preview)']);
		expect(await page.locator('loam-main loam-documents-section').count()).toBe(0);
		// A second press on the same row keeps it.
		await row(page, `recent:${one}`).locator(':scope > .label').click();
		await editorIdle(page);
		await expect
			.poll(async () => (await editorView(page))?.[0]?.tabs.map((tab) => tab.name))
			.toEqual(['One']);
		// Opening Notes reads its documents; Enter on one keeps it.
		await row(page, 'type:notes').locator(':scope > .label').click();
		await row(page, `notes:${two}`).waitFor();
		await row(page, `notes:${two}`).focus();
		await page.keyboard.press('Enter');
		await editorIdle(page);
		await expect
			.poll(async () => (await editorView(page))?.[0]?.tabs.map((tab) => tab.name))
			.toEqual(['One', 'Two']);
		// A mousedown lands on the row under it, and focus does not move another row there (#712).
		await row(page, `notes:${one}`).focus();
		const box = await row(page, `notes:${two}`).locator(':scope > .label').boundingBox();
		if (!box) throw new Error('no row');
		await page.mouse.move(box.x + 4, box.y + box.height / 2);
		await page.mouse.down();
		const after = await row(page, `notes:${two}`).boundingBox();
		await page.mouse.up();
		expect(after?.y).toBe((await row(page, `notes:${two}`).boundingBox())?.y);
		expect(
			await tree(page).evaluate((element) => (element as unknown as { selected: string }).selected)
		).toBe(`notes:${two}`);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('P2-D8: each row has its menu: Rename, Links, Trash, then Restore from the Trash branch', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		const id = await createNote(page, 'Draft');
		await documentsSection(page);
		const recent = row(page, `recent:${id}`);
		expect(await recent.getAttribute('aria-keyshortcuts')).toBe('Shift+F10');
		await recent.focus();
		await page.keyboard.press('Shift+F10');
		const menu = tree(page).locator('.menu');
		await expect.poll(() => menu.getAttribute('aria-label')).toBe('Actions for Draft');
		expect(await menu.locator('[role="menuitem"]').allTextContents()).toEqual([
			'Open beside',
			'Rename',
			'Links',
			'Trash',
		]);
		expect((await focusedOn(page)).text).toBe('Open beside');
		await page.keyboard.press('Escape');
		await expect.poll(async () => (await focusedOn(page)).text).toContain('Draft');
		// Rename, in the section's dialog.
		await recent.focus();
		await page.keyboard.press('Shift+F10');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
		const dialog = page.locator('loam-documents-sidebar dialog');
		await expect
			.poll(() => dialog.evaluate((element) => (element as HTMLDialogElement).open))
			.toBe(true);
		const field = dialog.locator('input.field');
		await field.fill('Plan');
		await page.keyboard.press('Enter');
		await expect
			.poll(() => row(page, `recent:${id}`).getAttribute('aria-label'))
			.toBe('Plan, Note');
		await expect.poll(async () => (await focusedOn(page)).text).toContain('Plan');
		// Links: that document's rows by document-link-list, whose command is step 12's; until then it says so.
		await recent.focus();
		await page.keyboard.press('Shift+F10');
		await tree(page).locator('.menu [data-action="links"]').click();
		await expect.poll(() => dialog.locator('h2').textContent()).toBe('Links of Plan');
		await page.keyboard.press('Escape');
		// Trash, then Restore from the Trash branch.
		await recent.focus();
		await page.keyboard.press('Shift+F10');
		await tree(page).locator('.menu [data-action="trash"]').click();
		await settle(page);
		await expect.poll(() => row(page, `recent:${id}`).count()).toBe(0);
		await row(page, 'trash').locator(':scope > .label').click();
		const trashed = row(page, `trash:${id}`);
		await trashed.waitFor();
		expect(await trashed.getAttribute('aria-label')).toMatch(/^Plan, Trashed .+, kept until .+$/);
		await trashed.focus();
		await page.keyboard.press('Shift+F10');
		expect(await tree(page).locator('.menu [role="menuitem"]').allTextContents()).toEqual([
			'Restore',
			'Links',
		]);
		await page.keyboard.press('Enter');
		await settle(page);
		await expect.poll(() => row(page, `recent:${id}`).count()).toBe(1);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it("P2-D8: the list's filter, type and status, and the trash's Restore", async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		const roadmap = await createNote(page, 'Roadmap');
		await createNote(page, 'Ideas');
		await documentsSection(page);
		const section = page.locator('loam-main loam-documents-section');
		const titles = () => section.locator('tbody tr td:first-child').allTextContents();
		await expect.poll(titles).toEqual(expect.arrayContaining(['Roadmap', 'Ideas']));
		await section.locator('input[type="search"]').fill('road');
		await expect.poll(titles).toEqual(['Roadmap']);
		await expect.poll(() => section.locator('.said').textContent()).toBe('1 document');
		await section.locator('input[type="search"]').fill('');
		await kernelCall(page, 'document-trash', { document: roadmap });
		await expect.poll(titles).toEqual(['Ideas']);
		await section.locator('select[data-ref="status"]').selectOption('trashed');
		await expect.poll(() => section.locator('h1').textContent()).toBe('Trash');
		await expect.poll(titles).toEqual(['Roadmap']);
		expect(await section.locator('tbody tr').first().textContent()).toMatch(
			/Trashed .+, kept until .+/
		);
		await section.getByRole('button', { name: 'Restore Roadmap' }).click();
		await expect.poll(titles).toEqual([]);
		await expect.poll(() => section.locator('.empty').textContent()).toBe('The trash is empty');
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it("P2-D8: a project's home shows its documents by type, and a link opens one", async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		const atlas = (await kernelCall(page, 'project-get', { project: 'atlas' })) as {
			data: { id: string };
		};
		const id = await createNote(page, 'Atlas plan', atlas.data.id);
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await kernelCall(page, 'section-open', { section: 'projects' });
		const card = page.locator('loam-projects-section article[aria-labelledby="card-documents"]');
		await card.waitFor();
		expect((await card.locator('h3').allTextContents()).sort()).toEqual(['Memo: 0', 'Note: 1']);
		const link = card.locator('a', { hasText: 'Atlas plan' });
		expect(await link.getAttribute('href')).toBe(`${site.root}personal/p/atlas/~/documents/${id}`);
		await link.click();
		await editorIdle(page);
		await expect
			.poll(async () => (await editorView(page))?.[0]?.tabs.map((tab) => tab.title))
			.toEqual(['Atlas plan']);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('P2-D8: a hostile title in a record renders as text, in the tree, the list, the palette and the card', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		await createNote(page, HOSTILE);
		await documentsSection(page);
		await page.evaluate(() =>
			(
				document.querySelector('loam-shell') as unknown as {
					openPalette(q?: string): Promise<void>;
				}
			).openPalette('img')
		);
		await expect
			.poll(() => page.locator('loam-palette violet-option .result-name').allTextContents())
			.toContain(HOSTILE);
		expect(await deepText(page, 'violet-tree-item > .label')).toContain(HOSTILE);
		expect(await deepText(page, 'tbody a[data-document]')).toContain(HOSTILE);
		expect(await deepText(page, 'img')).toEqual([]);
		expect(await page.title()).not.toBe('1');
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it("P2-D8: a non-member sees nothing of a restricted project's documents, in the tree, the list, the palette or New", async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		await kernelCall(page, 'auth-sign-in', {
			method: 'credentials',
			email: 'someone@example.com',
			password: 'x',
		});
		await kernelCall(page, 'project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: ['mock-user-someone@example.com'] },
		});
		const vault = (await kernelCall(page, 'project-get', { project: 'vault' })) as {
			data: { id: string };
		};
		await createNote(page, 'Vault secret', vault.data.id);
		await kernelCall(page, 'auth-sign-out');
		await documentsSection(page);
		const section = page.locator('loam-main loam-documents-section');
		await section.locator('input[type="checkbox"]').check();
		await settle(page);
		expect(await deepText(page, 'violet-tree-item > .label')).not.toContain('Vault secret');
		expect(await section.locator('tbody').textContent()).not.toContain('Vault secret');
		const searched = (await kernelCall(page, 'palette-search', { query: 'vault' })) as {
			data: { items: Array<{ title?: string }> };
		};
		expect(searched.data.items.map((item) => item.title)).not.toContain('Vault secret');
		// New lists types and creators, never documents: nothing of the vault there either.
		const listed = (await kernelCall(page, 'new-list')) as { data: { items: unknown[] } };
		expect(JSON.stringify(listed.data.items)).not.toContain('Vault');
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});
});

describe("an app's tree sidebar", () => {
	it("is loam-tree, nested, from the documents chunk, and a choice is the app's selection", async () => {
		const site = await serveDeployment({
			config: deploymentFile(deploymentEntry('outline', await outlineApp(fixtures))),
		});
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		await kernelCall(page, 'app-open', { instance: 'outline' });
		await surfacesIdle(page);
		const sidebar = page.locator('loam-sidebar loam-tree');
		await sidebar.locator('violet-tree-item[data-id="guides"]').waitFor();
		expect(await page.locator('loam-sidebar loam-list').count()).toBe(0);
		expect(await sidebar.locator('violet-tree').getAttribute('aria-label')).toBe('Outline');
		// Nested, each level its own: Right opens a branch, Down enters it.
		// Each opened branch's children render on FAST's next update, as a person's next key comes later.
		const shown = (id: string) =>
			expect
				.poll(() => sidebar.locator(`violet-tree-item[data-id="${id}"]`).isVisible())
				.toBe(true);
		await sidebar.locator('violet-tree-item[data-id="guides"]').focus();
		await page.keyboard.press('ArrowRight');
		await shown('start');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowRight');
		await shown('install');
		await page.keyboard.press('ArrowDown');
		const install = sidebar.locator('violet-tree-item[data-id="install"]');
		expect((await focusedOn(page)).text).toBe('InstallFive minutes');
		expect(await install.getAttribute('aria-level')).toBe('3');
		expect(await install.getAttribute('aria-label')).toBe('Install, Five minutes');
		await page.keyboard.press('Enter');
		await settle(page);
		const selected = (await kernelCall(page, 'app-selection-get', { instance: 'outline' })) as {
			data: { id: string | null };
		};
		expect(selected.data.id).toBe('install');
		// A hostile title is text.
		expect(await deepText(page, 'violet-tree-item > .label')).toContain(HOSTILE);
		expect(await deepText(page, 'img')).toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
		await site.close();
	});
});

describe.each(['/', '/loam/'])(
	"P2-E8: the documents section's and a document's shapes, with base_path = %s",
	(basePath) => {
		let site: DeploymentSite;
		beforeAll(async () => {
			site = await fullDeployment(basePath);
		});
		afterAll(async () => {
			await site?.close();
		});
		const pathOf = (page: Page) => new URL(page.url()).pathname;

		it('P2-E8: /<ws>/~/documents shows the list, and /<ws>/p/<slug>/~/documents/<id> opens that document', async () => {
			const first = await openShell(browser, site.root);
			await surfacesIdle(first.page);
			await kernelCall(first.page, 'project-create', { name: 'Atlas' });
			const atlas = (await kernelCall(first.page, 'project-get', { project: 'atlas' })) as {
				data: { id: string };
			};
			const id = await createNote(first.page, 'Deep', atlas.data.id);
			await settle(first.page);
			await first.page.close();
			// The same profile, so the same store, one tab at a time (phase 0's writer lock).
			const list = await openShell(browser, `${site.root}personal/~/documents`, {}, first.context);
			await editorIdle(list.page);
			await list.page.locator('loam-main loam-documents-section h1').waitFor();
			expect(pathOf(list.page)).toBe(`${basePath}personal/~/documents`);
			expect(await list.page.locator('loam-sidebar loam-documents-sidebar').count()).toBe(1);
			await list.page.close();
			const deep = await openShell(
				browser,
				`${site.root}personal/p/atlas/~/documents/${id}`,
				{},
				first.context
			);
			await editorIdle(deep.page);
			await expect
				.poll(async () => (await editorView(deep.page))?.[0]?.tabs.map((tab) => tab.title))
				.toEqual(['Deep']);
			expect(pathOf(deep.page)).toBe(`${basePath}personal/p/atlas/~/documents/${id}`);
			const opens = (await journal(deep.page)).filter((entry) => entry.command === 'document-open');
			expect(opens.map((entry) => entry.input)).toEqual([{ document: id }]);
			expect([...first.errors, ...list.errors, ...deep.errors]).toEqual([]);
			expect([...list.violations, ...deep.violations]).toEqual([]);
			await first.context.close();
		});
	}
);
