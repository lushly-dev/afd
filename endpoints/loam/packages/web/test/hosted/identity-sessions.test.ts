/**
 * Phase 3's hosted criterion, P3-H2 and P3-H4 (phase 3 specification, 10.1 and 18; step 10), on the hosted lane's
 * development profile at `/loam/`, against the profile's own provider over HTTPS, no test-only host. Passkeys are made by
 * Chromium's virtual authenticator, through its DevTools `WebAuthn` domain, as phase 3's local suites make them.
 *
 * - **P3-H2:** E1's passkey path (a password sign-in, a passkey added, a sign-out and a sign-in with "Sign in with a
 *   passkey", the actor the provider's user id, no credential journaled, a reload inside a restricted project restored by
 *   the probe, an authenticator without user verification refused) and E17's (an owner's invitation, the mailed link, a
 *   passkey made from it with no password and no prior session, a member with a verified email, the link refused again).
 * - **P3-H4:** after `session-revoke 'all'` and after `member-remove`, the revoked session's next MCP, provider and relay
 *   requests are refused at once, the person's refresh token fails, and their last access token is accepted until it
 *   expires and refused after. Access tokens here live `TTL_SECONDS` (`startDevHost`'s `accessTokenTtlSeconds`, never
 *   longer than 10 minutes); the hosted verifier allows 60 s of clock skew past `exp` (AFD's `DEFAULT_CLOCK_SKEW_S`).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
	agentToken,
	type DevHost,
	type HostSend,
	startDevHost,
} from '@lushly-dev/loam-host/testing';
import { TEST_RATE_LIMIT } from '@lushly-dev/loam-identity/testing';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	addVirtualAuthenticator,
	focused,
	hostedProviderDeployment,
	kernelCall,
	launchForDevHost,
	openPage,
	openShell,
	recordSecretsSent,
	type ShellPage,
	settle,
} from '../browser/harness';
import {
	baseOf,
	claimsOf,
	cookieOf,
	listWith,
	mcpClient,
	PASSWORD,
	personId,
	resourceOf,
	signedInShell,
} from './identity-support';
import { type Fixture, startAfdFixture } from './relay-fixtures';
import { codeOf, fixtureEntry, modern, relayAs, toolCall } from './relay-support';
import { hosted } from './support';

const REDIRECT = 'http://127.0.0.1:9/callback';
const CLIENT = 'P3 revocation agent';
const TTL_SECONDS = 30;
/** AFD's `DEFAULT_CLOCK_SKEW_S`, which `createMcpAuth`'s verifier keeps: a token is accepted up to `exp` plus this. */
const SKEW_SECONDS = 60;
const TEAM_TOKEN = 'team-bearer-p3h4-0123456789abcdef';

let host: DevHost;
let browser: Browser;
let directory: string;
let team: Fixture;
const opened: ShellPage[] = [];

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'loam-p3-sessions-'));
	team = await startAfdFixture('hybrid');
	host = await startDevHost({
		config: hostedProviderDeployment(
			['passkey', 'password'],
			// A team instance at workspace level, so a member's scope-less call is forwarded while her session holds.
			await fixtureEntry(directory, 'team', team.url, TEAM_TOKEN, ['audience = "team"'])
		),
		basePath: '/loam/',
		organization: { slug: 'acme', name: 'Acme' },
		people: [
			{
				email: 'olu@acme.example',
				name: 'Olu',
				role: 'owner',
				methods: ['password'],
				password: PASSWORD,
			},
			{
				email: 'bea@acme.example',
				name: 'Bea',
				role: 'member',
				methods: ['password'],
				password: PASSWORD,
			},
			{
				email: 'cy@acme.example',
				name: 'Cy',
				role: 'member',
				methods: ['password'],
				password: PASSWORD,
			},
			{
				email: 'cam@acme.example',
				name: 'Cam',
				role: 'member',
				methods: ['password'],
				password: PASSWORD,
			},
			{
				email: 'dee@acme.example',
				name: 'Dee',
				role: 'member',
				methods: ['password'],
				password: PASSWORD,
			},
		],
		clients: [{ name: CLIENT, redirect: REDIRECT }],
		accessTokenTtlSeconds: TTL_SECONDS,
		rateLimit: TEST_RATE_LIMIT,
	});
	browser = await launchForDevHost(host);
}, 240_000);

