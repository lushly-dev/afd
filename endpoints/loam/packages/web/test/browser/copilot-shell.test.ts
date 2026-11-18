/**
 * Phase 5's step 2 in the browser (phase 5 specification, 3.2, 4.1 and step 1's seams, #1507): the built shell, served
 * as a deployer serves it, with a version 4 deployment whose `[copilot]` names the test provider and no view app. The
 * shell turns its panel on from the projection, `deployment write` names the sandbox origin in `frame-src` for the
 * copilot alone, and a turn runs through the production wiring: the lazy chunk, the frame on the sandbox origin, the
 * page's transport and the kernel's halves. And the panel beside an app's own panel passes axe in each theme, which in
 * step 1 failed `scrollable-region-focusable`.
 */

import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	axe,
	type DeploymentSite,
	deploymentEntry,
	kernelCall,
	openApp,
	openShell,
	packApp,
	serveDeployment,
	surfacesIdle,
} from './harness';

let browser: Browser;
let site: DeploymentSite;

const COPILOT = [
	'[copilot]',
	'default = "scripted"',
	'',
	'[[copilot.providers]]',
	'id = "scripted"',
	'kind = "test"',
	'model = "script"',
].join('\n');

beforeAll(async () => {
	site = await serveDeployment({
		config: [
			'deployment_version = 4',
			'',
			deploymentEntry('tally', await packApp('tally')),
			'',
			deploymentEntry('hello', await packApp('hello')),
			'',
			COPILOT,
		].join('\n'),
		sandbox: true,
	});
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
});

/** The copilot's panel in the shell's panel part, once it has loaded. */
async function openPanel(page: Page): Promise<void> {
	await agentCall(page, 'layout-set', { panel: { open: true } });
	await page.waitForFunction(() =>
		Boolean(
			document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-panel loam-copilot-panel')
		)
	);
	await surfacesIdle(page);
}

describe('the copilot named by the deployment (step 2)', () => {
	it('projects the provider, frames the sandbox origin with no view app, and lists the provider', async () => {
		expect(site.projection.copilot).toEqual({
			default: 'scripted',
			providers: [{ id: 'scripted', kind: 'test', model: 'script' }],
		});
		const opened = await openShell(browser, site.origin);
		const policy = await opened.page.evaluate(
			() =>
				document
					.querySelector('meta[http-equiv="Content-Security-Policy"]')
					?.getAttribute('content') ?? ''
		);
		expect(policy).toContain(`frame-src ${site.sandbox?.origin};`);
		const listed = await kernelCall(opened.page, 'copilot-provider-list', {});
		expect(listed).toMatchObject({
			success: true,
			data: { providers: [{ id: 'scripted', kind: 'test', model: 'script', default: true }] },
		});
		// Nothing of the copilot loads before a turn: no frame yet.
		expect(await opened.page.locator('iframe[data-loam-copilot]').count()).toBe(0);
		await opened.context.close();
	});

	it('runs a turn through the production wiring: the frame on the sandbox origin and the page’s test provider', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openPanel(page);
		const composer = page.locator('loam-copilot-panel violet-chat-composer textarea');
		await composer.fill('Hello');
		await composer.press('Enter');
		await page.waitForFunction(() =>
			(
				document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-copilot-panel')
					?.shadowRoot?.textContent ?? ''
			).includes('No script')
		);
		const frame = page.locator('iframe[data-loam-copilot]');
		expect(await frame.getAttribute('sandbox')).toBe('allow-scripts');
		expect(await frame.getAttribute('src')).toBe(
			`${site.sandbox?.origin}/sandbox/copilot/index.html`
		);
		const sessions = (await kernelCall(page, 'copilot-session-list', {})) as {
			data: { sessions: Array<{ id: string; provider: string }> };
		};
		expect(sessions.data.sessions[0]?.provider).toBe('scripted');
		const got = (await kernelCall(page, 'copilot-session-get', {
			session: sessions.data.sessions[0]?.id,
		})) as { data: { turns: Array<{ state: string; reply: string }> } };
		expect(got.data.turns[0]).toMatchObject({ state: 'done', reply: 'No script' });
		expect(opened.violations).toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('passes axe with the copilot beside tally’s own panel, in each theme (#1507)', async () => {
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			const opened = await openShell(browser, site.origin, {
				viewport: { width: 1600, height: 900 },
				reducedMotion: 'reduce',
			});
			const { page } = opened;
			await agentCall(page, 'appearance-set', { theme });
			await openApp(page, 'tally');
			await page.locator('tally-history').waitFor();
			await openPanel(page);
			expect(await axe(page), theme).toEqual([]);
			await opened.context.close();
		}
	});

	it('keeps the panel part reachable by keyboard when it scrolls with nothing focusable in it (#1507)', async () => {
		// Step 1's failure, made on purpose: a short window, tally's panel, and the copilot's composer disabled, so the
		// part's scroller overflows and holds no focusable element of its own.
		const opened = await openShell(browser, site.origin, {
			viewport: { width: 1600, height: 560 },
			reducedMotion: 'reduce',
		});
		const { page } = opened;
		await openApp(page, 'tally');
		await page.locator('tally-history').waitFor();
		await agentCall(page, 'layout-set', { panel: { open: true, height: 120 } });
		await openPanel(page);
		await page.evaluate(() => {
			const panel = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-copilot-panel') as unknown as { unavailable: boolean };
			panel.unavailable = true;
		});
		await surfacesIdle(page);
		const body = await page.evaluate(() => {
			const element = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-panel')
				?.shadowRoot?.querySelector('.body') as HTMLElement;
			return {
				scrolls: element.scrollHeight > element.clientHeight + 1,
				tabindex: element.getAttribute('tabindex'),
			};
		});
		expect(body).toEqual({ scrolls: true, tabindex: '0' });
		expect(await axe(page)).toEqual([]);
		await opened.context.close();
	});

	it('leaves the copilot’s panel in the part when apps switch: it is the shell’s, not the app’s', async () => {
		const opened = await openShell(browser, site.origin, {
			viewport: { width: 1600, height: 900 },
		});
		const { page } = opened;
		await openApp(page, 'tally');
		await page.locator('tally-history').waitFor();
		await openPanel(page);
		const inPart = () =>
			page.evaluate(
				() =>
					document
						.querySelector('loam-shell')
						?.shadowRoot?.querySelectorAll('loam-panel > loam-copilot-panel').length ?? 0
			);
		expect(await inPart()).toBe(1);
		await openApp(page, 'hello');
		expect(await inPart()).toBe(1);
		await openApp(page, 'tally');
		await page.locator('tally-history').waitFor();
		expect(await inPart()).toBe(1);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});
});
