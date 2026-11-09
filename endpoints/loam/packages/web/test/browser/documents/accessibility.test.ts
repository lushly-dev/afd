/**
 * The editor area under axe (documents specification, D10 so far; steps 10 and 11): two groups of notes, the
 * tab menu open, the documents section's tree with its row menu open, its list and its trash, and the New
 * menu open, in each theme and density, under forced colors and in the compact class, with phase 0's tags
 * and zero violations. Step 12 adds a view editor in its sandboxed frame, axe inside that frame too, a note
 * embedding another, the link picker open and the documents inspector; the second type joins with step 13.
 */

import { type Browser, chromium, type Frame, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	axe,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	kernelCall,
	openShell,
	packApp,
	serveDeployment,
} from '../harness';
import { sheetPackage } from './sheet';
import { createNote, editorIdle, editorView, settledAxe } from './support';

let browser: Browser;
let site: DeploymentSite;
/** With the `sheet` fixture, a view, on a second origin (step 12). */
let viewSite: DeploymentSite;

beforeAll(async () => {
	browser = await chromium.launch();
	site = await serveDeployment({
		config: deploymentFile(deploymentEntry('notes', await packApp('notes'))),
	});
	viewSite = await serveDeployment({
		sandbox: true,
		config: deploymentFile(
			deploymentEntry('notes', await packApp('notes')),
			deploymentEntry('sheet', await sheetPackage())
		),
	});
}, 120_000);

afterAll(async () => {
	await site?.close();
	await viewSite?.close();
	await browser?.close();
});

