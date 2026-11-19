/**
 * P4-E8 in Chromium (phase 4 specification, 7.1 to 7.3, 10.3 and 15): R9's pending path, an agent's `tally-reset`
 * waiting in the inbox, announced, confirmed or declined there by buttons that name the command, the shell running it
 * once; R7's human gesture signed out, a person's own `tally-reset` asking in the slot, focus on Decline, never on
 * Confirm; the active app's port asking with the shell's header; R15's input prompt replaced by its confirmation, and
 * `palette-run` collecting a command's input from the palette; and the slot and the inbox under axe in three themes.
 * The units of E8 are the kernel's `late/confirmations.test.ts`; the close prompt's three answers are
 * `documents/editor.test.ts`'s.
 */

import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	axe,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	focused,
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

type Result = {
	success: boolean;
	data?: Record<string, unknown>;
	error?: { code: string; details?: Record<string, unknown> };
};

/** Start a call that waits for an answer in the slot, kept on the page; `settled` reads its result once it ends. */
const start = (page: Page, name: string, input: unknown, via: 'person' | 'tally') =>
	page.evaluate(
		({ name, input, via }) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: {
					call(name: string, input: unknown): Promise<unknown>;
					appPort(instance: string): { call(name: string, input: unknown): Promise<unknown> };
				};
			};
			const held = window as unknown as { waiting?: Promise<unknown>; ended?: unknown };
			delete held.ended;
			held.waiting = (
				via === 'person'
					? shell.kernel.call(name, input)
					: shell.kernel.appPort('tally').call(name, input)
			).then((result) => {
				held.ended = result;
			});
		},
		{ name, input, via }
	);
const settled = (page: Page) =>
	page.evaluate(() => (window as unknown as { ended?: unknown }).ended) as Promise<
		Result | undefined
	>;

const slot = (page: Page) => page.locator('loam-modal dialog[open]');
const inboxButton = (page: Page) => page.locator('loam-titlebar button.inbox');
const inbox = (page: Page) => page.locator('loam-main loam-inbox');
const total = async (page: Page) =>
	((await kernelCall(page, 'tally-get')) as Result).data?.total as number;
const announced = (page: Page) =>
	page
		.locator('loam-shell')
		.evaluate(
			(shell) => shell.shadowRoot?.querySelector('.announce[role="status"]')?.textContent ?? ''
		);