afterAll(async () => {
	await Promise.all(opened.splice(0).map((page) => page.context.close()));
	await browser?.close();
	await host?.close();
	await team?.close();
	if (directory) await rm(directory, { recursive: true, force: true });
});

const shadow = (page: Page, selector: string) => page.locator('loam-shell').locator(selector);
const link = (page: Page) => page.locator('loam-link-page');
const accountOf = (page: Page) =>
	page.evaluate(
		() => (document.querySelector('loam-shell') as unknown as { account: string }).account
	);
/** The page's own journal, read whole. */
const entriesOf = (page: Page) =>
	page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			journal: { read(): Promise<unknown[]> };
		};
		return shell.journal.read();
	}) as Promise<
		Array<{ command: string; input?: unknown; actor?: unknown; result: { success: boolean } }>
	>;

async function signInWithPassword(page: Page, email: string): Promise<void> {
	await shadow(page, 'loam-titlebar .account').click();
	const dialog = shadow(page, 'loam-sign-in-dialog');
	await dialog.locator('#email').fill(email);
	await dialog.locator('#password').fill(PASSWORD);
	await dialog.getByRole('button', { name: 'Sign in with a password' }).click();
	await page.waitForFunction(
		() => (document.querySelector('loam-shell') as unknown as { account: string }).account !== ''
	);
	await settle(page);
}

async function shell(): Promise<ShellPage> {
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const page = await openShell(browser, host.root, {}, context);
	opened.push(page);
	return page;
}

