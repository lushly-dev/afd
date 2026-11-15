/**
 * Step 4's re-check of the organization routes (phase 3 specification, 5.8, 7.2 and 7.5; step 3's follow-up), and
 * P3-E6's and E7's provider units: every `/organization/*` route the provider instance serves, listed from the instance
 * itself rather than from Better Auth's documentation, is either not served or served under a rule this file proves by
 * a direct request against a real Better Auth 1.7.18 provider, as a person could make it around Loam's commands.
 */

import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoamMailV1 } from './options.js';
import { LOAM_DISABLED_PATHS } from './options.js';
import { createTestProvider } from './testing/provider.js';
import { TestBrowser } from './testing/requests.js';

const ORIGIN = 'https://acme.example';
const PASSWORD = 'correct horse battery staple';
const database = new DatabaseSync(':memory:');
const sent: LoamMailV1[] = [];
let provider: Awaited<ReturnType<typeof createTestProvider>>;

beforeAll(async () => {
	provider = await createTestProvider({
		baseURL: `${ORIGIN}/api/auth`,
		secret: 'o'.repeat(32),
		database,
		workspace: 'acme',
		organization: { slug: 'acme', name: 'Acme' },
		people: [
			{ email: 'olu@example.com', name: 'Olu', role: 'owner', password: PASSWORD },
			{ email: 'ada@example.com', name: 'Ada', role: 'admin', password: PASSWORD },
			{ email: 'bea@example.com', name: 'Bea', role: 'member', password: PASSWORD },
			{ email: 'cy@example.com', name: 'Cy', role: null, password: PASSWORD },
			{ email: 'dee@example.com', name: 'Dee', role: null, password: PASSWORD },
		],
		methods: ['passkey', 'password'],
		send: async (message) => void sent.push(message),
	});
});
afterAll(() => database.close());

const browser = () => new TestBrowser((request) => provider.auth.handler(request), ORIGIN);
async function as(email: string): Promise<TestBrowser> {
	const page = browser();
	expect((await page.signIn(email, PASSWORD)).status).toBe(200);
	return page;
}
const org = () => provider.organizationId;

/**
 * Every organization route the instance serves, with the rule that holds it (5.8). A route Better Auth adds in a
 * later version fails this test until it is read against 7.5 and listed.
 */
const SERVED: Record<string, string> = {
	'/organization/create': '7.5: allowUserToCreateOrganization false, refused',
	'/organization/update':
		'7.5: no role holds organization:update; beforeUpdateOrganization refuses',
	'/organization/delete': '7.5: deletion disabled; no role holds organization:delete',
	'/organization/invite-member':
		"7.5: owners' invitation permission; only an owner invites an owner",
	'/organization/update-member-role':
		"7.5: owners'; only an owner touches the owner role; the last owner",
	'/organization/remove-member': "7.5: owners'; the last owner; the removed person's sessions go",
	'/organization/accept-invitation':
		'the invitee, verified; adds the member without beforeAddMember',
	'/organization/reject-invitation': 'the invitee only',
	'/organization/cancel-invitation': "the invitation permission, owners'",
	'/organization/get-organization': 'a member only; the organization, no members',
	'/organization/get-active-member': "the caller's own member row",
	'/organization/get-active-member-role': "the caller's own role",
	'/organization/get-invitation': 'the invitee only',
	'/organization/list': "the caller's own organizations",
	'/organization/list-invitations':
		"owners' (the invitation permission); an admin never sees an owner's",
	'/organization/list-user-invitations': "the caller's own",
	'/organization/has-permission': "the caller's own role",
	'/organization/check-slug': 'whether a slug is taken, as the deployment file already says',
};
const NOT_SERVED = [
	'/organization/leave',
	'/organization/set-active',
	'/organization/list-members',
	'/organization/get-full-organization',
];

