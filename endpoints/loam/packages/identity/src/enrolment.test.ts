/**
 * P3-E17's units (phase 3 specification, 5.6, 5.8 and 18): enrolment by invitation only, at the provider, by direct
 * requests against a real Better Auth 1.7.18 provider from `createLoamAuthOptions`, in this process, as a person could
 * make them around Loam's commands. Passkeys come from a software authenticator (`testing/webauthn.ts`), which is not
 * a real one; the Chromium scenario uses Chromium's virtual authenticator.
 */

import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JOIN_MODEL } from './enrolment.js';
import type { LoamMailV1 } from './options.js';
import { createTestProvider } from './testing/provider.js';
import { linkIn, TestBrowser } from './testing/requests.js';
import { SoftAuthenticator } from './testing/webauthn.js';

const ORIGIN = 'https://acme.example';
const PASSWORD = 'correct horse battery staple';
const database = new DatabaseSync(':memory:');
const sent: LoamMailV1[] = [];
let provider: Awaited<ReturnType<typeof createTestProvider>>;

beforeAll(async () => {
	provider = await createTestProvider({
		baseURL: `${ORIGIN}/api/auth`,
		secret: 'z'.repeat(32),
		database,
		workspace: 'acme',
		organization: { slug: 'acme', name: 'Acme' },
		people: [
			{ email: 'olu@example.com', role: 'owner', password: PASSWORD },
			{ email: 'ada@example.com', role: 'admin', password: PASSWORD },
			{ email: 'bea@example.com', role: 'member', password: PASSWORD },
			{ email: 'cy@example.com', role: null, password: PASSWORD },
			{ email: 'una@example.com', role: null, password: PASSWORD, emailVerified: false },
		],
		methods: ['passkey', 'password'],
		bootstrapOwner: 'first@example.com',
		send: async (message) => void sent.push(message),
	});
});
afterAll(() => database.close());

const browser = () => new TestBrowser((request) => provider.auth.handler(request), ORIGIN);

async function signedIn(email: string): Promise<TestBrowser> {
	const page = browser();
	const answer = await page.signIn(email, PASSWORD);
	expect(answer.status).toBe(200);
	return page;
}

/** An owner's invitation, through the provider's own endpoint, and the link the mail carries. */
async function invite(
	email: string,
	role = 'member'
): Promise<{ invitation: string; token: string; link: URL }> {
	const olu = await signedIn('olu@example.com');
	const made = await olu.call('/organization/invite-member', {
		body: { email, role, organizationId: provider.organizationId },
	});
	expect(made.status).toBe(200);
	const mail = sent.filter((message) => message.to === email).at(-1);
	if (!mail) throw new Error(`No mail to ${email}`);
	const link = linkIn(mail.text);
	return {
		invitation: link.searchParams.get('invitation') as string,
		token: link.searchParams.get('token') as string,
		link,
	};
}

const row = <T>(sql: string, ...values: (string | number | null)[]) =>
	database.prepare(sql).get(...values) as T | undefined;

