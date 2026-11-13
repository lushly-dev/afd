/**
 * Sessions at the provider (phase 3 specification, 4.3, 4.6, 5.2 and 5.8), in this process through Better Auth's own
 * handler, so coverage sees what the test-only auth host's child runs: a real Better Auth 1.7.18 provider from
 * `createLoamAuthOptions`, called directly as a person could call it, around Loam's commands. The same endpoints over
 * HTTP, behind the shell's origin, are E1's and E3's Chromium scenarios (`web/test/browser/identity`).
 */

import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deviceLabel, methodOfPath, sessionHandle } from './sessions.js';
import { createTestProvider } from './testing/provider.js';

const ORIGIN = 'https://acme.example';
const PASSWORD = 'correct horse battery staple';
const database = new DatabaseSync(':memory:');
let provider: Awaited<ReturnType<typeof createTestProvider>>;

beforeAll(async () => {
	provider = await createTestProvider({
		baseURL: `${ORIGIN}/api/auth`,
		secret: 'y'.repeat(32),
		database,
		workspace: 'acme',
		organization: { slug: 'acme', name: 'Acme' },
		people: [
			{ email: 'olu@example.com', role: 'owner', password: PASSWORD },
			{ email: 'bea@example.com', role: 'member', password: PASSWORD },
			{ email: 'dee@example.com', role: 'member', password: PASSWORD },
			{ email: 'eli@example.com', role: 'member', password: PASSWORD },
			{ email: 'fay@example.com', role: 'member', password: PASSWORD },
		],
		methods: ['passkey', 'password'],
		send: async () => {},
	});
});
afterAll(() => database.close());

interface Answer {
	status: number;
	body: Record<string, unknown> | null;
	cookie: string;
}

/** A request as a browser on the deployment's origin makes it. */
async function call(
	path: string,
	options: { cookie?: string; body?: unknown; agent?: string } = {}
): Promise<Answer> {
	const response = await provider.auth.handler(
		new Request(`${ORIGIN}/api/auth${path}`, {
			method: options.body === undefined ? 'GET' : 'POST',
			headers: {
				origin: ORIGIN,
				...(options.agent ? { 'user-agent': options.agent } : {}),
				...(options.cookie ? { cookie: options.cookie } : {}),
				...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
			},
			...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
		})
	);
	const text = await response.text();
	const cookie = response.headers
		.getSetCookie()
		.map((line) => line.split(';')[0])
		.join('; ');
	const json = response.headers.get('content-type')?.includes('json');
	return { status: response.status, body: text && json ? JSON.parse(text) : null, cookie };
}

const MAC_CHROME =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

/** A new password session for `email`: its cookie. */
async function signIn(email: string, agent?: string): Promise<string> {
	const signed = await call('/sign-in/email', {
		body: { email, password: PASSWORD },
		...(agent ? { agent } : {}),
	});
	expect(signed.status, JSON.stringify(signed.body)).toBe(200);
	return signed.cookie;
}

/** The session row a cookie names, read from the provider's database. */
function rowOf(cookie: string): { id: string; token: string; loamMethod: string | null } {
	const token =
		decodeURIComponent(/session_token=([^;]+)/.exec(cookie)?.[1] ?? '').split('.')[0] ?? '';
	return database
		.prepare('SELECT id, token, loamMethod FROM session WHERE token = ?')
		.get(token) as {
		id: string;
		token: string;
		loamMethod: string | null;
	};
}

/** Make a session older than `freshAge`, as if it was made six minutes ago. */
function age(cookie: string, seconds = 360): void {
	const { id } = rowOf(cookie);
	database
		.prepare('UPDATE session SET createdAt = ? WHERE id = ?')
		.run(new Date(Date.now() - seconds * 1_000).toISOString(), id);
}

/** Give a person a passkey row, as a registration would have stored one. */
function holdPasskey(email: string): void {
	database
		.prepare(
			'INSERT INTO passkey (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, transports, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?)'
		)
		.run(
			randomUUID(),
			'Laptop',
			'AAAA',
			provider.people[email] as string,
			randomUUID(),
			'singleDevice',
			'internal',
			new Date().toISOString()
		);
}

const codeOf = (answer: Answer) => answer.body?.code;

