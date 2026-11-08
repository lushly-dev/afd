/**
 * The editor area and `notes` (documents specification, 5, 6 and 10; step 10): D1's first half, two notes
 * side by side that restore after a reload, with no `document-open` journaled for it and a replay with no
 * difference; D5's native half, the area's keyboard, preview, pinning, saving, parking, scopes and overlays;
 * and D7, one model in many editors. Links, backlinks and the inspector are step 12's half of D1.
 */

import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	kernelCall,
	openShell,
	packApp,
	serveDeployment,
} from '../harness';
import {
	createNote,
	editorIdle,
	editorView,
	entriesOf,
	frameViolations,
	replayDifferences,
	typeInto,
} from './support';

let browser: Browser;
let site: DeploymentSite;

beforeAll(async () => {
	browser = await chromium.launch();
	site = await serveDeployment({
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello')),
			deploymentEntry('notes', await packApp('notes'))
		),
	});
});

afterAll(async () => {
	await site?.close();
	await browser?.close();
});

/** The note's stored text, as an agent reads it. */
const stored = async (page: Page, document: string) =>
	((await agentCall(page, 'notes-content-get', { document })) as { data?: { text: string } }).data
		?.text;

/** Open `document` and wait for its editor. */
async function open(page: Page, id: string, options: Record<string, unknown> = {}) {
	await kernelCall(page, 'document-open', { document: id, ...options });
	await editorIdle(page);
	await page.waitForFunction(() => {
		const area = document
			.querySelector('loam-shell')
			?.shadowRoot?.querySelector('loam-main')
			?.querySelector('loam-editor-area');
		return [...(area?.querySelectorAll('loam-editor-frame:not([hidden])') ?? [])].every(
			(frame) => (frame as unknown as { state: string }).state !== 'loading'
		);
	});
}

describe('P2-D1: two notes side by side, restored after a reload', () => {
	it('P2-D1: opens two notes beside each other, each in its own tablist with its editor, and restores both after a reload with no document-open journaled for it', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const alpha = await createNote(page, 'Alpha');
		const beta = await createNote(page, 'Beta');
		await open(page, alpha);
		await open(page, beta);
		// `Open beside`, from Beta's tab menu, by the keyboard (5.8).
		await page.locator('loam-editor-group [role="tab"][aria-selected="true"]').focus();
		await page.keyboard.press('Shift+F10');
		await page.locator('loam-editor-group [role="menuitem"]', { hasText: 'Open beside' }).click();
		await editorIdle(page);
		// Alpha, in the first group, by a press on its tab.
		await page
			.locator('loam-editor-group')
			.first()
			.locator('[role="tab"]', { hasText: 'Alpha' })
			.click();
		await editorIdle(page);
		let view = await editorView(page);
		expect(view?.map((group) => group.label)).toEqual(['Documents, group 1', 'Documents, group 2']);
		expect(view?.map((group) => group.tabs.find((tab) => tab.selected)?.title)).toEqual([
			'Alpha',
			'Beta',
		]);
		// Each group's active tab has its editor in the deep DOM.
		expect(view?.map((group) => group.editors.filter((each) => !each.hidden).length)).toEqual([
			1, 1,
		]);
		const [alphaTab] = (view?.[0]?.editors ?? [])
			.filter((each) => !each.hidden)
			.map((each) => each.tab);
		await typeInto(page, alphaTab as string, 'Alpha text');
		await page.keyboard.press('ControlOrMeta+s');
		// Within autosave's 2,000 ms, so Mod+S saved it.
		await expect.poll(() => stored(page, alpha), { timeout: 1500 }).toBe('Alpha text');
		await editorIdle(page);
		const url = page.url();
		expect(new URL(url).pathname).toBe(`/personal/~/documents/${alpha}`);
		// The view state's debounced write, as a person's `pagehide` asks for it (#660's loss aside).
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { flush(): Promise<void> };
			};
			await shell.kernel.flush();
		});
		const before = (await entriesOf(page)).length;

		// A reload with the editor's chunk held: the first frame is busy, with no landing (6).
		site.hold(/\/assets\/editor-/);
		await page.reload();
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await page.waitForFunction(() => {
			const main = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-main');
			return main?.getAttribute('aria-busy') === 'true';
		});
		const landing = await page.evaluate(() => {
			const main = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-main');
			const shown = main?.shadowRoot?.querySelector('.landing');
			return shown ? getComputedStyle(shown).display : 'none';
		});
		expect(landing).toBe('none');
		site.release();
		await page.waitForFunction(
			() =>
				document
					.querySelector('loam-shell')
					?.shadowRoot?.querySelector('loam-main')
					?.querySelectorAll('loam-editor-frame notes-editor, loam-editor-frame loam-mount')
					.length !== 0
		);
		await expect
			.poll(async () => (await editorView(page))?.flatMap((group) => group.editors).length)
			.toBe(2);
		await editorIdle(page);
		view = await editorView(page);
		expect(view?.map((group) => group.tabs.find((tab) => tab.selected)?.title)).toEqual([
			'Alpha',
			'Beta',
		]);
		expect(page.url()).toBe(url);
		// Main is busy no more once the area owns it: `aria-busy` and the busy heading are gone (6).
		await expect
			.poll(() =>
				page.evaluate(() => {
					const main = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-main');
					return [
						main?.getAttribute('aria-busy') ?? null,
						main?.querySelectorAll('h1.announce').length,
					];
				})
			)
			.toEqual([null, 0]);
		await expect
			.poll(async () => (await editorView(page))?.[0]?.editors.find((each) => !each.hidden)?.text)
			.toBe('Alpha text');
		const entries = await entriesOf(page);
		// No `document-open` for the restore, as phase 1's reopen has it; a `document-get` at boot is journaled.
		expect(entries.slice(before).map((entry) => entry.command)).not.toContain('document-open');
		expect(entries.slice(before).map((entry) => entry.command)).toContain('document-get');
		for (const entry of entries) {
			expect(
				(entry as { context?: { scope?: unknown } }).context?.scope,
				`${entry.seq} ${entry.command}`
			).toBeDefined();
		}
		expect(opened.errors).toEqual([]);
		await opened.context.close();
		expect(await replayDifferences(site, entries)).toEqual([]);
	}, 90_000);
});

/** The focused element, through shadow roots: its role and its name or text. */
const focusedOn = (page: Page) =>
	page.evaluate(() => {
		let element: Element | null = document.activeElement;
		while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
		return {
			tag: element?.tagName.toLowerCase() ?? '',
			role: element?.getAttribute('role') ?? null,
			label: element?.getAttribute('aria-label') ?? '',
		};
	});

/** The tab strip's tab named `title`, in group `group` (from 0). */
const tabOf = (page: Page, title: string, group = 0) =>
	page.locator('loam-editor-group').nth(group).locator('[role="tab"]', { hasText: title });

/** What the seeded walk leaves on the page: each save held until a step resolves or rejects it. */
type Walk = Window & {
	pending?: Array<{ resolve: () => void; reject: () => void }>;
	reopens?: number;
	reopenOpens?: number;
	gate?: boolean;
	gates?: Array<() => void>;
};

/** The fewest reopens a walk's seed may reach, so its coverage cannot drop unseen. */
const REOPEN_FLOOR = 1;

/** What `trashOnClear` leaves on the page: what the agent's trash answered. */
type Trapped = Window & { trapped?: { success: boolean; error?: { code: string } } };

/**
 * When the area clears the mark of `tab`, an agent trashes `note` at once, through the same page: what that
 * trash answered is kept for {@link trapped}.
 */
async function trashOnClear(page: Page, note: string, tab: string): Promise<void> {
	await page.evaluate(
		({ note, tab }) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: {
					call(name: string, input?: unknown, options?: unknown): Promise<unknown>;
					agent: { call(name: string, input: unknown): Promise<unknown> };
				};
			};
			const call = shell.kernel.call.bind(shell.kernel);
			const held = window as Trapped;
			shell.kernel.call = async (name: string, input?: unknown, options?: unknown) => {
				const answer = await call(name, input, options);
				const asked = input as { tab?: string; dirty?: boolean } | undefined;
				if (
					name === 'editor-dirty-set' &&
					asked?.tab === tab &&
					asked.dirty === false &&
					!held.trapped
				) {
					held.trapped = (await shell.kernel.agent.call('document-trash', {
						document: note,
					})) as Trapped['trapped'];
				}
				return answer;
			};
		},
		{ note, tab }
	);
}
const trapped = (page: Page) => page.evaluate(() => (window as Trapped).trapped);

/** What `failSaves` leaves on the page: each held save, by tab, and whether saves now reject at once. */
type FailedSaves = Window & {
	failSaves?: Array<() => void>;
	heldSaves?: Array<{ tab: string; fail: () => void; pass: () => void }>;
	failNow?: boolean;
};

/** Hold every later save of each tab's frame, autosave's too, until {@link failAll} rejects them. */
async function failSaves(page: Page, tabs: string[]): Promise<void> {
	await page.evaluate((tabs) => {
		const shell = document.querySelector('loam-shell') as unknown as {
			editor: { lifecycle: [unknown, Map<string, { save(): Promise<void> }>] };
		};
		const held = window as FailedSaves;
		held.failSaves ??= [];
		held.heldSaves ??= [];
		for (const tab of tabs) {
			const frame = shell.editor.lifecycle[1].get(tab);
			if (!frame) throw new Error(`No frame for ${tab}`);
			frame.save = () =>
				new Promise<void>((resolve, reject) => {
					const fail = () =>
						reject(Object.assign(new Error('Held, then refused'), { code: 'TEST_REFUSED' }));
					if (held.failNow) fail();
					else {
						held.failSaves?.push(fail);
						held.heldSaves?.push({ tab, fail, pass: () => resolve() });
					}
				});
		}
	}, tabs);
}

/** Wait until the controller holds no frame for any of `tabs`, as once their tabs close. */
async function framesGone(page: Page, tabs: string[]): Promise<void> {
	await page.waitForFunction((tabs) => {
		const shell = document.querySelector('loam-shell') as unknown as {
			editor: { lifecycle: [unknown, Map<string, unknown>] };
		};
		return tabs.every((tab) => !shell.editor.lifecycle[1].has(tab));
	}, tabs);
}

/** Settle the saves held for `tab` so far: each resolves, as a save that wrote, or rejects. */
const settleSaves = (page: Page, tab: string, how: 'pass' | 'fail') =>
	page.evaluate(
		({ tab, how }) => {
			const held = window as FailedSaves;
			const mine = (held.heldSaves ?? []).filter((each) => each.tab === tab);
			held.heldSaves = (held.heldSaves ?? []).filter((each) => each.tab !== tab);
			for (const each of mine) each[how]();
		},
		{ tab, how }
	);

/** What the reopen's gate leaves on the page: whether its open was asked, and how to let it run. */
type Gated = Window & { openGate?: () => void; openAsked?: boolean };

/** Hold every frame's saves, autosave's too, in the walk's list, until a test settles them. */
const holdEverySave = (page: Page) =>
	page.evaluate(() => {
		const held = window as Walk;
		held.pending = [];
		const frame = customElements.get('loam-editor-frame')?.prototype as { save(): Promise<void> };
		frame.save = () =>
			new Promise<void>((resolve, reject) => {
				held.pending?.push({
					resolve,
					reject: () => reject(Object.assign(new Error('Held, then refused'), { code: 'TEST' })),
				});
			});
	});

/** Settle only the newest save held for `tab`. */
const settleNewest = (page: Page, tab: string, how: 'pass' | 'fail') =>
	page.evaluate(
		({ tab, how }) => {
			const all = (window as FailedSaves).heldSaves ?? [];
			let index = all.length - 1;
			while (index >= 0 && all[index]?.tab !== tab) index--;
			const [newest] = index < 0 ? [] : all.splice(index, 1);
			newest?.[how]();
		},
		{ tab, how }
	);

/** Settle only the oldest save held for `tab`. */
const settleOldest = (page: Page, tab: string, how: 'pass' | 'fail') =>
	page.evaluate(
		({ tab, how }) => {
			const held = window as FailedSaves;
			const index = (held.heldSaves ?? []).findIndex((each) => each.tab === tab);
			const [oldest] = index < 0 ? [] : (held.heldSaves ?? []).splice(index, 1);
			oldest?.[how]();
		},
		{ tab, how }
	);

/** Whether the controller holds a frame for `tab` that is on the page, with its editor. */
const frameDrawn = (page: Page, tab: string) =>
	page.evaluate((tab) => {
		const shell = document.querySelector('loam-shell') as unknown as {
			editor: { lifecycle: [unknown, Map<string, HTMLElement>] };
		};
		const frame = shell.editor.lifecycle[1].get(tab);
		return !!frame?.isConnected && !!frame.querySelector('loam-mount');
	}, tab);

