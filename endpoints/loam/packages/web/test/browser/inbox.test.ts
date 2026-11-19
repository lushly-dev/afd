/**
 * P4-E6 in Chromium (phase 4 specification, 6.1, 6.7, 7.1, 10.3 and 15): a sticky toast lands in the inbox and is
 * counted on the title bar's Inbox button, whose name says the count; its "Open inbox" opens the inbox at it; the
 * palette's "Open inbox" row; a notice's action run from the inbox as the person, ending done; an agent's notice with
 * its link and no action; a new notice announced with the keyboard path to it, and a muted app's never; and the
 * inbox under axe in three themes. The units of E6 (source on each path, the rates, the quota, R10, the list's page
 * and `body`, the scope filter) are the kernel's `late/notifications.test.ts`.
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
	serveDist,
	settle,
} from './harness';

let browser: Browser;
let site: DeploymentSite;
/** A deployment with no app at all: the Inbox button's count still runs (the reviews' item 8). */
let empty: { origin: string; close(): Promise<void> };
beforeAll(async () => {
	site = await serveDeployment({
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello'), { order: 10 }),
			deploymentEntry('tally', await packApp('tally'), { order: 20 })
		),
	});
	empty = await serveDist();
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
	await empty?.close();
});

type Result = { success: boolean; data?: Record<string, unknown>; error?: { code: string } };

/** A call through hello's own port, as its surfaces make one. */
const helloCall = (page: Page, name: string, input: unknown) =>
	page.evaluate(
		({ name, input }) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: {
					appPort(instance: string): { call(name: string, input: unknown): Promise<unknown> };
				};
			};
			return shell.kernel.appPort('hello').call(name, input);
		},
		{ name, input }
	) as Promise<Result>;

const inboxButton = (page: Page) => page.locator('loam-titlebar button.inbox');
const inbox = (page: Page) => page.locator('loam-main loam-inbox');
/** What the shell's own live region last said. */
const announced = (page: Page) =>
	page
		.locator('loam-shell')
		.evaluate(
			(shell) => shell.shadowRoot?.querySelector('.announce[role="status"]')?.textContent ?? ''
		);

