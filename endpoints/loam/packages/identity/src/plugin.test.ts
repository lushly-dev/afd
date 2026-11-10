/**
 * `loamServerPlugin` in this process (phase 3 specification, 2.3, 4.2 and 7.5), through Better Auth's own
 * handler, so coverage sees what the test-only host's child runs. `provider.test.ts` holds the same rules
 * over HTTP against the host.
 */

import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
			{ email: 'ada@example.com', role: 'admin', password: PASSWORD },
			{ email: 'bea@example.com', role: 'member', password: PASSWORD },
			{ email: 'nobody@example.com', role: null, password: PASSWORD },
		],
		methods: ['passkey', 'password'],
		send: async () => {},
	});
});
afterAll(() => database.close());

async function call(path: string, options: { cookie?: string; body?: unknown } = {}) {
	const response = await provider.auth.handler(
		new Request(`${ORIGIN}/api/auth${path}`, {
			method: options.body === undefined ? 'GET' : 'POST',
			headers: {
				origin: ORIGIN,
				...(options.cookie ? { cookie: options.cookie } : {}),
				...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
			},
			...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
		})
	);
	const text = await response.text();
	const json = response.headers.get('content-type')?.includes('json');
	return {
		status: response.status,
		body: (text && json ? JSON.parse(text) : null) as Record<string, unknown> | null,
		cookie: response.headers
			.getSetCookie()
			.map((line) => line.split(';')[0])
			.join('; '),
	};
}
const signIn = async (email: string) =>
	(await call('/sign-in/email', { body: { email, password: PASSWORD } })).cookie;
const memberId = (email: string) =>
	(
		database
			.prepare('SELECT id FROM member WHERE userId = ?')
			.get(provider.people[email] as string) as { id: string }
	).id;

describe('loamServerPlugin, in process', () => {
	it('answers whoami: null signed out, the bound membership signed in, null for a non-member', async () => {
		expect((await call('/loam/whoami')).body).toBeNull();
		const bea = await call('/loam/whoami', { cookie: await signIn('bea@example.com') });
		expect(bea.body).toMatchObject({
			user: { email: 'bea@example.com', image: null },
			membership: { organization: { id: provider.organizationId, slug: 'acme' }, role: 'member' },
		});
		const nobody = await call('/loam/whoami', { cookie: await signIn('nobody@example.com') });
		expect(nobody.body?.membership).toBeNull();
	});

	it('answers a session whose user id starts `agt_` as none (3.2)', async () => {
		const cookie = await signIn('nobody@example.com');
		// A forged or misconfigured provider: the user's id rewritten under its live session.
		const id = provider.people['nobody@example.com'] as string;
		database.exec('PRAGMA foreign_keys = OFF');
		for (const table of ['user', 'session', 'account'])
			database
				.prepare(
					`UPDATE ${table} SET ${table === 'user' ? 'id' : 'userId'} = ? WHERE ${table === 'user' ? 'id' : 'userId'} = ?`
				)
				.run('agt_forged', id);
		database.exec('PRAGMA foreign_keys = ON');
		expect((await call('/loam/whoami', { cookie })).body).toBeNull();
	});

	it('serves the binding to owners alone', async () => {
		const owner = await call('/loam/binding', { cookie: await signIn('olu@example.com') });
		expect(owner.body).toMatchObject({ organization: { slug: 'acme' } });
		const member = await call('/loam/binding', { cookie: await signIn('bea@example.com') });
		expect([member.status, member.body?.code]).toEqual([403, 'OWNER_REQUIRED']);
	});

	it('checks the caller of the role endpoints: an admin never touches the owner role', async () => {
		const ada = await signIn('ada@example.com');
		const organizationId = provider.organizationId;
		const promote = await call('/organization/update-member-role', {
			cookie: ada,
			body: { organizationId, memberId: memberId('bea@example.com'), role: ['owner'] },
		});
		expect(promote.body?.code).toBe('OWNER_REQUIRED');
		const byEmail = await call('/organization/remove-member', {
			cookie: ada,
			body: { organizationId, memberIdOrEmail: 'OLU@example.com' },
		});
		expect(byEmail.body?.code).toBe('OWNER_REQUIRED');
		const byId = await call('/organization/remove-member', {
			cookie: ada,
			body: { organizationId, memberIdOrEmail: memberId('olu@example.com') },
		});
		expect(byId.body?.code).toBe('OWNER_REQUIRED');
		// A member of another organization's id, or no organization named: the plugin's own refusal.
		const elsewhere = await call('/organization/remove-member', {
			cookie: ada,
			body: { organizationId: 'org_nowhere', memberIdOrEmail: memberId('olu@example.com') },
		});
		expect(elsewhere.body?.code).not.toBe('OWNER_REQUIRED');
		const unnamed = await call('/organization/update-member-role', {
			cookie: ada,
			body: { memberId: memberId('bea@example.com'), role: 'owner' },
		});
		expect(unnamed.status).toBeGreaterThanOrEqual(400);
		// The owner may.
		const olu = await signIn('olu@example.com');
		const granted = await call('/organization/update-member-role', {
			cookie: olu,
			body: { organizationId, memberId: memberId('ada@example.com'), role: 'owner' },
		});
		expect(granted.status, JSON.stringify(granted.body)).toBe(200);
	});
});