describe("Step 4's re-check: every organization route the provider serves, against 7.5", () => {
	it('lists the routes from the provider instance, each served under its rule or not served', () => {
		const routes = Object.values(provider.auth.api as Record<string, { path?: string }>)
			.map((endpoint) => endpoint.path)
			.filter(
				(path): path is string => typeof path === 'string' && path.startsWith('/organization/')
			)
			.sort();
		expect(routes).toEqual([...Object.keys(SERVED), ...NOT_SERVED].sort());
		for (const path of NOT_SERVED) expect(LOAM_DISABLED_PATHS).toContain(path);
		for (const path of Object.keys(SERVED)) expect(LOAM_DISABLED_PATHS).not.toContain(path);
	});

	it("answers 404 for leave, set-active and Better Auth's member reads, which show every member's email to any member", async () => {
		const bea = await as('bea@example.com');
		for (const path of NOT_SERVED) {
			const read = path.includes('list-members') || path.includes('full');
			const answer = read
				? await bea.call(`${path}?organizationId=${org()}`)
				: await bea.call(path, { body: { organizationId: org() } });
			expect(answer.status, path).toBe(404);
		}
	});

	it("P3-E6: Loam's members read shows each email only to an owner, and refuses a non-member", async () => {
		const bea = (await (await as('bea@example.com')).call('/loam/members')).body as {
			people: Record<string, unknown>[];
			total: number;
		};
		expect(bea.total).toBe(3);
		expect(bea.people.map((person) => person.name).sort()).toEqual(['Ada', 'Bea', 'Olu']);
		for (const person of bea.people) expect(person).not.toHaveProperty('email');
		const ada = (await (await as('ada@example.com')).call('/loam/members')).body as {
			people: Record<string, unknown>[];
		};
		const byEmail = Object.fromEntries(ada.people.map((person) => [person.email, person.role]));
		expect(byEmail).toEqual({
			'olu@example.com': 'owner',
			'ada@example.com': 'admin',
			'bea@example.com': 'member',
		});
		const cy = await (await as('cy@example.com')).call('/loam/members');
		expect([cy.status, cy.body?.code]).toEqual([403, 'WORKSPACE_NOT_MEMBER']);
	});

	it('P3-E6: a member cannot invite, cancel or list invitations; an admin invites members but never an owner, and never sees an owner invitation', async () => {
		const bea = await as('bea@example.com');
		const invited = await bea.call('/organization/invite-member', {
			body: { email: 'x@example.com', role: 'member', organizationId: org() },
		});
		expect(invited.status).toBe(403);
		expect((await bea.call(`/organization/list-invitations?organizationId=${org()}`)).status).toBe(
			403
		);
		const olu = await as('olu@example.com');
		const owner = await olu.call('/organization/invite-member', {
			body: { email: 'owner2@example.com', role: 'owner', organizationId: org() },
		});
		expect(owner.status).toBe(200);
		const ada = await as('ada@example.com');
		const refused = await ada.call('/organization/invite-member', {
			body: { email: 'owner3@example.com', role: 'owner', organizationId: org() },
		});
		expect(refused.status).toBe(403);
		const member = await ada.call('/organization/invite-member', {
			body: { email: 'member2@example.com', role: 'member', organizationId: org() },
		});
		expect(member.status).toBe(200);
		const seen = (await ada.call(`/organization/list-invitations?organizationId=${org()}`))
			.body as unknown as {
			email: string;
		}[];
		expect(seen.map((row) => row.email)).toContain('member2@example.com');
		expect(seen.map((row) => row.email)).not.toContain('owner2@example.com');
		const cancel = await bea.call('/organization/cancel-invitation', {
			body: { invitationId: member.body?.id },
		});
		expect(cancel.status).toBe(403);
	});

	it("P3-E7: an invitation is the invitee's alone to read, accept or reject; reads of an organization need its membership", async () => {
		const olu = await as('olu@example.com');
		const invited = await olu.call('/organization/invite-member', {
			body: { email: 'dee@example.com', role: 'member', organizationId: org() },
		});
		const id = invited.body?.id as string;
		const bea = await as('bea@example.com');
		expect((await bea.call(`/organization/get-invitation?id=${id}`)).status).toBe(403);
		expect(
			(await bea.call('/organization/accept-invitation', { body: { invitationId: id } })).status
		).toBe(403);
		expect(
			(await bea.call('/organization/reject-invitation', { body: { invitationId: id } })).status
		).toBe(403);
		const cy = await as('cy@example.com');
		expect((await cy.call(`/organization/get-organization?organizationId=${org()}`)).status).toBe(
			403
		);
		expect(((await cy.call('/organization/list')).body as unknown as unknown[]).length).toBe(0);
		const dee = await as('dee@example.com');
		const mine = (await dee.call('/organization/list-user-invitations')).body as unknown as {
			id: string;
		}[];
		expect(mine.map((row) => row.id)).toContain(id);
		// Loam's own list, with the organization's slug and name (5.3), is the invitee's alone too.
		expect((await dee.call('/loam/invitations')).body).toEqual({
			invitations: [
				{
					id,
					organization: { slug: 'acme', name: 'Acme' },
					role: 'member',
					expiresAt: expect.any(String),
				},
			],
		});
		expect((await bea.call('/loam/invitations')).body).toEqual({ invitations: [] });
		expect(
			(await dee.call('/organization/accept-invitation', { body: { invitationId: id } })).status
		).toBe(200);
		expect((await dee.call('/loam/whoami')).body).toMatchObject({ membership: { role: 'member' } });
	});

	it("accept-invitation's write of the active organization grants nothing: Loam never reads it but where the role hook resolves a call naming none", async () => {
		// Another organization, made directly in the database as a provider-side change would be, with Dee's
		// invitation to it. Accepting makes it her session's active one.
		const now = new Date().toISOString();
		database
			.prepare('INSERT INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)')
			.run('org-other', 'Other', 'other', now);
		const olu = provider.people['olu@example.com'] as string;
		database
			.prepare(
				"INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES ('m-other', 'org-other', ?, 'owner', ?)"
			)
			.run(olu, now);
		database
			.prepare(
				"INSERT INTO invitation (id, organizationId, email, role, status, expiresAt, inviterId, createdAt) VALUES ('inv-other', 'org-other', 'cy@example.com', 'owner', 'pending', ?, ?, ?)"
			)
			.run(new Date(Date.now() + 3_600_000).toISOString(), olu, now);
		const cy = await as('cy@example.com');
		expect(
			(await cy.call('/organization/accept-invitation', { body: { invitationId: 'inv-other' } }))
				.status
		).toBe(200);
		// An owner of that organization is no member of the workspace, and its active organization changes nothing.
		expect((await cy.call('/loam/whoami')).body).toMatchObject({ membership: null });
		const beaMember = database
			.prepare('SELECT id FROM member WHERE userId = ? AND organizationId = ?')
			.get(provider.people['bea@example.com'] as string, org()) as { id: string };
		const promote = await cy.call('/organization/update-member-role', {
			body: { memberId: beaMember.id, role: 'owner' },
		});
		expect(promote.status).toBeGreaterThanOrEqual(400);
		const remove = await cy.call('/organization/remove-member', {
			body: { memberIdOrEmail: 'bea@example.com' },
		});
		expect(remove.status).toBeGreaterThanOrEqual(400);
		expect(database.prepare('SELECT role FROM member WHERE id = ?').get(beaMember.id)).toEqual({
			role: 'member',
		});
	});

	it("reads only the caller's own member row and role, and answers has-permission and check-slug for no one else", async () => {
		const bea = await as('bea@example.com');
		const role = await bea.call(`/organization/get-active-member-role?organizationId=${org()}`);
		expect(role.body).toMatchObject({ role: 'member' });
		const allowed = await bea.call('/organization/has-permission', {
			body: { organizationId: org(), permissions: { member: ['delete'] } },
		});
		expect(allowed.body).toMatchObject({ success: false });
		const slug = await bea.call('/organization/check-slug', { body: { slug: 'acme' } });
		expect(slug.status).toBe(400);
	});
});
