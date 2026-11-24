/**
 * P5-A8's cards in Chromium (phase 5 specification, 3.2, 6.1, 6.2): the panel's approval and suggestion cards, drawn
 * from `copilot-session-get`'s records alone, every value as text; Confirm, Decline and "Run it" answering only a
 * person's own press, on the panel's kernel (the palette interface, the person's); and axe in light, dark and high
 * contrast. The built shell defines the panel; a second one, over a kernel that records every call and answers the
 * session's records, is put beside it, since the page's test provider has no script that asks. The kernel's records
 * themselves are P5-A5's (`kernel/src/copilot/enforce.test.ts`); a stop within 250 ms is S3's (`copilot.test.ts`).
 */

import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	axe,
	type DeploymentSite,
	deploymentEntry,
	openShell,
	packApp,
	serveDeployment,
	surfacesIdle,
} from './harness';

let browser: Browser;
let site: DeploymentSite;

beforeAll(async () => {
	site = await serveDeployment({
		config: [
			'deployment_version = 4',
			'',
			deploymentEntry('tally', await packApp('tally')),
			'',
			'[copilot]',
			'default = "scripted"',
			'',
			'[[copilot.providers]]',
			'id = "scripted"',
			'kind = "test"',
			'model = "script"',
		].join('\n'),
		sandbox: true,
	});
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
});

/** The records the fake kernel answers: one waiting confirmation, whose header holds markup, and one suggestion. */
const RECORDS = {
	session: { id: 'cps_00000000000000aa', taint: [] },
	turns: [{ seq: 1, state: 'done' }],
	confirmations: [
		{
			id: 'ntf_aaaaaaaaaaaaaaaa',
			state: 'pending',
			title: 'Create a project',
			header: 'Copilot, for <b>you</b>',
			prompt: 'Your autonomy setting asks before agents run this.',
			command: 'project-create',
			input: { name: '<img src=x onerror=alert(1)>' },
			scope: { workspace: 'personal' },
			danger: false,
			asked: {
				mode: 'ask',
				reason: 'policy',
				sources: [],
				chain: [{ id: 'default', mode: 'ask', as: 'mode' }],
			},
			// A mounted server's preview (7.2), changed since the person looked, its content marked up by a stranger.
			preview: {
				command: 'mail-draft-show',
				digest: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
				changed: true,
				labels: 'per-part',
				data: {
					draft: 'drf_1',
					content: { trust: 'content', body: '<img src=y onerror=alert(2)>' },
				},
			},
			expiresAt: Date.now() + 600_000,
		},
	],
	suggestions: [
		{
			id: 'sug_00000000000000aa',
			command: 'tally-reset',
			input: {},
			scope: { workspace: 'personal' },
			reasons: ['policy'],
			sources: [],
			expiresAt: Date.now() + 600_000,
			ran: false,
		},
	],
};

/** Put a second panel beside the shell's, over a kernel that records what it is called with, and draw its cards. */
async function mountCards(page: Page): Promise<void> {
	await agentCall(page, 'layout-set', { panel: { open: true } });
	await page.waitForFunction(() => Boolean(customElements.get('loam-copilot-panel')));
	// The shell's own panel goes again, so the one under test is the page's only "Copilot" landmark.
	await agentCall(page, 'layout-set', { panel: { open: false } });
	await page.evaluate(async (records) => {
		const calls: Array<{ name: string; input: unknown }> = [];
		(window as unknown as { cardCalls: typeof calls }).cardCalls = calls;
		const kernel = {
			async call(name: string, input?: unknown) {
				calls.push({ name, input });
				if (name === 'copilot-session-start')
					return { success: true, data: { session: { id: records.session.id } } };
				if (name === 'copilot-session-get') return { success: true, data: records };
				if (name === 'copilot-provider-list')
					return { success: true, data: { providers: [{ id: 'scripted' }] } };
				if (name === 'copilot-message-send') return { success: true, data: { turn: { seq: 1 } } };
				return { success: true, data: {} };
			},
		};
		const holder = document.createElement('div');
		holder.id = 'cards-test';
		holder.setAttribute('role', 'complementary');
		holder.setAttribute('aria-label', 'Cards under test');
		holder.style.cssText =
			'position:fixed;inset-inline-end:0;inset-block-start:0;inline-size:360px;block-size:600px;background:var(--violet-color-surface-page)';
		const panel = document.createElement('loam-copilot-panel') as HTMLElement & {
			kernel: unknown;
			submit(text: string): Promise<void>;
			refresh(): Promise<void>;
		};
		panel.kernel = kernel;
		holder.append(panel);
		document.body.append(holder);
		// The first message starts the session; with no host, no run streams, so the cards are read at once.
		void panel.submit('Hello');
		await new Promise((resolve) => setTimeout(resolve, 50));
		await panel.refresh();
	}, RECORDS);
	await surfacesIdle(page);
}

