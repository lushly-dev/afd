/**
 * P3-E18's units (phase 3 specification, 5.7, 5.8 and 18; D97): recovery by email and by single sign-on, at the
 * provider, by direct requests against a real Better Auth 1.7.18 provider from `createLoamAuthOptions`. The deployer's
 * single sign-on is a test-only OpenID provider on loopback (`testing/oidc.ts`); passkeys come from a software
 * authenticator. Neither proves anything of a real identity provider or authenticator.
 */

import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoamMailV1 } from './options.js';
import { RECOVERY_ANSWER_MS } from './recovery.js';
import { startTestOidcProvider, type TestOidcProvider } from './testing/oidc.js';
import { createTestProvider } from './testing/provider.js';
import { linkIn, TestBrowser } from './testing/requests.js';
import { SoftAuthenticator } from './testing/webauthn.js';

const ORIGIN = 'https://acme.example';
const PASSWORD = 'correct horse battery staple';
const database = new DatabaseSync(':memory:');
const sent: LoamMailV1[] = [];
let oidc: TestOidcProvider;
let provider: Awaited<ReturnType<typeof createTestProvider>>;

beforeAll(async () => {
	oidc = await startTestOidcProvider();
	provider = await createTestProvider({
		baseURL: `${ORIGIN}/api/auth`,
		secret: 'r'.repeat(32),
		database,
		workspace: 'acme',
		organization: { slug: 'acme', name: 'Acme' },
		people: [
			{ email: 'olu@example.com', role: 'owner', password: PASSWORD },
			{ email: 'bea@example.com', role: 'member', password: PASSWORD },
			{ email: 'cy@example.com', role: 'member', password: PASSWORD },
			{ email: 'dee@example.com', role: 'member', password: PASSWORD },
			{ email: 'eli@example.com', role: 'member', password: PASSWORD },
			{ email: 'fay@example.com', role: 'member', password: PASSWORD },
			{ email: 'una@example.com', role: 'member', password: PASSWORD, emailVerified: false },
		],
		methods: ['passkey', 'password', 'oidc:corp'],
		oidc: [
			{
				id: 'corp',
				clientId: oidc.clientId,
				clientSecret: oidc.clientSecret,
				discoveryUrl: oidc.discoveryUrl,
			},
		],
		send: async (message) => void sent.push(message),
	});
});
afterAll(async () => {
	database.close();
	await oidc?.close();
});

const browser = () => new TestBrowser((request) => provider.auth.handler(request), ORIGIN);
const idOf = (email: string) =>
	(database.prepare('SELECT id FROM user WHERE email = ?').get(email) as { id: string }).id;
const sessionsOf = (email: string) =>
	(
		database.prepare('SELECT count(*) AS n FROM session WHERE userId = ?').get(idOf(email)) as {
			n: number;
		}
	).n;

async function signedIn(email: string): Promise<TestBrowser> {
	const page = browser();
	expect((await page.signIn(email, PASSWORD)).status).toBe(200);
	return page;
}

/** A recovery request, and the link it mailed, if any. */
async function request(email: string): Promise<{ ms: number; body: unknown; link?: URL }> {
	const before = sent.length;
	const started = Date.now();
	const answer = await browser().call('/loam/recover/request', { body: { email } });
	const ms = Date.now() - started;
	// The mail goes in the background: give it a moment.
	await new Promise((resolve) => setTimeout(resolve, 20));
	const mail = sent.slice(before).find((message) => message.to === email);
	return { ms, body: answer.body, ...(mail ? { link: linkIn(mail.text) } : {}) };
}

/** A sign-in through the deployer's single sign-on, as `email`, following every redirect but the last. */
async function oidcSignIn(page: TestBrowser, email: string, emailVerified = true) {
	oidc.as({ sub: `sub-${email}`, email, emailVerified });
	const started = await page.call('/sign-in/social', {
		body: { provider: 'corp', callbackURL: `${ORIGIN}/~/recover?via=oidc` },
	});
	expect(started.status).toBe(200);
	const authorize = await fetch(started.body?.url as string, { redirect: 'manual' });
	const back = authorize.headers.get('location') as string;
	return page.fetch(back);
}

