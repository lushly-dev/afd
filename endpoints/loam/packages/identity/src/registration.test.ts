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

const session = (createdAt: Date, method: string | null) => ({
	session: { createdAt, loamMethod: method },
	user: { id: 'u1' },
});

/** A request whose own session is fresh and a passkey's, and a store holding the person's passkey. */
const ctx = () => ({
	context: {
		session: session(new Date(), 'passkey'),
		adapter: { findOne: async () => ({ id: 'pk1' }) },
	},
});

afterEach(() => {
	authoritative.answer = null;
});

describe('P3-E1: registration re-checks the session it reads again (5.8, I3)', () => {
	it('refuses when the store answers no session, whatever the request carried', async () => {
		authoritative.answer = null;
		await expect(afterVerification()({ ctx: ctx() })).rejects.toMatchObject({
			body: { code: 'REAUTH_REQUIRED' },
		});
	});

	it("decides on the store's session: a stale one is refused though the request's own was fresh", async () => {
		authoritative.answer = session(new Date(Date.now() - 600_000), 'passkey');
		await expect(afterVerification()({ ctx: ctx() })).rejects.toMatchObject({
			body: { code: 'REAUTH_REQUIRED' },
		});
	});

	it("lets a fresh passkey session's registration through", async () => {
		authoritative.answer = session(new Date(), 'passkey');
		await expect(afterVerification()({ ctx: ctx() })).resolves.toEqual({});
	});
});