/** Reject every held save together, and every later one at once. */
const failAll = (page: Page) =>
	page.evaluate(() => {
		const held = window as FailedSaves;
		held.failNow = true;
		for (const fail of held.failSaves?.splice(0) ?? []) fail();
	});

/** Give a tab's `notes-editor` a draft notes' schema refuses, so its save rejects. */
async function longDraft(page: Page, tab: string): Promise<void> {
	await page.evaluate((tab) => {
		const editor = document
			.querySelector('loam-shell')
			?.shadowRoot?.querySelector('loam-main')
			?.querySelector(`loam-editor-frame[data-tab="${tab}"] loam-mount`)
			?.shadowRoot?.querySelector('notes-editor');
		const area = editor?.shadowRoot?.querySelector('violet-text-area') as HTMLElement & {
			value: string;
		};
		area.value = 'x'.repeat(200_001);
		area.dispatchEvent(new CustomEvent('input', { detail: { value: area.value } }));
	}, tab);
}

/** Give a tab's `notes-editor` the draft `text`, as typing does, with no focus or keys: a modal may be open. */
async function editDraft(page: Page, tab: string, text: string): Promise<void> {
	await page.evaluate(
		({ tab, text }) => {
			const editor = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main')
				?.querySelector(`loam-editor-frame[data-tab="${tab}"] loam-mount`)
				?.shadowRoot?.querySelector('notes-editor');
			const area = editor?.shadowRoot?.querySelector('violet-text-area') as HTMLElement & {
				value: string;
			};
			area.value = text;
			area.dispatchEvent(new CustomEvent('input', { detail: { value: text } }));
		},
		{ tab, text }
	);
	await expect.poll(() => draftOf(page, tab)).toBe(text);
}

/** A tab's frame's `notes-editor` draft, by the controller's frames, mounted or parked. */
const draftOf = (page: Page, tab: string) =>
	page.evaluate((tab) => {
		const shell = document.querySelector('loam-shell') as unknown as {
			editor: { lifecycle: [unknown, Map<string, HTMLElement>] };
		};
		const editor = shell.editor.lifecycle[1]
			.get(tab)
			?.querySelector('loam-mount')
			?.shadowRoot?.querySelector('notes-editor') as (HTMLElement & { draft?: string }) | null;
		return editor?.draft ?? null;
	}, tab);
const draftLength = async (page: Page, tab: string) => (await draftOf(page, tab))?.length ?? null;

/** The drafts of the frames showing each document, in order. */
const draftsOf = (page: Page, documents: string[]) =>
	page.evaluate((documents) => {
		const shell = document.querySelector('loam-shell') as unknown as {
			editor: { lifecycle: [unknown, Map<string, HTMLElement & { document: string }>] };
		};
		return documents.map((id) => {
			const frame = [...shell.editor.lifecycle[1].values()].find((each) => each.document === id);
			const editor = frame
				?.querySelector('loam-mount')
				?.shadowRoot?.querySelector('notes-editor') as (HTMLElement & { draft?: string }) | null;
			return editor?.draft ?? null;
		});
	}, documents);

/** What `holdSave` leaves on the page. */
type HeldSave = Window & { releaseSave?: () => void; disposed?: boolean };

/**
 * Hold the next save of `tab`'s frame until {@link releaseSave}, and note when the frame is disposed, which
 * follows anything its retiring does; with `dropRecord`, the frame holds no record.
 */
async function holdSave(page: Page, tab: string, dropRecord = false): Promise<void> {
	await page.evaluate(
		({ tab, dropRecord }) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				editor: { lifecycle: [unknown, Map<string, unknown>] };
			};
			const frame = shell.editor.lifecycle[1].get(tab) as {
				save(): Promise<void>;
				dispose(): Promise<void>;
				record: unknown;
			};
			const held = window as HeldSave;
			frame.save = () =>
				new Promise<void>((resolve) => {
					held.releaseSave = resolve;
				});
			const dispose = frame.dispose.bind(frame);
			frame.dispose = async () => {
				await dispose();
				held.disposed = true;
			};
			if (dropRecord) frame.record = null;
		},
		{ tab, dropRecord }
	);
}

/** Resolve the held save, and wait until its frame has retired. */
async function releaseSave(page: Page): Promise<void> {
	await page.evaluate(() => (window as HeldSave).releaseSave?.());
	await page.waitForFunction(() => (window as HeldSave).disposed === true);
	await editorIdle(page);
}

/** The journal's `editor-dirty-set { dirty: false }` entries from entry `from`, with their scopes. */
const clears = async (page: Page, from: number) =>
	(await entriesOf(page))
		.slice(from)
		.filter(
			(entry) =>
				entry.command === 'editor-dirty-set' && (entry.input as { dirty?: boolean }).dirty === false
		)
		.map((entry) => entry.context);

/** The first group's first tab: its accessible name, and whether the kernel holds it dirty. */
const tabName = (page: Page) => editorView(page).then((view) => view?.[0]?.tabs[0]?.name);
const dirtyOf = async (page: Page) =>
	(
		(await agentCall(page, 'editor-get')) as {
			data: { groups: Array<{ tabs: Array<{ dirty: boolean }> }> };
		}
	).data.groups[0]?.tabs[0]?.dirty;

/** The text area of the tab's editor. */
const textOf = (page: Page, tab: string) =>
	page.locator(`loam-editor-frame[data-tab="${tab}"] textarea`);

/** Each group's visible editor's draft, in order. */
const drafts = async (page: Page) =>
	((await editorView(page)) ?? []).map(
		(group) => group.editors.find((each) => !each.hidden)?.text ?? null
	);

