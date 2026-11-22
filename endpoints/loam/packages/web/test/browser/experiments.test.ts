/**
 * P4-E5 in Chromium (phase 4 specification, 5.2, 5.3, 5.4, 3.5 and 15): the settings tree's Experiments entry, after
 * Autonomy; hello's `hello.inspector-v2` listed with what it may change and when it ends; turning it on for yourself
 * through the section, which creates hello's inspector, and off again, which takes it away; the workspace's switch and
 * a person's opt-out; and axe in three themes. The units of E5, two people and R14's unload among them, are the
 * kernel's `late/experiments.test.ts` and `late/experiment-rules.test.ts`.
 */

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
	settle,
} from './harness';

let browser: Browser;
let site: DeploymentSite;
beforeAll(async () => {
	site = await serveDeployment({
		config: deploymentFile(deploymentEntry('hello', await packApp('hello'), { order: 10 })),
	});
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
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
		await list(page).locator(`#${ID}-person`).check();
		await expect
			.poll(() => list(page).locator(`#${ID}-state`).textContent())
			.toBe('On: you turned it on.');
		await openApp(page, 'hello');
		await kernelCall(page, 'layout-set', { inspector: { open: true } });
		await page.locator('hello-inspector').waitFor();
		const gates = (await kernelCall(page, 'app-get', { instance: 'hello' })) as {
			data: { gates: Record<string, { open: boolean }>; surfaces: string[] };
		};
		expect(gates.data.gates.inspector?.open).toBe(true);
		// Off again, from anywhere: the shell renders the gates again and the inspector is gone (5.3).
		await kernelCall(page, 'experiment-disable', {
			experiment: 'hello.inspector-v2',
			audience: 'person',
		});
		await settle(page);
		await expect.poll(() => page.locator('hello-inspector').count()).toBe(0);
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

	it('passes axe in three themes', async () => {
		const page = await opened();
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			await kernelCall(page, 'appearance-set', { theme });
			await settle(page);
			expect(await axe(page), theme).toEqual([]);
		}
		await page.close();
	});
});
