/**
 * E3 and E15's revoked sessions (phase 3 specification, 4.3, 4.6 and 18): sessions revoked at the provider reach the shell. A real Better Auth
 * 1.7.18 server stands behind `api/auth/` on the shell's own HTTPS origin, through the test-only auth host; it
 * proves no hosted lane (2.4). Each browser context is a profile, and the journal's writer lock holds one shell tab
 * per profile, so a second device is a second context and `SessionSync`'s other tab is a plain page of the same
 * profile listening on the `loam-session` channel.
 */

import type { JournalEntry } from '@lushly-dev/afd-core';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	addVirtualAuthenticator,
	connectClient,
	type DeploymentSite,
	kernelCall,
	launchForDevHost,
	openShell,
	providerDeployment,
	type ShellPage,
	secretsHeld,
	secretsNow,
	serveDeployment,
	settle,
	unsearched,
} from '../harness';

const PASSWORD = 'correct horse battery staple';
const REDIRECT = 'http://127.0.0.1:9/callback';

let browser: Browser;
let site: DeploymentSite;
const opened: ShellPage[] = [];

beforeAll(async () => {
	site = await serveDeployment({
		config: providerDeployment(['passkey', 'password']),
		authHost: {
			organization: { slug: 'acme', name: 'Acme' },
			people: [
				// The deployer's owner, who pre-registers the client below.
				{ email: 'olu@example.com', name: 'Olu', role: 'owner', password: PASSWORD },
				{ email: 'dee@example.com', name: 'Dee', role: 'member', password: PASSWORD },
				{ email: 'eli@example.com', name: 'Eli', role: 'member', password: PASSWORD },
				{ email: 'fay@example.com', name: 'Fay', role: 'member', password: PASSWORD },
				{ email: 'gil@example.com', name: 'Gil', role: 'member', password: PASSWORD },
			],
			// E3's `'all'`: a client Eli connects, so the revocation has a consent and a refresh token to end.
			clients: [{ name: 'Client', redirect: REDIRECT }],
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

const authHost = () => site.authHost as NonNullable<DeploymentSite['authHost']>;

/** A page's text and every attribute's value, every shadow root's included: anywhere a name could still show. */
const deepText = (page: Page) =>
	page.evaluate(() => {
		const parts: string[] = [document.body.textContent ?? ''];
		const walk = (root: Document | ShadowRoot) => {
			for (const node of root.querySelectorAll('*')) {
				for (const attribute of node.attributes) parts.push(attribute.value);
				if (node.shadowRoot) {
					parts.push(node.shadowRoot.textContent ?? '');
					walk(node.shadowRoot);
				}
			}
		};
		walk(document);
		return parts.join('\n');
	});

/** E15: no profile holds the password, nor a cookie, token or address of a session now or in `earlier`. */
async function expectNoSecret(
	shells: ShellPage[],
	earlier: Awaited<ReturnType<typeof secretsNow>>[]
): Promise<void> {
	for (const shell of shells) {
		const { held, found } = await secretsHeld(shell, {
			authHost: authHost(),
			password: PASSWORD,
			earlier,
		});
		expect(unsearched(held)).toEqual([]);
		expect(held.store.rows).toBeGreaterThan(0);
		expect(found).toEqual([]);
	}
}

describe('P3-E3: revocation reaches the shell (4.3, 4.6)', () => {
	it("P3-E3: P3-E15: revokes another device's session by its handle; that device signs out when it is next visible", async () => {
		const here = await open();
		const there = await open();
		await signIn(here.page, 'dee@example.com');
		await signIn(there.page, 'dee@example.com');
		// E15: read now, since the revocation deletes the other device's session.
		const before = [await secretsNow(here, authHost()), await secretsNow(there, authHost())];
		expect(before[1]?.tokens.length).toBeGreaterThan(1);
		// A project restricted to Dee, which the other device shows before it signs out.
		const dee = authHost().people['dee@example.com'] as string;
		const vault = (await kernelCall(there.page, 'project-create', {
			name: 'Vault Seven',
			access: { mode: 'restricted', members: [dee] },
		})) as { success: boolean; error?: unknown };
		expect(vault.success, JSON.stringify(vault.error)).toBe(true);
		await kernelCall(there.page, 'section-open', { section: 'projects' });
		await expect.poll(() => deepText(there.page)).toContain('Vault Seven');
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
		// The other device reads its session again when it becomes visible: within 2 s of that, it shows "Sign in" and
		// nothing restricted anywhere in the page, text or attribute, shadow roots included.
		const started = Date.now();
		await there.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await expect
			.poll(
				async () => {
					const text = await deepText(there.page);
					return text.includes('Sign in to acme') && !text.includes('Vault Seven');
				},
				{ timeout: 2_000, interval: 50 }
			)
			.toBe(true);
		expect(Date.now() - started).toBeLessThan(2_000);
		expect(await accountOf(there.page)).toBe('');
		await settle(there.page);
		expect(await deepText(there.page)).not.toContain('Vault Seven');
		// The change of person was settled, top-level, in that device's journal.
		const settled = (await entriesOf(there.page)).filter(
			(entry) => entry.command === 'session-settle'
		);
		expect(settled.at(-1)?.input).toMatchObject({ person: null });
		expect(await accountOf(here.page)).toBe('Dee');
		// E15: neither device holds the password, a cookie or a session token, the revoked one's included.
		await expectNoSecret([here, there], before);
	});

	it("P3-E3: P3-E15: revokes 'all' from a fresh session, which signs this profile's every tab out and ends the person's grants", async () => {
		const page = await open();
		await signIn(page.page, 'eli@example.com');
		const elsewhere = await open();
		await signIn(elsewhere.page, 'eli@example.com');
		// A client Eli connected, with `offline_access`: a consent and a refresh token at the provider.
		const tokens = await connectClient(page.context, site, {
			id: authHost().clients.Client as string,
			redirect: REDIRECT,
		});
		expect(tokens.refresh).toBeTruthy();
		const eli = authHost().people['eli@example.com'] as string;
		const consents = () =>
			authHost().db().prepare('SELECT id FROM oauthConsent WHERE userId = ?').all(eli);
		const refreshTokens = () =>
			authHost()
				.db()
				.prepare('SELECT id, revoked FROM oauthRefreshToken WHERE userId = ? ORDER BY id')
				.all(eli) as { id: string; revoked: unknown }[];
		expect(consents().length).toBeGreaterThan(0);
		const issued = refreshTokens();
		expect(issued.length).toBeGreaterThan(0);
		expect(issued.every((row) => row.revoked === null)).toBe(true);
		// E15: read now, since revoking 'all' deletes both sessions.
		const before = [
			await secretsNow(page, authHost()),
			await secretsNow(elsewhere, authHost()),
			{
				cookies: [],
				tokens: [tokens.access, tokens.refresh].filter((value): value is string => !!value),
				addresses: [],
			},
		];
		// Another tab of the same profile, listening on the channel `SessionSync` posts to.
		const tab = await page.context.newPage();
		await tab.goto(`${site.root}deployment.json`);
		await tab.evaluate(() => {
			const heard: unknown[] = [];
			(globalThis as { heard?: unknown[] }).heard = heard;
			new BroadcastChannel('loam-session').onmessage = (event) =>
				heard.push({ ...(event.data as object), at: Date.now() });
		});
		const revokedAt = Date.now();
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
		// The profile's other page hears `SessionSync`'s sign-out within 2 s of the revocation, by the time it stamped
		// on arrival. The journal's writer lock holds one shell tab per profile (step 3's deviation 9), so this page is
		// on the channel, not a second shell.
		await expect
			.poll(() => tab.evaluate(() => (globalThis as { heard?: unknown[] }).heard), {
				timeout: 2_000,
			})
			.toContainEqual(expect.objectContaining({ type: 'signed-out' }));
		const heard = (await tab.evaluate(() => (globalThis as { heard?: unknown[] }).heard)) as {
			type: string;
			at: number;
		}[];
		const arrived = heard.find((message) => message.type === 'signed-out') as { at: number };
		expect(arrived.at - revokedAt).toBeLessThan(2_000);
		expect(await providerKnows(elsewhere.page)).toBe(false);
		// The person's consents deleted and their refresh tokens, `offline_access` included, revoked: from the host's
		// database (4.3).
		expect(consents()).toEqual([]);
		// Each refresh token issued is still there, marked revoked: not deleted, not live.
		const after = refreshTokens();
		expect(after.map((row) => row.id)).toEqual(issued.map((row) => row.id));
		expect(after.every((row) => row.revoked !== null)).toBe(true);
		await settle(page.page);
		const settled = (await entriesOf(page.page)).filter(
			(entry) => entry.command === 'session-settle'
		);
		expect(settled.at(-1)?.input).toMatchObject({ person: null });
		await settle(elsewhere.page);
		await expectNoSecret([page, elsewhere], before);
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
	it("P3-E3: a passkey holder's fresh passkey session revokes another device by handle and the others; their password session may not (NEW-1)", async () => {
		const here = await open();
		await addVirtualAuthenticator(here.page, { userVerified: true });
		await signIn(here.page, 'gil@example.com');
		// A fresh password session of a person with no passkey yet adds their first (5.2, D99).
		const added = (await kernelCall(here.page, 'account-passkey-add', { name: 'Laptop' })) as {
			success: boolean;
			error?: unknown;
		};
		expect(added.success, JSON.stringify(added.error)).toBe(true);
		await kernelCall(here.page, 'auth-sign-out');
		await here.page.waitForFunction(
			() => (document.querySelector('loam-shell') as unknown as { account: string }).account === ''
		);
		// Signed in again by the passkey: the ceremony through the provider, which marks the session `passkey`.
		const passkey = (await kernelCall(here.page, 'auth-sign-in', { method: 'passkey' })) as {
			success: boolean;
			error?: unknown;
		};
		expect(passkey.success, JSON.stringify(passkey.error)).toBe(true);
		await here.page.waitForFunction(
			() =>
				(document.querySelector('loam-shell') as unknown as { account: string }).account === 'Gil'
		);
		await settle(here.page);
		const gil = site.authHost?.people['gil@example.com'] as string;
		const newest = () =>
			site.authHost
				?.db()
				.prepare('SELECT loamMethod FROM session WHERE userId = ? ORDER BY createdAt DESC LIMIT 1')
				.get(gil) as { loamMethod: string | null };
		expect(newest().loamMethod).toBe('passkey');
		// Another device signs in by password: as the holder's, that session may revoke no other.
		const there = await open();
		await signIn(there.page, 'gil@example.com');
		const handleOf = async (page: Page) => {
			const listed = (await kernelCall(page, 'session-list')) as Listed;
			expect(listed.success, JSON.stringify(listed.error)).toBe(true);
			return listed.data?.sessions.find((row) => row.current)?.id as string;
		};
		const hereHandle = await handleOf(here.page);
		const thereHandle = await handleOf(there.page);
		const refused = (await kernelCall(there.page, 'session-revoke', { session: hereHandle })) as {
			success: boolean;
			error?: { code: string };
		};
		expect(refused.error?.code).toBe('REAUTH_REQUIRED');
		expect(await providerKnows(here.page)).toBe(true);
		// The passkey session revokes it by handle, at once.
		const revoked = (await kernelCall(here.page, 'session-revoke', { session: thereHandle })) as {
			success: boolean;
			data?: { revoked: number; signedOut: boolean };
			error?: unknown;
		};
		expect(revoked.success, JSON.stringify(revoked.error)).toBe(true);
		expect(revoked.data).toMatchObject({ revoked: 1, signedOut: false });
		expect(await providerKnows(there.page)).toBe(false);
		// And the others, from a third device.
		const third = await open();
		await signIn(third.page, 'gil@example.com');
		const others = (await kernelCall(here.page, 'session-revoke', { session: 'others' })) as {
			success: boolean;
			data?: { revoked: number; signedOut: boolean };
			error?: unknown;
		};
		expect(others.success, JSON.stringify(others.error)).toBe(true);
		expect(others.data).toMatchObject({ revoked: 1, signedOut: false });
		expect(await providerKnows(third.page)).toBe(false);
		expect(await accountOf(here.page)).toBe('Gil');
	});
});
