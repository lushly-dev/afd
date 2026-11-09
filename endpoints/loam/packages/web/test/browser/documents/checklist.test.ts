/**
 * D2 (documents specification, 14; step 13): a second document type lands with no shell change. `checklist`,
 * a view, packed from `apps/checklist` and named only by its `[apps.checklist]` entry in the deployment file
 * this suite writes, on a second origin: it appears in New, creates, opens in a real sandboxed frame beside a
 * note and works through its handler frame; and its document works with its view closed, by
 * `checklist-item-add` from an agent (`kernel.agent`) and through the person's palette interface, as the
 * coordinator amended D2 on 2026-11-09: the palette runs only commands that need no input, and a prompt for
 * one waits for phase 4. With hello and notes, D8's `new-list` holds it at both
 * levels. D10 for its view: axe inside its frame and on the page beside a note, in each theme and density and
 * under forced colors, with its keyboard and its states.
 */

import { type Browser, chromium, type Frame, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	axe,
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
import {
	checklistFrame,
	createNote,
	editorIdle,
	editorView,
	entriesOf,
	open,
	replayDifferences,
	settledAxe,
} from './support';

let browser: Browser;
/** Hello, notes and checklist, each from its packed package, with the sandbox on a second origin. */
let site: DeploymentSite;

beforeAll(async () => {
	browser = await chromium.launch();
	const [hello, notes, checklist] = await Promise.all([
		packApp('hello'),
		packApp('notes'),
		packApp('checklist'),
	]);
	site = await serveDeployment({
		sandbox: true,
		config: deploymentFile(
			deploymentEntry('hello', hello),
			deploymentEntry('notes', notes),
			deploymentEntry('checklist', checklist)
		),
	});
}, 120_000);

afterAll(async () => {
	await site?.close();
	await browser?.close();
});

interface Item {
	id: string;
	text: string;
	done: boolean;
}

/** What the editor shows: each item's text and state, as its `checkbox` names them. */
const shownItems = (frame: Frame) =>
	frame.evaluate(() =>
		[...document.querySelectorAll('#items button.item')].map(
			(item) =>
				`${item.getAttribute('aria-checked') === 'true' ? '[x]' : '[ ]'} ${item.textContent?.replace('✓', '').trim()}`
		)
	);

/** The focused element inside the frame. */
const focusedIn = (frame: Frame) =>
	frame.evaluate(() => {
		const element = document.activeElement as HTMLElement | null;
		return {
			role: element?.getAttribute('role') ?? element?.localName ?? '',
			name: element?.getAttribute('aria-label') ?? element?.textContent?.trim() ?? '',
		};
	});

/** The checklist's items as stored, read by an agent. */
const stored = async (page: Page, document: string) =>
	(
		(await agentCall(page, 'checklist-get', { document })) as {
			data?: { items: Item[] };
		}
	).data?.items.map((item) => `${item.done ? '[x]' : '[ ]'} ${item.text}`);

/** A tab's unsaved mark, as the kernel keeps it. */
const marked = async (page: Page, document: string) =>
	(
		(await kernelCall(page, 'editor-get')) as {
			data?: { groups: Array<{ tabs: Array<{ document: string; dirty: boolean }> }> };
		}
	).data?.groups
		.flatMap((group) => group.tabs)
		.find((each) => each.document === document)?.dirty;

/** What the page's kernel announces from now on: each event's command and whether it succeeded. */
async function heard(
	page: Page
): Promise<() => Promise<Array<{ command: string; success: boolean }>>> {
	await page.evaluate(() => {
		const shell = document.querySelector('loam-shell') as unknown as {
			kernel: { subscribe(listener: (event: { command: string; success: boolean }) => void): void };
		};
		const events: Array<{ command: string; success: boolean }> = [];
		(window as unknown as { heard: typeof events }).heard = events;
		shell.kernel.subscribe(({ command, success }) => events.push({ command, success }));
	});
	return () =>
		page.evaluate(
			() => (window as unknown as { heard: Array<{ command: string; success: boolean }> }).heard
		);
}

const newButton = (page: Page) => page.locator('loam-titlebar .new > button');
const menuItems = (page: Page) => page.locator('loam-new-menu violet-menu-item');

describe('P2-D2: a second document type lands with no shell change', () => {
	it('P2-D2: checklist appears in New from its deployment entry alone, creates, opens in a real sandboxed frame beside a note, and works through its handler frame', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		// The deployment names it, and nothing else does: the kernel lists its type from its manifest.
		const types = (await kernelCall(page, 'document-type-list')) as {
			data: { types: Array<{ id: string; editorKind: string; instance: string }> };
		};
		expect(types.data.types.map((type) => [type.id, type.editorKind, type.instance])).toEqual(
			expect.arrayContaining([
				['checklist', 'view', 'checklist'],
				['notes', 'native', 'notes'],
			])
		);
		// D8 with hello, notes and checklist: its template in `new-list` at the workspace and in a project.
		const titles = async () =>
			(
				(await kernelCall(page, 'new-list')) as { data: { items: Array<{ title: string }> } }
			).data.items.map((item) => item.title);
		expect(await titles()).toEqual(expect.arrayContaining(['Blank checklist', 'Blank note']));
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await settle(page);
		expect(await titles()).toEqual(expect.arrayContaining(['Blank checklist', 'Blank note']));
		await kernelCall(page, 'scope-set', { project: null });
		await settle(page);

		// A note open first, then New's Blank checklist, beside it.
		const note = await createNote(page, 'Shopping notes');
		await open(page, note, { preview: false });
		await newButton(page).click();
		await expect
			.poll(() => menuItems(page).allTextContents())
			.toEqual(expect.arrayContaining(['Blank checklist', 'Blank note']));
		await menuItems(page).filter({ hasText: 'Blank checklist' }).click();
		await editorIdle(page);
		const created = (await journal(page)).find(
			(entry) =>
				entry.command === 'document-create' &&
				(entry.input as { type?: string }).type === 'checklist'
		);
		expect(created?.success).toBe(true);
		const listed = (await kernelCall(page, 'document-list', { type: 'checklist' })) as {
			data: { documents: Array<{ id: string; title: string }> };
		};
		const checklist = listed.data.documents[0]?.id as string;
		expect(listed.data.documents.map((item) => item.title)).toEqual(['Blank checklist']);
		// New opened it in the note's group, active; the note goes beside it, so each shows.
		await expect
			.poll(async () =>
				(await editorView(page))?.map((group) => group.tabs.map((tab) => tab.title))
			)
			.toEqual([['Shopping notes', 'Blank checklist']]);
		await kernelCall(page, 'document-rename', { document: checklist, title: 'Groceries' });
		await open(page, note, { group: 'beside' });
		await expect
			.poll(async () =>
				(await editorView(page))?.map((group) =>
					group.tabs.filter((tab) => tab.selected).map((tab) => tab.title)
				)
			)
			.toEqual([['Groceries'], ['Shopping notes']]);

		// A real sandboxed frame: the proxy on the second origin, as phase 1's E2 has it, and the view opaque
		// inside it, reaching nothing of the shell.
		const proxy = await page.evaluate(() => {
			const view = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-editor-frame loam-view-frame');
			const frame = view?.shadowRoot?.querySelector('iframe');
			return { src: frame?.src ?? '', sandbox: frame?.getAttribute('sandbox') ?? null };
		});
		expect(new URL(proxy.src).origin).toBe(site.sandbox?.origin);
		expect(new URL(proxy.src).origin).not.toBe(site.origin);
		expect(proxy.sandbox).toBe('allow-scripts allow-same-origin allow-forms');
		const frame = await checklistFrame(page, 'Groceries');
		expect(await frame.evaluate(() => self.origin)).toBe('null');
		expect(
			await frame.evaluate(() => {
				try {
					return String(parent.document);
				} catch (cause) {
					return (cause as Error).name;
				}
			})
		).toBe('SecurityError');
		expect(await shownItems(frame)).toEqual([]);
		expect(await frame.locator('.empty').isVisible()).toBe(true);

		// It works through its handler frame: an add, a tick, a remove, each journaled from the view.
		const events = await heard(page);
		await frame.getByLabel('New item').fill('Milk');
		await frame.getByLabel('New item').press('Enter');
		await expect.poll(() => shownItems(frame)).toEqual(['[ ] Milk']);
		await expect.poll(() => frame.locator('#status').textContent()).toBe('Added Milk.');
		await frame.getByLabel('New item').fill('Bread');
		await frame.getByRole('button', { name: 'Add', exact: true }).click();
		await expect.poll(() => shownItems(frame)).toEqual(['[ ] Milk', '[ ] Bread']);
		await frame.getByRole('checkbox', { name: 'Milk' }).click();
		await expect.poll(() => shownItems(frame)).toEqual(['[x] Milk', '[ ] Bread']);
		expect(await frame.locator('#summary').textContent()).toBe('1 of 2 done');
		const fromView = (await journal(page)).filter((entry) =>
			entry.command.startsWith('checklist-item-')
		);
		expect(fromView.map((entry) => [entry.command, entry.success, entry.context?.caller])).toEqual([
			['checklist-item-add', true, 'checklist'],
			['checklist-item-add', true, 'checklist'],
			['checklist-item-toggle', true, 'checklist'],
		]);
		expect(await page.locator('body > iframe[aria-hidden="true"]').count()).toBe(1);
		// It holds no draft, so its tab is never unsaved.
		expect(await marked(page, checklist)).toBe(false);
		// Its selection is an item, in its binding's shape, which `editor-selection-set` checks.
		await frame.getByRole('checkbox', { name: 'Bread' }).focus();
		await expect
			.poll(async () =>
				(await events())
					.filter((event) => event.command === 'editor-selection-set')
					.map((event) => event.success)
			)
			.toContain(true);
		expect(
			(await events())
				.filter((event) => event.command === 'editor-selection-set')
				.every((event) => event.success)
		).toBe(true);

		// An agent's change reaches the open view, and a rename its title.
		await agentCall(page, 'checklist-item-add', { document: checklist, text: 'Eggs' });
		await expect.poll(() => shownItems(frame)).toEqual(['[x] Milk', '[ ] Bread', '[ ] Eggs']);
		await agentCall(page, 'document-rename', { document: checklist, title: 'Groceries, Friday' });
		await expect.poll(() => frame.locator('h1').textContent()).toBe('Groceries, Friday');
		// Removing the focused item focuses the next, and says so politely.
		await frame.getByRole('button', { name: 'Remove Bread' }).focus();
		await page.keyboard.press('Enter');
		await expect.poll(() => shownItems(frame)).toEqual(['[x] Milk', '[ ] Eggs']);
		await expect.poll(() => focusedIn(frame)).toEqual({ role: 'checkbox', name: 'Eggs' });
		expect(await frame.locator('#status').textContent()).toBe('Removed Bread.');
		// The person's undo of the removal, through its `undoCommand`, puts it back in place.
		const removal = (await entriesOf(page)).findLast(
			(entry) => entry.command === 'checklist-item-remove'
		);
		expect(removal?.result.success).toBe(true);
		expect(removal?.result.undoCommand).toBe('checklist-item-add');
		await kernelCall(page, removal?.result.undoCommand as string, removal?.result.undoArgs);
		await expect.poll(() => shownItems(frame)).toEqual(['[x] Milk', '[ ] Bread', '[ ] Eggs']);
		expect(await stored(page, checklist)).toEqual(['[x] Milk', '[ ] Bread', '[ ] Eggs']);
		expect(await marked(page, checklist)).toBe(false);
		await editorIdle(page);

		// The journal, with checklist's real handlers, replays with no difference.
		expect(await replayDifferences(site, await entriesOf(page))).toEqual([]);
		expect(opened.violations).toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 120_000);

	it('P2-D2: its document works with its view closed, through checklist-item-add from an agent and the person’s palette interface', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		const created = (await kernelCall(page, 'document-create', {
			type: 'checklist',
			title: 'Packing',
		})) as { data: { id: string } };
		const checklist = created.data.id;
		expect(await page.locator('body > iframe').count()).toBe(0);
		// No view has opened: each call goes through the handler frame alone. First an agent's.
		const fromAgent = (await agentCall(page, 'checklist-item-add', {
			document: checklist,
			text: 'Map',
		})) as { success: boolean; data?: { item: Item } };
		expect(fromAgent.success).toBe(true);
		expect(fromAgent.data?.item).toMatchObject({ text: 'Map', done: false });
		expect(await stored(page, checklist)).toEqual(['[ ] Map']);
		expect(await page.locator('loam-view-frame').count()).toBe(0);
		// Then the person's, through the palette interface.
		const added = (await kernelCall(page, 'checklist-item-add', {
			document: checklist,
			text: 'Tent',
		})) as { success: boolean; undoCommand?: string; data?: { item: Item } };
		expect(added.success).toBe(true);
		expect(added.undoCommand).toBe('checklist-item-remove');
		await kernelCall(page, 'checklist-item-toggle', {
			document: checklist,
			item: added.data?.item.id,
		});
		expect(await page.locator('loam-view-frame').count()).toBe(0);
		expect(await page.locator('body > iframe[aria-hidden="true"]').count()).toBe(1);
		const entries = (await journal(page)).filter((entry) =>
			entry.command.startsWith('checklist-item-')
		);
		// The journal records who called each by its interface: the agent's, then the person's palette.
		expect(entries.map((entry) => [entry.command, entry.interface, entry.success])).toEqual([
			['checklist-item-add', 'agent', true],
			['checklist-item-add', 'palette', true],
			['checklist-item-toggle', 'palette', true],
		]);
		expect(await stored(page, checklist)).toEqual(['[ ] Map', '[x] Tent']);
		// The palette's own rows: with its view closed checklist is neither the active app nor the editor's owner,
		// so its commands are not listed; with its tab active they are, needing a document and text, which the
		// palette does not ask for (phase 0's "needs input").
		const listed = async () =>
			(
				(await kernelCall(page, 'palette-search', { query: 'checklist', limit: 20 })) as {
					data: { items: Array<{ name: string }> };
				}
			).data.items
				.map((item) => item.name)
				.filter((name) => name.startsWith('checklist-'));
		expect(await listed()).toEqual([]);
		// Opened afterwards, the view shows what was done with it closed.
		await open(page, checklist, { preview: false });
		const frame = await checklistFrame(page, 'Packing');
		expect(await shownItems(frame)).toEqual(['[ ] Map', '[x] Tent']);
		expect((await listed()).sort()).toEqual([
			'checklist-get',
			'checklist-item-add',
			'checklist-item-remove',
			'checklist-item-toggle',
		]);
		await page.evaluate(() =>
			(
				document.querySelector('loam-shell') as unknown as {
					openPalette(q?: string): Promise<void>;
				}
			).openPalette()
		);
		const field = page.locator('loam-palette input.field');
		await field.waitFor();
		await field.fill('Add a checklist item');
		const option = page.locator('loam-palette violet-option[data-command="checklist-item-add"]');
		await expect.poll(() => option.count()).toBe(1);
		expect(await option.textContent()).toContain('(needs input)');
		await page.keyboard.press('Escape');
		expect(await replayDifferences(site, await entriesOf(page))).toEqual([]);
		expect(opened.violations).toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 120_000);
});

/** A raw `tools/call` from inside a view's frame, as its own code would send it to the shell's broker. */
function callFromView(frame: Frame, name: string, args: unknown): Promise<unknown> {
	return frame.evaluate(
		([name, args]) =>
			new Promise<unknown>((resolve) => {
				const id = `probe-${Math.random()}`;
				const listen = (event: MessageEvent) => {
					if (event.data?.id !== id) return;
					removeEventListener('message', listen);
					resolve(event.data.result ?? event.data.error);
				};
				addEventListener('message', listen);
				parent.postMessage(
					{ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
					'*'
				);
			}),
		[name, args] as const
	);
}

/** An answer with what a clock or a counter decides taken out, so two answers compare by their bytes. */
const settled = (answer: unknown) =>
	JSON.stringify(answer)
		.replace(/"executionTimeMs":\d+/g, '"executionTimeMs":0')
		.replace(/"traceId":"[^"]*"/g, '"traceId":""');

describe('P2-D2: the shell checks checklist’s calls first', () => {
	it('P2-D2: refuses the wrong type and another project’s checklist from the person, and answers the view’s cross-project read as a missing id', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await kernelCall(page, 'project-create', { name: 'Beacon' });
		const create = async (type: string, title: string, project: string) =>
			(
				(await kernelCall(page, 'document-create', { type, title, project })) as {
					data: { id: string };
				}
			).data.id;
		const here = await create('checklist', 'Here', 'atlas');
		const note = await create('notes', 'A note', 'atlas');
		const there = await create('checklist', 'There', 'beacon');
		// Beacon's checklist holds an item, added in Beacon.
		await kernelCall(page, 'scope-set', { project: 'beacon' });
		await settle(page);
		const secret = (await agentCall(page, 'checklist-item-add', {
			document: there,
			text: 'Secret',
		})) as { success: boolean };
		expect(secret.success).toBe(true);
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await settle(page);
		// The wrong type: a note, named to checklist's command.
		const wrong = (await kernelCall(page, 'checklist-get', { document: note })) as {
			success: boolean;
			error?: { code: string };
		};
		expect(wrong.success).toBe(false);
		expect(wrong.error?.code).toBe('DOCUMENT_TYPE_MISMATCH');
		// Another project: the person in Atlas, Beacon's checklist.
		const across = (await kernelCall(page, 'checklist-item-add', {
			document: there,
			text: 'From Atlas',
		})) as { success: boolean; error?: { code: string; message: string } };
		expect(across.success).toBe(false);
		expect(across.error?.code).toBe('SCOPE_MISMATCH');
		expect(across.error?.message).toContain('Beacon');
		// Nothing was written there, as Beacon reads it.
		await kernelCall(page, 'scope-set', { project: 'beacon' });
		await settle(page);
		expect(await stored(page, there)).toEqual(['[ ] Secret']);
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await settle(page);
		// From its view in Atlas, Beacon's checklist answers the same bytes as an id that does not exist.
		await open(page, here, { preview: false });
		const frame = await checklistFrame(page, 'Here');
		const beacon = await callFromView(frame, 'checklist-get', { document: there });
		const missing = await callFromView(frame, 'checklist-get', { document: 'doc_000000000000' });
		expect(settled(beacon)).not.toContain('Secret');
		expect(settled(beacon)).toBe(settled(missing));
		expect(settled(beacon)).toContain('DOCUMENT_NOT_FOUND');
		const journaled = (await journal(page)).filter(
			(entry) => entry.command === 'checklist-item-add' && !entry.success
		);
		expect(journaled.map((entry) => entry.error?.code)).toEqual(['SCOPE_MISMATCH']);
		expect(opened.violations).toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 120_000);
});

/** The frame's own colors, as its stylesheet resolves the tokens the shell pushed. */
const colorsIn = (frame: Frame) =>
	frame.evaluate(() => {
		const body = getComputedStyle(document.body);
		return { background: body.backgroundColor, text: body.color };
	});

describe('P2-D10: checklist’s view editor', () => {
	it('P2-D10: has no violation inside its frame or on the page beside a note, with items done and not, an invalid field and its message, in each theme and density and under forced colors', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		const note = await createNote(page, 'Beside');
		const checklist = (
			(await kernelCall(page, 'document-create', { type: 'checklist', title: 'Chores' })) as {
				data: { id: string };
			}
		).data.id;
		for (const text of ['Sweep', 'Water the plants', 'Take the bins out'])
			await agentCall(page, 'checklist-item-add', { document: checklist, text });
		await open(page, note, { preview: false });
		await open(page, checklist, { group: 'beside' });
		const frame = await checklistFrame(page, 'Chores');
		await frame.getByRole('checkbox', { name: 'Sweep' }).click();
		await expect.poll(() => shownItems(frame)).toContain('[x] Sweep');
		// An empty add: the field says invalid, described by the message, and nothing is called.
		await frame.getByRole('button', { name: 'Add', exact: true }).click();
		expect(await frame.getByLabel('New item').getAttribute('aria-invalid')).toBe('true');
		expect(await frame.getByLabel('New item').getAttribute('aria-describedby')).toBe('status');
		expect(await frame.locator('#status').textContent()).toBe('Write the item first.');
		const seen = new Set<string>();
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			for (const density of ['comfortable', 'compact'] as const) {
				await kernelCall(page, 'appearance-set', { theme, density });
				await editorIdle(page);
				// The view follows the shell's theme through `dev.loam/tokens`.
				const colors = JSON.stringify(await colorsIn(frame));
				if (density === 'comfortable') seen.add(colors);
				expect(await axe(frame), `inside the frame, ${theme} ${density}`).toEqual([]);
				expect(await settledAxe(page), `${theme} ${density}`).toEqual([]);
			}
		}
		expect(seen.size).toBe(3);
		await kernelCall(page, 'appearance-set', { theme: 'light', density: 'comfortable' });
		await page.emulateMedia({ forcedColors: 'active' });
		await editorIdle(page);
		expect(await axe(frame), 'inside the frame, forced colors').toEqual([]);
		expect(await settledAxe(page), 'forced colors').toEqual([]);
		await page.emulateMedia({ forcedColors: 'none' });
		expect(opened.violations).toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 120_000);

	it('P2-D10: works by keyboard: Tab from the field reaches each item and its Remove, Space ticks, Enter adds, and every target is at least 24 pixels', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await surfacesIdle(page);
		const checklist = (
			(await kernelCall(page, 'document-create', { type: 'checklist', title: 'Keys' })) as {
				data: { id: string };
			}
		).data.id;
		await open(page, checklist, { preview: false });
		const frame = await checklistFrame(page, 'Keys');
		await frame.getByLabel('New item').focus();
		await page.keyboard.type('First');
		await page.keyboard.press('Enter');
		await expect.poll(() => shownItems(frame)).toEqual(['[ ] First']);
		// Focus stays in the field, emptied, for the next item.
		expect(await frame.getByLabel('New item').inputValue()).toBe('');
		expect((await focusedIn(frame)).role).toBe('input');
		await page.keyboard.type('Second');
		await page.keyboard.press('Enter');
		await expect.poll(() => shownItems(frame)).toEqual(['[ ] First', '[ ] Second']);
		const order: string[] = [];
		for (let step = 0; step < 5; step++) {
			await page.keyboard.press('Tab');
			const { role, name } = await focusedIn(frame);
			order.push(`${role}:${name}`);
		}
		expect(order).toEqual([
			'button:Add',
			'checkbox:First',
			'button:Remove First',
			'checkbox:Second',
			'button:Remove Second',
		]);
		await page.keyboard.press('Shift+Tab');
		await page.keyboard.press('Space');
		await expect.poll(() => shownItems(frame)).toEqual(['[ ] First', '[x] Second']);
		expect(await frame.getByRole('checkbox', { name: 'Second' }).getAttribute('aria-checked')).toBe(
			'true'
		);
		// The done state is not color alone: a tick and a line through its text.
		expect(
			await frame
				.getByRole('checkbox', { name: 'Second' })
				.evaluate((item) => [
					item.querySelector('.box')?.textContent,
					getComputedStyle(item.querySelector('.text') as Element).textDecorationLine,
				])
		).toEqual(['✓', 'line-through']);
		for (const density of ['comfortable', 'compact'] as const) {
			await kernelCall(page, 'appearance-set', { theme: 'light', density });
			await editorIdle(page);
			const sizes = await frame.evaluate(() =>
				[...document.querySelectorAll('button, input')].map((control) => {
					const { width, height } = control.getBoundingClientRect();
					return Math.min(width, height);
				})
			);
			expect(Math.min(...sizes), density).toBeGreaterThanOrEqual(24);
		}
		expect(await marked(page, checklist)).toBe(false);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 120_000);
});
