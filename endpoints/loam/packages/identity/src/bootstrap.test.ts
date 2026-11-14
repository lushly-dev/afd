/**
 * `bootstrapOrganization` (phase 3 specification, 5.6 and 10.2; the review of step 4's I5), against a real Better Auth
 * 1.7.18 provider: while the bound organization has no member, a second call sends the first owner's link again and ends
 * the earlier one; once anyone is a member it refuses, as it does a slug the deployment does not bind.
 */

import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapOrganization } from './bootstrap.js';
import type { LoamMailV1 } from './options.js';
import { createTestProvider } from './testing/provider.js';
import { linkIn, TestBrowser } from './testing/requests.js';
import { SoftAuthenticator } from './testing/webauthn.js';

const ORIGIN = 'https://acme.example';
const database = new DatabaseSync(':memory:');
const sent: LoamMailV1[] = [];
let provider: Awaited<ReturnType<typeof createTestProvider>>;

beforeAll(async () => {
	provider = await createTestProvider({
		baseURL: `${ORIGIN}/api/auth`,
		secret: 'b'.repeat(32),
		database,
		workspace: 'acme',
		organization: { slug: 'acme', name: 'Acme' },
		// No one seeded: the bound organization has no member until the first owner joins.
		people: [],
		methods: ['passkey'],
		bootstrapOwner: 'first@example.com',
		send: async (message) => void sent.push(message),
	});
});
afterAll(() => database.close());

const browser = () => new TestBrowser((request) => provider.auth.handler(request), ORIGIN);
const lastLink = (to: string) => {
	const mail = sent.filter((message) => message.to === to).at(-1);
	if (!mail) throw new Error(`No mail to ${to}`);
	const link = linkIn(mail.text);
	return {
		invitation: link.searchParams.get('invitation') as string,
		token: link.searchParams.get('token') as string,
	};
};

describe('P3-E17: bootstrapOrganization (5.6, 10.2; I5)', () => {
	it('P3-E17: sends the first owner a new link while the organization has no member, ending the earlier one', async () => {
		const first = lastLink('first@example.com');
		const again = await bootstrapOrganization(provider.auth, {
			slug: 'acme',
			name: 'Acme',
			ownerEmail: 'second@example.com',
		});
		expect(again.organizationId).toBe(provider.organizationId);
		const second = lastLink('second@example.com');
		expect(second.invitation).toBe(again.invitation);
		const old = await browser().call(
			`/loam/join/check?invitation=${first.invitation}&token=${first.token}`
		);
		expect(old.body).toMatchObject({ code: 'INVITATION_NOT_FOUND' });
		const page = browser();
		expect(
			(
				await page.call('/loam/join/name', {
					body: { invitation: second.invitation, token: second.token, name: 'First Owner' },
				})
			).status
		).toBe(200);
		const { verified } = await page.registerPasskey(new SoftAuthenticator({ origin: ORIGIN }), {
			context: `join:${second.invitation}.${second.token}`,
			createSession: true,
		});
		expect(verified?.status).toBe(200);
		expect((await page.call('/loam/whoami')).body).toMatchObject({ membership: { role: 'owner' } });
	});

	it('P3-E17: refuses once the organization has a member, and for a slug the deployment does not bind', async () => {
		await expect(
			bootstrapOrganization(provider.auth, {
				slug: 'acme',
				name: 'Acme',
				ownerEmail: 'third@example.com',
			})
		).rejects.toThrow(/with members/);
		expect(sent.some((message) => message.to === 'third@example.com')).toBe(false);
		await expect(
			bootstrapOrganization(provider.auth, {
				slug: 'other',
				name: 'Other',
				ownerEmail: 'x@example.com',
			})
		).rejects.toThrow(/binds 'acme'/);
	});
});