/** The sandbox's inner frame of a sheet view, once it has read its document. */
async function sheetFrame(page: Page, role: 'editor' | 'embed'): Promise<Frame> {
	let found: Frame | undefined;
	await expect
		.poll(async () => {
			for (const frame of page.frames()) {
				const held = await frame
					.evaluate(
						() => (window as unknown as { sheet?: { ready?: boolean; role?: string } }).sheet
					)
					.catch(() => undefined);
				if (held?.ready && held.role === role) {
					found = frame;
					return true;
				}
			}
			return false;
		})
		.toBe(true);
	return found as Frame;
}

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
	it('P2-D10: two groups, the list with no tab and the tab menu have no violation, in each theme and density and under forced colors', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await kernelCall(page, 'section-open', { section: 'documents' });
		await editorIdle(page);
		// With no tab, main is the documents section's list, beside its tree (5.1, 8).
		expect(await settledAxe(page), 'the list and the tree').toEqual([]);
		await twoGroups(page);
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			for (const density of ['comfortable', 'compact'] as const) {
				await kernelCall(page, 'appearance-set', { theme, density });
				await editorIdle(page);
				expect(await settledAxe(page), `${theme} ${density}`).toEqual([]);
			}
		}
		await kernelCall(page, 'appearance-set', { theme: 'light', density: 'comfortable' });
		await page.locator('loam-editor-group [role="tab"][aria-selected="true"]').first().focus();
		await page.keyboard.press('Shift+F10');
		expect(await settledAxe(page), 'the tab menu open').toEqual([]);
		await page.keyboard.press('Escape');
		await page.emulateMedia({ forcedColors: 'active' });
		expect(await settledAxe(page), 'forced colors').toEqual([]);
		await page.emulateMedia({ forcedColors: 'none' });
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 90_000);

	it('P2-D10: the tree with its row menu open, the list, its trash and the New menu open have no violation, in each theme and density and under forced colors', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const one = await createNote(page, 'One');
		await createNote(page, 'Two');
		await kernelCall(page, 'document-trash', { document: one });
		await kernelCall(page, 'section-open', { section: 'documents' });
		await editorIdle(page);
		const tree = page.locator('loam-documents-sidebar loam-tree');
		await tree.locator('violet-tree-item[data-id="trash"] > .label').click();
		await tree.locator(`violet-tree-item[data-id="trash:${one}"]`).waitFor();
		const status = page.locator('loam-documents-section select[data-ref="status"]');
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			for (const density of ['comfortable', 'compact'] as const) {
				await kernelCall(page, 'appearance-set', { theme, density });
				await editorIdle(page);
				await status.selectOption('active');
				expect(await settledAxe(page), `${theme} ${density}, the list`).toEqual([]);
				await status.selectOption('trashed');
				expect(await settledAxe(page), `${theme} ${density}, the trash`).toEqual([]);
				await tree.locator('violet-tree-item[data-id^="recent:"]').first().focus();
				await page.keyboard.press('Shift+F10');
				expect(await settledAxe(page), `${theme} ${density}, the row menu`).toEqual([]);
				await page.keyboard.press('Escape');
				await page.locator('loam-titlebar .new > button').click();
				await page.locator('loam-new-menu violet-menu-item').first().waitFor();
				expect(await settledAxe(page), `${theme} ${density}, the New menu`).toEqual([]);
				await page.keyboard.press('Escape');
			}
		}
		await kernelCall(page, 'appearance-set', { theme: 'light', density: 'comfortable' });
		await page.emulateMedia({ forcedColors: 'active' });
		await status.selectOption('active');
		expect(await settledAxe(page), 'forced colors, the list').toEqual([]);
		await tree.locator('violet-tree-item[data-id^="recent:"]').first().focus();
		await page.keyboard.press('Shift+F10');
		expect(await settledAxe(page), 'forced colors, the row menu').toEqual([]);
		await page.keyboard.press('Escape');
		await page.locator('loam-titlebar .new > button').click();
		await page.locator('loam-new-menu violet-menu-item').first().waitFor();
		expect(await settledAxe(page), 'forced colors, the New menu').toEqual([]);
		await page.emulateMedia({ forcedColors: 'none' });
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 180_000);

	it('P2-D10: in the compact class, the list, the New menu and the tree in its drawer have no violation', async () => {
		const opened = await openShell(browser, site.root, { viewport: { width: 390, height: 844 } });
		const { page } = opened;
		await createNote(page, 'One');
		await kernelCall(page, 'section-open', { section: 'documents' });
		await editorIdle(page);
		await page.locator('loam-documents-section h1').waitFor();
		expect(await settledAxe(page), 'compact, the list').toEqual([]);
		await page.locator('loam-titlebar .new > button').click();
		await page.locator('loam-new-menu violet-menu-item').first().waitFor();
		expect(await settledAxe(page), 'compact, the New menu').toEqual([]);
		await page.keyboard.press('Escape');
		await kernelCall(page, 'layout-set', { compact: { drawer: 'sidebar' } });
		await page.locator('loam-documents-sidebar loam-tree violet-tree-item').first().waitFor();
		expect(await settledAxe(page), 'compact, the tree in its drawer').toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 90_000);

	it('P2-D10: a restore held busy has its heading, and no violation', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await twoGroups(page);
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { flush(): Promise<void> };
			};
			await shell.kernel.flush();
		});
		site.hold(/\/assets\/editor-/);
		await page.reload();
		await page.waitForFunction(() => {
			const main = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-main');
			return main?.getAttribute('aria-busy') === 'true';
		});
		expect(
			await page.evaluate(
				() =>
					document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-main h1.announce')
						?.textContent
			)
		).toBe('Opening');
		expect(await settledAxe(page), 'busy').toEqual([]);
		site.release();
		await opened.context.close();
	}, 60_000);

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
		expect(await settledAxe(page), 'compact').toEqual([]);
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

	it('P2-D10: axe waits for no animation without an end, and names one still running at its deadline', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await page.evaluate(() => {
			const spinner = document.createElement('div');
			spinner.className = 'spinner';
			document.body.append(spinner);
			spinner.animate([{ opacity: 1 }, { opacity: 0.5 }], {
				duration: 1_000,
				iterations: Infinity,
			});
		});
		expect(await settledAxe(page, 2_000)).toEqual([]);
		await page.evaluate(() => {
			const slow = document.createElement('div');
			slow.className = 'slow';
			document.body.append(slow);
			slow.animate([{ opacity: 1 }, { opacity: 0.5 }], { duration: 60_000, id: 'fade' });
		});
		await expect(settledAxe(page, 300)).rejects.toThrow(
			'Animations still running after 300 ms: div.slow fade'
		);
		await opened.context.close();
	}, 60_000);

	it('P2-D10: a view editor beside a note that embeds another, the link picker open and the inspector have no violation, in each theme and density and under forced colors, and none inside the view’s frame', async () => {
		const opened = await openShell(browser, viewSite.root);
		const { page } = opened;
		const sheet = (
			(await kernelCall(page, 'document-create', { type: 'sheet', title: 'Sheet' })) as {
				data: { id: string };
			}
		).data.id;
		const inner = await createNote(page, 'Inner');
		const outer = await createNote(page, 'Outer');
		await agentCall(page, 'notes-content-set', { document: inner, text: 'Inner text' });
		await agentCall(page, 'notes-content-set', { document: outer, text: 'Outer', embeds: [inner] });
		await kernelCall(page, 'document-open', { document: outer });
		await kernelCall(page, 'document-open', { document: sheet, group: 'beside' });
		await kernelCall(page, 'editor-activate', { tab: 't1' });
		await kernelCall(page, 'layout-set', { inspector: { open: true } });
		await editorIdle(page);
		const frame = await sheetFrame(page, 'editor');
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						document
							.querySelector('loam-shell')
							?.shadowRoot?.querySelector('loam-inspector notes-inspector') !== null
				)
			)
			.toBe(true);
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			for (const density of ['comfortable', 'compact'] as const) {
				await kernelCall(page, 'appearance-set', { theme, density });
				await editorIdle(page);
				expect(await settledAxe(page), `${theme} ${density}`).toEqual([]);
			}
		}
		await kernelCall(page, 'appearance-set', { theme: 'light', density: 'comfortable' });
		expect(await axe(frame), 'inside the view editor’s frame').toEqual([]);
		// The link picker, open.
		await page.locator('loam-editor-frame[data-tab="t1"] violet-button.link').click();
		await page.locator('loam-editor-frame[data-tab="t1"] violet-button.choice').first().waitFor();
		expect(await settledAxe(page), 'the link picker open').toEqual([]);
		await page.keyboard.press('Escape');
		await page.emulateMedia({ forcedColors: 'active' });
		expect(await settledAxe(page), 'forced colors').toEqual([]);
		await page.emulateMedia({ forcedColors: 'none' });
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 120_000);
});