describe('P4-E8: confirmations', () => {
	it("R9: an agent's reset waits in the inbox, announced, and runs once the person confirms it there", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'tally');
		await kernelCall(page, 'tally-add', { by: 3 });
		const asked = (await agentCall(page, 'tally-reset', {})) as Result;
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		expect(asked.error?.details).toMatchObject({ notification: expect.stringMatching(/^ntf_/) });
		// Never a modal: the slot stays empty.
		expect(await slot(page).count()).toBe(0);
		await expect.poll(() => inboxButton(page).getAttribute('aria-label')).toBe('Inbox 1 unread');
		await expect
			.poll(() => announced(page))
			.toBe(
				'From shell-agent, for you: confirm Reset the tally? Open it from Inbox in the title bar, or from the palette.'
			);
		await kernelCall(page, 'section-open', { section: 'inbox' });
		const item = inbox(page).locator('.notice').first();
		await expect.poll(() => item.textContent()).toContain('Requested by shell-agent for you');
		expect(await item.textContent()).toContain('Set the total back to zero and clear its history');
		expect(await item.locator('.meta').nth(1).textContent()).toContain('Waiting for your answer');
		// Confirm and Decline name the command (15).
		const confirm = item.getByRole('button', { name: 'Confirm Reset the tally' });
		expect(await item.getByRole('button', { name: 'Decline Reset the tally' }).count()).toBe(1);
		await confirm.click();
		await expect.poll(() => total(page)).toBe(0);
		await expect.poll(() => item.locator('.meta').nth(1).textContent()).toContain('Confirmed');
		// F5: the agent's re-call returns the stored outcome; nothing runs again.
		await kernelCall(page, 'tally-add', { by: 2 });
		const again = (await agentCall(page, 'tally-reset', {})) as Result;
		expect(again).toMatchObject({ success: true, data: { total: 0 } });
		expect(await total(page)).toBe(2);
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it('declines in the inbox: nothing runs, and the same call is refused without asking', async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'tally');
		await kernelCall(page, 'tally-add', { by: 3 });
		await agentCall(page, 'tally-reset', {});
		await kernelCall(page, 'section-open', { section: 'inbox' });
		const item = inbox(page).locator('.notice').first();
		await item.getByRole('button', { name: 'Decline Reset the tally' }).click();
		await expect.poll(() => item.locator('.meta').nth(1).textContent()).toContain('Declined');
		const again = (await agentCall(page, 'tally-reset', {})) as Result;
		expect(again.error?.code).toBe('CONFIRMATION_DECLINED');
		await expect
			.poll(() => item.locator('.meta').nth(1).textContent())
			.toContain('Declined automatically once');
		expect(await total(page)).toBe(3);
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it("R7: a person's own reset asks in the slot, signed out, Decline focused, and runs on their Confirm", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await kernelCall(page, 'tally-add', { by: 4 });
		// From the palette: a row with no input runs at once, and its confirmation asks in the slot.
		await page.keyboard.press('ControlOrMeta+K');
		await page.locator('loam-palette input').fill('tally-reset');
		await expect
			.poll(() => page.locator('loam-palette violet-option').first().getAttribute('data-command'))
			.toBe('tally-reset');
		await page.keyboard.press('Enter');
		await expect.poll(() => slot(page).count()).toBe(1);
		const dialog = slot(page);
		expect(await dialog.getAttribute('aria-modal')).toBe('true');
		expect(await dialog.locator('h2').textContent()).toBe('Run Reset the tally?');
		expect(await dialog.locator('#modal-body').textContent()).toContain(
			'Set the total back to zero'
		);
		expect(await dialog.locator('.details').textContent()).toBe('No input');
		// The header is the dialog's name (15); focus is on Decline, never Confirm (step 4's record).
		await expect.poll(async () => (await focused(page)).label).toBe('Decline');
		await dialog.locator('button', { hasText: 'Confirm' }).click();
		await expect.poll(() => slot(page).count()).toBe(0);
		await expect.poll(() => total(page)).toBe(0);
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it("the active app's port asks with the shell's header, and its decline holds the port back", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'tally');
		await kernelCall(page, 'tally-add', { by: 5 });
		await start(page, 'tally-reset', {}, 'tally');
		await expect.poll(() => slot(page).count()).toBe(1);
		expect(await slot(page).locator('h2').textContent()).toBe('Tally asks to run Reset the tally');
		await slot(page).locator('button', { hasText: 'Decline' }).click();
		await expect.poll(async () => (await settled(page))?.error?.code).toBe('CONFIRMATION_DECLINED');
		// R16: held by the window, without asking again.
		await start(page, 'tally-reset', {}, 'tally');
		await expect.poll(async () => (await settled(page))?.error?.code).toBe('CONFIRMATION_DECLINED');
		expect(await slot(page).count()).toBe(0);
		expect(await total(page)).toBe(5);
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it("R15 and 7.1: palette-run's prompt collects input, and a confirm_prompt command's confirmation replaces it", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await kernelCall(page, 'hello-greet', { name: 'Ada' });
		const names = async () =>
			(
				(((await kernelCall(page, 'hello-list')) as Result).data?.items ?? []) as Array<{
					id: string;
				}>
			).map((item) => item.id);
		expect(await names()).toContain('Ada');
		// A command that needs input is a palette row that opens its prompt (7.1).
		await page.keyboard.press('ControlOrMeta+K');
		await page.locator('loam-palette input').fill('hello-forget');
		await expect
			.poll(() => page.locator('loam-palette violet-option').first().getAttribute('data-command'))
			.toBe('hello-forget');
		await page.keyboard.press('Enter');
		await expect.poll(() => slot(page).count()).toBe(1);
		expect(await slot(page).locator('h2').textContent()).toBe('Forget a name');
		// Input the command's schema refuses keeps the prompt open, with the reason.
		await slot(page).locator('button', { hasText: 'Run' }).click();
		await expect.poll(() => slot(page).locator('.error').textContent()).toContain('fit');
		await slot(page).locator('input').first().fill('Ada');
		await slot(page).locator('button', { hasText: 'Run' }).click();
		await expect.poll(() => slot(page).count()).toBe(0);
		await expect.poll(names).not.toContain('Ada');
		// R15: the reset's input prompt, replaced in the slot by its confirmation, which shows the input.
		await kernelCall(page, 'tally-add', { by: 1 });
		const opened = (await kernelCall(page, 'palette-run', { command: 'tally-reset' })) as Result;
		expect(opened.data?.prompt).toMatchObject({ kind: 'prompt', owner: 'shell' });
		await expect.poll(() => slot(page).locator('h2').textContent()).toBe('Reset the tally');
		await slot(page).locator('button', { hasText: 'Run' }).click();
		await expect.poll(() => slot(page).locator('h2').textContent()).toBe('Run Reset the tally?');
		expect(await slot(page).locator('.details').textContent()).toBe('No input');
		await slot(page).locator('button', { hasText: 'Confirm' }).click();
		await expect.poll(() => total(page)).toBe(0);
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it('passes axe in three themes with a confirmation in the slot and one in the inbox', async () => {
		const { page } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await agentCall(page, 'tally-reset', {});
		await kernelCall(page, 'section-open', { section: 'inbox' });
		await expect.poll(() => inbox(page).locator('.notice').count()).toBe(1);
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			await kernelCall(page, 'appearance-set', { theme });
			await settle(page);
			expect(await axe(page), theme).toEqual([]);
		}
		await start(page, 'tally-reset', {}, 'person');
		await expect.poll(() => slot(page).count()).toBe(1);
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			await page.evaluate(
				(theme) =>
					(
						document.querySelector('loam-shell') as unknown as {
							kernel: { call(name: string, input: unknown): Promise<unknown> };
						}
					).kernel.call('appearance-set', { theme }),
				theme
			);
			await settle(page);
			expect(await axe(page), theme).toEqual([]);
		}
		await page.context().close();
	});
});