describe('P2-D5: the editor area, native half', () => {
	it('P2-D5: the strip by keyboard: arrows, Home and End move and activate, Enter enters the editor, Delete closes and focus goes to the next tab', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		for (const title of ['One', 'Two', 'Three']) await open(page, await createNote(page, title));
		await tabOf(page, 'Three').focus();
		await page.keyboard.press('ArrowLeft');
		await editorIdle(page);
		expect(await focusedOn(page)).toMatchObject({ role: 'tab', label: 'Two' });
		expect((await editorView(page))?.[0]?.tabs.find((tab) => tab.selected)?.title).toBe('Two');
		await page.keyboard.press('Home');
		await editorIdle(page);
		expect(await focusedOn(page)).toMatchObject({ role: 'tab', label: 'One' });
		await page.keyboard.press('End');
		await editorIdle(page);
		expect(await focusedOn(page)).toMatchObject({ role: 'tab', label: 'Three' });
		await page.keyboard.press('Enter');
		await editorIdle(page);
		expect((await focusedOn(page)).tag).toBe('textarea');
		// The pointer's close and menu buttons: hidden, out of the Tab order, and never focused by a press. The
		// tab says how the keyboard reaches both, and Tab from it goes to the editor, past them.
		const buttons = await page.evaluate(() =>
			[
				...(document
					.querySelector('loam-shell')
					?.shadowRoot?.querySelector('loam-main')
					?.querySelector('loam-editor-group')
					?.shadowRoot?.querySelectorAll('.close, .more') ?? []),
			].map((button) => [button.getAttribute('tabindex'), button.getAttribute('aria-hidden')])
		);
		expect(buttons).toHaveLength(6);
		expect(new Set(buttons.map((pair) => pair.join()))).toEqual(new Set(['-1,true']));
		const mac = await page.evaluate(
			() => (document.querySelector('loam-shell') as unknown as { mac: boolean }).mac
		);
		const described = await tabOf(page, 'Three').evaluate((tab) => {
			const root = tab.getRootNode() as ShadowRoot;
			return [
				tab.getAttribute('aria-keyshortcuts'),
				root
					.getElementById(tab.getAttribute('aria-describedby') ?? '')
					?.textContent?.replace(/\s+/g, ' ')
					.trim(),
			];
		});
		expect(described).toEqual(
			mac
				? [
						'Delete Backspace Shift+F10',
						'Delete or Backspace closes the tab. Shift+F10 opens its menu.',
					]
				: ['Delete Shift+F10', 'Delete closes the tab. Shift+F10 opens its menu.']
		);
		await tabOf(page, 'Three').focus();
		await page.keyboard.press('Tab');
		expect((await focusedOn(page)).tag).toBe('textarea');
		// A pointer's menu gives focus back to what had it, the editor; the keyboard's, to the tab (APG).
		await page.locator('loam-editor-group .item[data-tab="t3"] .more').click();
		expect((await focusedOn(page)).role).toBe('menuitem');
		await page.keyboard.press('Escape');
		expect((await focusedOn(page)).tag).toBe('textarea');
		await tabOf(page, 'Three').focus();
		await page.keyboard.press('Shift+F10');
		expect(await page.locator('loam-editor-group [role="menu"]').getAttribute('aria-label')).toBe(
			'Actions for Three'
		);
		await page.keyboard.press('Escape');
		expect(await focusedOn(page)).toMatchObject({ role: 'tab', label: 'Three' });
		// Tab from the menu moves on, to the editor, as APG's menu has it.
		await page.keyboard.press('Shift+F10');
		await page.keyboard.press('Tab');
		expect((await focusedOn(page)).tag).toBe('textarea');

		// The strip reordering keeps focus on its tab: pinning it, which moves it first.
		await tabOf(page, 'Three').focus();
		await page.keyboard.press('Shift+F10');
		await page.keyboard.press('Enter');
		await editorIdle(page);
		expect((await editorView(page))?.[0]?.tabs.map((tab) => tab.title)).toEqual([
			'Three',
			'One',
			'Two',
		]);
		expect(await focusedOn(page)).toMatchObject({ role: 'tab', label: 'Three, pinned' });
		// An agent closing another tab, before it in the strip, leaves focus where it is.
		await tabOf(page, 'Two').focus();
		await agentCall(page, 'editor-close', { tab: 't1' });
		await editorIdle(page);
		expect(await focusedOn(page)).toMatchObject({ role: 'tab', label: 'Two' });
		// Moved to a new group, focus follows the tab there.
		await page.keyboard.press('Shift+F10');
		await page
			.locator('loam-editor-group [role="menuitem"]', { hasText: 'Move to a new group' })
			.click();
		await editorIdle(page);
		expect((await editorView(page))?.map((group) => group.tabs.map((tab) => tab.title))).toEqual([
			['Three'],
			['Two'],
		]);
		const there = await page.evaluate(() => {
			const groups = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main')
				?.querySelectorAll('loam-editor-group');
			return [...(groups ?? [])].map(
				(group) => group.shadowRoot?.activeElement?.getAttribute('aria-label') ?? null
			);
		});
		expect(there).toEqual([null, 'Two']);
		expect(await focusedOn(page)).toMatchObject({ role: 'tab', label: 'Two' });

		// Delete in the group that is not active keeps focus in that group (APG Tabs): the first group gets a
		// second note, then the second group is made active again.
		await agentCall(page, 'editor-activate', { tab: 't3' });
		await open(page, await createNote(page, 'Four'));
		await agentCall(page, 'editor-activate', { tab: 't2' });
		await editorIdle(page);
		await page.evaluate(() => {
			const group = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main')
				?.querySelectorAll('loam-editor-group')[0];
			(
				group?.shadowRoot?.querySelector('button.tab[aria-selected="true"]') as HTMLElement | null
			)?.focus();
		});
		expect(await focusedOn(page)).toMatchObject({ role: 'tab', label: 'Four' });
		const before = (await editorView(page))?.[0]?.tabs.map((tab) => tab.title);
		await page.keyboard.press(mac ? 'Backspace' : 'Delete');
		await editorIdle(page);
		expect((await editorView(page))?.[0]?.tabs.length).toBe((before?.length ?? 0) - 1);
		const inGroup = await page.evaluate(() => {
			const group = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main')
				?.querySelectorAll('loam-editor-group')[0];
			return group?.shadowRoot?.activeElement?.getAttribute('role') ?? null;
		});
		expect(inGroup).toBe('tab');
		expect(await focusedOn(page)).toMatchObject({ role: 'tab', label: 'Three, pinned' });
		if (!mac) {
			// Elsewhere, Backspace is no close key.
			const count = (await editorView(page))?.[0]?.tabs.length;
			await page.keyboard.press('Backspace');
			await editorIdle(page);
			expect((await editorView(page))?.[0]?.tabs.length).toBe(count);
		}

		// An agent moving the focused tab: focus follows it into the group it moved to.
		const groups = (
			(await kernelCall(page, 'editor-get')) as { data: { groups: Array<{ id: string }> } }
		).data.groups;
		await tabOf(page, 'Three').focus();
		await agentCall(page, 'editor-move', { tab: 't3', group: groups[1]?.id });
		await editorIdle(page);
		expect((await editorView(page))?.map((group) => group.tabs.map((tab) => tab.title))).toEqual([
			['Three', 'Two'],
		]);
		expect(await focusedOn(page)).toMatchObject({ role: 'tab', label: 'Three, pinned' });
		// An agent closing the focused tab: focus goes to its group's new active tab, and with none, to main.
		await agentCall(page, 'editor-close', { tab: 't3' });
		await editorIdle(page);
		expect(await focusedOn(page)).toMatchObject({ role: 'tab', label: 'Two' });
		await agentCall(page, 'editor-close', { tab: 't2' });
		await editorIdle(page);
		expect((await focusedOn(page)).tag).toBe('loam-main');
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('P2-D5: a preview tab says so, the next preview replaces it, and a pinned tab says so and stays', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const one = await createNote(page, 'One');
		const two = await createNote(page, 'Two');
		await open(page, one, { preview: true });
		expect((await editorView(page))?.[0]?.tabs.map((tab) => tab.name)).toEqual(['One (preview)']);
		await open(page, two, { preview: true });
		expect((await editorView(page))?.[0]?.tabs.map((tab) => tab.name)).toEqual(['Two (preview)']);
		await tabOf(page, 'Two').focus();
		await page.keyboard.press('Shift+F10');
		await page.locator('loam-editor-group [role="menuitem"]', { hasText: 'Pin' }).click();
		await editorIdle(page);
		expect((await editorView(page))?.[0]?.tabs.map((tab) => tab.name)).toEqual(['Two, pinned']);
		await open(page, one, { preview: true });
		expect((await editorView(page))?.[0]?.tabs.map((tab) => tab.name)).toEqual([
			'Two, pinned',
			'One (preview)',
		]);
		await opened.context.close();
	});

	it('P2-D5: saves after autosave_ms, on a dirty close, and keeps a tab dirty with a toast when its save rejects, asking before a discard', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const one = await createNote(page, 'One');
		await open(page, one);
		await typeInto(page, 't1', 'Saved by the timer');
		await expect
			.poll(() => editorView(page).then((view) => view?.[0]?.tabs[0]?.name))
			.toBe('One, unsaved');
		await expect.poll(() => stored(page, one), { timeout: 6000 }).toBe('Saved by the timer');
		await expect.poll(() => editorView(page).then((view) => view?.[0]?.tabs[0]?.name)).toBe('One');
		// A dirty close of a type that autosaves saves first.
		await page.keyboard.type(', then closed');
		await tabOf(page, 'One').focus();
		await page.keyboard.press('Delete');
		await expect.poll(() => stored(page, one)).toBe('Saved by the timer, then closed');
		await editorIdle(page);
		expect((await editorView(page))?.[0]?.tabs).toEqual([]);

		// A draft notes' schema refuses: its save rejects, the tab stays dirty, and a toast says why.
		await open(page, one);
		await page.evaluate(() => {
			const editor = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main')
				?.querySelector('loam-editor-frame loam-mount')
				?.shadowRoot?.querySelector('notes-editor');
			const area = editor?.shadowRoot?.querySelector('violet-text-area') as HTMLElement & {
				value: string;
			};
			area.value = 'x'.repeat(200_001);
			area.dispatchEvent(new CustomEvent('input', { detail: { value: area.value } }));
		});
		await textOf(page, 't2').focus();
		await page.keyboard.press('ControlOrMeta+s');
		await expect
			.poll(async () =>
				JSON.stringify((await kernelCall(page, 'overlay-list')) as unknown).includes(
					'was not saved'
				)
			)
			.toBe(true);
		const toasts = (await kernelCall(page, 'overlay-list')) as {
			data: { overlays: Array<{ kind: string; input: { tone?: string; message: string } }> };
		};
		expect(toasts.data.overlays.find((each) => each.kind === 'toast')?.input).toMatchObject({
			tone: 'danger',
		});
		expect((await editorView(page))?.[0]?.tabs[0]?.name).toBe('One, unsaved');
		// Its close asks, and Keep editing keeps it; Discard closes it.
		await tabOf(page, 'One').focus();
		await page.keyboard.press('Delete');
		await page.locator('loam-modal button', { hasText: 'Keep editing' }).click();
		await editorIdle(page);
		expect((await editorView(page))?.[0]?.tabs.map((tab) => tab.title)).toEqual(['One']);
		await tabOf(page, 'One').focus();
		await page.keyboard.press('Delete');
		await page.locator('loam-modal button', { hasText: 'Discard' }).click();
		await editorIdle(page);
		expect((await editorView(page))?.[0]?.tabs).toEqual([]);
		expect(await stored(page, one)).toBe('Saved by the timer, then closed');
		await opened.context.close();
	});

	it('P2-D5: an agent marking an unsaved tab saved, then closing it, loses nothing: the tab is unsaved again, and a close saves first', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const one = await createNote(page, 'One');
		await open(page, one);
		const dirty = async () =>
			(
				(await agentCall(page, 'editor-get')) as {
					data: { groups: Array<{ tabs: Array<{ dirty: boolean }> }> };
				}
			).data.groups[0]?.tabs[0]?.dirty;
		// Within autosave's 2,000 ms, so only the chrome's fixes save it.
		await typeInto(page, 't1', 'Not an agent’s to drop');
		await agentCall(page, 'editor-dirty-set', { tab: 't1', dirty: false });
		await expect.poll(dirty, { timeout: 1500 }).toBe(true);
		expect(
			((await agentCall(page, 'editor-close', { tab: 't1' })) as { error?: { code: string } }).error
				?.code
		).toBe('EDITOR_TAB_DIRTY');
		await agentCall(page, 'editor-close', { tab: 't1', discard: true });
		await expect.poll(() => stored(page, one), { timeout: 1500 }).toBe('Not an agent’s to drop');
		await editorIdle(page);
		expect((await editorView(page))?.[0]?.tabs).toEqual([]);
		// Marked saved and closed at once: the text is saved, and the tab is closed or refused, never dropped.
		await open(page, one);
		await textOf(page, 't2').click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.type(', twice');
		await agentCall(page, 'editor-dirty-set', { tab: 't2', dirty: false });
		const closed = (await agentCall(page, 'editor-close', { tab: 't2' })) as {
			success: boolean;
			error?: { code: string };
		};
		expect(closed.success || closed.error?.code === 'EDITOR_TAB_DIRTY').toBe(true);
		await expect
			.poll(() => stored(page, one), { timeout: 6000 })
			.toBe('Not an agent’s to drop, twice');
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it("P2-D5: an agent's trash or move of an open note with unsaved text is refused, the text kept, and once the person saves, the trash runs", async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		const note = await createNote(page, 'Kept');
		await open(page, note);
		// Within autosave's 2,000 ms, so the text is held by the editor alone.
		await typeInto(page, 't1', 'Not to be lost');
		for (const [name, input] of [
			['document-trash', { document: note }],
			['document-move', { document: note, project: 'atlas' }],
			['editor-dirty-set', { tab: 't1', dirty: false }],
		] as const) {
			const refused = (await agentCall(page, name, input)) as { error?: { code: string } };
			expect(refused.error?.code, name).toBe('EDITOR_TAB_DIRTY');
		}
		expect((await editorView(page))?.[0]?.editors.find((each) => !each.hidden)?.text).toBe(
			'Not to be lost'
		);
		// The person saves, and then the trash runs; restored, the note holds the text.
		await page.keyboard.press('ControlOrMeta+s');
		await expect.poll(() => stored(page, note)).toBe('Not to be lost');
		await expect.poll(() => tabName(page)).toBe('Kept');
		expect(
			((await agentCall(page, 'document-trash', { document: note })) as { success: boolean })
				.success
		).toBe(true);
		await kernelCall(page, 'document-restore', { document: note });
		expect(await stored(page, note)).toBe('Not to be lost');
		// An agent's close with discard: true keeps the mark: the editor saves, its save clears the mark from the
		// person's page, and only then does a trash run.
		await open(page, note);
		await textOf(page, 't2').click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.type(', twice');
		await agentCall(page, 'editor-close', { tab: 't2', discard: true });
		await expect.poll(() => stored(page, note), { timeout: 1500 }).toBe('Not to be lost, twice');
		await expect
			.poll(
				async () =>
					((await agentCall(page, 'document-trash', { document: note })) as { success: boolean })
						.success
			)
			.toBe(true);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('P2-D5: a clean tab an agent marked unsaved and closed leaves no mark behind, so a trash then runs', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const note = await createNote(page, 'Clean');
		await open(page, note);
		const ok = async (name: string, input: unknown) =>
			((await agentCall(page, name, input)) as { success: boolean }).success;
		expect(await ok('editor-dirty-set', { tab: 't1', dirty: true })).toBe(true);
		expect(await ok('editor-close', { tab: 't1', discard: true })).toBe(true);
		await editorIdle(page);
		// The clean frame clears the mark the agent's close kept, from the person's page.
		await expect.poll(() => ok('document-trash', { document: note })).toBe(true);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it("P2-D5: a save that rejects after an agent's close keeps the draft, in a tab again, unsaved, and once the person discards it a trash runs", async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const note = await createNote(page, 'Long');
		await open(page, note);
		// A draft notes' schema refuses, so its save rejects.
		await page.evaluate(() => {
			const editor = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main')
				?.querySelector('loam-editor-frame loam-mount')
				?.shadowRoot?.querySelector('notes-editor');
			const area = editor?.shadowRoot?.querySelector('violet-text-area') as HTMLElement & {
				value: string;
			};
			area.value = 'x'.repeat(200_001);
			area.dispatchEvent(new CustomEvent('input', { detail: { value: area.value } }));
		});
		await expect.poll(() => tabName(page)).toBe('Long, unsaved');
		await trashOnClear(page, note, 't1');
		expect(
			(
				(await agentCall(page, 'editor-close', { tab: 't1', discard: true })) as {
					success: boolean;
				}
			).success
		).toBe(true);
		// The danger toast says it was not saved, and the draft is back, whole, in a tab of its own, unsaved.
		await expect
			.poll(async () =>
				JSON.stringify(await kernelCall(page, 'overlay-list')).includes('was not saved')
			)
			.toBe(true);
		await expect
			.poll(
				async () =>
					(await editorView(page))?.[0]?.editors.find((each) => !each.hidden)?.text?.length
			)
			.toBe(200_001);
		await expect
			.poll(async () => (await editorView(page))?.[0]?.tabs.map((each) => each.name))
			.toEqual(['Long, unsaved']);
		const read = (await agentCall(page, 'editor-get')) as {
			data: { groups: Array<{ tabs: Array<{ id: string; dirty: boolean }> }> };
		};
		expect(read.data.groups[0]?.tabs).toMatchObject([{ id: 't2', dirty: true }]);
		// A trash the moment the closed tab's mark went met the new tab's mark.
		expect((await trapped(page))?.error?.code).toBe('EDITOR_TAB_DIRTY');
		// A trash waits on it, naming the tab that holds it now.
		const refused = (await agentCall(page, 'document-trash', { document: note })) as {
			error?: { code: string; suggestion: string };
		};
		expect(refused.error?.code).toBe('EDITOR_TAB_DIRTY');
		expect(refused.error?.suggestion).toContain('editor-close { tab: "t2", discard: true }');
		// The person discards it; then the trash runs.
		await tabOf(page, 'Long').focus();
		await page.keyboard.press('Delete');
		await page.locator('loam-modal button', { hasText: 'Discard' }).click();
		await editorIdle(page);
		await expect
			.poll(
				async () =>
					((await agentCall(page, 'document-trash', { document: note })) as { success: boolean })
						.success
			)
			.toBe(true);
		await opened.context.close();
	});

	it('P2-D5: the re-report of an unsaved tab goes to the scope it was rendered in, not one the person switched to meanwhile', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		// Note B in Atlas, open there as its t1; note A in the workspace, open as its t1, and edited.
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await open(page, await createNote(page, 'Bee', 'atlas'));
		await kernelCall(page, 'scope-set', { project: null });
		await open(page, await createNote(page, 'Ay'));
		await typeInto(page, 't1', 'Unsaved');
		await expect.poll(() => tabName(page)).toBe('Ay, unsaved');
		// The area's next editor-get answer waits on a gate.
		await page.evaluate(() => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { call(name: string, ...rest: unknown[]): Promise<unknown> };
			};
			const call = shell.kernel.call.bind(shell.kernel);
			const held = new Promise<void>((resolve) => {
				(window as unknown as { openGate: () => void }).openGate = resolve;
			});
			let once = true;
			shell.kernel.call = async (name: string, ...rest: unknown[]) => {
				const answer = await call(name, ...rest);
				if (name === 'editor-get' && once) {
					once = false;
					await held;
				}
				return answer;
			};
		});
		const from = (await entriesOf(page)).length;
		// The person's page marks the tab saved while its editor is not: the area will report it unsaved again,
		// from a read of the workspace, after the person has switched to Atlas.
		await kernelCall(page, 'editor-dirty-set', { tab: 't1', dirty: false });
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await page.evaluate(() => (window as unknown as { openGate: () => void }).openGate());
		await editorIdle(page);
		const reported = async () =>
			(await entriesOf(page))
				.slice(from)
				.filter(
					(entry) =>
						entry.command === 'editor-dirty-set' &&
						(entry.input as { dirty?: boolean }).dirty === true
				)
				.map((entry) => (entry.context as { scope?: unknown }).scope);
		await expect.poll(async () => (await reported()).length).toBe(1);
		expect(await reported()).toEqual([{ workspace: 'personal' }]);
		const atlas = (await agentCall(page, 'editor-get')) as {
			data: { groups: Array<{ tabs: Array<{ id: string; dirty: boolean }> }> };
		};
		expect(atlas.data.groups[0]?.tabs).toMatchObject([{ id: 't1', dirty: false }]);
		await opened.context.close();
	});

	it("P2-D5: two saves that reject together after an agent's closes both keep their drafts, in the background, with no URL move", async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const alpha = await createNote(page, 'Alpha');
		const beta = await createNote(page, 'Beta');
		// Each save is held from the first keystroke, so autosave saves nothing either.
		await open(page, alpha);
		await failSaves(page, ['t1']);
		await typeInto(page, 't1', 'Alpha draft');
		await open(page, beta);
		await failSaves(page, ['t2']);
		await typeInto(page, 't2', 'Beta draft');
		await open(page, await createNote(page, 'Gamma'));
		const url = page.url();
		await agentCall(page, 'editor-close', { tab: 't1', discard: true });
		await agentCall(page, 'editor-close', { tab: 't2', discard: true });
		// Both retiring frames' saves are held; then they reject together.
		await framesGone(page, ['t1', 't2']);
		await failAll(page);
		// Both drafts are back, each in a tab of its document, unsaved; Gamma stays active and the URL with it.
		await expect.poll(() => draftsOf(page, [alpha, beta])).toEqual(['Alpha draft', 'Beta draft']);
		await editorIdle(page);
		const read = (await agentCall(page, 'editor-get')) as {
			data: {
				groups: Array<{
					active: string;
					tabs: Array<{ id: string; document: string; dirty: boolean }>;
				}>;
			};
		};
		const tabs = read.data.groups[0]?.tabs ?? [];
		expect(tabs.filter((tab) => tab.document !== alpha && tab.document !== beta)).toMatchObject([
			{ id: 't3' },
		]);
		expect(read.data.groups[0]?.active).toBe('t3');
		await expect
			.poll(async () =>
				(((await agentCall(page, 'editor-get')) as typeof read).data.groups[0]?.tabs ?? [])
					.filter((tab) => tab.document === alpha || tab.document === beta)
					.map((tab) => tab.dirty)
			)
			.toEqual([true, true]);
		expect(page.url()).toBe(url);
		await opened.context.close();
	});

	it("P2-D5: two active tabs' saves that reject together after an agent's closes both keep their drafts", async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const alpha = await createNote(page, 'Alpha');
		const beta = await createNote(page, 'Beta');
		// Each the active tab of its own group, so each comes back active and is drawn as its group's frame.
		await open(page, alpha);
		await failSaves(page, ['t1']);
		await typeInto(page, 't1', 'Alpha draft');
		await open(page, beta, { group: 'beside' });
		await failSaves(page, ['t2']);
		await typeInto(page, 't2', 'Beta draft');
		await agentCall(page, 'editor-close', { tab: 't1', discard: true });
		await agentCall(page, 'editor-close', { tab: 't2', discard: true });
		await framesGone(page, ['t1', 't2']);
		await failAll(page);
		await expect.poll(() => draftsOf(page, [alpha, beta])).toEqual(['Alpha draft', 'Beta draft']);
		await opened.context.close();
	});

	it('P2-D5: a reopen after a rejected save never takes the person back to a scope they left', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		const note = await createNote(page, 'Here');
		await open(page, note);
		await failSaves(page, ['t1']);
		await typeInto(page, 't1', 'A draft');
		await agentCall(page, 'editor-close', { tab: 't1', discard: true });
		await framesGone(page, ['t1']);
		// The toast and the area's next read of the scope wait on a gate, so its check of the scope passes.
		await page.evaluate(() => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { call(name: string, ...rest: unknown[]): Promise<unknown> };
			};
			const call = shell.kernel.call.bind(shell.kernel);
			const held = new Promise<void>((resolve) => {
				(window as unknown as { openGate: () => void }).openGate = resolve;
			});
			shell.kernel.call = async (name: string, ...rest: unknown[]) => {
				const answer = await call(name, ...rest);
				if (name === 'toast-show' || name === 'scope-get') await held;
				return answer;
			};
		});
		await failAll(page);
		// Between the toast and the reopen, the person goes to Atlas.
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { agent: { call(name: string, input: unknown): Promise<unknown> } };
			};
			// The person's own call, through the kernel underneath the gate.
			await (
				shell.kernel as unknown as { call(name: string, input: unknown): Promise<unknown> }
			).call('scope-set', { project: 'atlas' });
		});
		await page.evaluate(() => (window as unknown as { openGate: () => void }).openGate());
		await editorIdle(page);
		const scope = (await kernelCall(page, 'scope-get')) as { data: { project?: { slug: string } } };
		expect(scope.data.project?.slug).toBe('atlas');
		await expect.poll(() => new URL(page.url()).pathname).toContain('/p/atlas');
		await opened.context.close();
	});

	it('P2-D5: a rejected save whose document is open in the active group, with a clean editor, takes that tab', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const note = await createNote(page, 'Twice');
		await open(page, note);
		await open(page, note, { group: 'beside' });
		await longDraft(page, 't2');
		await expect
			.poll(async () => (await editorView(page))?.[1]?.tabs[0]?.name)
			.toBe('Twice, unsaved');
		await kernelCall(page, 'editor-activate', { tab: 't1' });
		await editorIdle(page);
		await trashOnClear(page, note, 't2');
		await agentCall(page, 'editor-close', { tab: 't2', discard: true });
		// The draft is in t1, the active group's tab of the same note, and t1 is unsaved.
		await expect.poll(() => draftLength(page, 't1')).toBe(200_001);
		await expect
			.poll(async () => (await editorView(page))?.[0]?.tabs.map((tab) => tab.name))
			.toEqual(['Twice, unsaved']);
		await expect.poll(async () => (await trapped(page))?.error?.code).toBe('EDITOR_TAB_DIRTY');
		await opened.context.close();
	});

	it('P2-D5: a rejected draft in the background, or beside an unsaved editor, is marked before its closed tab’s mark goes', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		// In the background: Gamma active, Alpha's draft refused.
		const alpha = await createNote(page, 'Alpha');
		await open(page, alpha);
		await longDraft(page, 't1');
		await open(page, await createNote(page, 'Gamma'));
		await trashOnClear(page, alpha, 't1');
		await agentCall(page, 'editor-close', { tab: 't1', discard: true });
		await expect
			.poll(() => draftsOf(page, [alpha]).then((drafts) => drafts[0]?.length))
			.toBe(200_001);
		await expect.poll(async () => (await trapped(page))?.error?.code).toBe('EDITOR_TAB_DIRTY');
		await opened.context.close();
	});

	it('P2-D5: a rejected draft whose document is open in the active group with an unsaved editor opens beside, marked first', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const note = await createNote(page, 'Twice');
		await open(page, note);
		await open(page, note, { group: 'beside' });
		await longDraft(page, 't1');
		await longDraft(page, 't2');
		await kernelCall(page, 'editor-activate', { tab: 't1' });
		await editorIdle(page);
		await trashOnClear(page, note, 't2');
		await agentCall(page, 'editor-close', { tab: 't2', discard: true });
		// t1 keeps its own draft; t2's comes back beside it, in a new tab, unsaved.
		await expect
			.poll(async () => {
				const view = (await editorView(page)) ?? [];
				return view.map((group) => group.tabs.map((tab) => tab.name));
			})
			.toEqual([['Twice, unsaved'], ['Twice, unsaved']]);
		await expect.poll(() => draftLength(page, 't3')).toBe(200_001);
		await expect.poll(async () => (await trapped(page))?.error?.code).toBe('EDITOR_TAB_DIRTY');
		await opened.context.close();
	});

	it('P2-D5: a rejected draft takes its document’s tab in another group when that tab’s editor is clean', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const note = await createNote(page, 'Thrice');
		await open(page, note);
		await open(page, note, { group: 'beside' });
		await open(page, note, { group: 'beside' });
		// t1, active, and t3 hold refused drafts; t2's editor is clean.
		await longDraft(page, 't1');
		await longDraft(page, 't3');
		await kernelCall(page, 'editor-activate', { tab: 't1' });
		await editorIdle(page);
		await agentCall(page, 'editor-close', { tab: 't3', discard: true });
		await expect.poll(() => draftLength(page, 't2')).toBe(200_001);
		expect(await draftLength(page, 't1')).toBe(200_001);
		await opened.context.close();
	});

	it('P2-D5: an eleventh editor parked while its save rejects stays, with its draft, in its tab', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await open(page, await createNote(page, 'First'));
		await longDraft(page, 't1');
		await expect.poll(() => tabName(page)).toBe('First, unsaved');
		for (let index = 2; index <= 11; index++)
			await open(page, await createNote(page, `Note ${index}`));
		await editorIdle(page);
		// Parked as the oldest of eleven, its save rejected: its frame is back, with the draft, the tab unsaved.
		await expect.poll(() => draftLength(page, 't1')).toBe(200_001);
		const read = (await agentCall(page, 'editor-get')) as {
			data: { groups: Array<{ tabs: Array<{ id: string; dirty: boolean }> }> };
		};
		expect(read.data.groups[0]?.tabs.find((tab) => tab.id === 't1')?.dirty).toBe(true);
		await opened.context.close();
	});

	it('P2-D5: a parked editor still saving is taken back, with its draft, when the person shows its tab again', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await open(page, await createNote(page, 'First'));
		await failSaves(page, ['t1']);
		await typeInto(page, 't1', 'parked draft');
		// Ten more park it, its save held; the person shows it again while it saves, and then the save rejects.
		for (let index = 2; index <= 11; index++)
			await open(page, await createNote(page, `Note ${index}`));
		await framesGone(page, ['t1']);
		await kernelCall(page, 'editor-activate', { tab: 't1' });
		await editorIdle(page);
		await failAll(page);
		await editorIdle(page);
		await expect.poll(() => draftOf(page, 't1')).toBe('parked draft');
		expect((await editorView(page))?.[0]?.editors.find((each) => !each.hidden)?.tab).toBe('t1');
		await opened.context.close();
	});

	it('P2-D5: a parked editor taken back, edited and parked again keeps its mark and its draft through both saves', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const first = await createNote(page, 'First');
		await open(page, first);
		await failSaves(page, ['t1']);
		await typeInto(page, 't1', 'A');
		const park = async (from: number) => {
			for (let index = from; index < from + 10; index++) {
				await open(page, await createNote(page, `Note ${index}`));
			}
			await framesGone(page, ['t1']);
		};
		// Parked with its save held; taken back and edited; parked again while that first save is pending.
		await park(2);
		await kernelCall(page, 'editor-activate', { tab: 't1' });
		await editorIdle(page);
		await textOf(page, 't1').click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.type('B');
		await park(12);
		// The first save writes what it began with; the frame holds a later edit, so the tab stays unsaved.
		await settleSaves(page, 't1', 'pass');
		await editorIdle(page);
		const dirty = async () =>
			(
				(await agentCall(page, 'editor-get')) as {
					data: { groups: Array<{ tabs: Array<{ id: string; dirty: boolean }> }> };
				}
			).data.groups[0]?.tabs.find((tab) => tab.id === 't1')?.dirty;
		expect(await dirty()).toBe(true);
		expect(
			(
				(await agentCall(page, 'document-trash', { document: first })) as {
					error?: { code: string };
				}
			).error?.code
		).toBe('EDITOR_TAB_DIRTY');
		// The second save rejects: the same frame, never disposed, goes back into its tab with the draft.
		await expect
			.poll(async () => await page.evaluate(() => (window as FailedSaves).heldSaves?.length ?? 0))
			.toBeGreaterThan(0);
		await settleSaves(page, 't1', 'fail');
		await expect.poll(() => draftOf(page, 't1')).toBe('AB');
		expect(await frameDrawn(page, 't1')).toBe(true);
		expect(await dirty()).toBe(true);
		await opened.context.close();
	}, 120_000);

	it('P2-D5: a rejected draft does not take a tab whose parked editor is still saving its own draft', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const note = await createNote(page, 'Shared');
		// t1 in the first group, parked with its save held.
		await open(page, note);
		await failSaves(page, ['t1']);
		await typeInto(page, 't1', 'Parked draft');
		for (let index = 2; index <= 11; index++)
			await open(page, await createNote(page, `Note ${index}`));
		await framesGone(page, ['t1']);
		// The same note beside, t12, with its own draft, its save held; then the first group active again.
		await open(page, note, { group: 'beside' });
		await failSaves(page, ['t12']);
		await typeInto(page, 't12', 'Beside draft');
		await kernelCall(page, 'editor-activate', { tab: 't11' });
		await editorIdle(page);
		await agentCall(page, 'editor-close', { tab: 't12', discard: true });
		await framesGone(page, ['t12']);
		// t12's save rejects first: its draft goes beside, not into t1, whose parked editor is unsaved.
		await settleSaves(page, 't12', 'fail');
		await expect
			.poll(() =>
				page.evaluate((note) => {
					const shell = document.querySelector('loam-shell') as unknown as {
						editor: { lifecycle: [unknown, Map<string, HTMLElement & { document: string }>] };
					};
					return [...shell.editor.lifecycle[1].entries()]
						.filter(([, frame]) => frame.document === note)
						.map(([tab]) => tab);
				}, note)
			)
			.toEqual(['t13']);
		await settleSaves(page, 't1', 'fail');
		await expect.poll(() => draftOf(page, 't1')).toBe('Parked draft');
		expect(await draftOf(page, 't13')).toBe('Beside draft');
		await opened.context.close();
	}, 120_000);

	it('P2-D5: a frame parked again in one scope never lands in another, and its leave ends where it began', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const first = await createNote(page, 'First');
		await open(page, first);
		await failSaves(page, ['t1']);
		await typeInto(page, 't1', 'A');
		const park = async (from: number, project?: string) => {
			for (let index = from; index < from + 10; index++) {
				await open(page, await createNote(page, `Note ${index}`, project));
			}
			await framesGone(page, ['t1']);
		};
		// Parked with its save held, taken back, edited and parked again: a leave queued behind the first.
		await park(2);
		await kernelCall(page, 'editor-activate', { tab: 't1' });
		await editorIdle(page);
		await textOf(page, 't1').click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.type('B');
		await park(12);
		// To another scope, whose own first note is its t1, parked there too.
		await kernelCall(page, 'project-create', { name: 'Elsewhere' });
		await kernelCall(page, 'scope-set', { project: 'elsewhere' });
		await kernelCall(page, 'section-open', { section: 'documents' });
		await editorIdle(page);
		const there = await createNote(page, 'There', 'elsewhere');
		await open(page, there);
		await park(2, 'elsewhere');
		// The first save resolves; the queued leave runs as the scope's going, and holds its own save.
		await settleSaves(page, 't1', 'pass');
		await editorIdle(page);
		await expect
			.poll(() => page.evaluate(() => (window as FailedSaves).heldSaves?.length ?? 0))
			.toBeGreaterThan(0);
		const before = (await entriesOf(page)).length;
		await kernelCall(page, 'editor-activate', { tab: 't1' });
		await editorIdle(page);
		// Elsewhere's t1 is There's, and nothing of First is under it.
		const held = await page.evaluate(() => {
			const shell = document.querySelector('loam-shell') as unknown as {
				editor: { lifecycle: [unknown, Map<string, HTMLElement & { document: string }>] };
			};
			return [...shell.editor.lifecycle[1].values()].map((frame) => frame.document);
		});
		expect(held).toContain(there);
		expect(held).not.toContain(first);
		expect(await draftOf(page, 't1')).not.toBe('AB');
		// The journal settles: no mark is reported again and again.
		await page.waitForTimeout(1000);
		const settled = (await entriesOf(page)).length;
		await page.waitForTimeout(1000);
		expect((await entriesOf(page)).length).toBe(settled);
		const marks = (await entriesOf(page))
			.slice(before)
			.filter((entry) => entry.command === 'editor-dirty-set');
		expect(marks).toEqual([]);
		// The workspace draft's save rejects after its scope went: lost after its toast (Status, deviation 16).
		await settleSaves(page, 't1', 'fail');
		await expect
			.poll(async () =>
				JSON.stringify(await kernelCall(page, 'overlay-list')).includes('was not saved')
			)
			.toBe(true);
		await editorIdle(page);
		expect(await frameViolations(page)).toEqual([]);
		await opened.context.close();
	}, 180_000);

	it('P2-D5: a frame kept back with a park queued leaves the parking map, so a later reopen leaves one frame', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const first = await createNote(page, 'First');
		await open(page, first);
		await failSaves(page, ['t1']);
		await typeInto(page, 't1', 'A');
		const park = async (from: number) => {
			for (let index = from; index < from + 10; index++) {
				await open(page, await createNote(page, `Note ${index}`));
			}
			await framesGone(page, ['t1']);
		};
		await park(2);
		await kernelCall(page, 'editor-activate', { tab: 't1' });
		await editorIdle(page);
		await textOf(page, 't1').click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.type('B');
		await park(12);
		// The first save rejects: kept back in t1, its queued park dropped.
		await settleSaves(page, 't1', 'fail');
		await expect.poll(() => draftOf(page, 't1')).toBe('AB');
		await editorIdle(page);
		// Its own save back, the person saves it, and the note opens beside, where an agent closes it unsaved.
		await page.evaluate(() => {
			const shell = document.querySelector('loam-shell') as unknown as {
				editor: { lifecycle: [unknown, Map<string, { save?: unknown }>] };
			};
			delete (shell.editor.lifecycle[1].get('t1') as { save?: unknown }).save;
		});
		await kernelCall(page, 'editor-activate', { tab: 't1' });
		await editorIdle(page);
		await textOf(page, 't1').click();
		await page.keyboard.press('ControlOrMeta+s');
		await expect.poll(() => stored(page, first)).toBe('AB');
		await open(page, first, { group: 'beside' });
		const read = (await agentCall(page, 'editor-get')) as {
			data: { groups: Array<{ active: string }> };
		};
		const beside = read.data.groups[1]?.active as string;
		await failSaves(page, [beside]);
		await typeInto(page, beside, 'C');
		await agentCall(page, 'editor-close', { tab: beside, discard: true });
		await framesGone(page, [beside]);
		await settleSaves(page, beside, 'fail');
		await editorIdle(page);
		// One frame of the note is on the page, t1's; the one kept back earlier went when t1 took the draft.
		const mounted = await page.evaluate((first) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				shadowRoot: ShadowRoot;
				editor: { lifecycle: [unknown, Map<string, HTMLElement>] };
			};
			const frames = [
				...(shell.shadowRoot.querySelector('loam-main')?.querySelectorAll('loam-editor-frame') ??
					[]),
			].filter((frame) => (frame as unknown as { document: string }).document === first);
			return { count: frames.length, held: frames[0] === shell.editor.lifecycle[1].get('t1') };
		}, first);
		expect(mounted).toEqual({ count: 1, held: true });
		await opened.context.close();
	}, 180_000);

	it('P2-D5: an agent closing a parked editor’s tab while its save is held keeps the draft when that save rejects', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const first = await createNote(page, 'First');
		await open(page, first);
		await failSaves(page, ['t1']);
		await typeInto(page, 't1', 'Parked draft');
		for (let index = 2; index <= 11; index++)
			await open(page, await createNote(page, `Note ${index}`));
		await framesGone(page, ['t1']);
		// An agent closes the parked editor's tab; then its save rejects.
		await agentCall(page, 'editor-close', { tab: 't1', discard: true });
		await editorIdle(page);
		await settleSaves(page, 't1', 'fail');
		await expect.poll(() => draftsOf(page, [first])).toEqual(['Parked draft']);
		await editorIdle(page);
		const refused = (await agentCall(page, 'document-trash', { document: first })) as {
			error?: { code: string };
		};
		expect(refused.error?.code).toBe('EDITOR_TAB_DIRTY');
		await opened.context.close();
	}, 120_000);

	it('P2-D5: the person’s close of a tab finishes in its own scope, whatever scope is active by then', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await open(page, await createNote(page, 'There', 'atlas'));
		await kernelCall(page, 'scope-set', { project: null });
		await kernelCall(page, 'section-open', { section: 'documents' });
		const here = await createNote(page, 'Here');
		await open(page, here);
		await failSaves(page, ['t1']);
		await typeInto(page, 't1', 'Closing');
		// The person closes Here; its save is held while they go to Atlas, whose own t1 is There.
		await tabOf(page, 'Here').focus();
		await page.keyboard.press('Delete');
		await expect
			.poll(() => page.evaluate(() => (window as FailedSaves).heldSaves?.length ?? 0))
			.toBeGreaterThan(0);
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await kernelCall(page, 'section-open', { section: 'documents' });
		await editorIdle(page);
		await settleSaves(page, 't1', 'pass');
		const tabsAt = (options: unknown) =>
			page.evaluate(async (options) => {
				const shell = document.querySelector('loam-shell') as unknown as {
					kernel: {
						agent: {
							call(
								name: string,
								input: unknown,
								options: unknown
							): Promise<{ data?: { groups: Array<{ tabs: Array<{ document: string }> }> } }>;
						};
					};
				};
				const read = await shell.kernel.agent.call('editor-get', {}, options);
				return read.data?.groups.flatMap((group) => group.tabs.map((tab) => tab.document)) ?? [];
			}, options);
		await expect.poll(() => tabsAt({ scope: 'workspace' })).toEqual([]);
		expect((await tabsAt({})).length).toBe(1);
		await editorIdle(page);
		await opened.context.close();
	}, 120_000);

	it('P2-D5: a closed active tab’s editor leaves the page as its save starts, so nothing is typed into it', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await open(page, await createNote(page, 'Gone'));
		await failSaves(page, ['t1']);
		await typeInto(page, 't1', 'Draft');
		await agentCall(page, 'editor-close', { tab: 't1', discard: true });
		await framesGone(page, ['t1']);
		const visible = await page.evaluate(
			() =>
				[
					...(document
						.querySelector('loam-shell')
						?.shadowRoot?.querySelector('loam-main')
						?.querySelectorAll('loam-editor-frame') ?? []),
				].filter((frame) => !(frame as HTMLElement).hidden).length
		);
		expect(visible).toBe(0);
		await editorIdle(page);
		await settleSaves(page, 't1', 'fail');
		await editorIdle(page);
		await opened.context.close();
	}, 120_000);

	it('P2-D5: a queued park of a frame from before a scope round trip never returns to the parking map', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		const first = await createNote(page, 'First');
		await open(page, first);
		await failSaves(page, ['t1']);
		await typeInto(page, 't1', 'A');
		const park = async (from: number) => {
			for (let index = from; index < from + 10; index++) {
				await open(page, await createNote(page, `Note ${index}`));
			}
			await framesGone(page, ['t1']);
		};
		await park(2);
		await kernelCall(page, 'editor-activate', { tab: 't1' });
		await editorIdle(page);
		await textOf(page, 't1').click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.type('B');
		await park(12);
		// To Atlas and back: the same scope, but not the same visit.
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await kernelCall(page, 'section-open', { section: 'documents' });
		await editorIdle(page);
		await kernelCall(page, 'scope-set', { project: null });
		await kernelCall(page, 'section-open', { section: 'documents' });
		await editorIdle(page);
		await settleSaves(page, 't1', 'pass');
		await editorIdle(page);
		const parked = await page.evaluate(() => {
			const shell = document.querySelector('loam-shell') as unknown as {
				editor: { lifecycle: [number, unknown, Map<string, unknown>] };
			};
			return [...shell.editor.lifecycle[2].keys()];
		});
		expect(parked).not.toContain('t1');
		await expect
			.poll(() => page.evaluate(() => (window as FailedSaves).heldSaves?.length ?? 0))
			.toBeGreaterThan(0);
		await settleSaves(page, 't1', 'fail');
		await editorIdle(page);
		await opened.context.close();
	}, 180_000);

	it('P2-D5: an agent marking a tab with no editor unsaved holds nothing: the mark goes, and a trash runs', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const a = await createNote(page, 'Alpha');
		await open(page, a);
		await open(page, await createNote(page, 'Beta'));
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { flush(): Promise<void> };
			};
			await shell.kernel.flush();
		});
		// After a reload only the active tab has an editor; Alpha's tab has none.
		await page.reload();
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						!!document
							.querySelector('loam-shell')
							?.shadowRoot?.querySelector('loam-main loam-editor-area')
				)
			)
			.toBe(true);
		await editorIdle(page);
		expect(
			(
				(await agentCall(page, 'editor-dirty-set', { tab: 't1', dirty: true })) as {
					success: boolean;
				}
			).success
		).toBe(true);
		await editorIdle(page);
		const dirty = (
			(await agentCall(page, 'editor-get')) as {
				data: { groups: Array<{ tabs: Array<{ id: string; dirty: boolean }> }> };
			}
		).data.groups[0]?.tabs.find((tab) => tab.id === 't1')?.dirty;
		expect(dirty).toBe(false);
		expect(
			((await agentCall(page, 'document-trash', { document: a })) as { success: boolean }).success
		).toBe(true);
		await opened.context.close();
	}, 120_000);

	it.each<[string, string]>([
		['untouched', 'goes, with the tab the reopen opened'],
		['typed into after the modal opened', 'is kept, in that tab'],
	])(
		'P2-D5: the person’s Discard of a draft a reopen has meanwhile given to a new tab, %s, %s',
		async (how) => {
			const opened = await openShell(browser, site.root);
			const { page } = opened;
			const alpha = await createNote(page, 'Alpha');
			await open(page, alpha);
			await failSaves(page, ['t1']);
			await typeInto(page, 't1', 'Draft');
			// The person closes t1, its save held; an agent closes it too, its save held as well.
			await tabOf(page, 'Alpha').focus();
			await page.keyboard.press('Delete');
			await expect
				.poll(() => page.evaluate(() => (window as FailedSaves).heldSaves?.length ?? 0))
				.toBeGreaterThan(0);
			await agentCall(page, 'editor-close', { tab: 't1', discard: true });
			await framesGone(page, ['t1']);
			// Both reject: the person's modal opens, and the reopen gives the draft to t2, marked, before they choose.
			await settleSaves(page, 't1', 'fail');
			await expect.poll(() => draftOf(page, 't2')).toBe('Draft');
			const typed = how !== 'untouched';
			if (typed) await editDraft(page, 't2', 'Draft More');
			await page.locator('loam-modal button', { hasText: 'Discard' }).click();
			await editorIdle(page);
			const tabs = (
				(await agentCall(page, 'editor-get')) as {
					data: { groups: Array<{ tabs: Array<{ id: string; dirty: boolean }> }> };
				}
			).data.groups.flatMap((group) => group.tabs);
			const trash = (await agentCall(page, 'document-trash', { document: alpha })) as {
				success: boolean;
				error?: { code: string };
			};
			if (typed) {
				// Typed after the modal opened: not the draft the person discarded, so t2 keeps it, marked.
				expect(await draftOf(page, 't2')).toBe('Draft More');
				expect(tabs).toMatchObject([{ id: 't2', dirty: true }]);
				expect(trash.error?.code).toBe('EDITOR_TAB_DIRTY');
			} else {
				// The same outcome as a Discard before the reopen's open: nothing of the draft is left.
				expect(tabs).toEqual([]);
				expect(trash.success).toBe(true);
			}
			await opened.context.close();
		},
		120_000
	);

	it('P2-D5: a scope round trip keeps the mark of a tab whose editor’s save is still held', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		const alpha = await createNote(page, 'Alpha');
		await open(page, alpha);
		await failSaves(page, ['t1']);
		await typeInto(page, 't1', 'Held');
		await open(page, await createNote(page, 'Beta'));
		await failSaves(page, ['t2']);
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await kernelCall(page, 'section-open', { section: 'documents' });
		await editorIdle(page);
		await kernelCall(page, 'scope-set', { project: null });
		await kernelCall(page, 'section-open', { section: 'documents' });
		await editorIdle(page);
		// Alpha's editor, of the visit before, still saves: its tab keeps its mark, and a trash waits.
		expect(
			(
				(await agentCall(page, 'document-trash', { document: alpha })) as {
					error?: { code: string };
				}
			).error?.code
		).toBe('EDITOR_TAB_DIRTY');
		await settleSaves(page, 't1', 'fail');
		await editorIdle(page);
		await opened.context.close();
	}, 120_000);

	it('P2-D5: an agent marking a tab whose editor is ready and clean unsaved holds nothing: the mark goes', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const alpha = await createNote(page, 'Alpha');
		await open(page, alpha);
		expect(
			(
				(await agentCall(page, 'editor-dirty-set', { tab: 't1', dirty: true })) as {
					success: boolean;
				}
			).success
		).toBe(true);
		await editorIdle(page);
		const dirty = (
			(await agentCall(page, 'editor-get')) as {
				data: { groups: Array<{ tabs: Array<{ id: string; dirty: boolean }> }> };
			}
		).data.groups[0]?.tabs[0]?.dirty;
		expect(dirty).toBe(false);
		expect(
			((await agentCall(page, 'document-trash', { document: alpha })) as { success: boolean })
				.success
		).toBe(true);
		await opened.context.close();
	}, 120_000);

	it('P2-D5: a scope round trip keeps the mark when the tab is active on return and its new editor reads clean', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		const alpha = await createNote(page, 'Alpha');
		await open(page, alpha);
		await failSaves(page, ['t1']);
		await typeInto(page, 't1', 'Held');
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await kernelCall(page, 'section-open', { section: 'documents' });
		await editorIdle(page);
		await kernelCall(page, 'scope-set', { project: null });
		await kernelCall(page, 'section-open', { section: 'documents' });
		await editorIdle(page);
		// t1 is active again, in a new editor that read the stored text: clean, while "Held" still saves.
		expect(
			(
				(await agentCall(page, 'document-trash', { document: alpha })) as {
					error?: { code: string };
				}
			).error?.code
		).toBe('EDITOR_TAB_DIRTY');
		await settleSaves(page, 't1', 'fail');
		await editorIdle(page);
		await opened.context.close();
	}, 120_000);

	it('P2-D5: the person’s Discard of an editor another’s close took holds when its save rejects later', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const alpha = await createNote(page, 'Alpha');
		await open(page, alpha);
		await failSaves(page, ['t1']);
		await typeInto(page, 't1', 'Draft');
		await tabOf(page, 'Alpha').focus();
		await page.keyboard.press('Delete');
		await expect
			.poll(() => page.evaluate(() => (window as FailedSaves).heldSaves?.length ?? 0))
			.toBeGreaterThan(0);
		await agentCall(page, 'editor-close', { tab: 't1', discard: true });
		await framesGone(page, ['t1']);
		// Only the person's save rejects: the modal opens and they discard, while the leave's save is held.
		await settleOldest(page, 't1', 'fail');
		await page.locator('loam-modal button', { hasText: 'Discard' }).click();
		await editorIdle(page);
		// Then the leave's save rejects: nothing comes back, and its mark goes.
		await settleSaves(page, 't1', 'fail');
		await editorIdle(page);
		const tabs = (
			(await agentCall(page, 'editor-get')) as { data: { groups: Array<{ tabs: unknown[] }> } }
		).data.groups.flatMap((group) => group.tabs);
		expect(tabs).toEqual([]);
		expect(
			((await agentCall(page, 'document-trash', { document: alpha })) as { success: boolean })
				.success
		).toBe(true);
		await opened.context.close();
	}, 120_000);

	it('P2-D5: a newer leave of a tab settling first keeps the mark an older leave of it still holds', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		const alpha = await createNote(page, 'Alpha');
		await open(page, alpha);
		await holdEverySave(page);
		const roundTrip = async () => {
			await kernelCall(page, 'scope-set', { project: 'atlas' });
			await kernelCall(page, 'section-open', { section: 'documents' });
			await editorIdle(page);
			await kernelCall(page, 'scope-set', { project: null });
			await kernelCall(page, 'section-open', { section: 'documents' });
			await editorIdle(page);
		};
		await typeInto(page, 't1', 'Older');
		await roundTrip();
		await typeInto(page, 't1', 'Newer');
		await roundTrip();
		const trash = async () =>
			(await agentCall(page, 'document-trash', { document: alpha })) as {
				success: boolean;
				error?: { code: string };
			};
		// The newer leave's save settles first: the older one still saves "Older", so the tab stays marked.
		await page.evaluate(() => (window as Walk).pending?.pop()?.resolve());
		await editorIdle(page);
		expect((await trash()).error?.code).toBe('EDITOR_TAB_DIRTY');
		// Then the older: its leave's end clears the mark, and the trash runs.
		await page.evaluate(() => {
			for (const each of (window as Walk).pending?.splice(0) ?? []) each.resolve();
		});
		await editorIdle(page);
		expect((await trash()).success).toBe(true);
		await opened.context.close();
	}, 120_000);

	it.each<[string, string]>([
		['Discard', 'nothing reopens'],
		['Keep editing', 'the draft comes back'],
	])(
		'P2-D5: the person’s %s during a reopen’s open: %s',
		async (choice) => {
			const opened = await openShell(browser, site.root);
			const { page } = opened;
			const alpha = await createNote(page, 'Alpha');
			await open(page, alpha);
			await failSaves(page, ['t1']);
			await typeInto(page, 't1', 'Draft');
			await tabOf(page, 'Alpha').focus();
			await page.keyboard.press('Delete');
			await expect
				.poll(() => page.evaluate(() => (window as FailedSaves).heldSaves?.length ?? 0))
				.toBeGreaterThan(0);
			await agentCall(page, 'editor-close', { tab: 't1', discard: true });
			await framesGone(page, ['t1']);
			// The next document-open, the reopen's, waits on a gate before it runs.
			await page.evaluate(() => {
				const shell = document.querySelector('loam-shell') as unknown as {
					kernel: { call(name: string, ...rest: unknown[]): Promise<unknown> };
				};
				const call = shell.kernel.call.bind(shell.kernel);
				const gate = new Promise<void>((resolve) => {
					(window as Gated).openGate = resolve;
				});
				let once = true;
				shell.kernel.call = async (name: string, ...rest: unknown[]) => {
					if (name === 'document-open' && once) {
						once = false;
						(window as Gated).openAsked = true;
						await gate;
					}
					return call(name, ...rest);
				};
			});
			// The leave's save rejects, and its reopen waits at the gate; then the person's rejects, and they choose.
			await settleNewest(page, 't1', 'fail');
			await page.waitForFunction(() => (window as Gated).openAsked === true);
			await settleSaves(page, 't1', 'fail');
			await page.locator('loam-modal button', { hasText: choice }).click();
			await page.evaluate(() => (window as Gated).openGate?.());
			await editorIdle(page);
			const tabsOf = async () =>
				(
					(await agentCall(page, 'editor-get')) as {
						data: { groups: Array<{ tabs: Array<{ id: string }> }> };
					}
				).data.groups.flatMap((group) => group.tabs.map((tab) => tab.id));
			if (choice === 'Discard') {
				expect(await tabsOf()).toEqual([]);
				expect(
					((await agentCall(page, 'document-trash', { document: alpha })) as { success: boolean })
						.success
				).toBe(true);
			} else {
				// Kept: the draft is in t2; edited there and closed by an agent, its save rejecting, it is back in t3.
				await expect.poll(() => draftOf(page, 't2')).toBe('Draft');
				await textOf(page, 't2').click();
				await page.keyboard.press('ControlOrMeta+End');
				await page.keyboard.type(' More');
				await agentCall(page, 'editor-close', { tab: 't2', discard: true });
				await framesGone(page, ['t2']);
				await page.evaluate(() => {
					const held = window as FailedSaves;
					for (const each of held.heldSaves?.splice(0) ?? []) each.fail();
				});
				await expect.poll(() => draftOf(page, 't3')).toBe('Draft More');
				await editorIdle(page);
			}
			await opened.context.close();
		},
		120_000
	);

	it.each([0x5eed10, 9, 12, 20, 100, 1, 2, 0xdeadbeef, 42])(
		'P2-D5: a seeded walk of 200 steps, seed %i, keeps the twelve invariants after each and reaches reopens',
		async (start) => {
			const opened = await openShell(browser, site.root);
			const { page } = opened;
			// mulberry32: the same steps for the same seed every run.
			let seed = start;
			const random = () => {
				seed = (seed + 0x6d2b79f5) | 0;
				let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
				t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
				return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
			};
			const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
			const holdSaves = () =>
				page.evaluate(() => {
					const held = window as Walk;
					held.pending = [];
					// Once the editor's chunk defines its frame, which a reload into an app may not have yet.
					void customElements.whenDefined('loam-editor-frame').then(() => {
						const frame = customElements.get('loam-editor-frame')?.prototype as {
							save(): Promise<void>;
						};
						frame.save = () =>
							new Promise<void>((resolve, reject) => {
								held.pending?.push({
									resolve,
									reject: () =>
										reject(Object.assign(new Error('Refused by the walk'), { code: 'WALK' })),
								});
							});
					});
				});
			// Counts the reopens reached, a draft taken by another tab or a reopen's own open, and holds the next of
			// those opens at a gate when asked.
			const instrument = () =>
				page.evaluate(() => {
					const held = window as Walk;
					held.reopens = 0;
					held.reopenOpens = 0;
					held.gates = [];
					const shell = document.querySelector('loam-shell') as unknown as {
						kernel: { call(name: string, input?: unknown, ...rest: unknown[]): Promise<unknown> };
						shadowRoot: ShadowRoot;
					};
					const call = shell.kernel.call.bind(shell.kernel);
					shell.kernel.call = async (name: string, input?: unknown, ...rest: unknown[]) => {
						if (name === 'document-open' && (input as { stay?: string } | undefined)?.stay) {
							held.reopenOpens = (held.reopenOpens ?? 0) + 1;
							if (held.gate) {
								held.gate = false;
								await new Promise<void>((resolve) => held.gates?.push(resolve));
							}
						}
						return call(name, input, ...rest);
					};
					new MutationObserver((records) => {
						for (const record of records) {
							const now = (record.target as HTMLElement).dataset.tab;
							if (record.oldValue && record.oldValue !== now)
								held.reopens = (held.reopens ?? 0) + 1;
						}
					}).observe(shell.shadowRoot, {
						subtree: true,
						attributeFilter: ['data-tab'],
						attributeOldValue: true,
					});
				});
			let reopens = 0;
			let reopenOpens = 0;
			const counted = async () => {
				const [taken, opens] = await page.evaluate(() => [
					(window as Walk).reopens ?? 0,
					(window as Walk).reopenOpens ?? 0,
				]);
				reopens += taken;
				reopenOpens += opens;
			};
			await kernelCall(page, 'project-create', { name: 'Atlas' });
			for (const title of ['One', 'Two', 'Three']) await open(page, await createNote(page, title));
			await holdSaves();
			await instrument();
			const kinds = [
				'park',
				'park',
				'take',
				'take',
				'type',
				'type',
				'type',
				'resolve',
				'reject',
				'hold',
				'switch',
				'move',
				'close',
				'mark',
				'trash',
				'relocate',
				'person-close',
				'modal',
				'pagehide',
				'held-read',
				'reload',
				'app',
				'beside',
				'pin',
				'activate',
				'stay',
				'pagehide-reject',
				'move-held',
				'round-trip',
				'type-held',
				'rename',
				'close-move',
				'close-close',
				'save-key',
				'person-close-held',
				'gate',
				'release',
				'race',
				'person-open',
				'content-set',
				'type-close',
				'type-close',
				'type-close-reject',
				'type-close-reject',
				'modal',
			] as const;
			let project: string | undefined;
			let app = false;
			const steps: string[] = [];
			for (let step = 0; step < 200; step++) {
				const kind = pick(kinds);
				steps.push(kind);
				const read = (await agentCall(page, 'editor-get')) as {
					data?: { groups: Array<{ id: string; tabs: Array<{ id: string; document: string }> }> };
				};
				const groups = read.data?.groups ?? [];
				const tabs = groups.flatMap((group) => group.tabs);
				const some = () => pick(tabs);
				if (kind === 'park') {
					await kernelCall(page, 'document-open', {
						document: await createNote(page, `Walk ${step}`, project),
					});
				} else if (kind === 'take' && tabs.length > 0) {
					await kernelCall(page, 'editor-activate', { tab: some().id });
				} else if (kind === 'type') {
					const area = page
						.locator('loam-editor-group:not([hidden]) loam-editor-frame:not([hidden]) textarea')
						.first();
					if ((await area.count()) > 0) {
						await area.click({ timeout: 500 }).catch(() => undefined);
						await page.keyboard.type('x');
					}
				} else if (kind === 'resolve' || kind === 'reject') {
					// Any held save, not only the oldest.
					await page.evaluate(
						({ kind, at }) => {
							const pending = (window as Walk).pending ?? [];
							pending.splice(Math.floor(at * pending.length), 1)[0]?.[kind]();
						},
						{ kind, at: random() }
					);
				} else if (kind === 'switch') {
					project = project ? undefined : 'atlas';
					await kernelCall(page, 'scope-set', { project: project ?? null });
				} else if (kind === 'move' && tabs.length > 0) {
					await agentCall(page, 'editor-move', {
						tab: some().id,
						group: random() < 0.5 ? 'new' : pick(groups).id,
					});
				} else if (kind === 'close' && tabs.length > 0) {
					await agentCall(page, 'editor-close', { tab: some().id, discard: random() < 0.5 });
				} else if (kind === 'mark' && tabs.length > 0) {
					await agentCall(page, 'editor-dirty-set', { tab: some().id, dirty: random() < 0.5 });
				} else if (kind === 'trash' && tabs.length > 0) {
					await agentCall(page, 'document-trash', { document: some().document });
				} else if (kind === 'relocate' && tabs.length > 0) {
					await agentCall(page, 'document-move', {
						document: some().document,
						project: project ? null : 'atlas',
					});
				} else if (kind === 'person-close') {
					const tab = page
						.locator('loam-editor-group:not([hidden]) [role="tab"][aria-selected="true"]')
						.first();
					if ((await tab.count()) > 0) {
						await tab.focus().catch(() => undefined);
						await page.keyboard.press('Delete');
					}
				} else if (kind === 'modal') {
					const choice = page.locator('loam-modal button', {
						hasText: random() < 0.5 ? 'Discard' : 'Keep editing',
					});
					if ((await choice.count()) > 0)
						await choice
							.first()
							.click({ timeout: 500 })
							.catch(() => undefined);
				} else if (kind === 'pagehide') {
					await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
				} else if (kind === 'held-read') {
					await page.evaluate(() => {
						const shell = document.querySelector('loam-shell') as unknown as {
							kernel: { call(name: string, ...rest: unknown[]): Promise<unknown> };
						};
						const call = shell.kernel.call.bind(shell.kernel);
						let once = true;
						shell.kernel.call = async (name: string, ...rest: unknown[]) => {
							const answer = await call(name, ...rest);
							if (name === 'editor-get' && once) {
								once = false;
								await new Promise((resolve) => setTimeout(resolve, 150));
							}
							return answer;
						};
					});
				} else if (kind === 'reload') {
					await counted();
					await page.reload();
					await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
					await page.waitForTimeout(300);
					await holdSaves();
					await instrument();
					app = false;
				} else if (kind === 'app') {
					app = !app;
					await kernelCall(
						page,
						app ? 'app-open' : 'section-open',
						app ? { instance: 'hello' } : { section: 'documents' }
					);
				} else if (kind === 'beside' && tabs.length > 0) {
					await kernelCall(page, 'document-open', { document: some().document, group: 'beside' });
				} else if (kind === 'pin' && tabs.length > 0) {
					await agentCall(page, 'editor-pin', { tab: some().id, pinned: random() < 0.5 });
				} else if (kind === 'activate' && tabs.length > 0) {
					await agentCall(page, 'editor-activate', { tab: some().id });
				} else if (kind === 'stay' && tabs.length > 0) {
					await agentCall(page, 'document-open', { document: some().document, stay: 'background' });
				} else if (kind === 'pagehide-reject') {
					await page.evaluate(() => {
						window.dispatchEvent(new Event('pagehide'));
						for (const each of (window as Walk).pending?.splice(0) ?? []) each.reject();
					});
				} else if (kind === 'round-trip') {
					// The other scope's documents, and back.
					await kernelCall(page, 'scope-set', { project: project ? null : 'atlas' });
					await kernelCall(page, 'section-open', { section: 'documents' });
					await editorIdle(page).catch((cause) => {
						throw new Error(
							`Seed ${start}, step ${step} (${kind}, away): ${(cause as Error).message}. Steps: ${steps.join(', ')}`
						);
					});
					await kernelCall(page, 'scope-set', { project: project ?? null });
					await kernelCall(page, 'section-open', { section: 'documents' });
				} else if (kind === 'type-held' || kind === 'save-key') {
					const area = page
						.locator('loam-editor-group:not([hidden]) loam-editor-frame:not([hidden]) textarea')
						.first();
					if ((await area.count()) > 0) {
						await area.click({ timeout: 500 }).catch(() => undefined);
						if (kind === 'type-held') await page.keyboard.type('h');
						else await page.keyboard.press('ControlOrMeta+s');
					}
				} else if (kind === 'rename' && tabs.length > 0) {
					await kernelCall(page, 'document-rename', {
						document: some().document,
						title: `Renamed ${step}`,
					});
				} else if (kind === 'close-move' && tabs.length > 1) {
					await agentCall(page, 'editor-close', { tab: some().id, discard: true });
					await agentCall(page, 'editor-move', { tab: some().id, group: 'new' });
				} else if (kind === 'close-close' && tabs.length > 0) {
					const tab = some().id;
					await agentCall(page, 'editor-close', { tab, discard: true });
					await agentCall(page, 'editor-close', { tab, discard: true });
				} else if (kind === 'person-close-held') {
					if (await page.evaluate(() => ((window as Walk).pending?.length ?? 0) > 0)) {
						const tab = page
							.locator('loam-editor-group:not([hidden]) [role="tab"][aria-selected="true"]')
							.first();
						if ((await tab.count()) > 0) {
							await tab.focus().catch(() => undefined);
							await page.keyboard.press('Delete');
						}
					}
				} else if (kind === 'gate') {
					await page.evaluate(() => {
						(window as Walk).gate = true;
					});
				} else if (kind === 'release') {
					await page.evaluate(() => {
						for (const release of (window as Walk).gates?.splice(0) ?? []) release();
					});
				} else if (kind === 'race') {
					// Typing, the person's close and an agent's close of the same tab, none waited for.
					const tab = page
						.locator('loam-editor-group:not([hidden]) [role="tab"][aria-selected="true"]')
						.first();
					const area = page
						.locator('loam-editor-group:not([hidden]) loam-editor-frame:not([hidden]) textarea')
						.first();
					const id = (await tab.count()) > 0 ? await tab.getAttribute('data-tab') : null;
					if (id && (await area.count()) > 0) {
						await area.click({ timeout: 500 }).catch(() => undefined);
						await page.keyboard.type('r');
						await tab.focus().catch(() => undefined);
						await page.keyboard.press('Delete');
						await agentCall(page, 'editor-close', { tab: id, discard: true });
					}
				} else if (kind === 'type-close' || kind === 'type-close-reject') {
					// A draft an agent's close takes, its save held: what a reopen brings back when that save rejects.
					const tab = page
						.locator('loam-editor-group:not([hidden]) [role="tab"][aria-selected="true"]')
						.first();
					const area = page
						.locator('loam-editor-group:not([hidden]) loam-editor-frame:not([hidden]) textarea')
						.first();
					const id = (await tab.count()) > 0 ? await tab.getAttribute('data-tab') : null;
					if (id && (await area.count()) > 0) {
						await area.click({ timeout: 500 }).catch(() => undefined);
						await page.keyboard.type('c');
						await agentCall(page, 'editor-close', { tab: id, discard: random() < 0.5 });
						// Its leave's save, the newest held, rejects at once: the reopen runs while the area shows.
						if (kind === 'type-close-reject') {
							await page.waitForTimeout(50);
							await page.evaluate(() => (window as Walk).pending?.pop()?.reject());
						}
					}
				} else if (kind === 'person-open' && tabs.length > 0) {
					await kernelCall(page, 'document-open', { document: some().document });
				} else if (kind === 'content-set' && tabs.length > 0) {
					await agentCall(page, 'notes-content-set', {
						document: some().document,
						text: `Agent ${step}`,
					});
				} else if (kind === 'move-held' && tabs.length > 0) {
					// A tab moved while a save is held, of its editor or another's.
					if (await page.evaluate(() => ((window as Walk).pending?.length ?? 0) > 0)) {
						await agentCall(page, 'editor-move', { tab: some().id, group: 'new' });
					}
				}
				try {
					await editorIdle(page);
				} catch (cause) {
					throw new Error(
						`Seed ${start}, step ${step} (${kind}): ${(cause as Error).message}. Steps: ${steps.join(', ')}`
					);
				}
			}
			await page.evaluate(() => {
				for (const release of (window as Walk).gates?.splice(0) ?? []) release();
				for (const each of (window as Walk).pending?.splice(0) ?? []) each.reject();
			});
			await editorIdle(page);
			expect(await frameViolations(page)).toEqual([]);
			await counted();
			// Straight to the output, so every seed's count shows, passing or not.
			process.stdout.write(
				`Seed ${start}: ${reopens} drafts taken by another tab, ${reopenOpens} reopen opens\n`
			);
			expect(reopens + reopenOpens).toBeGreaterThanOrEqual(REOPEN_FLOOR);
			await opened.context.close();
		},
		600_000
	);

	it('P2-D5: a tab’s type icon is blank until the app surfaces register the icons, then drawn', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await open(page, await createNote(page, 'One'));
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { flush(): Promise<void> };
			};
			await shell.kernel.flush();
		});
		const icon = () =>
			page.evaluate(
				() =>
					document
						.querySelector('loam-shell')
						?.shadowRoot?.querySelector('loam-main loam-editor-group')
						?.shadowRoot?.querySelector('[role="tab"] .icon')
						?.getAttribute('icon') ?? null
			);
		site.hold(/\/assets\/surfaces-/);
		await page.reload();
		await expect.poll(icon).toBe('');
		site.release();
		await expect.poll(icon).toBe('system/document');
		await opened.context.close();
	});

	it('P2-D5: parks a native editor with its scroll, keeps the tabs off screen while an app is active, and keeps nothing of Atlas under Beacon', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const long = await createNote(page, 'Long');
		await agentCall(page, 'notes-content-set', {
			document: long,
			text: Array.from({ length: 300 }, (_, line) => `Line ${line}`).join('\n'),
		});
		const short = await createNote(page, 'Short');
		await open(page, long);
		await open(page, short);
		await tabOf(page, 'Long').click();
		await editorIdle(page);
		await textOf(page, 't1').evaluate((area) => {
			area.scrollTop = 600;
			(area as HTMLElement & { marked?: boolean }).marked = true;
		});
		await tabOf(page, 'Short').click();
		await editorIdle(page);
		await tabOf(page, 'Long').click();
		await editorIdle(page);
		await expect.poll(() => textOf(page, 't1').evaluate((area) => area.scrollTop)).toBe(600);
		// The same element, parked and shown again, not made anew.
		expect(
			await textOf(page, 't1').evaluate(
				(area) => (area as HTMLElement & { marked?: boolean }).marked
			)
		).toBe(true);

		// An app opened: the tabs stay in editor-get, and on no screen.
		await kernelCall(page, 'app-open', { instance: 'hello' });
		await editorIdle(page);
		expect(await editorView(page)).toBeNull();
		const kept = (await kernelCall(page, 'editor-get')) as {
			data: { groups: Array<{ tabs: unknown[] }> };
		};
		expect(kept.data.groups[0]?.tabs).toHaveLength(2);
		await kernelCall(page, 'section-open', { section: 'documents' });
		await editorIdle(page);
		expect(
			await textOf(page, 't1').evaluate(
				(area) => (area as HTMLElement & { marked?: boolean }).marked
			)
		).toBe(true);

		// Per scope: nothing of the workspace's area stays under Atlas, and it is back on return.
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await kernelCall(page, 'section-open', { section: 'documents' });
		await editorIdle(page);
		// Every shadow root under main, walked: no frame, no mount, none of the workspace's titles or text.
		const deep = await page.evaluate(() => {
			const main = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-main');
			const names: string[] = [];
			let text = '';
			const walk = (root: Element | ShadowRoot) => {
				for (const element of root.querySelectorAll('*')) {
					names.push(element.localName);
					if (element.shadowRoot) walk(element.shadowRoot);
					if (element instanceof HTMLTextAreaElement) text += element.value;
				}
				text += root.textContent ?? '';
			};
			if (main) walk(main);
			if (main?.shadowRoot) walk(main.shadowRoot);
			return { names, text };
		});
		expect(deep.names).not.toContain('loam-editor-frame');
		expect(deep.names).not.toContain('loam-mount');
		expect(deep.names).not.toContain('notes-editor');
		for (const leaked of ['Long', 'Short', 'Line 0']) expect(deep.text).not.toContain(leaked);
		expect((await editorView(page))?.flatMap((group) => group.editors)).toEqual([]);
		expect((await editorView(page))?.flatMap((group) => group.tabs)).toEqual([]);
		await kernelCall(page, 'scope-set', { project: null });
		await editorIdle(page);
		await expect
			.poll(async () => (await editorView(page))?.[0]?.tabs.map((tab) => tab.title))
			.toEqual(['Long', 'Short']);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('P2-D5: saves on Mod+S at once, within autosave_ms, and says so politely', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const note = await createNote(page, 'Quick');
		await open(page, note);
		await typeInto(page, 't1', 'Saved by the chord');
		await page.keyboard.press('ControlOrMeta+s');
		await expect.poll(() => stored(page, note), { timeout: 1500 }).toBe('Saved by the chord');
		await expect
			.poll(() => page.locator('loam-shell .announce[role="status"]').textContent())
			.toBe('Quick saved');
		await opened.context.close();
	});

	it('P2-D5: a change of scope during an unsaved edit saves it, and the tab is clean on return', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const note = await createNote(page, 'Drafted');
		await open(page, note);
		await typeInto(page, 't1', 'Before the switch');
		await expect
			.poll(() => editorView(page).then((view) => view?.[0]?.tabs[0]?.name))
			.toBe('Drafted, unsaved');
		await kernelCall(page, 'project-create', { name: 'Elsewhere' });
		await kernelCall(page, 'scope-set', { project: 'elsewhere' });
		// Read at the workspace, the note's own scope, from inside the other project.
		await expect
			.poll(() =>
				page.evaluate(async (document) => {
					const shell = window.document.querySelector('loam-shell') as unknown as {
						kernel: {
							agent: {
								call(
									name: string,
									input: unknown,
									options: unknown
								): Promise<{ data?: { text: string } }>;
							};
						};
					};
					return (
						await shell.kernel.agent.call('notes-content-get', { document }, { scope: 'workspace' })
					).data?.text;
				}, note)
			)
			.toBe('Before the switch');
		await kernelCall(page, 'scope-set', { project: null });
		await editorIdle(page);
		const back = (await agentCall(page, 'editor-get')) as {
			data: { groups: Array<{ tabs: Array<{ dirty: boolean }> }> };
		};
		await expect
			.poll(
				async () =>
					((await agentCall(page, 'editor-get')) as typeof back).data.groups[0]?.tabs[0]?.dirty
			)
			.toBe(false);
		await expect
			.poll(() => editorView(page).then((view) => view?.[0]?.tabs[0]?.name))
			.toBe('Drafted');
		// An agent's close is not refused as unsaved.
		expect(
			((await agentCall(page, 'editor-close', { tab: 't1' })) as { success: boolean }).success
		).toBe(true);
		await opened.context.close();
	});

	it('P2-D5: a save held past a return to its scope and a newer edit clears nothing, so the tab stays unsaved', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const note = await createNote(page, 'Drafted');
		await open(page, note);
		await typeInto(page, 't1', 'First edit');
		await expect.poll(() => tabName(page)).toBe('Drafted, unsaved');
		await holdSave(page, 't1');
		// To another scope: the frame retires, and its save starts and is held.
		await kernelCall(page, 'project-create', { name: 'Elsewhere' });
		await kernelCall(page, 'scope-set', { project: 'elsewhere' });
		await editorIdle(page);
		await page.waitForFunction(() => typeof (window as HeldSave).releaseSave === 'function');
		// Back, and edited again: a newer unsaved edit in the same tab.
		await kernelCall(page, 'scope-set', { project: null });
		await editorIdle(page);
		await typeInto(page, 't1', ', then a newer one');
		await editorIdle(page);
		// From here, the retiring frame's own clear is the only one that could land: the new frame's editor
		// reported clean on loading, and dirty again on the newer edit, before it.
		const from = (await entriesOf(page)).length;
		await releaseSave(page);
		expect(await clears(page, from)).toEqual([]);
		expect(await dirtyOf(page)).toBe(true);
		expect(await tabName(page)).toBe('Drafted, unsaved');
		await opened.context.close();
	});

	it('P2-D5: a leaving editor with no record clears no tab, in any scope', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await open(page, await createNote(page, 'Drafted'));
		await typeInto(page, 't1', 'Unsaved');
		await expect.poll(() => tabName(page)).toBe('Drafted, unsaved');
		await holdSave(page, 't1', true);
		await kernelCall(page, 'project-create', { name: 'Elsewhere' });
		await kernelCall(page, 'scope-set', { project: 'elsewhere' });
		// A tab with the same id in the scope now active, which a clear with no scope would reach.
		await open(page, await createNote(page, 'There', 'elsewhere'));
		const from = (await entriesOf(page)).length;
		await releaseSave(page);
		expect(await clears(page, from)).toEqual([]);
		await opened.context.close();
	});

	it('P2-D5: leaves Mod+S to the browser when no editor is the active owner', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const prevented = async () => {
			await page.evaluate(() => {
				(window as unknown as { saved?: boolean }).saved = undefined;
				const heard = (event: KeyboardEvent) => {
					if (event.code !== 'KeyS') return;
					(window as unknown as { saved?: boolean }).saved = event.defaultPrevented;
					window.removeEventListener('keydown', heard);
				};
				window.addEventListener('keydown', heard);
			});
			await page.keyboard.press('ControlOrMeta+s');
			return page.evaluate(() => (window as unknown as { saved?: boolean }).saved);
		};
		expect(await prevented()).toBe(false);
		await open(page, await createNote(page, 'One'));
		await textOf(page, 't1').focus();
		expect(await prevented()).toBe(true);
		await opened.context.close();
	});
});

