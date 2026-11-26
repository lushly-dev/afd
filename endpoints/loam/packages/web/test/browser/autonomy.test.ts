/**
 * P4-E4 and P4-E13's notice in Chromium (phase 4 specification, 4.5, 3.5, 13 and 15): the settings tree's Autonomy
 * entry, after Keybindings; the advisory notice above its rows, exactly; the workspace's mode and ceiling, a project's
 * mode and a rule for one command, each set through the section; the chain explaining a resolved mode; the person's
 * cap; section 13's message in place of the cap on a hosted `provider` deployment; and axe in three themes. The units
 * of E4 are the kernel's `late/autonomy.test.ts` and `late/autonomy-rules.test.ts`.
 */

import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	axe,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	focused,
	kernelCall,
	openShell,
	packApp,
	serveDeployment,
	setTheme,
	settle,
} from './harness';

let browser: Browser;
let site: DeploymentSite;
beforeAll(async () => {
	site = await serveDeployment({
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello'), { order: 10 }),
			deploymentEntry('tally', await packApp('tally'), { order: 20 })
		),
	});
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
});

const NOTICE =
	'Loam holds every agent, the copilot included, to these rules: Act runs, Ask asks you first, Suggest only offers it to you.';

/** The id of the deepest focused element, through shadow roots. */
const deepest = (page: Page) =>
	page.evaluate(() => {
		let element: Element | null = document.activeElement;
		while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
		return element?.id;
	});
const autonomy = (page: Page) =>
	page.locator('loam-main loam-settings-section loam-autonomy-section');

/** A shell with Atlas made and active, the autonomy section open. */
async function inAtlas(): Promise<{ page: Page; atlas: string }> {
	const { page } = await openShell(browser, site.origin, { agents: 'ask' });
	const made = (await kernelCall(page, 'project-create', { name: 'Atlas', slug: 'atlas' })) as {
		data: { id: string };
	};
	await kernelCall(page, 'scope-set', { project: made.data.id });
	await kernelCall(page, 'section-open', { section: 'settings', target: 'loam.autonomy' });
	await settle(page);
	await expect.poll(() => autonomy(page).count()).toBe(1);
	return { page, atlas: made.data.id };
}