describe('P3-H2: a person signs in with a passkey on the hosted lane', () => {
	/** Bea's passkey as the virtual authenticator made it, with its private key, for the refusal below. */
	let beaCredential: unknown;

	it("P3-H2: E1's path: a password sign-in, a passkey added, a sign-out, and a sign-in with the passkey, the actor the provider's user id and no credential journaled", async () => {
		const page = await shell();
		// Every ceremony's bytes the page sends the provider, for the journal scan below.
		const sent = recordSecretsSent(page.page);
		const authenticator = await addVirtualAuthenticator(page.page, { userVerified: true });
		await signInWithPassword(page.page, 'bea@acme.example');
		expect(await accountOf(page.page)).toBe('Bea');
		const bea = personId(host, 'bea@acme.example');
		const added = (await kernelCall(page.page, 'account-passkey-add', { name: 'Laptop' })) as {
			success: boolean;
			error?: unknown;
		};
		expect(added.success, JSON.stringify(added.error)).toBe(true);
		const credentials = await authenticator.credentials();
		expect(credentials).toHaveLength(1);
		beaCredential = credentials[0];
		// Stored at the profile's own provider, for Bea.
		expect(
			host.db().auth.prepare('SELECT COUNT(*) AS n FROM passkey WHERE userId = ?').get(bea)
		).toEqual({ n: 1 });
		expect(((await kernelCall(page.page, 'auth-sign-out')) as { success: boolean }).success).toBe(
			true
		);
		await page.page.waitForFunction(
			() => (document.querySelector('loam-shell') as unknown as { account: string }).account === ''
		);
		await shadow(page.page, 'loam-main .sign-in').click();
		await shadow(page.page, 'loam-sign-in-dialog .passkey').click();
		await page.page.waitForFunction(
			() =>
				(document.querySelector('loam-shell') as unknown as { account: string }).account === 'Bea'
		);
		await settle(page.page);
		const signIns = (await entriesOf(page.page)).filter(
			(entry) => entry.command === 'auth-sign-in' && entry.result.success
		);
		expect(signIns.at(-1)?.input).toEqual({ method: 'passkey' });
		// The session the passkey made is the provider's, marked as a passkey's (2.6, D99).
		expect(
			host
				.db()
				.auth.prepare('SELECT COUNT(*) AS n FROM session WHERE userId = ? AND loamMethod = ?')
				.get(bea, 'passkey')
		).toEqual({ n: 1 });
		// The actor after the passkey sign-in is the provider's user id, on the server's journal too.
		const made = (await kernelCall(page.page, 'project-create', {
			name: 'Beacon',
			access: { mode: 'restricted', members: [bea] },
		})) as { success: boolean; data?: { slug: string }; error?: unknown };
		expect(made.success, JSON.stringify(made.error)).toBe(true);
		const created = (await host.journal()).filter((entry) => entry.command === 'project-create');
		expect(created.at(-1)?.actor).toMatchObject({ kind: 'human', id: bea });
		// No credential in either journal: no ceremony's bytes (the registration's attestation and the sign-in's
		// signature, authenticator data and client data, as the page sent them), no key and no password.
		expect(sent.registrations).toBeGreaterThanOrEqual(1);
		expect(sent.authentications).toBeGreaterThanOrEqual(1);
		const key = (beaCredential as { privateKey: string; credentialId: string }).privateKey;
		for (const text of [
			JSON.stringify(await entriesOf(page.page)),
			JSON.stringify(await host.journal()),
		]) {
			for (const value of sent.values) expect(text).not.toContain(value);
			expect(text).not.toContain(key);
			expect(text).not.toContain(PASSWORD);
		}
		// A reload inside her restricted project restores it from the probe.
		expect(
			(
				(await kernelCall(page.page, 'scope-set', { project: made.data?.slug })) as {
					success: boolean;
				}
			).success
		).toBe(true);
		await page.page.evaluate(async () => {
			await (
				document.querySelector('loam-shell') as unknown as { kernel: { flush(): Promise<void> } }
			).kernel.flush();
		});
		// The probe (4.2): the reload asks the profile's provider who is signed in, and it answers Bea.
		const probed = page.page.waitForResponse(
			(response) => new URL(response.url()).pathname === `${baseOf(host)}api/auth/loam/whoami`
		);
		await page.page.reload();
		const probe = await probed;
		expect(probe.status()).toBe(200);
		expect(await probe.text()).toContain(bea);
		await page.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await page.page.waitForFunction(
			() =>
				(document.querySelector('loam-shell') as unknown as { account: string }).account === 'Bea'
		);
		const scope = (await kernelCall(page.page, 'scope-get')) as {
			data: { project?: { slug: string } };
		};
		expect(scope.data.project?.slug).toBe(made.data?.slug);
		expect(page.errors).toEqual([]);
	});

	it('P3-H2: an authenticator without user verification is refused: no passkey made, and no sign-in with one', async () => {
		const page = await shell();
		await signInWithPassword(page.page, 'cy@acme.example');
		const careless = await addVirtualAuthenticator(page.page, { userVerified: false });
		const added = (await kernelCall(page.page, 'account-passkey-add', {})) as { success: boolean };
		expect(added.success).toBe(false);
		expect(
			host
				.db()
				.auth.prepare('SELECT COUNT(*) AS n FROM passkey WHERE userId = ?')
				.get(personId(host, 'cy@acme.example'))
		).toEqual({ n: 0 });
		await kernelCall(page.page, 'auth-sign-out');
		await page.page.waitForFunction(
			() => (document.querySelector('loam-shell') as unknown as { account: string }).account === ''
		);
		// Bea's real passkey on an authenticator that cannot verify its user: the ceremony the profile asks for, which
		// requires user verification, fails, and no one is signed in.
		expect(beaCredential).toBeDefined();
		await careless.add(beaCredential);
		await shadow(page.page, 'loam-main .sign-in').click();
		await shadow(page.page, 'loam-sign-in-dialog .passkey').click();
		await expect
			.poll(() => shadow(page.page, 'loam-sign-in-dialog .message').textContent())
			.not.toBe('');
		// The failed ceremony keeps focus on its button.
		expect((await focused(page.page)).label).toBe('Sign in with a passkey');
		expect(await accountOf(page.page)).toBe('');
		const refused = (await entriesOf(page.page)).filter(
			(entry) => entry.command === 'auth-sign-in' && !entry.result.success
		);
		expect(refused.at(-1)?.input).toEqual({ method: 'passkey' });
	});

	it('P3-H2: a cancelled ceremony is said in the dialog, keeps focus on its button, and signs no one in', async () => {
		const page = await shell();
		// The browser's answer when the person dismisses its passkey prompt (WebAuthn: NotAllowedError), which the
		// virtual authenticator cannot give.
		await page.page.evaluate(() => {
			navigator.credentials.get = (options?: CredentialRequestOptions) =>
				options?.mediation === 'conditional'
					? new Promise(() => {})
					: Promise.reject(
							new DOMException(
								'The operation either timed out or was not allowed.',
								'NotAllowedError'
							)
						);
		});
		await shadow(page.page, 'loam-main .sign-in').click();
		await shadow(page.page, 'loam-sign-in-dialog .passkey').click();
		await expect
			.poll(() => shadow(page.page, 'loam-sign-in-dialog .message').textContent())
			.toBe('The passkey prompt was closed. Try again, or choose another way to sign in.');
		expect((await focused(page.page)).label).toBe('Sign in with a passkey');
		expect(await accountOf(page.page)).toBe('');
		const tried = (await entriesOf(page.page)).filter((entry) => entry.command === 'auth-sign-in');
		expect(tried.at(-1)).toMatchObject({
			input: { method: 'passkey' },
			result: { success: false, error: { code: 'PASSKEY_CANCELLED' } },
		});
	});

	it('P3-H2: the dialog starts the passkey autofill when it opens, only where the browser offers it (E1 as amended by R8)', async () => {
		for (const offered of [true, false]) {
			const page = await shell();
			await page.page.evaluate((offered) => {
				(
					PublicKeyCredential as unknown as { isConditionalMediationAvailable(): Promise<boolean> }
				).isConditionalMediationAvailable = async () => offered;
				const kernel = (
					document.querySelector('loam-shell') as unknown as {
						kernel: { call(name: string, input?: unknown): Promise<unknown> };
					}
				).kernel;
				const call = kernel.call.bind(kernel);
				const asked: unknown[] = [];
				(globalThis as { asked?: unknown[] }).asked = asked;
				// The autofill waits for the person; here it is only recorded, never answered.
				kernel.call = (name, input) => {
					if (name === 'auth-sign-in') asked.push(input);
					return (input as { autoFill?: boolean })?.autoFill
						? new Promise(() => {})
						: call(name, input);
				};
			}, offered);
			await shadow(page.page, 'loam-main .sign-in').click();
			await shadow(page.page, 'loam-sign-in-dialog dialog[open]').waitFor();
			const asked = () => page.page.evaluate(() => (globalThis as { asked?: unknown[] }).asked);
			if (offered) {
				await expect.poll(asked).toEqual([{ method: 'passkey', autoFill: true }]);
				expect((await focused(page.page)).label).toBe('Sign in with a passkey');
			} else {
				await settle(page.page);
				expect(await asked()).toEqual([]);
			}
		}
	});

	it("P3-H2: E17's path: an owner's invitation; the invitee creates a passkey from the mailed link with no password and no session, and is a member with a verified email; the link fails a second time", async () => {
		const owner = await signedInShell(browser, host, 'olu@acme.example', opened);
		const invited = (await kernelCall(owner.page, 'member-invite', {
			email: 'newcomer@acme.example',
			role: 'member',
		})) as { success: boolean; error?: unknown };
		expect(invited.success, JSON.stringify(invited.error)).toBe(true);
		let url: string | undefined;
		await expect
			.poll(async () => {
				const mail = (await host.mail())
					.filter((message) => message.to === 'newcomer@acme.example')
					.at(-1);
				url = mail ? /https:\/\/\S+/.exec(mail.text)?.[0] : undefined;
				return url;
			})
			.toBeTruthy();
		expect(new URL(url as string).pathname).toBe(`${baseOf(host)}~/join`);
		// A fresh browser profile, with no session: the join page, then a passkey made with user verification.
		const invitee = await openPage(browser, url as string);
		opened.push(invitee);
		await invitee.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'link');
		expect(await invitee.context.cookies(host.origin)).toEqual([]);
		await addVirtualAuthenticator(invitee.page, { userVerified: true });
		await expect.poll(() => link(invitee.page).locator('h1').textContent()).toBe('Join Acme');
		await link(invitee.page).locator('#link-name').fill('Newcomer Person');
		await link(invitee.page).getByRole('button', { name: 'Create a passkey' }).click();
		await link(invitee.page).locator('h1', { hasText: 'Welcome to Acme' }).waitFor();
		const user = host
			.db()
			.auth.prepare('SELECT id, emailVerified FROM user WHERE email = ?')
			.get('newcomer@acme.example') as { id: string; emailVerified: number };
		expect(user.emailVerified).toBe(1);
		// No password: Better Auth keeps one as a `credential` account, and the invitee has no account of any kind.
		expect(
			host.db().auth.prepare('SELECT COUNT(*) AS n FROM account WHERE userId = ?').get(user.id)
		).toEqual({ n: 0 });
		expect(
			host.db().auth.prepare('SELECT COUNT(*) AS n FROM passkey WHERE userId = ?').get(user.id)
		).toEqual({ n: 1 });
		expect(host.db().auth.prepare('SELECT role FROM member WHERE userId = ?').get(user.id)).toEqual(
			{ role: 'member' }
		);
		// Signed in by that ceremony: the shell in the same browser is the member's.
		await invitee.page.goto(host.root);
		await invitee.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await expect.poll(() => accountOf(invitee.page)).toBe('Newcomer Person');
		// The link a second time, in another browser profile.
		const again = await openPage(browser, url as string);
		opened.push(again);
		await again.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'link');
		await expect
			.poll(() => link(again.page).locator('h1').textContent())
			.toBe('This link does not work');
	});

	it("P3-H2: E17's refusals on the profile: a join link past its expiry does not work, one with a session present says to sign out first, one for an existing account to sign in and accept; a passkey from a session older than 300 s, or from a passkey holder's password session, is REAUTH_REQUIRED", async () => {
		const writable = new DatabaseSync(join(host.data, 'auth.sqlite'));
		try {
			// Eve has an account at the provider and no membership: an invitation's existing account.
			const now = new Date().toISOString();
			writable
				.prepare(
					"INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('usr_eve', 'Eve', 'eve@acme.example', 1, ?, ?)"
				)
				.run(now, now);
			const owner = await signedInShell(browser, host, 'olu@acme.example', opened);
			for (const email of ['second@acme.example', 'eve@acme.example', 'late@acme.example']) {
				const invited = (await kernelCall(owner.page, 'member-invite', {
					email,
					role: 'member',
				})) as { success: boolean; error?: unknown };
				expect(invited.success, JSON.stringify(invited.error)).toBe(true);
			}
			const mailedTo = async (email: string) => {
				let url: string | undefined;
				await expect
					.poll(async () => {
						const mail = (await host.mail()).filter((message) => message.to === email).at(-1);
						url = mail ? /https:\/\/\S+/.exec(mail.text)?.[0] : undefined;
						return url;
					})
					.toBeTruthy();
				return url as string;
			};
			// A link past its expiry (48 hours, 5.6), its row aged at the provider: it does not work, and enrols no one.
			const late = await mailedTo('late@acme.example');
			expect(
				writable
					.prepare('UPDATE loam_join SET expiresAt = ? WHERE email = ?')
					.run(new Date(Date.now() - 1_000).toISOString(), 'late@acme.example').changes
			).toBe(1);
			const expired = await openPage(browser, late);
			opened.push(expired);
			await expired.page.waitForFunction(
				() => document.documentElement.dataset.loamHost === 'link'
			);
			await addVirtualAuthenticator(expired.page, { userVerified: true });
			await expect
				.poll(() => link(expired.page).locator('h1').textContent())
				.toBe('This link does not work');
			expect(
				host
					.db()
					.auth.prepare('SELECT COUNT(*) AS n FROM user WHERE email = ?')
					.get('late@acme.example')
			).toEqual({ n: 0 });
			// A join registration's own refusals (5.8), by direct requests to the profile's provider, as the join page
			// asks for options: with another person's session present, `SIGN_OUT_FIRST` at generation; for an email that
			// already has an account, `ACCOUNT_EXISTS`, with no session. A direct sign-up is refused too (5.6).
			const contextOf = (url: string) => {
				const query = new URL(url).searchParams;
				return encodeURIComponent(`join:${query.get('invitation')}.${query.get('token')}`);
			};
			const options = (url: string, cookie?: string) =>
				hosted(
					host,
					`${baseOf(host)}api/auth/passkey/generate-register-options?context=${contextOf(url)}`,
					{ headers: { origin: host.origin, ...(cookie ? { cookie } : {}) } }
				);
			const codeIn = (answer: { body: string }) =>
				(JSON.parse(answer.body || '{}') as { code?: string }).code;
			expect(
				codeIn(await options(await mailedTo('second@acme.example'), await cookieOf(host, owner)))
			).toBe('SIGN_OUT_FIRST');
			expect(codeIn(await options(await mailedTo('eve@acme.example')))).toBe('ACCOUNT_EXISTS');
			const signUp = await hosted(host, `${baseOf(host)}api/auth/sign-up/email`, {
				method: 'POST',
				headers: { origin: host.origin, 'content-type': 'application/json' },
				body: JSON.stringify({
					email: 'walk-in@acme.example',
					password: PASSWORD,
					name: 'Walk In',
				}),
			});
			// Not served at all (`LOAM_DISABLED_PATHS`), as E17's local case reads it.
			expect(signUp.status).toBe(404);
			expect(
				host
					.db()
					.auth.prepare('SELECT COUNT(*) AS n FROM user WHERE email = ?')
					.get('walk-in@acme.example')
			).toEqual({ n: 0 });
			// The owner's own browser holds a session: the join page asks to sign out first, and enrols no one.
			await owner.page.goto(await mailedTo('second@acme.example'));
			await owner.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'link');
			await expect.poll(() => link(owner.page).locator('h1').textContent()).toBe('Sign out first');
			expect(
				host
					.db()
					.auth.prepare('SELECT COUNT(*) AS n FROM user WHERE email = ?')
					.get('second@acme.example')
			).toEqual({ n: 0 });
			const existing = await openPage(browser, await mailedTo('eve@acme.example'));
			opened.push(existing);
			await existing.page.waitForFunction(
				() => document.documentElement.dataset.loamHost === 'link'
			);
			await expect
				.poll(() => link(existing.page).locator('h1').textContent())
				.toBe('You already have an account');
			// It enrols nothing: no passkey, no membership, and her invitation still pending.
			expect(
				host.db().auth.prepare('SELECT COUNT(*) AS n FROM passkey WHERE userId = ?').get('usr_eve')
			).toEqual({ n: 0 });
			expect(
				host.db().auth.prepare('SELECT COUNT(*) AS n FROM member WHERE userId = ?').get('usr_eve')
			).toEqual({ n: 0 });
			expect(
				host
					.db()
					.auth.prepare('SELECT status FROM invitation WHERE email = ?')
					.all('eve@acme.example')
			).toEqual([{ status: 'pending' }]);
			// A session older than 300 s (5.2, D99): Cy's, aged at the provider, may not register a passkey.
			const cy = await shell();
			await signInWithPassword(cy.page, 'cy@acme.example');
			expect(
				writable
					.prepare('UPDATE session SET createdAt = ? WHERE userId = ?')
					.run(new Date(Date.now() - 301_000).toISOString(), personId(host, 'cy@acme.example'))
					.changes
			).toBeGreaterThanOrEqual(1);
			const stale = await addVirtualAuthenticator(cy.page, { userVerified: true });
			const refusedStale = (await kernelCall(cy.page, 'account-passkey-add', {})) as {
				success: boolean;
				error?: { code: string };
			};
			expect(refusedStale.error?.code).toBe('REAUTH_REQUIRED');
			expect(await stale.credentials()).toEqual([]);
			// A password session of a person who holds a passkey (Bea, since E1's path) may not register another.
			const bea = personId(host, 'bea@acme.example');
			const held = host.db().auth.prepare('SELECT COUNT(*) AS n FROM passkey WHERE userId = ?');
			expect((held.get(bea) as { n: number }).n).toBeGreaterThanOrEqual(1);
			const before = held.get(bea);
			const page = await shell();
			await signInWithPassword(page.page, 'bea@acme.example');
			const second = await addVirtualAuthenticator(page.page, { userVerified: true });
			const refused = (await kernelCall(page.page, 'account-passkey-add', {})) as {
				success: boolean;
				error?: { code: string };
			};
			expect(refused.error?.code).toBe('REAUTH_REQUIRED');
			expect(await second.credentials()).toEqual([]);
			expect(held.get(bea)).toEqual(before);
		} finally {
			writable.close();
		}
	});
});