describe('P3-E18: recovery by email, at the provider (5.7, D97)', () => {
	it('P3-E18: the request answers the same, after the same delay, for an account, no account and an unverified one; only the verified account is mailed', async () => {
		const known = await request('bea@example.com');
		const unknown = await request('nobody@example.com');
		const unverified = await request('una@example.com');
		for (const answer of [known, unknown, unverified]) {
			expect(answer.body).toEqual({ sent: true });
			expect(answer.ms).toBeGreaterThanOrEqual(RECOVERY_ANSWER_MS - 5);
			expect(answer.ms).toBeLessThan(RECOVERY_ANSWER_MS + 400);
		}
		expect(known.link?.pathname).toBe('/~/recover');
		expect(unknown.link).toBeUndefined();
		expect(unverified.link).toBeUndefined();
	});

	it('P3-E18: past three an hour a request is dropped, with the same answer and timing', async () => {
		const answers = [];
		for (let index = 0; index < 4; index++) answers.push(await request('dee@example.com'));
		expect(answers.filter((answer) => answer.link).length).toBe(3);
		expect(answers[3]?.link).toBeUndefined();
		expect(answers[3]?.body).toEqual({ sent: true });
		expect(answers[3]?.ms).toBeGreaterThanOrEqual(RECOVERY_ANSWER_MS - 5);
	});

	it('P3-E18: a recovery link restores access with a new passkey, revokes every other session, records recoveredAt and announces it; it fails a second time', async () => {
		const other = await signedIn('bea@example.com');
		await signedIn('bea@example.com');
		expect(sessionsOf('bea@example.com')).toBe(2);
		const { link } = await request('bea@example.com');
		const token = link?.searchParams.get('token') as string;
		// With a session present the page stops.
		expect((await other.call(`/loam/recover/check?token=${token}`)).body).toMatchObject({
			code: 'SIGN_OUT_FIRST',
		});
		const page = browser();
		expect((await page.call(`/loam/recover/check?token=${token}`)).status).toBe(200);
		const before = sent.length;
		const { verified } = await page.registerPasskey(new SoftAuthenticator({ origin: ORIGIN }), {
			context: `recover:${token}`,
			createSession: true,
		});
		expect(verified?.status).toBe(200);
		expect(sessionsOf('bea@example.com')).toBe(1);
		expect((await other.call('/loam/whoami')).body).toBeNull();
		const account = await page.call('/loam/account');
		expect(account.body?.recoveredAt).toBeTruthy();
		expect(account.body?.recovery).toBe('email');
		const announced = sent.slice(before).find((message) => message.to === 'bea@example.com');
		expect(announced?.text).toMatch(
			/Your access to Acme was restored on \d{4}-\d{2}-\d{2}\. If this wasn't you, contact an owner/
		);
		const again = await browser().registerPasskey(new SoftAuthenticator({ origin: ORIGIN }), {
			context: `recover:${token}`,
			createSession: true,
		});
		expect(again.options.body).toMatchObject({ code: 'RECOVERY_LINK_INVALID' });
	});

	it('P3-E18: a second link cancels the first, and a link fails after 15 minutes', async () => {
		const first = (await request('eli@example.com')).link?.searchParams.get('token') as string;
		const second = (await request('eli@example.com')).link?.searchParams.get('token') as string;
		expect((await browser().call(`/loam/recover/check?token=${first}`)).body).toMatchObject({
			code: 'RECOVERY_LINK_INVALID',
		});
		expect((await browser().call(`/loam/recover/check?token=${second}`)).status).toBe(200);
		database
			.prepare('UPDATE loam_recovery SET expiresAt = ? WHERE userId = ?')
			.run(new Date(Date.now() - 1).toISOString(), idOf('eli@example.com'));
		expect((await browser().call(`/loam/recover/check?token=${second}`)).body).toMatchObject({
			code: 'RECOVERY_LINK_INVALID',
		});
	});

	it("P3-E18: a recovery registration with another person's session present is SIGN_OUT_FIRST", async () => {
		const token = (await request('fay@example.com')).link?.searchParams.get('token') as string;
		const olu = await signedIn('olu@example.com');
		const tried = await olu.registerPasskey(new SoftAuthenticator({ origin: ORIGIN }), {
			context: `recover:${token}`,
			createSession: true,
		});
		expect(tried.options.body).toMatchObject({ code: 'SIGN_OUT_FIRST' });
	});

	it("P3-E18: a fault after afterVerification leaves the person's sessions and the token untouched; the same link then succeeds", async () => {
		await signedIn('fay@example.com');
		const held = sessionsOf('fay@example.com');
		const token = (await request('fay@example.com')).link?.searchParams.get('token') as string;
		database.exec(
			"CREATE TRIGGER loam_fault BEFORE INSERT ON passkey BEGIN SELECT RAISE(ABORT, 'injected'); END;"
		);
		try {
			const failed = await browser().registerPasskey(new SoftAuthenticator({ origin: ORIGIN }), {
				context: `recover:${token}`,
				createSession: true,
			});
			expect(failed.verified?.status).toBeGreaterThanOrEqual(400);
		} finally {
			database.exec('DROP TRIGGER loam_fault;');
		}
		expect(sessionsOf('fay@example.com')).toBe(held);
		const user = database
			.prepare('SELECT recoveredAt FROM user WHERE email = ?')
			.get('fay@example.com') as { recoveredAt: unknown };
		expect(user.recoveredAt ?? null).toBeNull();
		const retried = await browser().registerPasskey(new SoftAuthenticator({ origin: ORIGIN }), {
			context: `recover:${token}`,
			createSession: true,
		});
		expect(retried.verified?.status).toBe(200);
		expect(sessionsOf('fay@example.com')).toBe(1);
	});

	it('P3-E18: with passwords allowed, the recovery page may set a new password, through the same transaction', async () => {
		const stale = await signedIn('eli@example.com');
		const token = (await request('eli@example.com')).link?.searchParams.get('token') as string;
		const NEW = 'a brand new passphrase';
		const page = browser();
		expect(
			(await page.call('/loam/recover/password', { body: { token, password: NEW } })).status
		).toBe(200);
		expect((await stale.call('/loam/whoami')).body).toBeNull();
		expect((await browser().signIn('eli@example.com', PASSWORD)).status).toBe(401);
		expect((await browser().signIn('eli@example.com', NEW)).status).toBe(200);
		expect(
			(await browser().call('/loam/recover/password', { body: { token, password: NEW } })).body
		).toMatchObject({
			code: 'RECOVERY_LINK_INVALID',
		});
	});

	it("P3-E18: Better Auth's own password-reset and change-email routes answer 404", async () => {
		const olu = browser();
		for (const path of [
			'/request-password-reset',
			'/reset-password',
			'/forget-password/email-otp',
			'/change-email',
		]) {
			expect((await olu.call(path, { body: { email: 'olu@example.com' } })).status).toBe(404);
		}
		expect((await olu.call('/reset-password/some-token')).status).toBe(404);
	});

	it("P3-E18: no route lets anyone start another person's recovery: the links go only to the account's own verified address", async () => {
		const context = await provider.auth.$context;
		const routes = Object.values(provider.auth.api as Record<string, { path?: string }>)
			.map((endpoint) => endpoint.path)
			.filter(
				(path): path is string => typeof path === 'string' && /recover|reset|restore/.test(path)
			)
			.sort();
		expect(routes).toEqual([
			'/loam/recover/check',
			'/loam/recover/oidc/complete',
			'/loam/recover/oidc/start',
			'/loam/recover/password',
			'/loam/recover/request',
			'/request-password-reset',
			'/reset-password',
			'/reset-password/:token',
		]);
		// An owner asking for a member's recovery learns nothing, and the link goes to the member.
		const olu = await signedIn('olu@example.com');
		const before = sent.length;
		const answer = await olu.call('/loam/recover/request', { body: { email: 'cy@example.com' } });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(answer.body).toEqual({ sent: true });
		expect(sent.slice(before).map((message) => message.to)).toEqual(['cy@example.com']);
		expect(context.options.disabledPaths).toEqual(
			expect.arrayContaining([
				'/request-password-reset',
				'/reset-password',
				'/reset-password/:token',
			])
		);
	});
});

