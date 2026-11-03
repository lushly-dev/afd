/**
 * E9's Chromium part (phase 1 specification, section 14 and 4.5): per-app layouts, the preset, a persisted
 * active app, undeclared parts, and a real session replayed with zero differences.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JournalEntry } from '@lushly-dev/afd-core';
import {
	createFixedEnvironment,
	createFixturePorts,
	replayKernel,
} from '@lushly-dev/loam-kernel/testing';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	APPS,
	agentCall,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	journal,
	kernelCall,
	type Layout,
	layoutOf,
	measureFirstPaint,
	openApp,
	openShell,
	packApp,
	serveDeployment,
	surfacesIdle,
} from '../harness';
import { runAppsSession } from './session-apps';

let browser: Browser;
let site: DeploymentSite;
beforeAll(async () => {
	site = await serveDeployment({
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello')),
			deploymentEntry('tally', await packApp('tally'))
		),
	});
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
});

const viewStateLayout = async (page: Page) =>
	((await agentCall(page, 'view-state-get', { id: 'loam.layout' })) as { data: { state: Layout } })
		.data.state;

describe('E9: layout and persistence with apps', () => {
	it('keeps per-app layouts apart across a switch and a reload', async () => {
		const opened = await openShell(browser, site.origin);
		const { page, context } = opened;
		await openApp(page, 'hello');

		// The preset seeds the first open.
		const seeded = await layoutOf(page);
		expect(seeded.sidebar).toEqual({ open: true, width: 260 });
		expect(seeded.inspector.open).toBe(false);
		expect(seeded.panel.open).toBe(false);
		await agentCall(page, 'layout-set', { sidebar: { width: 320 }, inspector: { open: true } });
		await surfacesIdle(page);

		await openApp(page, 'tally');
		const tally = await layoutOf(page);
		expect(tally.sidebar.open).toBe(false);
		expect(tally.inspector.open).toBe(false);
		expect(tally.panel.open).toBe(true);
		await agentCall(page, 'layout-set', { panel: { height: 300 } });
		await surfacesIdle(page);
		expect(await viewStateLayout(page)).toEqual(await layoutOf(page));

		await openApp(page, 'hello');
		const back = await layoutOf(page);
		expect(back.sidebar.width).toBe(320);
		expect(back.inspector.open).toBe(true);

		await agentCall(page, 'app-open', { instance: 'tally' });
		await surfacesIdle(page);
		await page.evaluate(async () => {
			await (
				document.querySelector('loam-shell') as unknown as { kernel: { flush(): Promise<void> } }
			).kernel.flush();
		});
		await page.reload();
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await page.locator('tally-main').waitFor();
		expect((await layoutOf(page)).panel.height).toBe(300);
		const persisted = await page.evaluate(() => {
			const main = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-main');
			return main?.getAttribute('data-app');
		});
		expect(persisted).toBe('tally');
		// A persisted active app opens after first paint, with no `app-open` entry for the reload.
		const sinceReload = await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				journal: { read(): Promise<Array<{ command: string; traceId?: string }>> };
			};
			const entries = await shell.journal.read();
			const base = entries.at(-1)?.traceId?.split('-').slice(0, -1).join('-');
			return entries
				.filter(({ traceId }) => traceId?.startsWith(`${base}-`))
				.map(({ command }) => command);
		});
		expect(sinceReload).not.toContain('app-open');
		const paths = await measureFirstPaint(page);
		expect(paths.some((path) => path.endsWith('dist/native.js'))).toBe(false);
		await page.reload();
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await page.locator('tally-main').waitFor();
		await context.close();
	});

	it('refuses an undeclared part, and its toggle and chord do nothing', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'tally');
		const refused = (await kernelCall(page, 'layout-set', { sidebar: { open: true } })) as {
			error: { code: string; message: string };
		};
		expect(refused.error.code).toBe('LAYOUT_PART_UNDECLARED');
		const toggle = page.locator('loam-titlebar [data-toggle="sidebar"]');
		expect(await toggle.getAttribute('aria-disabled')).toBe('true');
		const before = (await journal(page)).length;
		await toggle.click({ force: true });
		await page.keyboard.press('ControlOrMeta+B');
		await surfacesIdle(page);
		expect(
			(await journal(page)).slice(before).filter(({ command }) => command === 'layout-set')
		).toEqual([]);
		const panelToggle = page.locator('loam-titlebar [data-toggle="panel"]');
		expect(await panelToggle.getAttribute('aria-disabled')).toBe(null);

		// With no app, every part is available again.
		await kernelCall(page, 'app-close');
		await surfacesIdle(page);
		expect(await toggle.getAttribute('aria-disabled')).toBe(null);
		expect(await page.locator('loam-main h1').textContent()).toBe('Choose an app');
		await opened.context.close();
	});

	it('replays a real session, with apps, overlays and switches, with zero differences', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await runAppsSession(page);
		const entries = (await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				journal: { read(): Promise<unknown[]> };
			};
			return shell.journal.read();
		})) as JournalEntry[];
		expect(opened.errors).toEqual([]);
		await opened.context.close();

		const manifestOf = async (app: 'hello' | 'tally') =>
			JSON.parse(await readFile(join(await packApp(app), 'app-manifest.json'), 'utf8')) as unknown;
		const definitionOf = async (app: 'hello' | 'tally') =>
			(await import(/* @vite-ignore */ join(APPS, app, 'dist/native.js'))).default;
		const { report } = await replayKernel(entries, {
			environment: createFixedEnvironment(),
			deployment: site.projection,
			ports: createFixturePorts({
				'apps/hello/': {
					manifest: await manifestOf('hello'),
					definition: await definitionOf('hello'),
				},
				'apps/tally/': {
					manifest: await manifestOf('tally'),
					definition: await definitionOf('tally'),
				},
			}),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		expect(report.entries.length).toBe(entries.length);
	}, 60_000);
});