describe('P4-E6: the inbox', () => {
	it('lands a sticky toast, counts it on the Inbox button, and opens the inbox at it', async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await expect.poll(() => inboxButton(page).getAttribute('aria-label')).toBe('Inbox');
		const shown = await helloCall(page, 'toast-show', {
			message: 'Ada signed the book',
			sticky: true,
		});
		expect(shown.data?.notification).toMatch(/^ntf_/);
		await expect.poll(() => inboxButton(page).getAttribute('aria-label')).toBe('Inbox 1 unread');
		expect((await inboxButton(page).textContent())?.replace(/\s+/g, ' ').trim()).toBe('Inbox 1');
		const toast = page.locator('loam-toast[message="Ada signed the book"]');
		await toast.locator('button.inbox').click();
		await expect.poll(() => inbox(page).count()).toBe(1);
		await expect.poll(() => new URL(page.url()).pathname).toMatch(/\/~\/inbox\/ntf_[a-z0-9]{16}$/);
		await expect.poll(() => toast.count()).toBe(0);
		// Focus is on the notice it opened at, which names itself unread.
		await expect.poll(async () => (await focused(page)).label).toBe('Ada signed the book, unread');
		await expect
			.poll(() => inbox(page).locator('.notice').first().locator('.meta').textContent())
			.toMatch(/^Unread · From Hello/);
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it("runs a notice's action as the person from the inbox, opened from the palette, and ends it done", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		const pushed = await helloCall(page, 'notification-push', {
			title: 'Ada is waiting at the guest book',
			action: { command: 'hello-greet', label: 'Greet Ada', input: { name: 'Ada' } },
		});
		expect(pushed.success).toBe(true);
		const link = { kind: 'app', instance: 'hello', scope: { workspace: 'personal' } };
		const left = (await agentCall(page, 'notification-push', {
			title: 'I filed the guest book summary',
			link,
		})) as Result;
		expect(left.success).toBe(true);
		await expect.poll(() => inboxButton(page).getAttribute('aria-label')).toBe('Inbox 2 unread');

		// The palette's row: "Open inbox" (7.1, 10.3).
		await page.keyboard.press('ControlOrMeta+K');
		await page.locator('loam-palette input').fill('inbox');
		await expect
			.poll(() => page.locator('loam-palette violet-option').first().getAttribute('data-command'))
			.toBe('inbox:open');
		await page.keyboard.press('Enter');
		await expect.poll(() => inbox(page).count()).toBe(1);

		const view = inbox(page);
		await expect.poll(() => view.locator('.notice').count()).toBe(2);
		const agents = view.locator('.notice', { hasText: 'I filed the guest book summary' });
		expect(await agents.locator('.meta').textContent()).toContain('From shell-agent, for you');
		// The agent's notice has its link and no action.
		await expect.poll(() => agents.locator('a').getAttribute('href')).toMatch(/\/hello$/);
		expect(await agents.locator('button.primary').count()).toBe(0);

		const helloNotice = view.locator('.notice', { hasText: 'Ada is waiting' });
		await helloNotice.locator('button', { hasText: 'Greet Ada' }).click();
		await expect.poll(() => view.locator('.status').textContent()).toBe('Greet Ada: done');
		await expect.poll(() => helloNotice.locator('.meta').textContent()).toContain('Done');
		expect(await helloNotice.locator('button', { hasText: 'Greet Ada' }).count()).toBe(0);
		const guests = (await kernelCall(page, 'hello-guests')) as Result;
		expect(guests.data?.guests).toEqual([expect.objectContaining({ name: 'Ada', greeted: true })]);
		await expect.poll(() => inboxButton(page).getAttribute('aria-label')).toBe('Inbox 1 unread');

		// Mark all read, then archive: the inbox empties, and the button says so.
		await view.locator('button', { hasText: 'Mark all read' }).click();
		await expect.poll(() => inboxButton(page).getAttribute('aria-label')).toBe('Inbox');
		await view.locator('button', { hasText: 'Archive all' }).click();
		await expect.poll(() => view.locator('.notice').count()).toBe(0);
		expect(await view.locator('.empty').textContent()).toContain('No notices');
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it("announces a new notice with the keyboard path to it, but never a muted app's", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await helloCall(page, 'notification-push', { title: 'Bea left a note' });
		await expect
			.poll(() => announced(page))
			.toBe(
				'New notice from Hello: Bea left a note. Open it from Inbox in the title bar, or from the palette.'
			);
		await kernelCall(page, 'setting-set', {
			section: 'loam.notifications',
			key: 'muted',
			value: ['hello'],
			level: 'person',
		});
		await helloCall(page, 'notification-push', { title: 'Quiet one' });
		// Counted, never announced (3.7).
		await expect.poll(() => inboxButton(page).getAttribute('aria-label')).toBe('Inbox 2 unread');
		await settle(page);
		expect(await announced(page)).not.toContain('Quiet one');
		// The keyboard path: Tab reaches the Inbox button in the title bar, whose press opens the inbox.
		await inboxButton(page).focus();
		expect((await focused(page)).label).toBe('Inbox 2 unread');
		await page.keyboard.press('Enter');
		await expect.poll(() => inbox(page).count()).toBe(1);
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it('passes axe in three themes with notices of every kind shown', async () => {
		const { page } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await helloCall(page, 'notification-push', {
			title: 'Ada is waiting at the guest book',
			body: 'She arrived a minute ago.',
			action: { command: 'hello-greet', label: 'Greet Ada', input: { name: 'Ada' } },
		});
		await agentCall(page, 'notification-push', {
			title: 'A summary',
			link: { kind: 'app', instance: 'hello', scope: { workspace: 'personal' } },
		});
		await kernelCall(page, 'notification-push', { title: 'A reminder', tone: 'warning' });
		await kernelCall(page, 'notification-read', { all: true, source: 'shell' });
		await kernelCall(page, 'section-open', { section: 'inbox' });
		await expect.poll(() => inbox(page).locator('.notice').count()).toBe(3);
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			await kernelCall(page, 'appearance-set', { theme });
			await settle(page);
			expect(await axe(page), theme).toEqual([]);
		}
		await page.context().close();
	});
});

describe('P4-E6: the inbox, after the reviews', () => {
	it('counts on the Inbox button in a deployment with no apps', async () => {
		const { page, errors } = await openShell(browser, empty.origin);
		await kernelCall(page, 'notification-push', { title: 'A reminder' });
		await expect.poll(() => inboxButton(page).getAttribute('aria-label')).toBe('Inbox 1 unread');
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it("clears the count and the inbox on a change of person, and shows only the next person's", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await kernelCall(page, 'notification-push', { title: 'Signed out, mine' });
		await kernelCall(page, 'section-open', { section: 'inbox' });
		await expect.poll(() => inbox(page).locator('.notice').count()).toBe(1);
		await expect.poll(() => inboxButton(page).getAttribute('aria-label')).toBe('Inbox 1 unread');
		await page.locator('loam-titlebar').locator('button.account').click();
		await expect.poll(() => inboxButton(page).getAttribute('aria-label')).toBe('Inbox');
		await expect.poll(() => inbox(page).locator('.notice').count()).toBe(0);
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it("runs a muted app's toast unseen, and times it out as a shown one", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await kernelCall(page, 'setting-set', {
			section: 'loam.notifications',
			key: 'muted',
			value: ['hello'],
			level: 'person',
		});
		const shown = await helloCall(page, 'toast-show', { message: 'Quiet', durationMs: 1000 });
		expect(shown.success).toBe(true);
		const id = shown.data?.overlayId as string;
		await settle(page);
		expect(await page.locator('loam-toast[message="Quiet"]').count()).toBe(0);
		const result = await page.evaluate((overlayId) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { appPort(instance: string): { waitOverlay(id: string): Promise<unknown> } };
			};
			return shell.kernel.appPort('hello').waitOverlay(overlayId);
		}, id);
		expect(result).toMatchObject({ result: 'dismissed', reason: 'timeout' });
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it("holds a muted app's timed toast under its own modal, as a shown one is held (the re-check's B1)", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await kernelCall(page, 'setting-set', {
			section: 'loam.notifications',
			key: 'muted',
			value: ['hello'],
			level: 'person',
		});
		const modal = await helloCall(page, 'modal-open', { title: 'Sure?', body: 'Say so.' });
		expect(modal.success).toBe(true);
		const shown = await helloCall(page, 'toast-show', { message: 'Quiet', durationMs: 1000 });
		const id = shown.data?.overlayId as string;
		// What the app reads: whether its toast has settled, polled through its own port.
		await page.evaluate((overlayId) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { appPort(instance: string): { waitOverlay(id: string): Promise<unknown> } };
			};
			const box = window as unknown as { settledQuiet?: unknown };
			void shell.kernel
				.appPort('hello')
				.waitOverlay(overlayId)
				.then((result) => {
					box.settledQuiet = result;
				});
		}, id);
		const settled = () =>
			page.evaluate(() => (window as unknown as { settledQuiet?: unknown }).settledQuiet ?? null);
		await page.waitForTimeout(2500);
		expect(await settled()).toBeNull();
		await kernelCall(page, 'overlay-dismiss', {
			overlayId: modal.data?.overlayId,
			result: 'cancel',
		});
		await expect
			.poll(settled, { timeout: 8000 })
			.toMatchObject({ result: 'dismissed', reason: 'timeout' });
		expect(errors).toEqual([]);
		await page.context().close();
	});
});
