/**
 * Step 6's provider units (phase 3 specification, 4.4, 5.8, 8.1 and 8.3), P3-E5's provider half, by direct requests
 * against a real Better Auth 1.7.18 provider: the sponsor's membership digest `/loam/members` answers, which the kernel's
 * `membership-settle` journals, is the one that person's own `whoami` answers; and an agent member has no account at
 * the provider, so step 6 serves no route of its own. The routes are listed from the provider instance.
 */

import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestProvider } from './testing/provider.js';
import { TestBrowser } from './testing/requests.js';

const ORIGIN = 'https://acme.example';
const PASSWORD = 'correct horse battery staple';
const database = new DatabaseSync(':memory:');
let provider: Awaited<ReturnType<typeof createTestProvider>>;

beforeAll(async () => {
	provider = await createTestProvider({
		baseURL: `${ORIGIN}/api/auth`,
		secret: 'a'.repeat(32),
		database,
		workspace: 'acme',
		organization: { slug: 'acme', name: 'Acme' },
		people: [
			{ email: 'olu@example.com', name: 'Olu', role: 'owner', password: PASSWORD },
			{ email: 'bea@example.com', name: 'Bea', role: 'member', password: PASSWORD },
			{ email: 'cy@example.com', name: 'Cy', role: 'member', password: PASSWORD },
			{ email: 'dee@example.com', name: 'Dee', role: null, password: PASSWORD },
		],
		methods: ['passkey', 'password'],
		send: async () => {},
	});
});
afterAll(() => database.close());

async function as(email: string): Promise<TestBrowser> {
	const page = new TestBrowser((request) => provider.auth.handler(request), ORIGIN);
	expect((await page.signIn(email, PASSWORD)).status).toBe(200);
	return page;
}

interface MemberRow {
	id: string;
	name: string;
	role: string;
	digest?: string;
	email?: string;
}

describe("P3-E5: the sponsor's membership, read at the provider (4.4)", () => {
	it("P3-E5: /loam/members answers each person's digest, the one their own whoami answers, to any member", async () => {
		const bea = await as('bea@example.com');
		const read = await bea.call('/loam/members');
		expect(read.status).toBe(200);
		const people = (read.body as { people: MemberRow[] }).people;
		expect(people.map((person) => person.name).sort()).toEqual(['Bea', 'Cy', 'Olu']);
		for (const person of people) {
			// A member who is no owner sees no email, as before; the digest is of what the row already shows.
			expect(person).not.toHaveProperty('email');
			expect(person.digest).toMatch(/^[0-9a-f]{64}$/);
		}
		for (const email of ['olu@example.com', 'bea@example.com', 'cy@example.com']) {
			const own = (await (await as(email)).call('/loam/whoami')).body as {
				user: { id: string };
				membership: { digest: string };
			};
			expect(people.find((person) => person.id === own.user.id)?.digest, email).toBe(
				own.membership.digest
			);
		}
	});

	it('P3-E5: a role changed is a digest changed, so the journal records which membership a sponsor check read', async () => {
		const olu = await as('olu@example.com');
		const before = ((await olu.call('/loam/members')).body as { people: MemberRow[] }).people;
		const cy = before.find((person) => person.name === 'Cy') as MemberRow;
		const memberId = (
			database.prepare('SELECT id FROM member WHERE userId = ?').get(cy.id) as { id: string }
		).id;
		const changed = await olu.call('/organization/update-member-role', {
			body: { memberId, role: 'admin', organizationId: provider.organizationId },
		});
		expect(changed.status).toBe(200);
		const after = ((await olu.call('/loam/members')).body as { people: MemberRow[] }).people;
		const now = after.find((person) => person.id === cy.id) as MemberRow;
		expect(now.role).toBe('admin');
		expect(now.digest).not.toBe(cy.digest);
	});

	it('P3-E5: no one who is no member reads the members, digests included', async () => {
		const dee = await as('dee@example.com');
		const refused = await dee.call('/loam/members');
		expect(refused.status).toBe(403);
		expect(JSON.stringify(refused.body)).not.toContain('digest');
	});
});

describe('P3-E5: an agent member has no account at the provider (8.1)', () => {
	/**
	 * Every `/loam/*` route the instance serves, listed from the instance. Step 6 adds none: an agent member is a
	 * record of Loam's store, never a user, session or credential, so the provider serves nothing for one (5.8 lists the
	 * routes a step enables). A route added later fails this test until it is read against 5.8 and listed.
	 */
	const LOAM_ROUTES = [
		'/loam/account',
		'/loam/binding',
		// Step 7's connected agents (9.2): a list, a person's disconnect and an owner's removal, and the person's change of
		// its access (#2784). None registers a credential or a session, and none makes an agent a user; the consent
		// page's approval makes the record.
		'/loam/connected-agents',
		'/loam/connected-agents/disconnect',
		'/loam/connected-agents/remove',
		'/loam/connected-agents/update',
		'/loam/invitations',
		'/loam/join/check',
		'/loam/join/name',
		'/loam/join/password',
		// Phase 6's S4: a person's own leave, on removal's path; it makes no agent a user.
		'/loam/leave',
		'/loam/members',
		'/loam/recover/check',
		'/loam/recover/oidc/complete',
		'/loam/recover/oidc/start',
		'/loam/recover/password',
		'/loam/recover/request',
		'/loam/revoke-person',
		'/loam/sessions',
		'/loam/whoami',
	];

	it('P3-E5: lists the routes from the provider instance: none for an agent member', () => {
		const paths = Object.values(provider.auth.api as Record<string, { path?: string }>)
			.map((endpoint) => endpoint.path)
			.filter((path): path is string => typeof path === 'string');
		expect(paths.filter((path) => path.startsWith('/loam/')).sort()).toEqual(LOAM_ROUTES);
		// No route signs an agent member in or gives it an account; step 7's connected-agent routes manage a person's
		// own connections, listed above.
		expect(
			paths.filter((path) => /agent/i.test(path) && !path.startsWith('/loam/connected-agents'))
		).toEqual([]);
	});

	it("P3-E5: no user row's id starts `agt_`, so the provider holds no account an agent member could sign in with", () => {
		const users = database.prepare('SELECT id FROM user').all() as { id: string }[];
		expect(users.length).toBeGreaterThan(0);
		expect(users.filter((user) => user.id.startsWith('agt_'))).toEqual([]);
	});
});
