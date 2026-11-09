/**
 * The editor area under axe (documents specification, D10 so far; step 10): two groups of notes, the tab
 * menu open, the empty area, in each theme and density, under forced colors and in the compact class, with
 * phase 0's tags and zero violations. A view editor, the tree and the New menu join with steps 11 to 13.
 */

import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	kernelCall,
	openShell,
	packApp,
	serveDeployment,
} from '../harness';
import { createNote, editorIdle, editorView, settledAxe } from './support';

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
		expect(await settledAxe(page), 'the empty area').toEqual([]);
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
});