describe('P3-E18: recovery by single sign-on, an explicit ceremony (5.7, 5.8)', () => {
	let key: SoftAuthenticator;

	beforeAll(async () => {
		// Cy links the deployer's single sign-on, then adds a passkey from a fresh password session.
		const linked = browser();
		expect((await oidcSignIn(linked, 'cy@example.com')).status).toBe(302);
		const cy = await signedIn('cy@example.com');
		key = new SoftAuthenticator({ origin: ORIGIN });
		expect((await cy.registerPasskey(key)).verified?.status).toBe(200);
	});

	it("P3-E18: a person's account reports how they could recover: by single sign-on, by email, or not at all", async () => {
		expect((await (await signedIn('cy@example.com')).call('/loam/account')).body?.recovery).toBe(
			'oidc'
		);
		expect((await (await signedIn('dee@example.com')).call('/loam/account')).body?.recovery).toBe(
			'email'
		);
	});

	it('P3-E18: an ordinary fresh single sign-on session of a passkey holder may not register a passkey', async () => {
		const page = browser();
		expect((await oidcSignIn(page, 'cy@example.com')).status).toBe(302);
		expect((await page.call('/passkey/generate-register-options')).body).toMatchObject({
			code: 'REAUTH_REQUIRED',
		});
	});

	it('P3-E18: the ceremony runs the whole recovery transaction and lets its session register a passkey for a holder', async () => {
		const other = await signedIn('cy@example.com');
		const page = await signedIn('cy@example.com');
		const start = await page.call('/loam/recover/oidc/start', { body: { provider: 'corp' } });
		expect(start.body).toMatchObject({
			provider: 'corp',
			callbackURL: `${ORIGIN}/~/recover?via=oidc`,
		});
		// Any session in this browser is signed out first.
		expect(page.session).toBeUndefined();
		expect((await oidcSignIn(page, 'cy@example.com')).status).toBe(302);
		const before = sent.length;
		expect((await page.call('/loam/recover/oidc/complete', { body: {} })).body).toEqual({
			recovered: true,
		});
		expect(sessionsOf('cy@example.com')).toBe(1);
		expect((await other.call('/loam/whoami')).body).toBeNull();
		expect(sent.slice(before).some((message) => /was restored/.test(message.text))).toBe(true);
		expect(
			(await page.registerPasskey(new SoftAuthenticator({ origin: ORIGIN }))).verified?.status
		).toBe(200);
		// The nonce is spent.
		expect((await page.call('/loam/recover/oidc/complete', { body: {} })).body).toMatchObject({
			code: 'REAUTH_REQUIRED',
		});
	});

	it('P3-E18: complete refuses a call with no start, a passkey or password session, a session older than 300 s, and an unverified email', async () => {
		// No start: no nonce.
		const none = browser();
		expect((await oidcSignIn(none, 'cy@example.com')).status).toBe(302);
		expect((await none.call('/loam/recover/oidc/complete', { body: {} })).body).toMatchObject({
			code: 'REAUTH_REQUIRED',
		});
		// A passkey session after the start.
		const passkey = browser();
		await passkey.call('/loam/recover/oidc/start', { body: { provider: 'corp' } });
		expect((await passkey.signInWithPasskey(key)).status).toBe(200);
		expect((await passkey.call('/loam/recover/oidc/complete', { body: {} })).status).toBe(401);
		// A password session after the start.
		const password = browser();
		await password.call('/loam/recover/oidc/start', { body: { provider: 'corp' } });
		expect((await password.signIn('cy@example.com', PASSWORD)).status).toBe(200);
		expect((await password.call('/loam/recover/oidc/complete', { body: {} })).status).toBe(401);
		// A session made more than 300 s ago (its row moved back, and the nonce with it).
		const stale = browser();
		await stale.call('/loam/recover/oidc/start', { body: { provider: 'corp' } });
		expect((await oidcSignIn(stale, 'cy@example.com')).status).toBe(302);
		database
			.prepare('UPDATE loam_recovery_nonce SET createdAt = ?')
			.run(new Date(Date.now() - 400_000).toISOString());
		database
			.prepare('UPDATE session SET createdAt = ? WHERE userId = ?')
			.run(new Date(Date.now() - 301_000).toISOString(), idOf('cy@example.com'));
		expect((await stale.call('/loam/recover/oidc/complete', { body: {} })).status).toBe(401);
		// The provider reports the email unverified, or another email, for the same person.
		const unverified = browser();
		await unverified.call('/loam/recover/oidc/start', { body: { provider: 'corp' } });
		expect((await oidcSignIn(unverified, 'cy@example.com', false)).status).toBe(302);
		expect((await unverified.call('/loam/recover/oidc/complete', { body: {} })).status).toBe(401);
		const differing = browser();
		await differing.call('/loam/recover/oidc/start', { body: { provider: 'corp' } });
		oidc.as({ sub: 'sub-cy@example.com', email: 'cy.other@example.com' });
		const started = await differing.call('/sign-in/social', {
			body: { provider: 'corp', callbackURL: `${ORIGIN}/~/recover?via=oidc` },
		});
		const authorize = await fetch(started.body?.url as string, { redirect: 'manual' });
		await differing.fetch(authorize.headers.get('location') as string);
		expect((await differing.call('/loam/recover/oidc/complete', { body: {} })).status).toBe(401);
	});

	it('P3-E17: a single sign-on whose email is not verified creates no user and links nothing', async () => {
		const page = browser();
		const back = await oidcSignIn(page, 'stranger@example.com', false);
		expect(back.status).toBe(302);
		expect(page.session).toBeUndefined();
		expect(
			database.prepare('SELECT * FROM user WHERE email = ?').get('stranger@example.com')
		).toBeUndefined();
		const unverifiedLink = browser();
		await oidcSignIn(unverifiedLink, 'dee@example.com', false);
		expect(
			database
				.prepare("SELECT count(*) AS n FROM account WHERE userId = ? AND providerId = 'corp'")
				.get(idOf('dee@example.com'))
		).toEqual({ n: 0 });
	});
});
