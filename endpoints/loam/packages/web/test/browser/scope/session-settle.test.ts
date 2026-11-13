/**
 * E4's Chromium part (phase 3 specification, 4.4 and 18; #854, #864): a session that ends with no command. The
 * page's clock is Playwright's, so the Mock's hour passes at once: the kernel's expiry timer fires with no call,
 * refreshes the adapter, which finds the session gone, and journals `session-settle` with its input; the
 * restricted project is left, and the projects list loses the name with no other read.
 */

import type { JournalEntry } from '@lushly-dev/afd-core';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	kernelCall,
	openShell,
	packApp,
	type ShellPage,
	serveDeployment,
	settle,
	surfacesIdle,
} from '../harness';

const PERSON = 'mock-user-person@example.com';

let browser: Browser;
let site: DeploymentSite;

beforeAll(async () => {
	browser = await chromium.launch();
	site = await serveDeployment({
		config: deploymentFile(deploymentEntry('hello', await packApp('hello'))),
	});
});
afterAll(async () => {
	await site?.close();
	await browser?.close();
});

/**
 * The shell on a page whose clock Playwright drives, installed once the shell is open (its boot waits on real
 * frames) and before the sign-in arms the expiry timer.
 */
async function openTimed(): Promise<ShellPage> {
	const opened = await openShell(browser, site.root);
	await opened.page.clock.install();
	return opened;
}

const entriesOf = (page: Page) =>
	page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			journal: { read(): Promise<unknown[]> };
		};
		return shell.journal.read();
	}) as Promise<JournalEntry[]>;

/** Every text of the page, through every open shadow root. */
const deepText = (page: Page) =>
	page.evaluate(() => {
		const walk = (root: ParentNode): string =>
			[...root.querySelectorAll('*')]
				.map((element) => (element.shadowRoot ? walk(element.shadowRoot) : ''))
				.join(' ') +
			(root instanceof Element || root instanceof ShadowRoot ? root.textContent : '');
		return walk(document.documentElement);
	});

async function restrictedVault(page: Page): Promise<void> {
	await kernelCall(page, 'auth-sign-in', {
		method: 'credentials',
		email: 'person@example.com',
		password: 'x',
	});
	await kernelCall(page, 'project-create', {
		name: 'Vault',
		access: { mode: 'restricted', members: [PERSON] },
	});
}

/** The Mock's hour passes with no command: the kernel's timer fires, at most once, as a page's would. */
async function expire(page: Page): Promise<void> {
	await page.clock.fastForward('02:00:00');
	await settle(page);
}

/** The settles the journal holds, and the entries after the last one. */
async function settlesOf(page: Page) {
	const entries = await entriesOf(page);
	const at = entries.findLastIndex((entry) => entry.command === 'session-settle');
	return {
		settles: entries.filter((entry) => entry.command === 'session-settle'),
		after: entries.slice(at + 1).map((entry) => entry.command),
	};
}

describe('P3-E4: a session ends with no command, in Chromium (#854, #864)', () => {
	it('P3-E4: the expiry timer settles inside a restricted project with no call, journaled with its input, and leaves it', async () => {
		const opened = await openTimed();
		const { page } = opened;
		await restrictedVault(page);
		await kernelCall(page, 'scope-set', { project: 'vault' });
		await kernelCall(page, 'section-open', { section: 'projects' });
		await surfacesIdle(page);
		const section = page.locator('loam-main loam-projects-section');
		await expect.poll(() => section.locator('h1').textContent()).toBe('Vault');
		expect((await settlesOf(page)).settles).toEqual([]);

		await expire(page);
		const { settles } = await settlesOf(page);
		expect(settles).toHaveLength(1);
		expect(settles[0]?.input).toEqual({
			person: null,
			role: null,
			membershipDigest: null,
			reason: 'expiry',
		});
		expect(settles[0]?.result).toMatchObject({
			success: true,
			data: { person: null, left: PERSON },
		});
		// Left with no other call: the project, its home and its URL.
		await expect
			.poll(() => page.locator('loam-rail loam-project-switcher button').getAttribute('aria-label'))
			.toBe('Project: none');
		await expect.poll(() => new URL(page.url()).pathname).not.toContain('/p/vault');
		await expect.poll(() => section.locator('h1').textContent()).toBe('Projects');
		await expect.poll(() => deepText(page)).not.toContain('Vault');
		expect(opened.errors).toEqual([]);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	}, 60_000);

	it('P3-E4: on the list at workspace level, with no change of scope, the projects list loses the name with no other read (#864)', async () => {
		const opened = await openTimed();
		const { page } = opened;
		await restrictedVault(page);
		await page.locator('loam-rail loam-section-entry[section="projects"] button').click();
		const section = page.locator('loam-main loam-projects-section');
		await expect.poll(() => section.locator('h1').textContent()).toBe('Projects');
		await expect
			.poll(() => section.locator('tbody tr').allTextContents())
			.toEqual([expect.stringContaining('Vault')]);

		await expire(page);
		// The section re-read on the settle's event alone: nothing the test or the person called.
		await expect.poll(() => deepText(page)).not.toContain('Vault');
		expect(await section.locator('tbody tr').count()).toBe(0);
		const { settles, after } = await settlesOf(page);
		expect(settles.map((entry) => entry.input)).toEqual([
			{ person: null, role: null, membershipDigest: null, reason: 'expiry' },
		]);
		// Nothing changed after it: the section only read.
		expect(after.filter((command) => !/-(get|list|search)$/.test(command))).toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 60_000);
});