const send: HostSend = (path, options) =>
	hosted(host, path, {
		method: options.method,
		headers: options.headers,
		...(options.body !== undefined ? { body: options.body } : {}),
	}) as never;

const tokenPath = () => `${baseOf(host)}api/auth/oauth2/token`;

/** A refresh grant at the profile's token endpoint: its status and its tokens, or its error. */
async function refreshWith(refresh: string): Promise<{
	status: number;
	access?: string;
	refresh?: string;
	error?: string;
}> {
	const answer = await hosted(host, tokenPath(), {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refresh,
			client_id: host.clients[CLIENT] as string,
			resource: resourceOf(host),
		}).toString(),
	});
	const body = (() => {
		try {
			return JSON.parse(answer.body) as {
				access_token?: string;
				refresh_token?: string;
				error?: string;
			};
		} catch {
			return {};
		}
	})();
	return {
		status: answer.status,
		...(body.access_token ? { access: body.access_token } : {}),
		...(body.refresh_token ? { refresh: body.refresh_token } : {}),
		...(body.error ? { error: body.error } : {}),
	};
}

/** The provider's own request that needs a session: `GET <path>/loam/sessions`, with the shell's cookie. */
const sessionsWith = (cookie: string) =>
	hosted(host, `${baseOf(host)}api/auth/loam/sessions`, {
		headers: { cookie, origin: host.origin },
	});