describe('P2-D7: one model, many editors', () => {
	it('P2-D7: a save in one group, an agent’s notes-content-set and an undo each reach the other editor; a dirty one shows the notice and loses nothing until a person chooses', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const note = await createNote(page, 'Shared');
		await open(page, note);
		await open(page, note, { group: 'beside' });
		expect((await editorView(page))?.map((group) => group.tabs.map((tab) => tab.title))).toEqual([
			['Shared'],
			['Shared'],
		]);
		await typeInto(page, 't1', 'one');
		await page.keyboard.press('ControlOrMeta+s');
		await expect.poll(() => drafts(page), { timeout: 1500 }).toEqual(['one', 'one']);
		const set = (await agentCall(page, 'notes-content-set', { document: note, text: 'agent' })) as {
			undoCommand: string;
			undoArgs: unknown;
		};
		await expect.poll(() => drafts(page)).toEqual(['agent', 'agent']);
		await kernelCall(page, set.undoCommand, set.undoArgs);
		await expect.poll(() => drafts(page)).toEqual(['one', 'one']);

		// The second editor holds a draft when another write lands: it says so and keeps the draft.
		await textOf(page, 't2').click();
		await page.keyboard.press('End');
		await page.keyboard.type(' draft');
		await agentCall(page, 'notes-content-set', { document: note, text: 'remote' });
		await expect.poll(() => drafts(page)).toEqual(['remote', 'one draft']);
		const notice = page.locator('loam-editor-frame[data-tab="t2"] .conflict');
		await expect.poll(() => notice.isVisible()).toBe(true);
		await notice.locator('violet-button', { hasText: 'Keep mine' }).click();
		await expect.poll(() => notice.isVisible()).toBe(false);
		expect(await drafts(page)).toEqual(['remote', 'one draft']);
		await textOf(page, 't2').focus();
		await page.keyboard.press('ControlOrMeta+s');
		await expect.poll(() => stored(page, note)).toBe('one draft');
		await expect.poll(() => drafts(page)).toEqual(['one draft', 'one draft']);
		// Use theirs takes the stored text.
		await textOf(page, 't1').click();
		await page.keyboard.type(' mine');
		await agentCall(page, 'notes-content-set', { document: note, text: 'theirs' });
		const first = page.locator('loam-editor-frame[data-tab="t1"] .conflict');
		await expect.poll(() => first.isVisible()).toBe(true);
		await first.locator('violet-button', { hasText: 'Use theirs' }).click();
		await expect.poll(() => drafts(page)).toEqual(['theirs', 'theirs']);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});
});
