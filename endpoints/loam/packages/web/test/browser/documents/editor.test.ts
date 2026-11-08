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
