/**
 * P4-E5 in Chromium (phase 4 specification, 5.2, 5.3, 5.4, 3.5 and 15): the settings tree's Experiments entry, after
 * Autonomy; hello's `hello.inspector-v2` listed with what it may change and when it ends; turning it on for yourself
 * through the section, which creates hello's inspector, and off again, which takes it away; the workspace's switch and
 * a person's opt-out; and axe in three themes. The units of E5, two people and R14's unload among them, are the
 * kernel's `late/experiments.test.ts` and `late/experiment-rules.test.ts`.
 */

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	axe,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	kernelCall,
	openApp,
	openShell,
	packApp,
	serveDeployment,
	setTheme,
	settle,
} from './harness';

let browser: Browser;
let site: DeploymentSite;
let gatedSite: DeploymentSite;
const tempDirs: string[] = [];

async function packGatedCopy(
	app: 'tally' | 'notes',
	experimentId: string,
	title: string
): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `loam-gated-${app}-`));
	tempDirs.push(dir);
	await cp(await packApp(app), dir, { recursive: true });
	const manifestPath = join(dir, 'app-manifest.json');
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
		manifest_version: number;
		app?: Record<string, unknown>;
		ui?: Record<string, unknown>;
	};
	manifest.manifest_version = 2;
	manifest.app = { ...(manifest.app ?? {}), requires_experiment: `${app}.${experimentId}` };
	manifest.ui = {
		...(manifest.ui ?? {}),
		experiments: [
			{
				id: experimentId,
				title,
				changes: `Shows ${app} and its surfaces.`,
				ends: '2027-03-01',
				stage: 'visible',
			},
		],
	};
	await writeFile(manifestPath, JSON.stringify(manifest, null, '\t'));
	return dir;
}

