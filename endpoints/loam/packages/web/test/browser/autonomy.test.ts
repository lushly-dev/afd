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

/**
 * Each save goes through the kernel and its event's read again; a loaded run (beside other suites, or on CI) takes
 * longer than the default second (#2843).
 */
const POLL = { timeout: 10_000 };

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
	await expect.poll(() => autonomy(page).count(), POLL).toBe(1);
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
		await expect.poll(() => panel.locator('#autonomy-advisory').textContent(), POLL).toBe(NOTICE);
		expect(
			await panel.evaluate(
				(element) => element.shadowRoot?.querySelector('.section')?.firstElementChild?.id
			)
		).toBe('autonomy-advisory');

		// An owner's workspace mode and ceiling, the project's mode, and a rule for one command.
		await panel.locator('#workspace-mode').selectOption('ask');
		await expect
			.poll(() => panel.locator('.status').textContent(), POLL)
			.toBe("Workspace's mode is saved.");
		await panel.locator('#workspace-ceiling').selectOption('act');
		await expect
			.poll(() => panel.locator('.status').textContent(), POLL)
			.toBe('The ceiling is saved.');
		await panel.locator('#project-mode').selectOption('act');
		await expect
			.poll(() => panel.locator('.status').textContent(), POLL)
			.toBe("Project Atlas's mode is saved.");
		await panel.locator('#add-project-app').selectOption('tally');
		await expect
			.poll(() => panel.locator('#add-project-command option').allTextContents(), POLL)
			.toContain('Add to the tally');
		await panel.locator('#add-project-command').selectOption('tally-add');
		await panel.locator('#add-project-mode').selectOption('ask');
		await panel.getByRole('button', { name: 'Add rule' }).nth(1).click();
		await expect
			.poll(() => panel.locator('.status').textContent(), POLL)
			.toBe('The new rule is saved.');
		await expect
			.poll(() => panel.locator(`[data-row="project/${atlas}/tally/tally-add"]`).count(), POLL)
			.toBe(1);

		await panel.locator('#add-workspace-app').selectOption('shell');
		await panel.locator('#add-workspace-command').selectOption('layout-get');
		await panel.getByRole('button', { name: 'Add rule' }).first().click();
		await expect
			.poll(() => panel.locator('[data-row="workspace/-/shell/layout-get"]').count(), POLL)
			.toBe(1);

		// The chain: why each command gets its mode here.
		const explain = async (command: string) => {
			await panel.locator('#explain-command').fill(command);
			await panel.getByRole('button', { name: 'Explain' }).click();
			await expect
				.poll(() => panel.locator('#autonomy-explained p').first().textContent(), POLL)
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
		await expect
			.poll(() => panel.locator('.status').textContent(), POLL)
			.toBe('Your cap is saved.');
		expect(await explain('tally-get')).toContain('Your own cap: Suggest only');
		expect(await kernelCall(page, 'autonomy-list')).toMatchObject({ data: { cap: 'suggest' } });

		// Removing a rule, in words: the rule's own select.
		await panel.locator(`[data-row="project/${atlas}/tally/tally-add"] select`).selectOption('');
		await expect
			.poll(() => panel.locator(`[data-row="project/${atlas}/tally/tally-add"]`).count(), POLL)
			.toBe(0);
		await page.close();
	});

	it("keeps a half-made rule's app, command and mode when another write reads the section again (#2843)", async () => {
		const { page } = await inAtlas();
		const panel = autonomy(page);
		await panel.locator('#add-project-app').selectOption('tally');
		await expect
			.poll(() => panel.locator('#add-project-command option').allTextContents(), POLL)
			.toContain('Add to the tally');
		await panel.locator('#add-project-command').selectOption('tally-add');
		await panel.locator('#add-project-mode').selectOption('suggest');
		// A change from elsewhere: its event reads the section again, which draws every control anew.
		await panel.locator('#add-project-app').evaluate((select) => {
			select.dataset.before = '';
		});
		expect(await kernelCall(page, 'autonomy-set', { level: 'person', cap: 'act' })).toMatchObject({
			success: true,
		});
		await expect
			.poll(
				() =>
					panel.evaluate(
						(element) =>
							element.shadowRoot?.querySelector<HTMLSelectElement>('#autonomy-cap')?.value
					),
				POLL
			)
			.toBe('act');
		await settle(page);
		// Drawn anew, its choices given back.
		expect(await panel.locator('#add-project-app[data-before]').count()).toBe(0);
		expect(await panel.locator('#add-project-app').inputValue()).toBe('tally');
		await expect
			.poll(() => panel.locator('#add-project-command').inputValue(), POLL)
			.toBe('tally-add');
		expect(await panel.locator('#add-project-mode').inputValue()).toBe('suggest');
		await page.close();
	});

	it('keeps the chosen command across two reads again while its list is still coming, and nothing into another project (#2843)', async () => {
		const { page } = await inAtlas();
		const panel = autonomy(page);
		await panel.locator('#add-project-app').selectOption('tally');
		await expect
			.poll(() => panel.locator('#add-project-command option').allTextContents(), POLL)
			.toContain('Add to the tally');
		await panel.locator('#add-project-command').selectOption('tally-add');
		await panel.locator('#add-project-mode').selectOption('act');
		// Every `app-command-list` held from here, so each form drawn again waits on its list.
		await page.evaluate(() => {
			const kernel = (
				document.querySelector('loam-shell') as unknown as {
					kernel: { call(name: string, ...rest: unknown[]): Promise<unknown> };
				}
			).kernel;
			const call = kernel.call.bind(kernel);
			const held: Array<() => void> = [];
			(globalThis as { releaseLists?: () => void }).releaseLists = () => {
				for (const release of held.splice(0)) release();
			};
			kernel.call = async (name: string, ...rest: unknown[]) => {
				if (name === 'app-command-list') await new Promise<void>((resolve) => held.push(resolve));
				return call(name, ...rest);
			};
		});
		const drawn = async (mark: string) => {
			await panel.locator('#add-project-app').evaluate((select, mark) => {
				select.dataset.mark = mark;
			}, mark);
			expect(await kernelCall(page, 'autonomy-set', { level: 'person', cap: mark })).toMatchObject({
				success: true,
			});
			await expect
				.poll(() => panel.locator(`#add-project-app[data-mark="${mark}"]`).count(), POLL)
				.toBe(0);
			await settle(page);
		};
		await drawn('act');
		// Its list is still coming: the command select is empty, and Add rule sends nothing.
		expect(await panel.locator('#add-project-command option').count()).toBe(0);
		await drawn('suggest');
		await page.evaluate(() => (globalThis as { releaseLists?: () => void }).releaseLists?.());
		await expect
			.poll(() => panel.locator('#add-project-command').inputValue(), POLL)
			.toBe('tally-add');
		expect(await panel.locator('#add-project-app').inputValue()).toBe('tally');
		expect(await panel.locator('#add-project-mode').inputValue()).toBe('act');

		// Another project's form starts afresh.
		const other = (await kernelCall(page, 'project-create', {
			name: 'Beacon',
			slug: 'beacon',
		})) as {
			data: { id: string };
		};
		await kernelCall(page, 'scope-set', { project: other.data.id });
		await kernelCall(page, 'section-open', { section: 'settings', target: 'loam.autonomy' });
		await settle(page);
		await expect.poll(() => panel.locator('h3').first().count(), POLL).toBe(1);
		await expect
			.poll(() => panel.locator('section[aria-label="Project Beacon"]').count(), POLL)
			.toBe(1);
		await page.evaluate(() => (globalThis as { releaseLists?: () => void }).releaseLists?.());
		expect(await panel.locator('#add-project-app').inputValue()).not.toBe('tally');
		expect(await panel.locator('#add-project-mode').inputValue()).toBe('ask');
		await page.close();
	});

	it('refuses a rule above the bound with the reason in words, and an agent is handed the way', async () => {
		const { page } = await inAtlas();
		const panel = autonomy(page);
		// No workspace mode or ceiling: a project's general row may go no further than ask (F8).
		await panel.locator('#project-mode').selectOption('act');
		await expect
			.poll(() => panel.locator('.status').textContent(), POLL)
			.toMatch(/^Project Atlas's mode was not saved\. .*owner/);
		// The section says so, then reads again, which puts the stored value back: polled, as it lands after the words.
		await expect.poll(() => panel.locator('#project-mode').inputValue(), POLL).toBe('');
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
		await expect.poll(() => new URL(page.url()).hash, POLL).toBe('#cap');
		await expect.poll(() => autonomy(page).count(), POLL).toBe(1);
		// The section reveals and focuses the cap's control (improvement 10).
		await expect.poll(() => deepest(page), POLL).toBe('autonomy-cap');
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
		await expect.poll(() => panel.locator('[data-row]').count(), POLL).toBe(1);
		expect(await panel.locator('#workspace-mode').inputValue()).toBe('ask');
		expect(await panel.locator('#workspace-ceiling').inputValue()).toBe('act');
		expect(await panel.locator('#autonomy-cap').count()).toBe(1);
		await panel.locator('#autonomy-more').click();
		await expect.poll(() => panel.locator('[data-row]').count(), POLL).toBe(3);
		await expect.poll(() => panel.locator('#autonomy-more').count(), POLL).toBe(0);
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
		await expect.poll(() => panel.locator('#autonomy-cap').count(), POLL).toBe(0);
		expect(await panel.locator('#cap').innerText()).toContain(
			'This deployment cannot keep it yet.'
		);
		expect(await panel.locator('#autonomy-advisory').textContent()).toBe(NOTICE);
		await page.close();
	});

	it('keeps the cap and the general controls when a page read fails, the failure beside them', async () => {
		const { page } = await inAtlas();
		await expect.poll(() => autonomy(page).locator('#autonomy-cap').count(), POLL).toBe(1);
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
			.poll(() => panel.locator('#autonomy-read-error').textContent(), POLL)
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
