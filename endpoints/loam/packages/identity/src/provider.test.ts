/**
 * The provider, through a test-only auth host (phase 3 specification, 2.3, 2.4, 4.2, 7.1 and 7.5): a real
 * Better Auth 1.7.18 server from `createLoamAuthOptions`, called directly as a person could call it, around
 * Loam's commands. It proves the provider's rules, not the hosted lane (2.4).
 */

import { hashPassword } from 'better-auth/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestAuthHost, type TestAuthHost } from './testing/index.js';

const PASSWORD = 'correct horse battery staple';
let host: TestAuthHost;

beforeAll(async () => {
	host = await startTestAuthHost({
		organization: { slug: 'acme', name: 'Acme' },
		people: [
			{ email: 'olu@example.com', role: 'owner', password: PASSWORD },
			{ email: 'ada@example.com', role: 'admin', password: PASSWORD },
			{ email: 'bea@example.com', role: 'member', password: PASSWORD },
			{ email: 'cy@example.com', role: 'member', password: PASSWORD },
			{ email: 'caro@example.com', role: null, password: PASSWORD },
		],
	});
});
afterAll(() => host?.close());

/** A request as a browser on the deployment's origin makes it. */
async function call(
	path: string,
	options: { cookie?: string; body?: unknown; method?: string } = {}
): Promise<{ status: number; body: Record<string, unknown> | null; cookie: string }> {
	const response = await fetch(`${host.baseURL.replace(host.origin, host.listening)}${path}`, {
		method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
		headers: {
			origin: host.origin,
			...(options.cookie ? { cookie: options.cookie } : {}),
			...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
		},
		...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
	});
	const text = await response.text();
	const cookie = response.headers
		.getSetCookie()
		.map((line) => line.split(';')[0])
		.join('; ');
	// A disabled route answers 404 in plain text.
	const json = response.headers.get('content-type')?.includes('json');
	return { status: response.status, body: text && json ? JSON.parse(text) : null, cookie };
}

const sessions = new Map<string, string>();
async function signIn(email: string): Promise<string> {
	const held = sessions.get(email);
	if (held) return held;
	const signed = await call('/sign-in/email', { body: { email, password: PASSWORD } });
	expect(signed.status, JSON.stringify(signed.body)).toBe(200);
	sessions.set(email, signed.cookie);
	return signed.cookie;
}

const memberId = (email: string): string =>
	(
		host
			.db()
			.prepare('SELECT id FROM member WHERE userId = ? AND organizationId = ?')
			.get(host.people[email] as string, host.organizationId) as { id: string }
	).id;
const codeOf = (answer: { body: Record<string, unknown> | null }) => answer.body?.code;

describe('whoami (4.2)', () => {
	it('answers the session and the membership of the bound organization, or null signed out', async () => {
		expect((await call('/loam/whoami')).body).toBeNull();
		const bea = await call('/loam/whoami', { cookie: await signIn('bea@example.com') });
		expect(bea.status).toBe(200);
		expect(bea.body).toMatchObject({
			session: { id: expect.any(String) },
			user: { id: host.people['bea@example.com'], email: 'bea@example.com' },
			membership: {
				organization: { id: host.organizationId, slug: 'acme', name: 'Acme' },
				role: 'member',
				digest: expect.stringMatching(/^[0-9a-f]{64}$/),
			},
		});
		// No token, no secret: only ids, a name and an email.
		expect(JSON.stringify(bea.body)).not.toMatch(/token|password|secret/i);
		const caro = await call('/loam/whoami', { cookie: await signIn('caro@example.com') });
		expect(caro.body).toMatchObject({ user: { email: 'caro@example.com' }, membership: null });
		const olu = await call('/loam/whoami', { cookie: await signIn('olu@example.com') });
		const membership = (answer: typeof olu) =>
			answer.body?.membership as { role: string; digest: string };
		expect(membership(olu).role).toBe('owner');
		expect(membership(olu).digest).not.toBe(membership(bea).digest);
	});

	it('serves the binding to an owner and to no one else', async () => {
		const owner = await call('/loam/binding', { cookie: await signIn('ada@example.com') });
		expect(owner.status).toBe(200);
		expect(owner.body).toMatchObject({
			binding: { workspace: 'personal', organizationId: host.organizationId },
			organization: { slug: 'acme' },
		});
		expect(owner.body?.warning).toBeUndefined();
		const member = await call('/loam/binding', { cookie: await signIn('bea@example.com') });
		expect([member.status, codeOf(member)]).toEqual([403, 'OWNER_REQUIRED']);
		expect((await call('/loam/binding')).status).toBe(401);
	});
});

