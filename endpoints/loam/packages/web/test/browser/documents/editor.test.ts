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
		await expect.poll(() => stored(page, alpha)).toBe('Alpha text');
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