describe('P3-E17: enrolment by invitation only, at the provider (5.6, 5.8)', () => {
	it('P3-E17: an invitation mails a join link to the shell, and the link names the invitation to its holder only', async () => {
		const { invitation, token, link } = await invite('new1@example.com');
		expect(`${link.origin}${link.pathname}`).toBe(`${ORIGIN}/~/join`);
		// Stored only as its hash.
		const stored = row<{ tokenHash: string }>(
			'SELECT tokenHash FROM loam_join WHERE invitation = ?',
			invitation
		);
		expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
		expect(stored?.tokenHash).not.toContain(token);
		const page = browser();
		const check = await page.call(`/loam/join/check?invitation=${invitation}&token=${token}`);
		expect(check.status).toBe(200);
		expect(check.body).toMatchObject({
			organization: { name: 'Acme' },
			role: 'member',
			email: 'new1@example.com',
		});
		const wrong = await page.call(
			`/loam/join/check?invitation=${invitation}&token=${'A'.repeat(43)}`
		);
		expect(wrong.body).toMatchObject({ code: 'INVITATION_NOT_FOUND' });
	});

	it('P3-E17: the invitee creates a passkey with no password and no session, and is a verified member; the link fails a second time', async () => {
		const { invitation, token } = await invite('new2@example.com');
		const page = browser();
		const key = new SoftAuthenticator({ origin: ORIGIN });
		const { verified } = await page.registerPasskey(key, {
			context: `join:${invitation}.${token}`,
			createSession: true,
		});
		expect(verified?.status).toBe(200);
		const user = row<{ id: string; emailVerified: number }>(
			'SELECT id, emailVerified FROM user WHERE email = ?',
			'new2@example.com'
		);
		expect(user?.emailVerified).toBe(1);
		expect(row('SELECT * FROM account WHERE userId = ?', user?.id as string)).toBeUndefined();
		expect(
			row<{ role: string }>('SELECT role FROM member WHERE userId = ?', user?.id as string)?.role
		).toBe('member');
		expect(
			row<{ status: string }>('SELECT status FROM invitation WHERE id = ?', invitation)?.status
		).toBe('accepted');
		// Signed in by the ceremony that made the passkey: a passkey session, which whoami names a member.
		const whoami = await page.call('/loam/whoami');
		expect(whoami.body).toMatchObject({ user: { id: user?.id }, membership: { role: 'member' } });
		expect(
			row<{ loamMethod: string }>(
				'SELECT loamMethod FROM session WHERE userId = ?',
				user?.id as string
			)?.loamMethod
		).toBe('passkey');
		// A second time, from a new browser.
		const again = await browser().registerPasskey(new SoftAuthenticator({ origin: ORIGIN }), {
			context: `join:${invitation}.${token}`,
			createSession: true,
		});
		expect(again.options.body).toMatchObject({ code: 'INVITATION_NOT_FOUND' });
	});

	it('P3-E17: generating options consumes nothing, and a join verification without createSession is refused before any write', async () => {
		const { invitation, token } = await invite('new3@example.com');
		const page = browser();
		const key = new SoftAuthenticator({ origin: ORIGIN });
		const half = await page.registerPasskey(key, { context: `join:${invitation}.${token}` });
		expect(half.options.status).toBe(200);
		expect(half.verified?.status).toBe(400);
		expect(row('SELECT * FROM user WHERE email = ?', 'new3@example.com')).toBeUndefined();
		const stored = row<{ consumedAt: unknown }>(
			'SELECT consumedAt FROM loam_join WHERE invitation = ?',
			invitation
		);
		expect(stored?.consumedAt ?? null).toBeNull();
		expect(
			(await page.call(`/loam/join/check?invitation=${invitation}&token=${token}`)).status
		).toBe(200);
	});

	it('P3-E17: a fault after afterVerification leaves no user, the invitation pending and the token unconsumed; the same link then succeeds', async () => {
		const { invitation, token } = await invite('new4@example.com');
		database.exec(
			"CREATE TRIGGER loam_fault BEFORE INSERT ON passkey BEGIN SELECT RAISE(ABORT, 'injected'); END;"
		);
		try {
			const failed = await browser().registerPasskey(new SoftAuthenticator({ origin: ORIGIN }), {
				context: `join:${invitation}.${token}`,
				createSession: true,
			});
			expect(failed.verified?.status).toBeGreaterThanOrEqual(400);
		} finally {
			database.exec('DROP TRIGGER loam_fault;');
		}
		expect(row('SELECT * FROM user WHERE email = ?', 'new4@example.com')).toBeUndefined();
		expect(
			row<{ status: string }>('SELECT status FROM invitation WHERE id = ?', invitation)?.status
		).toBe('pending');
		expect(
			row<{ consumedAt: unknown }>(
				'SELECT consumedAt FROM loam_join WHERE invitation = ?',
				invitation
			)?.consumedAt ?? null
		).toBeNull();
		const retried = await browser().registerPasskey(new SoftAuthenticator({ origin: ORIGIN }), {
			context: `join:${invitation}.${token}`,
			createSession: true,
		});
		expect(retried.verified?.status).toBe(200);
		expect(row('SELECT * FROM user WHERE email = ?', 'new4@example.com')).toBeDefined();
	});

	it('P3-E17: the link fails after it expires, and after its invitation is cancelled', async () => {
		const expiring = await invite('new5@example.com');
		database
			.prepare('UPDATE loam_join SET expiresAt = ? WHERE invitation = ?')
			.run(new Date(Date.now() - 1_000).toISOString(), expiring.invitation);
		const late = await browser().call(
			`/loam/join/check?invitation=${expiring.invitation}&token=${expiring.token}`
		);
		expect(late.body).toMatchObject({ code: 'INVITATION_NOT_FOUND' });
		const cancelled = await invite('new6@example.com');
		const olu = await signedIn('olu@example.com');
		expect(
			(
				await olu.call('/organization/cancel-invitation', {
					body: { invitationId: cancelled.invitation },
				})
			).status
		).toBe(200);
		const answer = await browser().registerPasskey(new SoftAuthenticator({ origin: ORIGIN }), {
			context: `join:${cancelled.invitation}.${cancelled.token}`,
			createSession: true,
		});
		expect(answer.options.body).toMatchObject({ code: 'INVITATION_NOT_FOUND' });
	});

	it("P3-E17: a join registration with another person's session present is SIGN_OUT_FIRST, at generation and at verification", async () => {
		const { invitation, token } = await invite('new7@example.com');
		const bea = await signedIn('bea@example.com');
		const options = await bea.call(
			`/passkey/generate-register-options?context=${encodeURIComponent(`join:${invitation}.${token}`)}`
		);
		expect(options.body).toMatchObject({ code: 'SIGN_OUT_FIRST' });
		// Options made signed out, then a session appears before verification: refused before anything is written.
		const page = browser();
		const made = await page.call(
			`/passkey/generate-register-options?context=${encodeURIComponent(`join:${invitation}.${token}`)}`
		);
		expect(made.status).toBe(200);
		const signed = await page.signIn('bea@example.com', PASSWORD);
		expect(signed.status).toBe(200);
		const verified = await page.call('/passkey/verify-registration', {
			body: {
				response: new SoftAuthenticator({ origin: ORIGIN }).create(made.body as never),
				createSession: true,
			},
		});
		expect(verified.status).toBeGreaterThanOrEqual(400);
		expect(row('SELECT * FROM user WHERE email = ?', 'new7@example.com')).toBeUndefined();
	});

	it('P3-E17: a join link for an email that already has an account is ACCOUNT_EXISTS and enrols nothing', async () => {
		const { invitation, token } = await invite('cy@example.com');
		const page = browser();
		const check = await page.call(`/loam/join/check?invitation=${invitation}&token=${token}`);
		expect(check.status).toBe(409);
		expect(check.body).toMatchObject({ code: 'ACCOUNT_EXISTS' });
		const tried = await page.registerPasskey(new SoftAuthenticator({ origin: ORIGIN }), {
			context: `join:${invitation}.${token}`,
			createSession: true,
		});
		expect(tried.options.body).toMatchObject({ code: 'ACCOUNT_EXISTS' });
		expect(
			row<{ n: number }>(
				'SELECT count(*) AS n FROM passkey p JOIN user u ON u.id = p.userId WHERE u.email = ?',
				'cy@example.com'
			)?.n
		).toBe(0);
	});

	it('P3-E17: a direct sign-up is refused, and no registration runs with neither a session nor a link', async () => {
		const page = browser();
		const signUp = await page.call('/sign-up/email', {
			body: { email: 'walk-in@example.com', password: PASSWORD, name: 'Walk In' },
		});
		expect(signUp.status).toBe(404);
		const none = await page.call('/passkey/generate-register-options');
		expect(none.status).toBe(401);
		const odd = await page.call('/passkey/generate-register-options?context=other:thing');
		expect(odd.status).toBe(400);
		expect(row('SELECT * FROM user WHERE email = ?', 'walk-in@example.com')).toBeUndefined();
	});

	it('P3-E17: with passwords allowed, the join page may set a password instead, by the same checks', async () => {
		const { invitation, token } = await invite('new8@example.com', 'admin');
		const page = browser();
		const short = await page.call('/loam/join/password', {
			body: { invitation, token, password: 'short' },
		});
		expect(short.status).toBe(400);
		const joined = await page.call('/loam/join/password', {
			body: { invitation, token, password: PASSWORD },
		});
		expect(joined.status).toBe(200);
		const whoami = await page.call('/loam/whoami');
		expect(whoami.body).toMatchObject({ membership: { role: 'admin' } });
		const again = await browser().call('/loam/join/password', {
			body: { invitation, token, password: PASSWORD },
		});
		expect(again.body).toMatchObject({ code: 'INVITATION_NOT_FOUND' });
		// The session a password made is not user-verified (D99).
		const id = whoami.body?.user as { id: string };
		expect(
			row<{ loamMethod: string }>('SELECT loamMethod FROM session WHERE userId = ?', id.id)
				?.loamMethod
		).toBe('password');
	});

	it('P3-E17: accepting an invitation with an unverified email is refused', async () => {
		const { invitation } = await invite('una@example.com');
		const context = await provider.auth.$context;
		const una = row<{ id: string }>('SELECT id FROM user WHERE email = ?', 'una@example.com') as {
			id: string;
		};
		const session = await context.internalAdapter.createSession(una.id);
		const page = browser();
		page.jar.set(
			'__Secure-better-auth.session_token',
			encodeURIComponent(await signedToken(session.token, 'z'.repeat(32)))
		);
		const accepted = await page.call('/organization/accept-invitation', {
			body: { invitationId: invitation },
		});
		expect(accepted.status).toBe(403);
		expect(row('SELECT * FROM member WHERE userId = ?', una.id)).toBeUndefined();
	});

	it("P3-E17: with requireSession off, 5.8's first row still holds: a stale session, or a holder's password session, is REAUTH_REQUIRED", async () => {
		// Bea holds a passkey once she adds one from a fresh password session.
		const bea = await signedIn('bea@example.com');
		const key = new SoftAuthenticator({ origin: ORIGIN });
		expect((await bea.registerPasskey(key)).verified?.status).toBe(200);
		const password = await signedIn('bea@example.com');
		expect((await password.call('/passkey/generate-register-options')).body).toMatchObject({
			code: 'REAUTH_REQUIRED',
		});
		const passkeyed = browser();
		expect((await passkeyed.signInWithPasskey(key)).status).toBe(200);
		expect((await passkeyed.call('/passkey/generate-register-options')).status).toBe(200);
		// Stale: made more than 300 s ago.
		const stale = await signedIn('ada@example.com');
		database
			.prepare(
				"UPDATE session SET createdAt = ? WHERE userId = (SELECT id FROM user WHERE email = 'ada@example.com')"
			)
			.run(new Date(Date.now() - 301_000).toISOString());
		expect((await stale.call('/passkey/generate-register-options')).body).toMatchObject({
			code: 'REAUTH_REQUIRED',
		});
	});

	it('P3-E17: bootstrapOrganization invited the first owner, who enrols through the same join page as an owner', async () => {
		const mail = sent.find((message) => message.to === 'first@example.com');
		if (!mail) throw new Error('No mail to the first owner');
		const link = linkIn(mail.text);
		const context = `join:${link.searchParams.get('invitation')}.${link.searchParams.get('token')}`;
		expect(
			row<{ bootstrap: number }>(
				`SELECT bootstrap FROM loam_join WHERE invitation = ?`,
				link.searchParams.get('invitation')
			)?.bootstrap
		).toBe(1);
		const page = browser();
		const { verified } = await page.registerPasskey(new SoftAuthenticator({ origin: ORIGIN }), {
			context,
			createSession: true,
		});
		expect(verified?.status).toBe(200);
		expect((await page.call('/loam/whoami')).body).toMatchObject({ membership: { role: 'owner' } });
		expect(JOIN_MODEL).toBe('loamJoin');
	});
});

/** A session cookie's value as Better Auth signs it: `<token>.<base64 HMAC-SHA256>`. */
async function signedToken(token: string, secret: string): Promise<string> {
	const { createHmac } = await import('node:crypto');
	return `${token}.${createHmac('sha256', secret).update(token).digest('base64')}`;
}
