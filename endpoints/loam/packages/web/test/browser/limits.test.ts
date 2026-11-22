/**
 * P4-E10 in Chromium (phase 4 specification, section 11, 3.7 and 15): the Limits section in the settings tree, its
 * five keys with what each app uses beside them; hello's call through its port refused over `inputBytes` and over the
 * call rate, each with its details, and counted beside the key; the quarter rule's refusal naming the order; an agent's
 * `limit-usage-get` handed off; and axe in three themes. The units of E10 are the kernel's `late/limits.test.ts`,
 * `limits.test.ts`, `apps/store-quota.test.ts`, `apps/view-broker.test.ts` and `late-settings-failure.test.ts`.
 */

import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	axe,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
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

interface Refusal {
	success: boolean;
	error?: {
		code: string;
		suggestion?: string;
		retryable?: boolean;
		details?: Record<string, unknown>;
	};
}

/** `name` through hello's own port, as hello's code calls it; `times` calls, the last answer kept. */
const helloCalls = (page: Page, name: string, input: unknown, times = 1) =>
	page.evaluate(
		async ([name, input, times]) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: {
					appPort(instance: string): { call(name: string, input: unknown): Promise<unknown> };
				};
			};
			const port = shell.kernel.appPort('hello');
			let last: unknown;
			for (let i = 0; i < (times as number); i++) {
				last = await port.call(name as string, input);
				if (!(last as { success: boolean }).success) break;
			}
			return last;
		},
		[name, input, times] as const
	) as Promise<Refusal>;

const section = (page: Page) => page.locator('loam-main loam-settings-section');

/** A shell with the Limits section open. */
async function openLimits(): Promise<Page> {
	const { page } = await openShell(browser, site.origin);
	await kernelCall(page, 'section-open', { section: 'settings', target: 'loam.limits' });
	await settle(page);
	await expect.poll(() => section(page).locator('#field-callsPerSecond').count()).toBe(1);
	return page;
}

describe('P4-E10: the limits', () => {
	it('shows the Limits section after Notifications, its keys with what each app uses beside them', async () => {
		const page = await openLimits();
		const view = section(page);
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
		expect(new URL(page.url()).pathname).toMatch(/\/~\/settings\/loam\.limits$/);
		for (const [key, value] of [
			['messageBytes', '1048576'],
			['inputBytes', '262144'],
			['callsPerSecond', '50'],
			['storeBytes', '26214400'],
			['journalEntryBytes', '1048576'],
		]) {
			expect(await view.locator(`#field-${key}`).inputValue(), key).toBe(value);
			expect(await view.locator(`#usage-${key}`).textContent(), key).toContain(
				'No app was refused by it in the last hour.'
			);
		}
		expect(await view.locator('#field-inputBytes').getAttribute('aria-describedby')).toContain(
			'usage-inputBytes'
		);
		await page.close();
	});

	it("refuses hello's input over inputBytes and its calls over the rate, each counted beside its key", async () => {
		const page = await openLimits();
		const view = section(page);
		const over = await helloCalls(page, 'hello-greet', { name: 'x'.repeat(262_144) });
		expect(over.error).toMatchObject({ code: 'INPUT_TOO_LARGE', details: { limit: 262_144 } });
		expect(over.error?.suggestion).toContain('loam.limits.inputBytes');

		// The owner lowers the rate through the form; hello's burst then runs out.
		await view.locator('#field-callsPerSecond').fill('5');
		await view.locator('#field-callsPerSecond').press('Tab');
		await expect
			.poll(() => view.locator('.status').textContent())
			.toBe('Calls a second, per app is saved.');
		const limited = await helloCalls(page, 'hello-list', {}, 400);
		expect(limited.error).toMatchObject({
			code: 'RATE_LIMITED',
			retryable: true,
			details: { limit: 5 },
		});
		expect(limited.error?.details?.retryAfterMs).toBeGreaterThan(0);
		expect(limited.error?.suggestion).toContain('loam.limits.callsPerSecond');

		const usage = (await kernelCall(page, 'limit-usage-get', { instance: 'hello' })) as {
			data: { instances: Array<{ instance: string; refusals: Record<string, number> }> };
		};
		expect(usage.data.instances[0]).toMatchObject({
			instance: 'hello',
			refusals: { inputBytes: 1, callsPerSecond: 1, messageBytes: 0 },
		});
		// Shown beside each key once the section is read again.
		await kernelCall(page, 'section-open', { section: 'settings', target: 'loam.documents' });
		await kernelCall(page, 'section-open', { section: 'settings', target: 'loam.limits' });
		await settle(page);
		await expect
			.poll(() => view.locator('#usage-inputBytes').textContent())
			.toBe('Refused in the last hour: Hello once.');
		expect(await view.locator('#usage-callsPerSecond').textContent()).toBe(
			'Refused in the last hour: Hello once.'
		);
		await page.close();
	});

	it('refuses a journalEntryBytes under four inputBytes, naming the order, and hands an agent off', async () => {
		const page = await openLimits();
		const view = section(page);
		await view.locator('#field-journalEntryBytes').fill('524288');
		await view.locator('#field-journalEntryBytes').press('Tab');
		await expect
			.poll(() => view.locator('.status').textContent())
			.toContain(
				'Lower inputBytes before journalEntryBytes; raise journalEntryBytes before inputBytes'
			);
		expect(
			await kernelCall(page, 'setting-get', { section: 'loam.limits', key: 'journalEntryBytes' })
		).toMatchObject({
			data: { value: 1_048_576, from: 'default' },
		});
		const agent = (await agentCall(page, 'limit-usage-get', {})) as Refusal;
		expect(agent.error).toMatchObject({
			code: 'HUMAN_REQUIRED',
			details: { route: '~/settings/loam.limits', section: 'loam.limits', level: 'workspace' },
		});
		await page.close();
	});

	it('P4-E13: P4-E10: passes axe in three themes', async () => {
		const page = await openLimits();
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			await setTheme(page, theme);
			await expect
				.poll(() => section(page).locator('#field-callsPerSecond').count(), { message: theme })
				.toBe(1);
			expect(await axe(page), theme).toEqual([]);
		}
		await page.close();
	});
});