beforeAll(async () => {
	const hello = await packApp('hello');
	site = await serveDeployment({
		config: deploymentFile(deploymentEntry('hello', hello, { order: 10 })),
	});
	gatedSite = await serveDeployment({
		config: deploymentFile(
			deploymentEntry('hello', hello, { order: 10 }),
			deploymentEntry('tally', await packGatedCopy('tally', 'beta', 'Tally beta'), { order: 20 }),
			deploymentEntry('notes', await packGatedCopy('notes', 'beta', 'Notes beta'), { order: 30 })
		),
	});
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
	await gatedSite?.close();
	await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const ID = 'hello-inspector-v2';
const list = (page: Page) =>
	page.locator('loam-main loam-settings-section loam-experiments-section');

async function opened(): Promise<Page> {
	const { page } = await openShell(browser, site.origin);
	await kernelCall(page, 'section-open', { section: 'settings', target: 'loam.experiments' });
	await settle(page);
	await expect.poll(() => list(page).locator(`#experiment-${ID}`).count()).toBe(1);
	return page;
}

describe('P4-E5: an experiment gates a surface until a person opts in', () => {
	it('sits after Autonomy and says what may change and when it ends', async () => {
		const page = await opened();
		expect(
			await page
				.locator(
					'loam-main loam-settings-section [role="treeitem"][data-group="shell"] [role="treeitem"]'
				)
				.allTextContents()
		).toContain('Experiments');
		const row = list(page).locator(`#experiment-${ID}`);
		expect(await row.locator('h3').textContent()).toBe('Greeting inspector, Hello');
		expect(await row.innerText()).toContain('inspector');
		expect(await row.innerText()).toMatch(/Ends .*2027\./);
		expect(await row.locator(`#${ID}-state`).textContent()).toBe('Off.');
		expect(await row.locator(`#${ID}-person`).isChecked()).toBe(false);
		await page.close();
	});

	it("creates hello's inspector once it is on for me, and takes it away when off", async () => {
		const page = await opened();
		// #2112: before enabling hello.inspector-v2, hello's layout does not declare inspector.
		await openApp(page, 'hello');
		expect(
			(
				(await kernelCall(page, 'layout-set', { inspector: { open: true } })) as {
					error?: { code?: string };
				}
			).error?.code
		).toBe('LAYOUT_PART_UNDECLARED');
		await kernelCall(page, 'section-open', { section: 'settings', target: 'loam.experiments' });
		await expect.poll(() => list(page).locator(`#experiment-${ID}`).count()).toBe(1);
		await list(page).locator(`#${ID}-person`).check();
		await expect
			.poll(() => list(page).locator(`#${ID}-state`).textContent())
			.toBe('On: you turned it on.');
		await openApp(page, 'hello');
		expect(
			(
				(await kernelCall(page, 'layout-set', { inspector: { open: true } })) as {
					success: boolean;
				}
			).success
		).toBe(true);
		await page.locator('hello-inspector').waitFor();
		const gates = (await kernelCall(page, 'app-get', { instance: 'hello' })) as {
			data: { gates: Record<string, { open: boolean }>; surfaces: string[] };
		};
		expect(gates.data.gates.inspector?.open).toBe(true);
		// Off again, from anywhere: the shell renders the gates again, closes inspector in layout, and refuses reopening (#2112).
		await kernelCall(page, 'experiment-disable', {
			experiment: 'hello.inspector-v2',
			audience: 'person',
		});
		await settle(page);
		await expect.poll(() => page.locator('hello-inspector').count()).toBe(0);
		expect(
			(
				(await kernelCall(page, 'layout-get')) as {
					data?: { inspector?: { open?: boolean } };
				}
			).data?.inspector?.open
		).toBe(false);
		expect(
			(
				(await kernelCall(page, 'layout-set', { inspector: { open: true } })) as {
					error?: { code?: string };
				}
			).error?.code
		).toBe('LAYOUT_PART_UNDECLARED');
		await page.close();
	});

	it('turns it on for the workspace, and lets me step out (D155)', async () => {
		const page = await opened();
		const row = () => list(page).locator(`#experiment-${ID}`);
		await row().locator(`#${ID}-workspace`).check();
		await expect
			.poll(() => row().locator(`#${ID}-state`).textContent())
			.toBe('On: an owner turned it on for the workspace.');
		expect(await row().locator(`#${ID}-person`).isChecked()).toBe(true);
		await row().locator(`#${ID}-person`).uncheck();
		await expect
			.poll(() => row().locator(`#${ID}-state`).textContent())
			.toBe('Off: you turned it off.');
		expect(await row().locator(`#${ID}-workspace`).isChecked()).toBe(true);
		await page.close();
	});

	it('P4-E13: P4-E5: passes axe in three themes', async () => {
		const page = await opened();
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			await setTheme(page, theme);
			await expect
				.poll(() => list(page).locator(`#experiment-${ID}`).count(), { message: theme })
				.toBe(1);
			expect(await axe(page), theme).toEqual([]);
		}
		await page.close();
	});

	it('hides a gated app from the rail during stage A first paint until opted in (#2111)', async () => {
		const rail = (page: Page) =>
			page
				.locator('loam-rail loam-app-entry')
				.evaluateAll((entries) => entries.map((entry) => entry.getAttribute('instance')));
		const context = await browser.newContext();
		const page = await context.newPage();
		// Hold stage B's apps/late chunks so stage A paints from boot records alone.
		gatedSite.hold(/\/assets\/(apps|late)-/);
		try {
			await page.goto(gatedSite.origin, { waitUntil: 'domcontentloaded' });
			await expect.poll(() => rail(page)).toEqual(['hello']);
			// Wait until stage B is actually requested and held, confirming the rail stays ['hello'] throughout stage A.
			await expect.poll(() => gatedSite.held.length).toBeGreaterThan(0);
			expect(await rail(page)).toEqual(['hello']);
		} finally {
			gatedSite.release();
		}
		await page.waitForFunction(
			() =>
				(
					document.querySelector('loam-shell') as {
						kernel?: { appsReady?: Promise<unknown> };
					} | null
				)?.kernel?.appsReady !== undefined
		);
		await page.evaluate(
			() =>
				(
					document.querySelector('loam-shell') as unknown as {
						kernel: { appsReady: Promise<unknown> };
					}
				).kernel.appsReady
		);
		await settle(page);
		expect(await rail(page)).toEqual(['hello']);
		await kernelCall(page, 'experiment-enable', {
			experiment: 'tally.beta',
			audience: 'person',
		});
		await expect.poll(() => rail(page)).toEqual(['hello', 'tally']);
		await context.close();
	});

	it('closes a gated document app’s open tabs in the editor area when disabled while keeping the document (#2113)', async () => {
		const { page } = await openShell(browser, gatedSite.origin);
		await kernelCall(page, 'experiment-enable', {
			experiment: 'notes.beta',
			audience: 'person',
		});
		const created = (await kernelCall(page, 'document-create', {
			type: 'notes',
			title: 'Draft note',
		})) as { data: { id: string } };
		const id = created.data.id;
		await kernelCall(page, 'document-open', { document: id });
		await expect.poll(() => page.locator('loam-editor-area [role="tab"]').count()).toBe(1);

		await kernelCall(page, 'experiment-disable', {
			experiment: 'notes.beta',
			audience: 'person',
		});
		await expect.poll(() => page.locator('loam-editor-area [role="tab"]').count()).toBe(0);
		expect(
			(
				(await kernelCall(page, 'editor-get')) as {
					data: { groups: Array<{ tabs: unknown[] }> };
				}
			).data.groups.flatMap((group) => group.tabs)
		).toEqual([]);

		// Re-enabling makes the document openable again (the record stayed in the store).
		await kernelCall(page, 'experiment-enable', {
			experiment: 'notes.beta',
			audience: 'person',
		});
		expect(
			((await kernelCall(page, 'document-open', { document: id })) as { success: boolean }).success
		).toBe(true);
		await expect.poll(() => page.locator('loam-editor-area [role="tab"]').count()).toBe(1);
		await page.close();
	});
});
