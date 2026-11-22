/**
 * Phase 6's S4 and phase 3's A4 at a real Better Auth 1.7.18 provider (phase 6 specification, 3.7; step 5): Better
 * Auth's `/organization/leave` is not served; Loam's own `leave` takes the removal path, the last-owner rule first, then
 * the person's sessions, and the host's `onMemberRemoved` exactly once, naming the leaver; and an owner's removal runs
 * the same callback exactly once, from `afterRemoveMember`, which has no session to name the remover by.
 */

import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MemberRemovedV1 } from './hooks.js';
import { createTestProvider } from './testing/provider.js';
import { TestBrowser } from './testing/requests.js';

const ORIGIN = 'https://acme.example';
const PASSWORD = 'correct horse battery staple';
const database = new DatabaseSync(':memory:');
const heard: MemberRemovedV1[] = [];
let failing = false;
let provider: Awaited<ReturnType<typeof createTestProvider>>;

beforeAll(async () => {
	provider = await createTestProvider({
		baseURL: `${ORIGIN}/api/auth`,
		secret: 'l'.repeat(32),
		database,
		workspace: 'acme',
		organization: { slug: 'acme', name: 'Acme' },
		people: [
			{ email: 'olu@example.com', name: 'Olu', role: 'owner', password: PASSWORD },
			{ email: 'ada@example.com', name: 'Ada', role: 'admin', password: PASSWORD },
			{ email: 'bea@example.com', name: 'Bea', role: 'member', password: PASSWORD },
			{ email: 'cy@example.com', name: 'Cy', role: 'member', password: PASSWORD },
			{ email: 'dee@example.com', name: 'Dee', role: null, password: PASSWORD },
			{ email: 'eve@example.com', name: 'Eve', role: 'member', password: PASSWORD },
		],
		methods: ['passkey', 'password'],
		send: async () => {},
		onMemberRemoved: async (event) => {
			heard.push(event);
			if (failing) throw new Error('the kernel is not open');
		},
	});
});
afterAll(() => database.close());
beforeEach(() => {
	heard.length = 0;
	failing = false;
});

async function as(email: string): Promise<TestBrowser> {
	const page = new TestBrowser((request) => provider.auth.handler(request), ORIGIN);
	expect((await page.signIn(email, PASSWORD)).status).toBe(200);
	return page;
}
const id = (email: string) => provider.people[email] as string;

describe("S4: leaving runs removal's path, and the host hears each removal once (A4)", () => {
	it("does not serve Better Auth's /organization/leave", async () => {
		const bea = await as('bea@example.com');
		const answer = await bea.call('/organization/leave', {
			body: { organizationId: provider.organizationId },
		});
		expect(answer.status).toBe(404);
		expect(heard).toEqual([]);
	});

	it('refuses the last owner MEMBER_LAST_OWNER, and hears nothing', async () => {
		const olu = await as('olu@example.com');
		const answer = await olu.call('/loam/leave', { body: {} });
		expect(answer.status).toBe(400);
		expect(answer.body).toMatchObject({ code: 'MEMBER_LAST_OWNER' });
		expect(heard).toEqual([]);
	});

	it('refuses a person who is no member MEMBER_NOT_FOUND', async () => {
		const dee = await as('dee@example.com');
		const answer = await dee.call('/loam/leave', { body: {} });
		expect(answer.body).toMatchObject({ code: 'MEMBER_NOT_FOUND' });
		expect(heard).toEqual([]);
	});

	it("leaves: the member row gone, the person's sessions ended, the host told once, naming the leaver", async () => {
		const bea = await as('bea@example.com');
		const answer = await bea.call('/loam/leave', { body: {} });
		expect(answer.status).toBe(200);
		expect(answer.body).toEqual({ left: true });
		expect(heard).toEqual([
			{
				organizationId: provider.organizationId,
				userId: id('bea@example.com'),
				removedBy: id('bea@example.com'),
			},
		]);
		expect((await bea.call('/get-session')).body).toBeNull();
		const whoami = await (await as('bea@example.com')).call('/loam/whoami');
		expect((whoami.body as { membership: unknown }).membership).toBeNull();
	});

	it("an owner's removal tells the host once, from afterRemoveMember, naming the remover", async () => {
		const olu = await as('olu@example.com');
		const answer = await olu.call('/organization/remove-member', {
			body: { organizationId: provider.organizationId, memberIdOrEmail: 'ada@example.com' },
		});
		expect(answer.status).toBe(200);
		expect(heard).toEqual([
			{
				organizationId: provider.organizationId,
				userId: id('ada@example.com'),
				removedBy: id('olu@example.com'),
			},
		]);
	});

	it('two leaves of one membership at once tell the host once', async () => {
		const cy = await as('cy@example.com');
		const both = await Promise.all([
			cy.call('/loam/leave', { body: {} }),
			cy.call('/loam/leave', { body: {} }),
		]);
		expect(both.some((answer) => answer.status === 200)).toBe(true);
		expect(heard).toHaveLength(1);
	});

	it('a failing callback is logged, and the leave stands', async () => {
		failing = true;
		const eve = await as('eve@example.com');
		const answer = await eve.call('/loam/leave', { body: {} });
		expect(answer.status).toBe(200);
		expect(heard.length).toBe(1);
	});
});