interface Connected {
	email: string;
	shell: ShellPage;
	cookie: string;
	/** The last access token: the one the rotation below issued. */
	access: string;
	refresh: string;
	exp: number;
	/** When the token layer was seen to accept `access` after the revocation, while unexpired. */
	acceptedAfterRevocation?: number;
}

/**
 * A person signed in to a shell, with a connected agent whose refresh token has rotated twice (so a rotated token's
 * grant works before the revocation), and each of the three requests the revocation must refuse shown to pass first.
 */
async function connected(email: string): Promise<Connected> {
	const page = await signedInShell(browser, host, email, opened);
	const cookie = await cookieOf(host, page);
	const made = await agentToken(send, {
		origin: host.origin,
		providerPath: `${baseOf(host)}api/auth`,
		email,
		password: PASSWORD,
		clientId: host.clients[CLIENT] as string,
		redirect: REDIRECT,
		resource: resourceOf(host),
		scope: 'loam:read loam:write offline_access',
	});
	expect(made.refresh, JSON.stringify(made.refused)).toBeTypeOf('string');
	// Rotated twice: a rotated token's own grant is shown to work, so the last one's refusal is the revocation's.
	const first = await refreshWith(made.refresh as string);
	expect(first.status).toBe(200);
	expect(first.refresh).toBeTypeOf('string');
	expect(first.refresh).not.toBe(made.refresh);
	const rotated = await refreshWith(first.refresh as string);
	expect(rotated.status).toBe(200);
	// The last rotation's refresh token, the person's last, which the revocation must end.
	expect(rotated.refresh).toBeTypeOf('string');
	expect((rotated.refresh as string).length).toBeGreaterThanOrEqual(16);
	expect(rotated.refresh).not.toBe(first.refresh);
	const access = rotated.access as string;
	expect(claimsOf(access).exp as number).toBe((claimsOf(access).iat as number) + TTL_SECONDS);
	// Before: an MCP call, the provider's request and the relay's are each answered.
	const agent = await mcpClient(host, access);
	try {
		expect((await agent.call('project-list')).success).toBe(true);
	} finally {
		await agent.transport.disconnect();
	}
	expect((await sessionsWith(cookie)).status).toBe(200);
	const from = team.log.length;
	const relayed = await relayAs(host, undefined, 'team', toolCall('notes-get', {}, modern), {
		headers: { cookie },
	});
	expect(relayed.status, relayed.body).toBe(200);
	expect(team.log.length).toBe(from + 1);
	return {
		email,
		shell: page,
		cookie,
		access,
		refresh: rotated.refresh as string,
		exp: claimsOf(access).exp as number,
	};
}

