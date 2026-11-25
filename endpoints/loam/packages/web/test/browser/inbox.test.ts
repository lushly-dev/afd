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
	journal,
	kernelCall,
	openApp,
	openShell,
	packApp,
	serveDeployment,
	serveDist,
	setTheme,
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
	it('P4-E13: P4-E6: lands a sticky toast, counts it on the Inbox button, and opens the inbox at it', async () => {
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
		// 6.2's reason: the person's Open inbox closes the toast as `inbox`, journaled as the shell's dismissal.
		const dismissals = (await journal(page)).filter(
			(entry) =>
				entry.command === 'overlay-dismiss' &&
				(entry.input as { overlayId?: string }).overlayId === shown.data?.overlayId
		);
		expect(
			dismissals.map((entry) => [(entry.input as { reason?: string }).reason, entry.success])
		).toEqual([['inbox', true]]);
		// Wait for the inbox to render the target notice and for the leaving app's teardown to settle (#2301).
		await inbox(page).locator('.notice[data-target]').waitFor();
		await settle(page);
		// Focus is on the notice it opened at, which names itself unread.
		await expect.poll(async () => (await focused(page)).label).toBe('Ada signed the book, unread');
		await expect
			.poll(() => inbox(page).locator('.notice').first().locator('.meta').textContent())
			.toMatch(/^Unread · From Hello/);
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it('P4-E13: P4-E6: keeps focus on the target notice when the leaving app tears down after the inbox renders (#2301)', async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await helloCall(page, 'toast-show', { message: 'Ada signed the book', sticky: true });
		await expect.poll(() => inboxButton(page).getAttribute('aria-label')).toBe('Inbox 1 unread');
		// Hold the rail refresh that drives AppSurfaces.#sync so the inbox renders and focuses the
		// target notice before AppSurfaces.#leave removes Hello's surfaces.
		await page.evaluate(() => {
			const shell = document.querySelector('loam-shell') as unknown as {
				rail: { fresh(): Promise<unknown> };
			};
			const orig = shell.rail.fresh.bind(shell.rail);
			let release!: () => void;
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			(window as unknown as { __releaseLeave?: () => void }).__releaseLeave = release;
			shell.rail.fresh = async () => {
				await gate;
				shell.rail.fresh = orig;
				return orig();
			};
		});
		const toast = page.locator('loam-toast[message="Ada signed the book"]');
		await toast.locator('button.inbox').click();
		await inbox(page).locator('.notice[data-target]').waitFor();
		await expect.poll(async () => (await focused(page)).label).toBe('Ada signed the book, unread');
		// Now let AppSurfaces.#leave run while focus is already on the inbox notice.
		await page.evaluate(() =>
			(window as unknown as { __releaseLeave?: () => void }).__releaseLeave?.()
		);
		await expect.poll(() => page.locator('hello-main').count()).toBe(0);
		await settle(page);
		expect((await focused(page)).label).toBe('Ada signed the book, unread');
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it("P4-E13: P4-E6: runs a notice's action as the person from the inbox, opened from the palette, and ends it done", async () => {
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

	it("P4-E13: P4-E6: announces a new notice with the keyboard path to it, but never a muted app's", async () => {
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

	it('P4-E13: P4-E6: passes axe in three themes with notices of every kind shown', async () => {
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
			await setTheme(page, theme);
			await expect.poll(() => inbox(page).locator('.notice').count(), { message: theme }).toBe(3);
			expect(await axe(page), theme).toEqual([]);
		}
		await page.context().close();
	});
});

describe("P4-E13: the inbox's keyboard path from an announcement (15)", () => {
	it("P4-E13: P4-E6: Tab, pressed from the title bar's name, reaches the bell in a few presses, and it opens the inbox", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await helloCall(page, 'notification-push', { title: 'Bea left a note' });
		await expect.poll(() => announced(page)).toContain('Open it from Inbox in the title bar');
		// From a known point, the title bar's name, by real Tab presses alone, never a script's focus(): a press on text
		// sets where sequential focus starts, so the path is the title bar's own controls before the bell.
		// Off the rail, where `openApp`'s click left the pointer, so no rail tooltip is open.
		await page.mouse.move(700, 500);
		await page.locator('loam-titlebar .name').click();
		const path: string[] = [];
		for (let press = 0; press < 6; press++) {
			await page.keyboard.press('Tab');
			const now = await focused(page);
			path.push(now.label);
			if (now.hosts.includes('loam-titlebar') && now.label.startsWith('Inbox')) break;
		}
		// Short: New and Search, then the bell.
		expect(path.length, path.join(' > ')).toBeLessThanOrEqual(3);
		const bell = await focused(page);
		expect(bell.hosts, path.join(' > ')).toContain('loam-titlebar');
		expect(bell.label).toBe('Inbox 1 unread');
		await page.keyboard.press('Enter');
		await expect.poll(() => inbox(page).count()).toBe(1);
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it('P4-E13: P4-E6: Mod+K and "Open inbox" lists a row labelled "Open inbox", which opens the inbox', async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await helloCall(page, 'notification-push', { title: 'Bea left a note' });
		await expect.poll(() => announced(page)).toContain('or from the palette');
		await page.keyboard.press('ControlOrMeta+K');
		// The palette's input has focus before a key is typed into it.
		await expect.poll(async () => (await focused(page)).tag).toBe('input');
		expect((await focused(page)).hosts).toContain('loam-palette');
		await page.keyboard.type('Open inbox');
		expect(await page.locator('loam-palette input').inputValue()).toBe('Open inbox');
		const row = page.locator('loam-palette violet-option').first();
		await expect.poll(() => row.getAttribute('data-command')).toBe('inbox:open');
		expect((await row.locator('.result-name').textContent())?.trim()).toBe('Open inbox');
		await page.keyboard.press('Enter');
		await expect.poll(() => inbox(page).count()).toBe(1);
		expect(errors).toEqual([]);
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

	/** Mute hello, show its timed toast, and watch whether it settles, as the app would through its port. */
	async function mutedRunning(page: Page, durationMs: number): Promise<() => Promise<unknown>> {
		await kernelCall(page, 'setting-set', {
			section: 'loam.notifications',
			key: 'muted',
			value: ['hello'],
			level: 'person',
		});
		const shown = await helloCall(page, 'toast-show', { message: 'Quiet', durationMs });
		await page.evaluate((overlayId) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { appPort(instance: string): { waitOverlay(id: string): Promise<unknown> } };
			};
			const box = window as unknown as { settledRunning?: unknown };
			void shell.kernel
				.appPort('hello')
				.waitOverlay(overlayId)
				.then((result) => {
					box.settledRunning = result;
				});
		}, shown.data?.overlayId as string);
		return () =>
			page.evaluate(
				() => (window as unknown as { settledRunning?: unknown }).settledRunning ?? null
			);
	}

	it("holds a muted toast whose timer already runs when the palette opens (the verification's 1)", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		const settled = await mutedRunning(page, 2000);
		await page.waitForTimeout(300);
		await page.keyboard.press('ControlOrMeta+K');
		await page.locator('loam-palette input').waitFor();
		await page.waitForTimeout(3000);
		expect(await settled()).toBeNull();
		await page.keyboard.press('Escape');
		await expect
			.poll(settled, { timeout: 8000 })
			.toMatchObject({ result: 'dismissed', reason: 'timeout' });
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it("holds a muted toast whose timer already runs when the app's own modal opens", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		const settled = await mutedRunning(page, 2000);
		await page.waitForTimeout(300);
		const modal = await helloCall(page, 'modal-open', { title: 'Sure?', body: 'Say so.' });
		await page.waitForTimeout(3000);
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

describe("hello's own sticky toast and notice with an action (#2106)", () => {
	it('shows the inbox path from Hello: sticky toast lands and opens inbox; notice action greets into guest book', async () => {
		const { page, errors, violations } = await openShell(browser, site.origin);
		await openApp(page, 'hello');

		// 1. Hello's own sticky toast button opens a sticky toast that lands in the inbox and opens at it.
		await page.locator('hello-main violet-button.sticky-toast').click();
		const toast = page.locator('loam-toast[message="Hello from a sticky toast"]');
		await toast.waitFor();
		await expect.poll(() => inboxButton(page).getAttribute('aria-label')).toBe('Inbox 1 unread');
		await toast.locator('button.inbox').click();
		await expect.poll(() => inbox(page).count()).toBe(1);
		await expect
			.poll(() => inbox(page).locator('.notice').first().locator('.meta').textContent())
			.toMatch(/^Unread · From Hello/);

		// 2. Return to Hello, type a visitor name, and send Hello's notice with an action.
		await openApp(page, 'hello');
		await page.locator('hello-main violet-text-field input').fill('Ada');
		await page.locator('hello-main violet-button.notice').click();
		await expect
			.poll(() => page.locator('hello-main .answer').textContent())
			.toBe('Notice sent for Ada');
		await expect.poll(() => inboxButton(page).getAttribute('aria-label')).toBe('Inbox 2 unread');

		// Open the inbox and run the notice's action; Ada joins Hello's guest book.
		await inboxButton(page).click();
		const view = inbox(page);
		await expect.poll(() => view.count()).toBe(1);
		const helloNotice = view.locator('.notice', { hasText: 'Ada is waiting at the guest book' });
		await helloNotice.locator('button', { hasText: 'Greet Ada' }).click();
		await expect.poll(() => view.locator('.status').textContent()).toBe('Greet Ada: done');
		await expect.poll(() => helloNotice.locator('.meta').textContent()).toContain('Done');
		const guests = (await kernelCall(page, 'hello-guests')) as Result;
		expect(guests.data?.guests).toEqual([expect.objectContaining({ name: 'Ada', greeted: true })]);

		expect(errors).toEqual([]);
		expect(violations).toEqual([]);
		await page.context().close();
	});
});
