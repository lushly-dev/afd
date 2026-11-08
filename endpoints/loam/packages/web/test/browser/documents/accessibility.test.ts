/**
 * The editor area under axe (documents specification, D10 so far; step 10): two groups of notes, the tab
 * menu open, the empty area, in each theme and density, under forced colors and in the compact class, with
 * phase 0's tags and zero violations. A view editor, the tree and the New menu join with steps 11 to 13.
 */

import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	axe,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	kernelCall,
	openShell,
	packApp,
	serveDeployment,
} from '../harness';
import { createNote, editorIdle, editorView } from './support';

let browser: Browser;
let site: DeploymentSite;

beforeAll(async () => {
	browser = await chromium.launch();
	site = await serveDeployment({
		config: deploymentFile(deploymentEntry('notes', await packApp('notes'))),
	});
});

afterAll(async () => {
	await site?.close();
	await browser?.close();
});

/** Two notes side by side, the first with an unsaved draft. */
async function twoGroups(page: Page): Promise<void> {
	const one = await createNote(page, 'One');
	const two = await createNote(page, 'Two');
	await kernelCall(page, 'document-open', { document: one });
	await kernelCall(page, 'document-open', { document: two, group: 'beside' });
	await editorIdle(page);
	await expect
		.poll(
			async () =>
				(await editorView(page))?.flatMap((group) =>
					group.editors.filter((each) => each.text !== null)
				).length
		)
		.toBe(2);
	await page
		.locator('loam-editor-group:not([hidden]) loam-editor-frame:not([hidden]) textarea')
		.first()
		.click();
	await page.keyboard.type('A draft');
	await editorIdle(page);
}

describe('P2-D10: the editor area under axe', () => {
	it('P2-D10: two groups, the empty area and the tab menu have no violation, in each theme and density and under forced colors', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await kernelCall(page, 'section-open', { section: 'documents' });
		await editorIdle(page);
		expect(await axe(page), 'the empty area').toEqual([]);
		await twoGroups(page);
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			for (const density of ['comfortable', 'compact'] as const) {
				await kernelCall(page, 'appearance-set', { theme, density });
				await editorIdle(page);
				expect(await axe(page), `${theme} ${density}`).toEqual([]);
			}
		}
		await kernelCall(page, 'appearance-set', { theme: 'light', density: 'comfortable' });
		await page.locator('loam-editor-group [role="tab"][aria-selected="true"]').first().focus();
		await page.keyboard.press('Shift+F10');
		expect(await axe(page), 'the tab menu open').toEqual([]);
		await page.keyboard.press('Escape');
		await page.emulateMedia({ forcedColors: 'active' });
		expect(await axe(page), 'forced colors').toEqual([]);
		await page.emulateMedia({ forcedColors: 'none' });
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 90_000);

	it('P2-D10: in the compact class, only the active group shows, the menu has no Open beside, and nothing is violated', async () => {
		const opened = await openShell(browser, site.root, { viewport: { width: 390, height: 844 } });
		const { page } = opened;
		await twoGroups(page);
		const shown = await page.evaluate(() =>
			[
				...(document
					.querySelector('loam-shell')
					?.shadowRoot?.querySelector('loam-main')
					?.querySelectorAll('loam-editor-group') ?? []),
			].map((group) => !(group as HTMLElement).hidden)
		);
		expect(shown).toEqual([false, true]);
		expect(await axe(page), 'compact').toEqual([]);
		await page
			.locator('loam-editor-group:not([hidden]) [role="tab"][aria-selected="true"]')
			.focus();
		await page.keyboard.press('Shift+F10');
		await expect
			.poll(() =>
				page
					.locator('loam-editor-group:not([hidden]) [role="menuitem"]', { hasText: 'Open beside' })
					.isVisible()
			)
			.toBe(false);
		await opened.context.close();
	}, 60_000);
});
