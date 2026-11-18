/**
 * P4-E3 in Chromium (phase 4 specification, 3.6; D117, R12): appearance taken over by the person's `loam.appearance`
 * settings section, in a `local` deployment signed out. An old `loam.appearance` record in the page's IndexedDB is
 * painted from the first frame, moved into `loam.settings` by the first stage B (journaled as `setting-set` with
 * `migrated: true`), and the next load paints from `loam.settings` with no flash; `appearance-set` persists there.
 * `provider` mode's half (`.last`, two people) is `kernel/src/late/settings-appearance.test.ts`'s.
 */

import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentCall, journal, kernelCall, openShell, serveDist, settle } from './harness';

let browser: Browser;
let site: Awaited<ReturnType<typeof serveDist>>;
beforeAll(async () => {
	site = await serveDist();
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
});

/**
 * Every value `data-loam-theme` takes from before the page parses, across reloads: an init script runs before the
 * root element exists, so it watches the document's subtree.
 */
const WATCH_THEME = () => {
	const seen: string[] = [];
	(window as unknown as { loamThemes: string[] }).loamThemes = seen;
	new MutationObserver(() => {
		const theme = document.documentElement?.dataset.loamTheme;
		if (theme !== undefined && seen.at(-1) !== theme) seen.push(theme);
	}).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-loam-theme'] });
};
const themes = (page: Page) =>
	page.evaluate(() => (window as unknown as { loamThemes: string[] }).loamThemes);

/** The page's store, `loam-store`, as `IndexedDbAdapter` keeps it: `records` keyed by `[table, id]`. */
const storeRow = (page: Page, table: string, id: string, row?: unknown) =>
	page.evaluate(
		({ table, id, row }) =>
			new Promise<unknown>((resolve, reject) => {
				const opening = indexedDB.open('loam-store');
				opening.onerror = () => reject(opening.error);
				opening.onsuccess = () => {
					const db = opening.result;
					const transaction = db.transaction(
						'records',
						row === undefined ? 'readonly' : 'readwrite'
					);
					const records = transaction.objectStore('records');
					const request =
						row === undefined
							? records.get([table, id])
							: row === null
								? records.delete([table, id])
								: records.put({ table, id, row });
					request.onsuccess = () =>
						resolve(row === undefined ? (request.result?.row ?? null) : null);
					request.onerror = () => reject(request.error);
					transaction.oncomplete = () => db.close();
				};
			}),
		{ table, id, row }
	);

async function reload(page: Page): Promise<void> {
	await page.reload();
	await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
	await page.evaluate(
		() => (document.querySelector('loam-shell') as unknown as { ready: Promise<void> }).ready
	);
	await page.evaluate(
		() =>
			(
				document.querySelector('loam-shell') as unknown as {
					kernel: { appsReady: Promise<void> };
				}
			).kernel.appsReady
	);
	await settle(page);
}

describe('P4-E3: appearance taken over, local signed out (R12)', () => {
	it('paints an old record from the first frame, moves it on the first stage B, and paints loam.settings next', async () => {
		const opened = await openShell(browser, site.origin, { colorScheme: 'light' });
		const { page } = opened;
		await page.addInitScript(WATCH_THEME);
		// The record phases 0 to 3 kept, as an earlier release would have left it.
		await storeRow(page, 'settings', 'loam.settings', null);
		await storeRow(page, 'settings', 'loam.appearance', {
			id: 'loam.appearance',
			category: 'view-state',
			value: { theme: 'dark', density: 'compact' },
			updatedAt: '2026-01-01T00:00:00.000Z',
		});
		await reload(page);
		// Dark from the first value the root took: no light frame before stage B moved it.
		expect(await themes(page)).toEqual(['dark']);
		const moved = (await journal(page)).filter((entry) => entry.command === 'setting-set');
		expect(moved.map((entry) => entry.input)).toEqual([
			{ section: 'loam.appearance', key: 'theme', value: 'dark', level: 'person', migrated: true },
			{
				section: 'loam.appearance',
				key: 'density',
				value: 'compact',
				level: 'person',
				migrated: true,
			},
		]);
		expect(moved.every((entry) => entry.success)).toBe(true);
		expect(await storeRow(page, 'settings', 'loam.appearance')).toBeNull();
		expect(
			((await storeRow(page, 'settings', 'loam.settings')) as { value: Record<string, unknown> })
				.value['loam.appearance']
		).toMatchObject({ theme: { value: 'dark' }, density: { value: 'compact' } });

		// The next load paints from `loam.settings`, with no flash and nothing moved again.
		await reload(page);
		expect(await themes(page)).toEqual(['dark']);
		expect((await journal(page)).filter((entry) => entry.command === 'setting-set')).toHaveLength(
			2
		);
		expect(
			(
				(await kernelCall(page, 'setting-get', { section: 'loam.appearance', key: 'theme' })) as {
					data: unknown;
				}
			).data
		).toMatchObject({ value: 'dark', from: 'person' });
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});

	it('persists appearance-set in loam.settings, repaints on its event, and keeps loam.settings out of view-state-*', async () => {
		const opened = await openShell(browser, site.origin, { colorScheme: 'light' });
		const { page } = opened;
		await page.addInitScript(WATCH_THEME);
		expect(
			(await agentCall(page, 'appearance-set', { theme: 'high-contrast' })) as object
		).toMatchObject({
			success: true,
		});
		await expect
			.poll(() => page.evaluate(() => document.documentElement.dataset.loamTheme))
			.toBe('high-contrast');
		// A setting-set of the section repaints too.
		await agentCall(page, 'setting-set', {
			section: 'loam.appearance',
			key: 'density',
			value: 'compact',
			level: 'person',
		});
		await expect
			.poll(() => page.evaluate(() => document.documentElement.dataset.loamDensity))
			.toBe('compact');
		await reload(page);
		expect(await themes(page)).toEqual(['high-contrast']);
		for (const name of ['view-state-get', 'view-state-set']) {
			const refused = (await agentCall(page, name, { id: 'loam.settings', state: {} })) as {
				error?: { code: string };
			};
			expect(refused.error?.code, name).toBe('VIEW_STATE_NOT_FOUND');
		}
		const listed = (await agentCall(page, 'view-state-list')) as {
			data: { states: Array<{ id: string }> };
		};
		expect(listed.data.states.map((state) => state.id)).not.toContain('loam.settings');
		await opened.context.close();
	});
});
