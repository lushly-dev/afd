/**
 * Step 7's review, closed in step 9 (phase 3 specification, 7.2, 8.2 and 9.2): past a hundred rows. Better Auth's
 * adapter answers at most 100 rows a read unless told otherwise, so `/loam/members` reads the caller's own row
 * directly and its page with a count, and the connected agents are read page by page in a stable order. Against a
 * real Better Auth 1.7.18 provider from `createLoamAuthOptions`, with the rows made through its own adapter.
 */

import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	CONNECTED_AGENT_MODEL,
	type ConnectionAdapter,
	connectedAgentRows,
	connectionOf,
} from './connected-agents.js';
import { createTestProvider } from './testing/provider.js';
import { TestBrowser } from './testing/requests.js';

const ORIGIN = 'https://acme.example';
const PASSWORD = 'correct horse battery staple';
const MANY = 150;
const database = new DatabaseSync(':memory:');
let provider: Awaited<ReturnType<typeof createTestProvider>>;
let adapter: ConnectionAdapter & {
	create(input: { model: string; data: Record<string, unknown> }): Promise<unknown>;
};

beforeAll(async () => {
	provider = await createTestProvider({
		baseURL: `${ORIGIN}/api/auth`,
		secret: 'p'.repeat(32),
		database,
		workspace: 'acme',
		organization: { slug: 'acme', name: 'Acme' },
		people: [{ email: 'olu@example.com', name: 'Olu', role: 'owner', password: PASSWORD }],
		methods: ['passkey', 'password'],
		send: async () => {},
	});
	adapter = ((await provider.auth.$context) as unknown as { adapter: typeof adapter }).adapter;
	const organizationId = (
		database.prepare("SELECT id FROM organization WHERE slug = 'acme'").get() as { id: string }
	).id;
	// MANY people made before the two the reads look for, each a member, so both fall past the first hundred.
	const start = Date.now() - 10 * 60_000;
	for (let index = 0; index < MANY; index++) {
		const at = new Date(start + index * 1_000);
		const user = (await adapter.create({
			model: 'user',
			data: {
				name: `Person ${index}`,
				email: `person-${index}@example.com`,
				emailVerified: true,
				createdAt: at,
				updatedAt: at,
			},
		})) as { id: string };
		await adapter.create({
			model: 'member',
			data: { organizationId, userId: user.id, role: 'member', createdAt: at },
		});
	}
	// Olu, seeded first, is made a member again last: the newest row by insertion and by `createdAt`, so a read of
	// the first hundred rows in any order leaves him out, and only the direct read of his own row finds him.
	const olu = database
		.prepare(
			'SELECT member.id, member.userId FROM member JOIN user ON user.id = member.userId WHERE user.email = ?'
		)
		.get('olu@example.com') as { id: string; userId: string };
	database.prepare('DELETE FROM member WHERE id = ?').run(olu.id);
	await adapter.create({
		model: 'member',
		data: { organizationId, userId: olu.userId, role: 'owner', createdAt: new Date() },
	});
	const firstHundred = database
		.prepare('SELECT userId FROM member WHERE organizationId = ? LIMIT 100')
		.all(organizationId) as { userId: string }[];
	expect(firstHundred.some((row) => row.userId === olu.userId)).toBe(false);
});
afterAll(() => database.close());

async function as(email: string): Promise<TestBrowser> {
	const page = new TestBrowser((request) => provider.auth.handler(request), ORIGIN);
	expect((await page.signIn(email, PASSWORD)).status).toBe(200);
	return page;
}

describe("Step 7's follow-up: past a hundred members and connected agents", () => {
	it('/loam/members finds a caller who is the newest of more than a hundred, and pages every member with the total', async () => {
		const olu = await as('olu@example.com');
		const first = await olu.call('/loam/members?limit=200');
		expect(first.status).toBe(200);
		const answer = first.body as {
			people: { id: string; role: string; email?: string }[];
			total: number;
		};
		expect(answer.total).toBe(MANY + 1);
		expect(answer.people).toHaveLength(MANY + 1);
		// Olu, the last of them, is found and answered as an owner, with every email (D96).
		expect(answer.people.at(-1)).toMatchObject({ role: 'owner', email: 'olu@example.com' });
		expect(new Set(answer.people.map((person) => person.id)).size).toBe(MANY + 1);
		// Two pages of 100 hold each member once, in order.
		const one = (await olu.call('/loam/members?limit=100&offset=0')).body as typeof answer;
		const two = (await olu.call('/loam/members?limit=100&offset=100')).body as typeof answer;
		expect([...one.people, ...two.people].map((person) => person.id)).toEqual(
			answer.people.map((person) => person.id)
		);
	});

	it("the workspace's connected agents are read whole past a hundred, and one person's connection is found past them", async () => {
		const sponsor = (
			database.prepare('SELECT id FROM user WHERE email = ?').get('olu@example.com') as {
				id: string;
			}
		).id;
		const at = new Date();
		for (let index = 0; index <= MANY; index++)
			await adapter.create({
				model: CONNECTED_AGENT_MODEL,
				data: {
					agentId: `agt_paging_${String(index).padStart(3, '0')}`,
					workspace: 'acme',
					name: `Client ${index}`,
					clientId: `client-${index}`,
					clientHost: 'an app registered by the deployer',
					sponsor: index === MANY ? sponsor : `someone-${index}`,
					installedBy: sponsor,
					access: JSON.stringify({ workspace: true, projects: 'sponsor' }),
					scopes: 'loam:read',
					status: 'active',
					createdAt: at,
					updatedAt: at,
					updatedBy: sponsor,
				},
			});
		const rows = await connectedAgentRows(adapter, 'acme');
		expect(rows).toHaveLength(MANY + 1);
		expect(new Set(rows.map((row) => row.agentId)).size).toBe(MANY + 1);
		// A row past the first hundred by the adapter's own sort key, `id`: on the second page whatever the ids drawn.
		const late = database
			.prepare(
				'SELECT agentId, clientId, sponsor FROM loam_connected_agent ORDER BY id LIMIT 1 OFFSET 120'
			)
			.get() as { agentId: string; clientId: string; sponsor: string };
		expect(await connectionOf(adapter, 'acme', late.clientId, late.sponsor)).toMatchObject({
			agentId: late.agentId,
		});
	});
});