const cards = (page: Page) => page.locator('#cards-test loam-copilot-panel .cards');
const calls = (page: Page) =>
	page.evaluate(() =>
		(window as unknown as { cardCalls: Array<{ name: string; input: unknown }> }).cardCalls.filter(
			(call) => call.name === 'notification-act' || call.name === 'palette-run'
		)
	);

describe('P5-A8: the panel’s cards, from the kernel’s records (6.2)', () => {
	it('draws a confirmation and a suggestion as text, answering only a person’s own press', async () => {
		const opened = await openShell(browser, site.origin, {
			viewport: { width: 1600, height: 900 },
		});
		const { page } = opened;
		await mountCards(page);
		const region = cards(page);
		await region.locator('violet-approval-card').waitFor();
		// Every value is text: the header's markup and the input's are shown, never parsed.
		expect(await region.locator('.card-header').textContent()).toBe('Copilot, for <b>you</b>');
		expect(await region.locator('violet-approval-card .card-input').textContent()).toBe(
			'name: "<img src=x onerror=alert(1)>"'
		);
		// The preview as text (7.2): what changed first, the server's facts, and its content marked as others'.
		expect(await region.locator('violet-approval-card .card-preview').allTextContents()).toEqual([
			'Changed since you looked.',
			'What mail-draft-show shows it will do:',
			'draft: drf_1',
			'(written by others) content.body: <img src=y onerror=alert(2)>',
		]);
		expect(await region.locator('img').count()).toBe(0);
		expect(await region.locator('.card-why').first().textContent()).toContain('the default');
		expect(await region.locator('.suggestion .card-title').textContent()).toBe(
			'Suggested: tally-reset'
		);
		// A script's click answers nothing.
		await page.evaluate(() => {
			const region = document
				.querySelector('#cards-test loam-copilot-panel')
				?.shadowRoot?.querySelector('.cards');
			for (const button of region?.querySelectorAll('violet-button') ?? [])
				(button as HTMLElement).click();
		});
		expect(await calls(page)).toEqual([]);
		// A person's press does, on the panel's kernel.
		await region.getByText('Confirm Create a project').click();
		await region.getByText('Run it').click();
		await page.waitForFunction(
			() => (window as unknown as { cardCalls: unknown[] }).cardCalls.length > 0
		);
		expect(await calls(page)).toEqual([
			{
				name: 'notification-act',
				input: { notification: 'ntf_aaaaaaaaaaaaaaaa', answer: 'confirm' },
			},
			{
				name: 'palette-run',
				input: { command: 'tally-reset', suggestion: 'sug_00000000000000aa' },
			},
		]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('passes axe with the cards drawn, in light, dark and high contrast', async () => {
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			const opened = await openShell(browser, site.origin, {
				viewport: { width: 1600, height: 900 },
				reducedMotion: 'reduce',
			});
			const { page } = opened;
			await agentCall(page, 'appearance-set', { theme });
			await mountCards(page);
			await cards(page).locator('violet-approval-card').waitFor();
			expect(await axe(page), theme).toEqual([]);
			await opened.context.close();
		}
	});
});
