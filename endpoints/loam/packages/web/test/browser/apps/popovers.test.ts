/**
 * P4-E7, the parts phase 4's step 3 builds (its 6.1 to 6.7): owner lines, a sticky toast, the toast region's F6
 * stop, and popovers placed beside their anchor, focused, light-dismissed and closed on a switch, with a menu that
 * runs the app's own command as the person.
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
	surfacesIdle,
} from '../harness';

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

type Result = { success: boolean; data?: { overlayId: string }; error?: { code: string } };

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

/**
 * Mark hello's Greet button as an anchor, and focus it, as a person pressing it would. The pointer leaves the rail
 * first: the rail's tooltip, shown while it rests there, takes the first Escape for itself (WCAG 1.4.13).
 */
async function markAnchor(page: Page): Promise<void> {
	await page.mouse.move(700, 500);
	await page.locator('hello-main violet-button.greet').evaluate((button) => {
		button.setAttribute('data-loam-anchor', 'greet');
		(button as HTMLElement).focus();
	});
}

const overlays = async (page: Page) =>
	((await kernelCall(page, 'overlay-list')) as { data: { overlays: Array<{ kind: string }> } }).data
		.overlays;

const info = { anchor: { surface: 'main', anchor: 'greet' }, kind: 'info', body: 'Say hello.' };

describe('P4-E7: toasts (6.1, 6.6, 6.7)', () => {
	it("shows each owner's line, keeps a sticky toast, and is an F6 stop while it holds one", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		// No toast: F6 from the status bar wraps to the title bar, past the empty region.
		await page.locator('loam-statusbar').evaluate((part) => {
			part.setAttribute('tabindex', '-1');
			(part as HTMLElement).focus();
		});
		await page.keyboard.press('F6');
		expect((await focused(page)).part).not.toBe('toasts');

		await kernelCall(page, 'toast-show', { message: 'The shell saved', durationMs: 1000 });
		await helloCall(page, 'toast-show', { message: 'Hello counted', sticky: true });
		await agentCall(page, 'toast-show', { message: 'The agent finished' });
		await expect.poll(() => page.locator('loam-toast').count()).toBe(3);
		const lines = await page
			.locator('loam-toast')
			.evaluateAll((toasts) =>
				toasts.map((toast) => toast.shadowRoot?.querySelector('.from')?.textContent?.trim() ?? '')
			);
		expect(lines[0]).toBe('');
		expect(lines[1]).toMatch(/^From \S/);
		expect(lines[2]).toBe('From shell-agent, for you');
		// The shell's own carries no line, and its element hides the empty one.
		expect(
			await page
				.locator('loam-toast')
				.first()
				.evaluate(
					(toast) => (toast.shadowRoot?.querySelector('.from') as HTMLElement | null)?.hidden
				)
		).toBe(true);

		// The timed one goes; the sticky one stays past it.
		await expect.poll(() => page.locator('loam-toast').count(), { timeout: 8000 }).toBe(2);
		await page.waitForTimeout(1500);
		expect(await page.locator('loam-toast[message="Hello counted"]').count()).toBe(1);

		// F6 reaches the region last, after the status bar.
		await page.locator('loam-statusbar').evaluate((part) => {
			part.setAttribute('tabindex', '-1');
			(part as HTMLElement).focus();
		});
		await page.keyboard.press('F6');
		expect((await focused(page)).part).toBe('toasts');
		await page.keyboard.press('Tab');
		expect((await focused(page)).hosts).toContain('loam-toast');
		expect(errors).toEqual([]);
		await page.context().close();
	});
});