describe('P3-E3: sessions at the provider (4.3, 4.6)', () => {
	it('records how each session was made', async () => {
		expect(rowOf(await signIn('bea@example.com')).loamMethod).toBe('password');
		expect(methodOfPath('/passkey/verify-authentication')).toBe('passkey');
		expect(methodOfPath('/oauth2/callback/corp')).toBe('oidc');
		expect(methodOfPath('/sign-up/email')).toBeUndefined();
	});

	it('lists sessions by handle, never by token, with this one current, and past freshAge', async () => {
		const laptop = await signIn('bea@example.com', MAC_CHROME);
		const phone = await signIn('bea@example.com');
		// `session-list` succeeds 301 s after sign-in: Loam's endpoint needs a session, not a fresh one (E3).
		age(laptop, 301);
		const listed = await call('/loam/sessions', { cookie: laptop });
		expect(listed.status, JSON.stringify(listed.body)).toBe(200);
		const rows = listed.body?.sessions as Array<Record<string, unknown>>;
		const mine = rows.find((row) => row.handle === sessionHandle(rowOf(laptop).token));
		expect(mine).toMatchObject({ current: true, device: 'Chrome on macOS' });
		expect(rows.find((row) => row.handle === sessionHandle(rowOf(phone).token))).toMatchObject({
			current: false,
		});
		for (const row of rows) expect(row.handle).toMatch(/^[0-9a-f]{16}$/);
		const text = JSON.stringify(listed.body);
		expect(text).not.toContain(rowOf(laptop).token);
		expect(text).not.toContain(rowOf(phone).token);
		expect(text).not.toMatch(/ipAddress|token/);
		// Signed out: refused.
		expect((await call('/loam/sessions')).status).toBe(401);
	});

	it('revokes another session by its handle, which the provider refuses at once (cookie cache off)', async () => {
		const here = await signIn('dee@example.com');
		const there = await signIn('dee@example.com');
		expect((await call('/loam/whoami', { cookie: there })).body).not.toBeNull();
		const revoked = await call('/loam/revoke-person', {
			cookie: here,
			body: { target: sessionHandle(rowOf(there).token) },
		});
		expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
		expect(revoked.body).toEqual({ revoked: 1, signedOut: false });
		expect((await call('/loam/whoami', { cookie: there })).body).toBeNull();
		expect((await call('/loam/whoami', { cookie: here })).body).not.toBeNull();
		// Another person's handle, or one that never was, is not found.
		const unknown = await call('/loam/revoke-person', {
			cookie: here,
			body: { target: '0123456789abcdef' },
		});
		expect(unknown.status).toBe(404);
		expect(codeOf(unknown)).toBe('SESSION_NOT_FOUND');
		const other = await signIn('eli@example.com');
		expect(
			codeOf(
				await call('/loam/revoke-person', {
					cookie: here,
					body: { target: sessionHandle(rowOf(other).token) },
				})
			)
		).toBe('SESSION_NOT_FOUND');
	});

	it("revokes 'others' and 'all' only from a fresh session, and 'all' signs this one out", async () => {
		const stale = await signIn('fay@example.com');
		const fresh = await signIn('fay@example.com');
		age(stale);
		const refused = await call('/loam/revoke-person', {
			cookie: stale,
			body: { target: 'others' },
		});
		expect(refused.status).toBe(401);
		expect(codeOf(refused)).toBe('REAUTH_REQUIRED');
		const others = await call('/loam/revoke-person', { cookie: fresh, body: { target: 'others' } });
		expect(others.body).toEqual({ revoked: 1, signedOut: false });
		expect((await call('/loam/whoami', { cookie: stale })).body).toBeNull();
		const third = await signIn('fay@example.com');
		const all = await call('/loam/revoke-person', { cookie: fresh, body: { target: 'all' } });
		expect(all.body).toEqual({ revoked: 2, signedOut: true });
		expect((await call('/loam/whoami', { cookie: fresh })).body).toBeNull();
		expect((await call('/loam/whoami', { cookie: third })).body).toBeNull();
	});
});

