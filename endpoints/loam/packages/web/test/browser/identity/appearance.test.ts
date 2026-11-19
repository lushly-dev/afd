/**
 * P4-E3's `provider` half in Chromium (phase 4 specification, 3.6; R4, A-P3-2), through the test-only auth host: a
 * person's appearance is their own; signed out, the page paints `loam.appearance.last`, the last signed-in person's;
 * the next person signs in to their own; and a reload signed out paints `.last` from the first frame.
 */

import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	type DeploymentSite,
	kernelCall,
	launchForDevHost,
	openShell,
	providerDeployment,
	type ShellPage,
	serveDeployment,
	settle,
} from '../harness';

const PASSWORD = 'correct horse battery staple';

let browser: Browser;
let site: DeploymentSite;
const opened: ShellPage[] = [];

beforeAll(async () => {
	site = await serveDeployment({
		config: providerDeployment(['password']),
		authHost: {
			organization: { slug: 'acme', name: 'Acme' },
			methods: ['password'],
			people: [
				{ email: 'ada@example.com', name: 'Ada', role: 'member', password: PASSWORD },
				{ email: 'olu@example.com', name: 'Olu', role: 'owner', password: PASSWORD },
			],
		},
	});
	browser = await launchForDevHost({ spki: site.spki as string });
});
afterAll(async () => {
	await Promise.all(opened.splice(0).map((page) => page.context.close()));
	await browser?.close();
	await site?.close();
});

const theme = (page: Page) =>
	page.evaluate(() => ({
		theme: document.documentElement.dataset.loamTheme,
		density: document.documentElement.dataset.loamDensity ?? 'comfortable',
	}));

async function signIn(page: Page, email: string): Promise<void> {
	const answer = (await kernelCall(page, 'auth-sign-in', {
		method: 'credentials',
		email,
		password: PASSWORD,
	})) as { success: boolean; error?: unknown };
	expect(answer.success, JSON.stringify(answer.error)).toBe(true);
	await page.waitForFunction(
		() => (document.querySelector('loam-shell') as unknown as { account: string }).account !== ''
	);
	await settle(page);
}

async function signOut(page: Page): Promise<void> {
	await kernelCall(page, 'auth-sign-out');
	await page.waitForFunction(
		() => (document.querySelector('loam-shell') as unknown as { account: string }).account === ''
	);
	await settle(page);
}

describe('P4-E3: appearance per person in provider mode (A-P3-2)', () => {
	it('keeps each person their own, and paints the last one applied while signed out', async () => {
		const shell = await openShell(browser, site.root, { colorScheme: 'light' });
		opened.push(shell);
		const { page } = shell;
		await signIn(page, 'ada@example.com');
		await kernelCall(page, 'appearance-set', { theme: 'dark' });
		await expect.poll(() => theme(page)).toMatchObject({ theme: 'dark' });

		// Signed out: Ada's, as `.last`.
		await signOut(page);
		await expect.poll(() => theme(page)).toMatchObject({ theme: 'dark' });

		// Olu has none of his own: the default, which follows the light color scheme.
		await signIn(page, 'olu@example.com');
		await expect.poll(() => theme(page)).toMatchObject({ theme: 'light', density: 'comfortable' });
		await kernelCall(page, 'setting-set', {
			section: 'loam.appearance',
			key: 'density',
			value: 'compact',
			level: 'person',
		});
		await expect.poll(() => theme(page)).toMatchObject({ theme: 'light', density: 'compact' });

		// Signed out again: Olu's now; a reload paints it from the first frame.
		await signOut(page);
		await page.reload();
		await page.waitForFunction(() => document.documentElement.dataset.loamTheme !== undefined);
		expect(await theme(page)).toMatchObject({ theme: 'light', density: 'compact' });

		// Ada signs in to her own.
		await page.evaluate(
			() => (document.querySelector('loam-shell') as unknown as { ready: Promise<void> }).ready
		);
		await signIn(page, 'ada@example.com');
		await expect.poll(() => theme(page)).toMatchObject({ theme: 'dark', density: 'comfortable' });
		expect(shell.violations).toEqual([]);
	});
});
