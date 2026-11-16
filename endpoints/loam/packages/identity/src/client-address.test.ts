/**
 * A7 (phase 6 specification; phase 3's 2.6): the provider reads a client's address only from `x-loam-client-ip`,
 * the header the hosted server sets from the socket after deleting any incoming copy and `x-forwarded-for`. Proved
 * on a real Better Auth 1.7.18 provider from `createLoamAuthOptions`, by the address its session records. That the
 * host deletes and sets the header is `loam-host`'s own test, against the real host. The limiter it keys is on in
 * every mode, whatever `NODE_ENV` says.
 */

import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_ADDRESS_HEADER, createLoamAuthOptions } from './options.js';
import { createTestProvider } from './testing/provider.js';

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
		people: [{ email: 'bea@example.com', name: 'Bea', role: 'member', password: PASSWORD }],
		methods: ['passkey', 'password'],
		send: async () => {},
	});
});
afterAll(() => database.close());

describe("A7: the client's address comes from x-loam-client-ip alone", () => {
	it('records the address the host set, never x-forwarded-for', async () => {
		const answer = await provider.auth.handler(
			new Request(`${ORIGIN}/api/auth/sign-in/email`, {
				method: 'POST',
				headers: {
					origin: ORIGIN,
					'content-type': 'application/json',
					'x-forwarded-for': '198.51.100.7',
					[CLIENT_ADDRESS_HEADER]: '203.0.113.9',
				},
				body: JSON.stringify({ email: 'bea@example.com', password: PASSWORD }),
			})
		);
		expect(answer.status).toBe(200);
		expect(database.prepare('SELECT ipAddress FROM session').all()).toEqual([
			{ ipAddress: '203.0.113.9' },
		]);
	});
});

describe("The provider's rate limit is on in every mode, keyed by x-loam-client-ip (the coordinator's decision, 2026-11-15)", () => {
	const limited = new DatabaseSync(':memory:');
	let auth: { handler(request: Request): Promise<Response> };

	beforeAll(async () => {
		// `createLoamAuthOptions` as a deployment gets it, with no raised limit, under vitest's `NODE_ENV=test`, where
		// Better Auth's own default would leave the limiter off.
		const options = createLoamAuthOptions({
			baseURL: `${ORIGIN}/api/auth`,
			secret: 'b'.repeat(32),
			database: limited,
			workspace: 'acme',
			organization: 'acme',
			methods: ['passkey', 'password'],
			mail: { send: async () => {} },
		});
		await (await getMigrations(options)).runMigrations();
		auth = betterAuth(options);
	});
	afterAll(() => limited.close());

	const attempt = (address: string, forwarded = '198.51.100.7') =>
		auth.handler(
			new Request(`${ORIGIN}/api/auth/sign-in/email`, {
				method: 'POST',
				headers: {
					origin: ORIGIN,
					'content-type': 'application/json',
					'x-forwarded-for': forwarded,
					[CLIENT_ADDRESS_HEADER]: address,
				},
				body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong password here' }),
			})
		);

	it('refuses a fourth sign-in from one address within the window with 429, whatever x-forwarded-for says', async () => {
		expect(NODE_ENV_IS_TEST).toBe(true);
		for (let tries = 0; tries < 3; tries++)
			expect((await attempt('203.0.113.20', `198.51.100.${tries}`)).status).toBe(401);
		const limitedAnswer = await attempt('203.0.113.20', '198.51.100.99');
		expect(limitedAnswer.status).toBe(429);
		expect(Number(limitedAnswer.headers.get('x-retry-after'))).toBeGreaterThan(0);
	});

	it('keys the bucket on x-loam-client-ip: another address has its own', async () => {
		expect((await attempt('203.0.113.21')).status).toBe(401);
	});

	it('takes a raised limit only as an explicit option, which raises the sign-in rule too and never turns it off', () => {
		const raised = createLoamAuthOptions({
			baseURL: `${ORIGIN}/api/auth`,
			secret: 'c'.repeat(32),
			database: limited,
			workspace: 'acme',
			organization: 'acme',
			methods: ['passkey'],
			mail: { send: async () => {} },
			rateLimit: { window: 10, max: 500 },
		}).rateLimit;
		expect(raised).toMatchObject({ enabled: true, window: 10, max: 500 });
		expect(raised?.customRules?.['/sign-in/*']).toEqual({ window: 10, max: 500 });
		// Only a raise (N2): below the default, unlimited, fractional or over a longer window, each is refused.
		for (const rateLimit of [
			{ window: 10, max: 0 },
			{ window: 10, max: 99 },
			{ window: 10, max: Number.POSITIVE_INFINITY },
			{ window: 10, max: 150.5 },
			{ window: 0, max: 500 },
			{ window: 60, max: 500 },
		]) {
			expect(
				() =>
					createLoamAuthOptions({
						baseURL: `${ORIGIN}/api/auth`,
						secret: 'c'.repeat(32),
						database: limited,
						workspace: 'acme',
						organization: 'acme',
						methods: ['passkey'],
						mail: { send: async () => {} },
						rateLimit,
					}),
				JSON.stringify(rateLimit)
			).toThrow('at least 100');
		}
	});
});

describe("B1: the secret and telemetry never come from the environment (the coordinator's decision, 2026-11-16)", () => {
	const own = 's'.repeat(40);
	const options = () =>
		createLoamAuthOptions({
			baseURL: `${ORIGIN}/api/auth`,
			secret: own,
			database: new DatabaseSync(':memory:'),
			workspace: 'acme',
			organization: 'acme',
			methods: ['passkey'],
			mail: { send: async () => {} },
		});

	it('passes the secret as `secrets` explicitly, so BETTER_AUTH_SECRETS cannot replace it, and telemetry off', async () => {
		expect(options().secrets).toEqual([{ version: 1, value: own }]);
		expect(options().telemetry).toEqual({ enabled: false });
		const held = process.env.BETTER_AUTH_SECRETS;
		process.env.BETTER_AUTH_SECRETS = `1:${'e'.repeat(40)}`;
		try {
			const context = (await betterAuth(options()).$context) as { secret: string };
			expect(context.secret).toBe(own);
		} finally {
			if (held === undefined) delete process.env.BETTER_AUTH_SECRETS;
			else process.env.BETTER_AUTH_SECRETS = held;
		}
	});
});

const NODE_ENV_IS_TEST = process.env.NODE_ENV === 'test';