describe('P3-E1: 5.8 at the provider, by direct requests (D99)', () => {
	it('refuses a passkey registration, a removal or a revocation of others from a stale session', async () => {
		const stale = await signIn('bea@example.com');
		const other = await signIn('bea@example.com');
		age(stale);
		for (const [path, body] of [
			['/passkey/generate-register-options', undefined],
			['/passkey/delete-passkey', { id: 'none' }],
			['/loam/revoke-person', { target: 'others' }],
			['/loam/revoke-person', { target: 'all' }],
			// One handle at a time is no way around `others` (the review of step 3's B1).
			['/loam/revoke-person', { target: sessionHandle(rowOf(other).token) }],
		] as const) {
			const answer = await call(path, { cookie: stale, ...(body ? { body } : {}) });
			expect(answer.status, `${path} ${JSON.stringify(body)}`).toBe(401);
			expect(codeOf(answer), `${path} ${JSON.stringify(body)}`).toBe('REAUTH_REQUIRED');
		}
		expect((await call('/loam/whoami', { cookie: other })).body).not.toBeNull();
		// Its own session, by its own handle, is a sign-out, which needs nothing.
		const own = await call('/loam/revoke-person', {
			cookie: stale,
			body: { target: sessionHandle(rowOf(stale).token) },
		});
		expect(own.body).toEqual({ revoked: 1, signedOut: true });
	});

	it('refuses a password session of a person who holds a passkey, however fresh', async () => {
		holdPasskey('olu@example.com');
		const fresh = await signIn('olu@example.com');
		const other = await signIn('olu@example.com');
		const registration = await call('/passkey/generate-register-options', { cookie: fresh });
		expect(codeOf(registration)).toBe('REAUTH_REQUIRED');
		for (const target of ['others', sessionHandle(rowOf(other).token)]) {
			const answer = await call('/loam/revoke-person', { cookie: fresh, body: { target } });
			expect(codeOf(answer), target).toBe('REAUTH_REQUIRED');
		}
	});

	it("serves none of Better Auth's own session and credential routes, which would skip D99 or answer tokens", async () => {
		holdPasskey('fay@example.com');
		const fresh = await signIn('fay@example.com');
		const victim = await signIn('fay@example.com');
		for (const [path, body] of [
			['/list-sessions', undefined],
			['/revoke-session', { token: rowOf(victim).token }],
			['/revoke-sessions', {}],
			['/revoke-other-sessions', {}],
			['/update-session', { loamMethod: 'passkey' }],
			['/get-access-token', { providerId: 'corp' }],
			['/refresh-token', { providerId: 'corp' }],
			['/account-info', undefined],
			['/list-accounts', undefined],
			['/link-social', { provider: 'corp' }],
			['/unlink-account', { providerId: 'credential' }],
			['/change-password', { currentPassword: PASSWORD, newPassword: `${PASSWORD}!` }],
			['/verify-password', { password: PASSWORD }],
			['/delete-user', {}],
			['/sign-up/email', { email: 'new@example.com', password: PASSWORD, name: 'New' }],
		] as const) {
			const answer = await call(path, { cookie: fresh, ...(body ? { body } : {}) });
			expect(answer.status, path).toBe(404);
			expect(JSON.stringify(answer.body), path).not.toContain(rowOf(victim).token);
		}
		expect((await call('/loam/whoami', { cookie: victim })).body).not.toBeNull();
		expect(rowOf(fresh).loamMethod).toBe('password');
	});

	it("refuses a cookie's request from another origin, whatever NODE_ENV says (CSRF)", async () => {
		const here = await signIn('dee@example.com');
		const answer = await provider.auth.handler(
			new Request(`${ORIGIN}/api/auth/loam/revoke-person`, {
				method: 'POST',
				headers: {
					origin: 'https://evil.example',
					cookie: here,
					'content-type': 'application/json',
				},
				body: JSON.stringify({ target: 'all' }),
			})
		);
		expect(answer.status).toBe(403);
		expect((await call('/loam/whoami', { cookie: here })).body).not.toBeNull();
	});

	it("lets a fresh password session of a person with no passkey yet start their first one's registration", async () => {
		const fresh = await signIn('eli@example.com');
		const options = await call('/passkey/generate-register-options', { cookie: fresh });
		expect(options.status, JSON.stringify(options.body)).toBe(200);
		expect(options.body).toMatchObject({
			challenge: expect.any(String),
			authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
		});
	});

	it('refuses a join or recovery registration with a session present, SIGN_OUT_FIRST', async () => {
		const fresh = await signIn('eli@example.com');
		const answer = await call('/passkey/generate-register-options?context=join%3Ax.y', {
			cookie: fresh,
		});
		expect(answer.status).toBe(400);
		expect(codeOf(answer)).toBe('SIGN_OUT_FIRST');
	});
});

describe('whoami: the binding notice (2.3, 15)', () => {
	it('tells an owner, and no one else, that the deployment slug no longer names the bound organization', async () => {
		const owner = await signIn('olu@example.com');
		const member = await signIn('bea@example.com');
		expect((await call('/loam/whoami', { cookie: owner })).body?.warning).toBeUndefined();
		database
			.prepare('UPDATE organization SET slug = ? WHERE id = ?')
			.run('acme-2', provider.organizationId);
		try {
			expect((await call('/loam/whoami', { cookie: owner })).body?.warning).toBe(
				'IDENTITY_BINDING_MISMATCH'
			);
			expect((await call('/loam/whoami', { cookie: member })).body?.warning).toBeUndefined();
		} finally {
			database
				.prepare('UPDATE organization SET slug = ? WHERE id = ?')
				.run('acme', provider.organizationId);
		}
	});
});

describe('device labels (4.1)', () => {
	it('names a browser and a platform, never an address', () => {
		expect(deviceLabel(MAC_CHROME)).toBe('Chrome on macOS');
		expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Firefox/140.0')).toBe(
			'Firefox on Windows'
		);
		expect(deviceLabel('curl/8')).toBe('Another device');
		expect(deviceLabel(undefined)).toBeNull();
	});
});