/**
 * The revoked person's next MCP, provider and relay requests, each refused at once, each sent with what the person
 * held before the revocation (the session's cookie, the agent's last tokens); their last access token still accepted
 * by the token layer, which cannot see a revocation (S86), so its expiry is the bound; and their refresh token refused.
 */
async function refusedAtOnce(person: Connected, mcpCode: string): Promise<void> {
	const accepted = await listWith(host, person.access);
	// Answered 200 and received back before `exp`: accepted while unexpired, by the clock at its answer.
	const received = Date.now();
	expect(accepted.status, person.email).toBe(200);
	expect(received, person.email).toBeLessThan(person.exp * 1000);
	person.acceptedAfterRevocation = received;
	const agent = await mcpClient(host, person.access);
	try {
		const answer = await agent.call('project-list');
		expect(answer.success, person.email).toBe(false);
		expect(answer.error?.code, person.email).toBe(mcpCode);
	} finally {
		await agent.transport.disconnect();
	}
	expect((await sessionsWith(person.cookie)).status, person.email).toBe(401);
	const from = team.log.length;
	// The cookie the session had, not the browser's jar, which the revocation may already have cleared.
	const relayed = codeOf(
		await relayAs(host, undefined, 'team', toolCall('notes-get', {}, modern), {
			headers: { cookie: person.cookie },
		})
	);
	expect(relayed.status, person.email).toBe(401);
	expect(relayed.marked, person.email).toBe('1');
	expect(team.log.length, person.email).toBe(from);
	const refreshed = await refreshWith(person.refresh);
	expect(refreshed.status, person.email).toBe(400);
	expect(refreshed.error, person.email).toBe('invalid_grant');
	expect(refreshed.access, person.email).toBeUndefined();
}