describe("P3-E6: owners and the provider's own endpoints (step 1)", () => {
	it('refuses an admin granting, changing or removing the owner role: OWNER_REQUIRED', async () => {
		const ada = await signIn('ada@example.com');
		const promote = await call('/organization/update-member-role', {
			cookie: ada,
			body: {
				organizationId: host.organizationId,
				memberId: memberId('bea@example.com'),
				role: 'owner',
			},
		});
		expect([promote.status, codeOf(promote)]).toEqual([403, 'OWNER_REQUIRED']);
		const demote = await call('/organization/update-member-role', {
			cookie: ada,
			body: {
				organizationId: host.organizationId,
				memberId: memberId('olu@example.com'),
				role: 'member',
			},
		});
		expect(codeOf(demote)).toBe('OWNER_REQUIRED');
		const remove = await call('/organization/remove-member', {
			cookie: ada,
			body: { organizationId: host.organizationId, memberIdOrEmail: 'olu@example.com' },
		});
		expect(codeOf(remove)).toBe('OWNER_REQUIRED');
		// An admin holds every member power an owner holds otherwise (D96).
		const member = await call('/organization/update-member-role', {
			cookie: ada,
			body: {
				organizationId: host.organizationId,
				memberId: memberId('cy@example.com'),
				role: 'admin',
			},
		});
		expect(member.status, JSON.stringify(member.body)).toBe(200);
		const back = await call('/organization/update-member-role', {
			cookie: ada,
			body: {
				organizationId: host.organizationId,
				memberId: memberId('cy@example.com'),
				role: 'member',
			},
		});
		expect(back.status).toBe(200);
		// And an admin cannot invite an owner.
		const invite = await call('/organization/invite-member', {
			cookie: ada,
			body: { organizationId: host.organizationId, email: 'new@example.com', role: 'owner' },
		});
		expect(invite.status).toBe(403);
	});

	it("refuses demoting or removing the last owner, and a member's role change", async () => {
		const olu = await signIn('olu@example.com');
		const self = await call('/organization/update-member-role', {
			cookie: olu,
			body: {
				organizationId: host.organizationId,
				memberId: memberId('olu@example.com'),
				role: 'admin',
			},
		});
		expect(self.status).toBe(400);
		expect(['MEMBER_LAST_OWNER', 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER']).toContain(
			codeOf(self)
		);
		const leave = await call('/organization/leave', {
			cookie: olu,
			body: { organizationId: host.organizationId },
		});
		expect(leave.status).toBe(400);
		const member = await call('/organization/update-member-role', {
			cookie: await signIn('bea@example.com'),
			body: {
				organizationId: host.organizationId,
				memberId: memberId('cy@example.com'),
				role: 'admin',
			},
		});
		expect(member.status).toBe(403);
	});

	it('makes no member but by invitation, and no organization, and never sets the active one', async () => {
		const created = await call('/organization/create', {
			cookie: await signIn('olu@example.com'),
			body: { name: 'Other', slug: 'other' },
		});
		expect(created.status).toBe(403);
		const active = await call('/organization/set-active', {
			cookie: await signIn('olu@example.com'),
			body: { organizationId: host.organizationId },
		});
		expect(active.status).toBe(404);
		// No open sign-up.
		const signUp = await call('/sign-up/email', {
			body: { email: 'stranger@example.com', password: PASSWORD, name: 'Stranger' },
		});
		expect(signUp.status).toBeGreaterThanOrEqual(400);
		expect(
			host
				.db()
				.prepare('SELECT count(*) AS n FROM user WHERE email = ?')
				.get('stranger@example.com')
		).toEqual({ n: 0 });
	});

	it("revokes a removed person's sessions at once", async () => {
		const cy = await signIn('cy@example.com');
		expect((await call('/loam/whoami', { cookie: cy })).body).not.toBeNull();
		const removed = await call('/organization/remove-member', {
			cookie: await signIn('olu@example.com'),
			body: { organizationId: host.organizationId, memberIdOrEmail: 'cy@example.com' },
		});
		expect(removed.status, JSON.stringify(removed.body)).toBe(200);
		expect((await call('/loam/whoami', { cookie: cy })).body).toBeNull();
		expect(
			host
				.db()
				.prepare('SELECT count(*) AS n FROM session WHERE userId = ?')
				.get(host.people['cy@example.com'] as string)
		).toEqual({ n: 0 });
	});
});

describe("P3-E19: a re-created organization grants nothing (step 1's units)", () => {
	it("refuses changing the bound organization's slug or deleting it", async () => {
		const olu = await signIn('olu@example.com');
		const renamed = await call('/organization/update', {
			cookie: olu,
			body: { organizationId: host.organizationId, data: { slug: 'acme-two', name: 'Acme Two' } },
		});
		expect(renamed.status).toBe(403);
		const deleted = await call('/organization/delete', {
			cookie: olu,
			body: { organizationId: host.organizationId },
		});
		expect(deleted.status).toBeGreaterThanOrEqual(400);
		expect(
			host.db().prepare('SELECT slug, name FROM organization WHERE id = ?').get(host.organizationId)
		).toEqual({ slug: 'acme', name: 'Acme' });
	});

	it("gives the bound slug's new organization, and its members, nothing; and reports the mismatch", async () => {
		const write = host.db({ writable: true });
		const now = Date.now();
		// A provider-side change that bypassed every hook: the bound organization re-slugged, and a new one
		// created with the bound slug, its owner a person with an account.
		write
			.prepare('UPDATE organization SET slug = ? WHERE id = ?')
			.run('acme-old', host.organizationId);
		write
			.prepare('INSERT INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)')
			.run('org_impostor', 'Acme', 'acme', now);
		write
			.prepare(
				'INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)'
			)
			.run('usr_zed', 'Zed', 'zed@example.com', now, now);
		write
			.prepare(
				'INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
			)
			.run('acc_zed', 'usr_zed', 'credential', 'usr_zed', await hashPassword(PASSWORD), now, now);
		write
			.prepare(
				'INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)'
			)
			.run('mem_zed', 'org_impostor', 'usr_zed', 'owner', now);
		const zed = await signIn('zed@example.com');
		const who = await call('/loam/whoami', { cookie: zed });
		expect(who.body).toMatchObject({ user: { id: 'usr_zed' }, membership: null });
		expect((await call('/loam/binding', { cookie: zed })).status).toBe(403);
		// The bound organization's members stay its members, by its id.
		const bea = await call('/loam/whoami', { cookie: await signIn('bea@example.com') });
		expect(bea.body?.membership).toMatchObject({
			organization: { id: host.organizationId, slug: 'acme-old' },
		});
		const status = await call('/loam/binding', { cookie: await signIn('olu@example.com') });
		expect(status.body).toMatchObject({
			binding: { organizationId: host.organizationId },
			organization: { slug: 'acme-old' },
			warning: 'IDENTITY_BINDING_MISMATCH',
		});
	});
});
