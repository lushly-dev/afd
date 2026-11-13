/**
 * E3 (phase 3 specification, 4.3 and 4.6): sessions revoked at the provider reach the shell. A real Better Auth
 * 1.7.18 server stands behind `api/auth/` on the shell's own HTTPS origin, through the test-only auth host; it
 * proves no hosted lane (2.4). Each browser context is a profile, and the journal's writer lock holds one shell tab
 * per profile, so a second device is a second context and `SessionSync`'s other tab is a plain page of the same
 * profile listening on the `loam-session` channel.
 */

import type { JournalEntry } from '@lushly-dev/afd-core';
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
			people: [
				{ email: 'dee@example.com', name: 'Dee', role: 'member', password: PASSWORD },
				{ email: 'eli@example.com', name: 'Eli', role: 'member', password: PASSWORD },
				{ email: 'fay@example.com', name: 'Fay', role: 'member', password: PASSWORD },
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

async function open(): Promise<ShellPage> {
	const page = await openShell(browser, site.root);
	opened.push(page);
	return page;
}

const accountOf = (page: Page) =>
	page.evaluate(
		() => (document.querySelector('loam-shell') as unknown as { account: string }).account
	);

const entriesOf = (page: Page) =>
	page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			journal: { read(): Promise<unknown[]> };
		};
		return shell.journal.read();
	}) as Promise<JournalEntry[]>;

async function signIn(page: Page, email: string): Promise<void> {
	const signed = (await kernelCall(page, 'auth-sign-in', {
		method: 'credentials',
		email,
		password: PASSWORD,
	})) as { success: boolean; error?: unknown };
	expect(signed.success, JSON.stringify(signed.error)).toBe(true);
	await page.waitForFunction(
		() => (document.querySelector('loam-shell') as unknown as { account: string }).account !== ''
	);
	await settle(page);
}

interface Listed {
	success: boolean;
	data?: { sessions: Array<{ id: string; current: boolean }> };
	error?: { code: string };
}

/** Age every session of a person at the provider, as if each was made `seconds` ago. */
function age(email: string, seconds: number): void {
	site.authHost
		?.db({ writable: true })
		.prepare('UPDATE session SET createdAt = ? WHERE userId = ?')
		.run(
			new Date(Date.now() - seconds * 1_000).toISOString(),
			site.authHost.people[email] as string
		);
}

/** Whether the provider still answers a session for this page's cookie. */
const providerKnows = (page: Page) =>
	page.evaluate(async () => {
		const response = await fetch(new URL('api/auth/loam/whoami', document.baseURI), {
			credentials: 'same-origin',
		});
		return (await response.json().catch(() => null)) !== null;
	});

describe('P3-E3: revocation reaches the shell (4.3, 4.6)', () => {
	it("P3-E3: revokes another device's session by its handle; that device signs out when it is next visible", async () => {
		const here = await open();
		const there = await open();
		await signIn(here.page, 'dee@example.com');
		await signIn(there.page, 'dee@example.com');
		const listed = (await kernelCall(here.page, 'session-list')) as Listed;
		expect(listed.success, JSON.stringify(listed.error)).toBe(true);
		const other = listed.data?.sessions.find((row) => !row.current);
		expect(other?.id).toMatch(/^[0-9a-f]{16}$/);
		const revoked = (await kernelCall(here.page, 'session-revoke', { session: other?.id })) as {
			success: boolean;
			data?: { signedOut: boolean };
			error?: unknown;
		};
		expect(revoked.success, JSON.stringify(revoked.error)).toBe(true);
		expect(revoked.data?.signedOut).toBe(false);
		// The provider refuses the revoked session at once: no cookie cache stands between.
		expect(await providerKnows(there.page)).toBe(false);
		expect(await providerKnows(here.page)).toBe(true);
		// The other device reads its session again when it becomes visible, and shows "Sign in" within 2 s.
		const started = Date.now();
		await there.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await there.page.waitForFunction(
			() => (document.querySelector('loam-shell') as unknown as { account: string }).account === '',
			undefined,
			{ timeout: 2_000 }
		);
		expect(Date.now() - started).toBeLessThan(2_000);
		await settle(there.page);
		// The change of person was settled, top-level, in that device's journal.
		const settled = (await entriesOf(there.page)).filter(
			(entry) => entry.command === 'session-settle'
		);
		expect(settled.at(-1)?.input).toMatchObject({ person: null });
		expect(await accountOf(here.page)).toBe('Dee');
	});

	it("P3-E3: revokes 'all' from a fresh session, which signs this profile's every tab out", async () => {
		const page = await open();
		await signIn(page.page, 'eli@example.com');
		const elsewhere = await open();
		await signIn(elsewhere.page, 'eli@example.com');
		// Another tab of the same profile, listening on the channel `SessionSync` posts to.
		const tab = await page.context.newPage();
		await tab.goto(`${site.root}deployment.json`);
		await tab.evaluate(() => {
			const heard: unknown[] = [];
			(globalThis as { heard?: unknown[] }).heard = heard;
			new BroadcastChannel('loam-session').onmessage = (event) => heard.push(event.data);
		});
		const all = (await kernelCall(page.page, 'session-revoke', { session: 'all' })) as {
			success: boolean;
			data?: { revoked: number; signedOut: boolean };
			error?: unknown;
		};
		expect(all.success, JSON.stringify(all.error)).toBe(true);
		expect(all.data).toMatchObject({ revoked: 2, signedOut: true });
		await page.page.waitForFunction(
			() => (document.querySelector('loam-shell') as unknown as { account: string }).account === ''
		);
		await expect
			.poll(() => tab.evaluate(() => (globalThis as { heard?: unknown[] }).heard))
			.toContainEqual(expect.objectContaining({ type: 'signed-out' }));
		expect(await providerKnows(elsewhere.page)).toBe(false);
		await settle(page.page);
		const settled = (await entriesOf(page.page)).filter(
			(entry) => entry.command === 'session-settle'
		);
		expect(settled.at(-1)?.input).toMatchObject({ person: null });
	});

	it("P3-E3: lists sessions 301 s after sign-in, but revoking 'others' from a stale session needs a fresh one", async () => {
		const page = await open();
		await signIn(page.page, 'fay@example.com');
		age('fay@example.com', 301);
		const listed = (await kernelCall(page.page, 'session-list')) as Listed;
		expect(listed.success, JSON.stringify(listed.error)).toBe(true);
		expect(listed.data?.sessions.some((row) => row.current)).toBe(true);
		const stale = (await kernelCall(page.page, 'session-revoke', { session: 'others' })) as {
			success: boolean;
			error?: { code: string; retryable?: boolean };
		};
		expect(stale.success).toBe(false);
		expect(stale.error?.code).toBe('REAUTH_REQUIRED');
		expect(await accountOf(page.page)).toBe('Fay');
	});
});