describe('P4-E7: popovers (6.1 to 6.7)', () => {
	it('places an info popover beside its anchor, with the owner line, and light-dismisses it', async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await markAnchor(page);
		const opened = await helloCall(page, 'popover-open', { ...info, title: 'About Greet' });
		expect(opened.success).toBe(true);
		const popover = page.locator('loam-popover');
		await popover.waitFor();
		expect(await popover.evaluate((element) => element.matches(':popover-open'))).toBe(true);
		expect(await popover.getAttribute('role')).toBe('dialog');
		expect(await popover.getAttribute('aria-label')).toMatch(/^About Greet, From \S/);
		expect(await popover.locator('.from').textContent()).toMatch(/^From \S/);
		// Beside the anchor: below or above it, overlapping it along the inline axis.
		const [anchorBox, popoverBox] = await Promise.all([
			page.locator('hello-main violet-button.greet').boundingBox(),
			popover.boundingBox(),
		]);
		if (!anchorBox || !popoverBox) throw new Error('No boxes');
		const below = popoverBox.y >= anchorBox.y + anchorBox.height - 1;
		const above = popoverBox.y + popoverBox.height <= anchorBox.y + 1;
		expect(below || above).toBe(true);
		expect(Math.abs(popoverBox.y - (anchorBox.y + anchorBox.height))).toBeLessThan(40);
		expect(popoverBox.x).toBeLessThan(anchorBox.x + anchorBox.width);
		expect(popoverBox.x + popoverBox.width).toBeGreaterThan(anchorBox.x);
		// Focus moved in; the page has no violations with it open.
		await expect.poll(async () => (await focused(page)).tag).toBe('loam-popover');
		expect(await axe(page)).toEqual([]);

		await page.keyboard.press('Escape');
		await expect.poll(() => page.locator('loam-popover').count()).toBe(0);
		expect(await overlays(page)).toEqual([]);
		// Focus returned to the invoker.
		expect((await focused(page)).hosts).toContain('hello-main');
		const dismissed = (await journal(page)).filter(({ command }) => command === 'overlay-dismiss');
		expect(dismissed.length).toBeGreaterThan(0);

		// A press outside closes it as well.
		await helloCall(page, 'popover-open', info);
		await popover.waitFor();
		await page.mouse.click(5, 300);
		await expect.poll(() => page.locator('loam-popover').count()).toBe(0);
		expect(await overlays(page)).toEqual([]);
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it("runs a menu item, the app's own command, as the person, by keyboard", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await markAnchor(page);
		const refused = await helloCall(page, 'popover-open', {
			anchor: info.anchor,
			kind: 'menu',
			items: [{ command: 'app-open', label: 'Open tally', input: { instance: 'tally' } }],
		});
		expect(refused.error?.code).toBe('OVERLAY_ITEM_RESERVED');
		await helloCall(page, 'popover-open', {
			anchor: info.anchor,
			kind: 'menu',
			label: 'Greet',
			items: [
				{ command: 'hello-greet', label: 'Greet Ada', input: { name: 'Ada' } },
				{ command: 'hello-greet', label: 'Greet Bo', input: { name: 'Bo' } },
			],
		});
		const popover = page.locator('loam-popover');
		await popover.waitFor();
		expect(await popover.getAttribute('role')).toBe('menu');
		await expect.poll(async () => (await focused(page)).role).toBe('menuitem');
		expect((await focused(page)).label).toBe('Greet Ada');
		await page.keyboard.press('ArrowDown');
		expect((await focused(page)).label).toBe('Greet Bo');
		await page.keyboard.press('Enter');
		await expect.poll(() => page.locator('loam-popover').count()).toBe(0);
		await expect
			.poll(
				async () => (await journal(page)).filter(({ command }) => command === 'hello-greet').length
			)
			.toBe(1);
		const entries = await journal(page);
		const picked = entries.filter(({ command }) => command === 'overlay-dismiss').at(-1);
		expect(picked?.input).toMatchObject({ result: 'confirm', item: 1 });
		expect(errors).toEqual([]);
		await page.context().close();
	});

	it('refuses what it cannot anchor, an agent and an inactive app, and closes on a switch', async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		expect((await helloCall(page, 'popover-open', info)).error?.code).toBe(
			'OVERLAY_ANCHOR_NOT_FOUND'
		);
		await markAnchor(page);
		// Hello's anchor is not the shell's.
		const shell = (await kernelCall(page, 'popover-open', {
			...info,
			anchor: { surface: 'shell', anchor: 'greet' },
		})) as Result;
		expect(shell.error?.code).toBe('OVERLAY_ANCHOR_NOT_FOUND');
		const agent = (await agentCall(page, 'popover-open', info)) as Result;
		expect(agent.error?.code).toBe('HUMAN_REQUIRED');

		await helloCall(page, 'popover-open', info);
		await page.locator('loam-popover').waitFor();
		await agentCall(page, 'app-open', { instance: 'tally' });
		await surfacesIdle(page);
		await expect.poll(() => page.locator('loam-popover').count()).toBe(0);
		expect(await overlays(page)).toEqual([]);
		expect((await helloCall(page, 'popover-open', info)).error?.code).toBe(
			'OVERLAY_OWNER_INACTIVE'
		);
		expect(errors).toEqual([]);
		await page.context().close();
	});
});