describe('P3-H4: revocation on the hosted lane', () => {
	const revoked: Connected[] = [];

	it("P3-H4: after `session-revoke 'all'`, the revoked session's next MCP, provider and relay requests are refused at once, and the refresh token fails", async () => {
		const cam = await connected('cam@acme.example');
		const answer = (await kernelCall(cam.shell.page, 'session-revoke', { session: 'all' })) as {
			success: boolean;
			error?: unknown;
		};
		expect(answer.success, JSON.stringify(answer.error)).toBe(true);
		await refusedAtOnce(cam, 'AGENT_NOT_CONNECTED');
		revoked.push(cam);
	});

	it("P3-H4: after `member-remove`, the removed person's next MCP, provider and relay requests are refused at once, and the refresh token fails", async () => {
		// The owner's shell first, so nothing slow runs between Dee's last token and the sample after her removal.
		const owner = await signedInShell(browser, host, 'olu@acme.example', opened);
		const dee = await connected('dee@acme.example');
		const answer = (await kernelCall(owner.page, 'member-remove', {
			member: personId(host, 'dee@acme.example'),
		})) as { success: boolean; error?: unknown };
		expect(answer.success, JSON.stringify(answer.error)).toBe(true);
		await refusedAtOnce(dee, 'AGENT_NOT_CONNECTED');
		revoked.push(dee);
	});

	it(
		"P3-H4: each revoked person's last access token is accepted by the token layer until it expires, and refused after",
		async () => {
			expect(revoked.map((person) => person.email)).toEqual([
				'cam@acme.example',
				'dee@acme.example',
			]);
			const last = Math.max(...revoked.map((person) => person.exp));
			const firstRefused = new Map<string, number>();
			/** Each person's first refusal's challenge, read from that answer itself. */
			const challenge = new Map<string, string>();
			const deadline = (last + SKEW_SECONDS + 15) * 1000;
			while (firstRefused.size < revoked.length && Date.now() < deadline) {
				for (const person of revoked) {
					if (firstRefused.has(person.email)) continue;
					const sampled = Date.now();
					const answer = await listWith(host, person.access);
					if (answer.status === 401) {
						firstRefused.set(person.email, sampled);
						challenge.set(person.email, String(answer.headers['www-authenticate']));
					} else {
						expect(answer.status, `${person.email} at ${sampled}`).toBe(200);
						// Accepted only while unexpired by the verifier's clock: a request started a second past `exp` and
						// its skew (whole seconds) is never accepted.
						expect(sampled, person.email).toBeLessThan((person.exp + SKEW_SECONDS + 1) * 1000);
					}
				}
				await new Promise((done) => setTimeout(done, 2_000));
			}
			for (const person of revoked) {
				const at = firstRefused.get(person.email);
				expect(at, `${person.email} was never refused`).toBeTypeOf('number');
				// Accepted after the revocation, while unexpired (`refusedAtOnce`'s first sample).
				expect(person.acceptedAfterRevocation, person.email).toBeLessThan(person.exp * 1000);
				// Accepted until it expired: the first refusal came only after `exp`.
				expect(at as number, person.email).toBeGreaterThanOrEqual(person.exp * 1000);
				// The first refusal is the token layer's own: `invalid_token`, an expired token.
				expect(challenge.get(person.email), person.email).toContain('invalid_token');
				const refused = await listWith(host, person.access);
				expect(refused.status).toBe(401);
			}
		},
		(TTL_SECONDS + SKEW_SECONDS + 60) * 1000
	);
});