describe('P4-E4: the autonomy section', () => {
	it('P4-E13: P4-E4: sits after Keybindings, shows the notice above its rows, and sets and explains a mode per command', async () => {
		const { page, atlas } = await inAtlas();
		const view = page.locator('loam-main loam-settings-section');
		expect(
			await view
				.locator('[role="treeitem"][data-group="shell"] [role="treeitem"]')
				.allTextContents()
		).toEqual([
			'Appearance',
			'Rail',
			'Keybindings',
			'Autonomy',
			'Experiments',
			'Notifications',
			'Limits',
			'Documents',
		]);
		expect(await view.locator('[role="treeitem"][aria-selected="true"]').textContent()).toBe(
			'Autonomy'
		);
		expect(new URL(page.url()).pathname).toMatch(/\/p\/atlas\/~\/settings\/loam\.autonomy$/);
		// E13: the advisory notice, exactly, first in the section, above every row.
		const panel = autonomy(page);
		await expect.poll(() => panel.locator('#autonomy-advisory').textContent()).toBe(NOTICE);
		expect(
			await panel.evaluate(
				(element) => element.shadowRoot?.querySelector('.section')?.firstElementChild?.id
			)
		).toBe('autonomy-advisory');

		// An owner's workspace mode and ceiling, the project's mode, and a rule for one command.
		await panel.locator('#workspace-mode').selectOption('ask');
		await expect
			.poll(() => panel.locator('.status').textContent())
			.toBe("Workspace's mode is saved.");
		await panel.locator('#workspace-ceiling').selectOption('act');
		await expect.poll(() => panel.locator('.status').textContent()).toBe('The ceiling is saved.');
		await panel.locator('#project-mode').selectOption('act');
		await expect
			.poll(() => panel.locator('.status').textContent())
			.toBe("Project Atlas's mode is saved.");
		await panel.locator('#add-project-app').selectOption('tally');
		await expect
			.poll(() => panel.locator('#add-project-command option').allTextContents())
			.toContain('Add to the tally');
		await panel.locator('#add-project-command').selectOption('tally-add');
		await panel.locator('#add-project-mode').selectOption('ask');
		await panel.getByRole('button', { name: 'Add rule' }).nth(1).click();
		await expect.poll(() => panel.locator('.status').textContent()).toBe('The new rule is saved.');
		await expect
			.poll(() => panel.locator(`[data-row="project/${atlas}/tally/tally-add"]`).count())
			.toBe(1);

		await panel.locator('#add-workspace-app').selectOption('shell');
		await panel.locator('#add-workspace-command').selectOption('layout-get');
		await panel.getByRole('button', { name: 'Add rule' }).first().click();
		await expect
			.poll(() => panel.locator('[data-row="workspace/-/shell/layout-get"]').count())
			.toBe(1);

		// The chain: why each command gets its mode here.
		const explain = async (command: string) => {
			await panel.locator('#explain-command').fill(command);
			await panel.getByRole('button', { name: 'Explain' }).click();
			await expect
				.poll(() => panel.locator('#autonomy-explained p').first().textContent())
				.toMatch(new RegExp(`^${command}:`));
			return panel.locator('#autonomy-explained').innerText();
		};
		expect(await explain('tally-get')).toContain('tally-get: Act');
		expect(await explain('tally-get')).toContain(
			"Act, from the project Atlas's rule for every app and command"
		);
		expect(await explain('tally-get')).toContain(
			"Bounded to Act by the workspace's rule for every app and command"
		);
		expect(await explain('tally-add')).toContain('tally-add: Ask first');
		expect(await kernelCall(page, 'autonomy-get', { command: 'tally-add' })).toMatchObject({
			data: { mode: 'ask', from: `project/${atlas}/tally/tally-add` },
		});

		// The person's own cap, which only lowers.
		await panel.locator('#autonomy-cap').selectOption('suggest');
		await expect.poll(() => panel.locator('.status').textContent()).toBe('Your cap is saved.');
		expect(await explain('tally-get')).toContain('Your own cap: Suggest only');
		expect(await kernelCall(page, 'autonomy-list')).toMatchObject({ data: { cap: 'suggest' } });

		// Removing a rule, in words: the rule's own select.
		await panel.locator(`[data-row="project/${atlas}/tally/tally-add"] select`).selectOption('');
		await expect
			.poll(() => panel.locator(`[data-row="project/${atlas}/tally/tally-add"]`).count())
			.toBe(0);
		await page.close();
	});

	it('refuses a rule above the bound with the reason in words, and an agent is handed the way', async () => {
		const { page } = await inAtlas();
		const panel = autonomy(page);
		// No workspace mode or ceiling: a project's general row may go no further than ask (F8).
		await panel.locator('#project-mode').selectOption('act');
		await expect
			.poll(() => panel.locator('.status').textContent())
			.toMatch(/^Project Atlas's mode was not saved\. .*owner/);
		// The section says so, then reads again, which puts the stored value back: polled, as it lands after the words.
		await expect.poll(() => panel.locator('#project-mode').inputValue()).toBe('');
		const handed = (await page.evaluate(() =>
			(
				document.querySelector('loam-shell') as unknown as {
					kernel: { agent: { call(name: string, input: unknown): Promise<unknown> } };
				}
			).kernel.agent.call('autonomy-set', { level: 'workspace', mode: 'act' })
		)) as { error: { code: string; details: { route: string } } };
		expect(handed.error).toMatchObject({
			code: 'HUMAN_REQUIRED',
			details: { route: '~/settings/loam.autonomy' },
		});
		// The cap's hand-off opens the section at the cap.
		await kernelCall(page, 'section-open', { section: 'settings', target: 'loam.autonomy.cap' });
		await expect.poll(() => new URL(page.url()).hash).toBe('#cap');
		await expect.poll(() => autonomy(page).count()).toBe(1);
		// The section reveals and focuses the cap's control (improvement 10).
		await expect.poll(() => deepest(page)).toBe('autonomy-cap');
		await page.close();
	});

	it('reads its scope a page at a time, the general controls and the cap always shown', async () => {
		const { page } = await inAtlas();
		for (const input of [
			{ level: 'workspace', mode: 'ask', ceiling: 'act' },
			{ level: 'workspace', instance: 'tally', mode: 'ask' },
			{ level: 'workspace', instance: 'tally', command: 'tally-add', mode: 'ask' },
			{ level: 'workspace', instance: 'tally', command: 'tally-get', mode: 'act' },
		])
			expect(await kernelCall(page, 'autonomy-set', input)).toMatchObject({ success: true });
		const panel = autonomy(page);
		await panel.evaluate(async (element) => {
			const section = element as HTMLElement & { pageSize: number; read(): Promise<void> };
			section.pageSize = 2;
			await section.read();
		});
		await expect.poll(() => panel.locator('[data-row]').count()).toBe(1);
		expect(await panel.locator('#workspace-mode').inputValue()).toBe('ask');
		expect(await panel.locator('#workspace-ceiling').inputValue()).toBe('act');
		expect(await panel.locator('#autonomy-cap').count()).toBe(1);
		await panel.locator('#autonomy-more').click();
		await expect.poll(() => panel.locator('[data-row]').count()).toBe(3);
		await expect.poll(() => panel.locator('#autonomy-more').count()).toBe(0);
		await page.close();
	});

	it("shows section 13's message in place of the cap where the deployment cannot keep it", async () => {
		const { page } = await inAtlas();
		// A hosted `provider` deployment's answer, as `autonomy-list` gives it there (the kernel's unit holds the rule).
		await autonomy(page).evaluate(async (element) => {
			const section = element as HTMLElement & {
				kernel: { call(name: string, input: unknown, options: unknown): Promise<unknown> };
				read(): Promise<void>;
			};
			const kernel = section.kernel;
			section.kernel = {
				...kernel,
				async call(name, input, options) {
					const answer = (await kernel.call(name, input, options)) as {
						data?: { writable?: { cap?: object } };
					};
					if (name === 'autonomy-list' && answer.data?.writable)
						answer.data.writable.cap = { writable: false, reason: 'SHARED_RECORD_UNAVAILABLE' };
					return answer;
				},
			};
			await section.read();
		});
		const panel = autonomy(page);
		await expect.poll(() => panel.locator('#autonomy-cap').count()).toBe(0);
		expect(await panel.locator('#cap').innerText()).toContain(
			'This deployment cannot keep it yet.'
		);
		expect(await panel.locator('#autonomy-advisory').textContent()).toBe(NOTICE);
		await page.close();
	});

	it('keeps the cap and the general controls when a page read fails, the failure beside them', async () => {
		const { page } = await inAtlas();
		await expect.poll(() => autonomy(page).locator('#autonomy-cap').count()).toBe(1);
		await autonomy(page).evaluate(async (element) => {
			const section = element as HTMLElement & {
				kernel: { call(name: string, input: unknown, options: unknown): Promise<unknown> };
				read(): Promise<void>;
			};
			const kernel = section.kernel;
			section.kernel = {
				...kernel,
				async call(name, input, options) {
					if (name === 'autonomy-list')
						return {
							success: false,
							error: {
								code: 'OUTPUT_BUDGET_EXCEEDED',
								message: 'Over the budget',
								suggestion: 'Ask for fewer rows',
							},
						};
					return kernel.call(name, input, options);
				},
			};
			await section.read();
		});
		const panel = autonomy(page);
		await expect
			.poll(() => panel.locator('#autonomy-read-error').textContent())
			.toBe('The rules could not be read. Over the budget. Ask for fewer rows');
		expect(await panel.locator('#autonomy-cap').count()).toBe(1);
		expect(await panel.locator('#workspace-mode').count()).toBe(1);
		expect(await panel.locator('#autonomy-advisory').textContent()).toBe(NOTICE);
		await page.close();
	});

	it('P4-E13: P4-E4: moves by keyboard and passes axe in three themes', async () => {
		const { page } = await inAtlas();
		const panel = autonomy(page);
		await panel.locator('#workspace-mode').focus();
		await page.keyboard.press('Tab');
		expect(
			await page.evaluate(() => {
				let element: Element | null = document.activeElement;
				while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
				return element?.id;
			})
		).toBe('workspace-ceiling');
		expect((await focused(page)).hosts).toContain('loam-autonomy-section');
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			await setTheme(page, theme);
			await expect.poll(() => autonomy(page).count(), { message: theme }).toBe(1);
			expect(await axe(page), theme).toEqual([]);
		}
		await page.close();
	});
});
