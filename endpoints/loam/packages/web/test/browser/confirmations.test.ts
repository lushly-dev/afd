/**
 * P4-E8 in Chromium (phase 4 specification, 7.1 to 7.3, 10.3 and 15): R9's pending path, an agent's `tally-reset`
 * waiting in the inbox, announced, confirmed or declined there by buttons that name the command, the shell running it
 * once; R7's human gesture signed out, a person's own `tally-reset` asking in the slot, focus on Decline, never on
 * Confirm; the active app's port asking with the shell's header; R15's input prompt replaced by its confirmation, and
 * `palette-run` collecting a command's input from the palette; and the slot and the inbox under axe in three themes.
 * The units of E8 are the kernel's `late/confirmations.test.ts`; the close prompt's three answers are
 * `documents/editor.test.ts`'s.
 */

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
	openPage,
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
	it("P4-E13: P4-E8: R9: an agent's reset waits in the inbox, announced, and runs once the person confirms it there", async () => {
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

	it("P4-E13: P4-E8: R7: a person's own reset asks in the slot, signed out, Decline focused, and runs on their Confirm", async () => {
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
		// The header is the dialog's name (15): the role's own name, not only the heading's text.
		expect(
			await page.getByRole('dialog', { name: 'Run Reset the tally?', exact: true }).count()
		).toBe(1);
		// Focus is on Decline, never Confirm (step 4's record).
		await expect.poll(async () => (await focused(page)).label).toBe('Decline');
		await dialog.locator('button', { hasText: 'Confirm' }).click();
		await expect.poll(() => slot(page).count()).toBe(0);
		await expect.poll(() => total(page)).toBe(0);
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it("P4-E13: P4-E8: the active app's port asks with the shell's header, and its decline holds the port back", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'tally');
		await kernelCall(page, 'tally-add', { by: 5 });
		await start(page, 'tally-reset', {}, 'tally');
		await expect.poll(() => slot(page).count()).toBe(1);
		expect(await slot(page).locator('h2').textContent()).toBe('Tally asks to run Reset the tally');
		expect(
			await page
				.getByRole('dialog', { name: 'Tally asks to run Reset the tally', exact: true })
				.count()
		).toBe(1);
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

	it("blocker 1: a script's click or a dispatched event answers nothing, in the slot or the inbox", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await kernelCall(page, 'tally-add', { by: 2 });
		await start(page, 'tally-reset', {}, 'person');
		await expect.poll(() => slot(page).count()).toBe(1);
		const forged = await page.evaluate(() => {
			const modal = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-modal') as
				| (HTMLElement & Record<string, unknown>)
				| null;
			const confirm = modal?.shadowRoot?.querySelector<HTMLButtonElement>('button.confirm');
			if (!confirm) throw new Error('No Confirm button in the slot');
			confirm.click();
			confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			// The answer callback is not the element's to give away.
			return { onAnswer: typeof modal?.onAnswer };
		});
		expect(forged.onAnswer).toBe('undefined');
		await settle(page);
		expect(await slot(page).count()).toBe(1);
		expect(await total(page)).toBe(2);
		await slot(page).locator('button', { hasText: 'Decline' }).click();
		await expect.poll(async () => (await settled(page))?.error?.code).toBe('CONFIRMATION_DECLINED');
		await agentCall(page, 'tally-reset', {});
		await kernelCall(page, 'section-open', { section: 'inbox' });
		const item = inbox(page).locator('.notice').first();
		await expect
			.poll(() => item.getByRole('button', { name: 'Confirm Reset the tally' }).count())
			.toBe(1);
		// Both buttons, by name: tally's reset is destructive, so its Confirm is `danger`, not `primary`.
		await item.evaluate((element) => {
			for (const name of ['Confirm Reset the tally', 'Decline Reset the tally']) {
				const button = element.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
				if (!button) throw new Error(`No button named ${name}`);
				button.click();
				button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			}
		});
		await settle(page);
		expect(await item.locator('.meta').nth(1).textContent()).toContain('Waiting for your answer');
		expect(await total(page)).toBe(2);
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it("second round's 6: a script's close of the slot's dialog withdraws the question, and holds nothing back", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'tally');
		await kernelCall(page, 'tally-add', { by: 2 });
		await start(page, 'tally-reset', {}, 'tally');
		await expect.poll(() => slot(page).count()).toBe(1);
		await page.evaluate(() => {
			const modal = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-modal');
			const dialog = modal?.shadowRoot?.querySelector('dialog');
			if (!dialog) throw new Error('No dialog');
			dialog.close();
		});
		await expect.poll(async () => (await settled(page))?.error?.details?.reason).toBe('withdrawn');
		// No window: the port asks again at once.
		await start(page, 'tally-reset', {}, 'tally');
		await expect.poll(() => slot(page).count()).toBe(1);
		await slot(page).locator('button', { hasText: 'Decline' }).click();
		await expect.poll(async () => (await settled(page))?.error?.code).toBe('CONFIRMATION_DECLINED');
		expect(await total(page)).toBe(2);
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it("third round's F: a script's close of an app's own modal is an ordinary cancel the kernel takes", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		const opened = (await page.evaluate(() => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: {
					appPort(instance: string): { call(name: string, input: unknown): Promise<unknown> };
				};
			};
			return shell.kernel
				.appPort('hello')
				.call('modal-open', { title: 'Keep?', body: 'An app asks.' });
		})) as Result & { data?: { overlayId?: string } };
		expect(opened.success).toBe(true);
		await expect.poll(() => slot(page).count()).toBe(1);
		await page.evaluate(() => {
			const modal = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-modal');
			const dialog = modal?.shadowRoot?.querySelector('dialog');
			if (!dialog) throw new Error('No dialog');
			dialog.close();
		});
		// Closed in the kernel too, never left open there while the page shows nothing.
		await expect
			.poll(async () => ((await kernelCall(page, 'overlay-list')) as Result).data?.overlays)
			.toEqual([]);
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it("second round's 10: a long input is shown whole before Confirm is offered", async () => {
		// Tally's package with one more command, a long note under a `confirm_prompt`: raising and listing it calls no
		// handler.
		const packed = await packApp('tally');
		const copy = await mkdtemp(join(tmpdir(), 'loam-tally-note-'));
		await cp(packed, copy, { recursive: true });
		const file = join(copy, 'app-manifest.json');
		const manifest = JSON.parse(await readFile(file, 'utf8')) as { commands: unknown[] };
		manifest.commands.push({
			name: 'tally-note',
			title: 'Keep a note',
			description: 'Keep a long note.',
			effects: ['store-write'],
			confirm_prompt: 'Keep this note?',
			input_schema: {
				type: 'object',
				properties: { text: { type: 'string', maxLength: 100000 } },
				required: ['text'],
				additionalProperties: false,
			},
		});
		await writeFile(file, JSON.stringify(manifest));
		const long = await serveDeployment({
			config: deploymentFile(deploymentEntry('tally', copy, { order: 10 })),
		});
		const { page, errors } = await openShell(browser, long.origin);
		try {
			const text = `${'z'.repeat(5000)} the end`;
			const asked = (await agentCall(page, 'tally-note', { text })) as Result;
			expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
			await kernelCall(page, 'section-open', { section: 'inbox' });
			const item = inbox(page).locator('.notice').first();
			const show = item.getByRole('button', { name: 'Show the full input of Keep a note' });
			await expect.poll(() => show.count()).toBe(1);
			expect(await item.getByRole('button', { name: 'Confirm Keep a note' }).count()).toBe(0);
			expect(await item.locator('.input').textContent()).toContain('too long to list');
			await show.click();
			await expect.poll(() => item.locator('.input').textContent()).toContain('the end');
			await expect
				.poll(() => item.getByRole('button', { name: 'Confirm Keep a note' }).count())
				.toBe(1);
			await item.getByRole('button', { name: 'Decline Keep a note' }).click();
			expect(errors).toEqual([]);
		} finally {
			await page.context().close();
			await long.close();
			await rm(copy, { recursive: true, force: true });
		}
	});

	it('#2801: a preview too long to list is shown whole before Confirm is offered, again for a reshown one', async () => {
		// The browser suite mounts no server that gives a preview, so `notification-list` answers here as the kernel's
		// does for a 64 KiB preview: listed with its size in place of its data, and whole by its id.
		const { page, errors } = await openShell(browser, site.origin);
		try {
			await page.evaluate(() => {
				const shell = document.querySelector('loam-shell') as unknown as {
					kernel: { call(name: string, input?: unknown): Promise<unknown> };
				};
				const kernel = shell.kernel;
				const through = kernel.call.bind(kernel);
				const data = { text: `${'x'.repeat(65_000)} the end` };
				const notice = (id: string, createdAt: number) => ({
					id,
					workspace: 'personal',
					person: 'local',
					source: 'shell',
					kind: 'confirmation',
					title: 'Send the reply set',
					tone: 'info',
					scope: { workspace: 'personal' },
					createdAt,
					confirmation: {
						command: 'mail-replyset-send',
						caller: 'agent:copilot',
						input: {},
						header: 'Requested by the copilot for you',
						prompt: 'Send these replies?',
						title: 'Send',
						expiresAt: Date.now() + 600_000,
						state: 'pending',
						preview: { command: 'mail-replyset-preview', digest: 'd'.repeat(43), labels: 'whole' },
					},
				});
				const held = window as unknown as {
					rows: ReturnType<typeof notice>[];
					wholeReads: string[];
				};
				held.rows = [notice('ntf_aaaaaaaaaaaaaaaa', Date.now())];
				held.wholeReads = [];
				kernel.call = async (name, input) => {
					if (name !== 'notification-list') return through(name, input);
					const one = (input as { notification?: string }).notification;
					const rows = held.rows
						.filter((row) => one === undefined || row.id === one)
						.map((row) => {
							const copy = structuredClone(row);
							Object.assign(
								copy.confirmation.preview,
								one === undefined ? { truncated: true, bytes: 65_020 } : { data }
							);
							return copy;
						});
					if (one !== undefined) held.wholeReads.push(one);
					return {
						success: true,
						data: { notifications: rows, cursor: null, unread: rows.length },
					};
				};
			});
			await kernelCall(page, 'section-open', { section: 'inbox' });
			const item = inbox(page).locator('.notice').first();
			const show = item.getByRole('button', {
				name: 'Show the full preview of Send the reply set',
			});
			const confirm = item.getByRole('button', { name: 'Confirm Send the reply set' });
			await expect.poll(() => show.count()).toBe(1);
			expect(await confirm.count()).toBe(0);
			expect(await item.locator('.preview').allTextContents()).toContain(
				'The preview is too long to list (65020 bytes): show it before you answer'
			);
			await show.click();
			// Read by its id, whole: the end of the preview's text shows, and only then Confirm.
			await expect
				.poll(() => item.locator('.preview').allTextContents())
				.toEqual(expect.arrayContaining([expect.stringContaining('the end')]));
			await expect.poll(() => confirm.count()).toBe(1);
			expect(
				await page.evaluate(() => (window as unknown as { wholeReads: string[] }).wholeReads)
			).toEqual(['ntf_aaaaaaaaaaaaaaaa']);
			// A changed preview is a new confirmation with a new id (7.2): cut again, and Confirm withheld until it is read.
			await page.evaluate(() => {
				const held = window as unknown as { rows: Array<{ id: string; createdAt: number }> };
				held.rows = [
					{ ...structuredClone(held.rows[0]), id: 'ntf_bbbbbbbbbbbbbbbb', createdAt: Date.now() },
				] as never;
			});
			await kernelCall(page, 'notification-push', { title: 'Nudge' });
			const next = inbox(page).locator('.notice[data-id="ntf_bbbbbbbbbbbbbbbb"]');
			await expect
				.poll(() =>
					next.getByRole('button', { name: 'Show the full preview of Send the reply set' }).count()
				)
				.toBe(1);
			expect(await next.getByRole('button', { name: 'Confirm Send the reply set' }).count()).toBe(
				0
			);
			expect(errors).toEqual([]);
		} finally {
			await page.context().close();
		}
	});

	it("second round's 3: a person's first call during stage B asks in the slot, and is answered through the shell", async () => {
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		// Stage B held: the call below is queued behind it, and waits on the person once it runs.
		await context.route('**/assets/late-*', async (route) => {
			await held;
			await route.continue();
		});
		const { page, errors } = await openPage(browser, site.origin, {}, context);
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await page.waitForFunction(
			() => performance.getEntriesByName('first-contentful-paint').length > 0
		);
		await start(page, 'tally-reset', {}, 'person');
		release();
		// The chrome's own stage B reads (the persona, the rail) must not wait behind the call that waits on the person.
		await expect.poll(() => slot(page).count(), { timeout: 15_000 }).toBe(1);
		await slot(page).locator('button', { hasText: 'Confirm' }).click();
		await expect.poll(async () => (await settled(page))?.success, { timeout: 15_000 }).toBe(true);
		expect(errors).toEqual([]);
		await context.close();
	});

	it('P4-E13: P4-E8: passes axe in three themes with a confirmation in the slot and one in the inbox', async () => {
		const { page } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await agentCall(page, 'tally-reset', {});
		await kernelCall(page, 'section-open', { section: 'inbox' });
		await expect.poll(() => inbox(page).locator('.notice').count()).toBe(1);
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			await setTheme(page, theme);
			await expect.poll(() => inbox(page).locator('.notice').count(), { message: theme }).toBe(1);
			expect(await axe(page), theme).toEqual([]);
		}
		await start(page, 'tally-reset', {}, 'person');
		await expect.poll(() => slot(page).count()).toBe(1);
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			await setTheme(page, theme);
			await expect.poll(() => slot(page).count(), { message: theme }).toBe(1);
			expect(await axe(page), theme).toEqual([]);
		}
		await page.context().close();
	});
});
