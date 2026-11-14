/**
 * The passkey plugin's after-verification check (phase 3 specification, 5.8, D99), as a unit: it reads the session
 * again from the store, never the one the request carried in, and refuses when none comes back (the review of step
 * 3's I3), so step 4's `requireSession: false` cannot let a registration through unchecked.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const authoritative = vi.hoisted(() => ({ answer: null as unknown }));
vi.mock('better-auth/api', async (original) => ({
	...(await original<typeof import('better-auth/api')>()),
	getAuthoritativeSessionFromCtx: vi.fn(async () => authoritative.answer),
}));

const { createLoamAuthOptions } = await import('./options.js');

type AfterVerification = (input: { ctx: unknown }) => Promise<unknown>;

const afterVerification = (): AfterVerification => {
	const options = createLoamAuthOptions({
		baseURL: 'https://acme.example/api/auth',
		secret: 'x'.repeat(32),
		database: undefined as never,
		workspace: 'acme',
		organization: 'acme',
		methods: ['passkey'],
		mail: { send: async () => {} },
	}) as unknown as { plugins: { id: string; options?: Record<string, unknown> }[] };
	const passkey = options.plugins.find((plugin) => plugin.id === 'passkey');
	const registration = passkey?.options?.registration as
		| { afterVerification: AfterVerification }
		| undefined;
	if (!registration) throw new Error('No passkey registration options');
	return registration.afterVerification;
};

/**
 * A session as Better Auth hands it to a route: through `parseSessionOutput`, so with its token and no `loamMethod`,
 * which is `returned: false` (the re-check of step 3's NEW-1).
 */
const parsed = (token: string, createdAt = new Date()) => ({
	session: { id: `s-${token}`, token, userId: 'u1', createdAt },
	user: { id: 'u1' },
});

/** The store's own session rows, which keep `loamMethod`, and the person's passkey. */
const rows = new Map<
	string,
	{ token: string; userId: string; createdAt: Date; loamMethod: string | null }
>();
const ctx = () => ({
	context: {
		// The request's own session, fresh and a passkey's: never what the check decides on.
		session: parsed('carried'),
		adapter: {
			findOne: async ({ model, where }: { model: string; where: { value: unknown }[] }) =>
				model === 'session' ? (rows.get(String(where[0]?.value)) ?? null) : { id: 'pk1' },
		},
	},
});
const row = (token: string, createdAt: Date, loamMethod: string | null) =>
	rows.set(token, { token, userId: 'u1', createdAt, loamMethod });

afterEach(() => {
	authoritative.answer = null;
	rows.clear();
});

describe('P3-E1: registration re-checks the session it reads again (5.8, I3, NEW-1)', () => {
	it('refuses when the store answers no session, whatever the request carried', async () => {
		row('carried', new Date(), 'passkey');
		authoritative.answer = null;
		await expect(afterVerification()({ ctx: ctx() })).rejects.toMatchObject({
			body: { code: 'REAUTH_REQUIRED' },
		});
	});

	it('decides on the session row: a stale one is refused though the parsed session says it is fresh', async () => {
		row('t1', new Date(Date.now() - 600_000), 'passkey');
		authoritative.answer = parsed('t1');
		await expect(afterVerification()({ ctx: ctx() })).rejects.toMatchObject({
			body: { code: 'REAUTH_REQUIRED' },
		});
	});

	it("refuses a passkey holder's fresh session that a password made", async () => {
		row('t2', new Date(), 'password');
		authoritative.answer = parsed('t2');
		await expect(afterVerification()({ ctx: ctx() })).rejects.toMatchObject({
			body: { code: 'REAUTH_REQUIRED' },
		});
	});

	it("lets a fresh passkey session's registration through, read from its row: the parsed session has no loamMethod", async () => {
		row('t3', new Date(), 'passkey');
		authoritative.answer = parsed('t3');
		await expect(afterVerification()({ ctx: ctx() })).resolves.toEqual({});
	});
});
