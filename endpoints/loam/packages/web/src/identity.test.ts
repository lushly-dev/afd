/**
 * The first-paint probe and `DeferredAuthAdapter` (phase 3 specification, 4.2, 4.3 and 7.6), as units over a stubbed
 * `whoami`: the membership read answers only for the person the session holds (the review of step 3's I1), and the
 * real adapter starts from the state at the moment it is built, a late probe's included (N2).
 */

import type { AuthAdapter, AuthSessionState } from '@lushly-dev/afd-auth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeferredAuthAdapter, probeIdentity, readWhoami } from './identity.js';

const whoamiOf = (id: string, role: 'owner' | 'member', digest: string) => ({
	session: { id: `s-${id}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
	user: { id, email: `${id}@example.com` },
	membership: { role, digest },
});

/** `fetch` answering each `whoami` with what `answer` holds at that moment. */
function stubWhoami(first: unknown): { answer: unknown } {
	const held = { answer: first };
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(held.answer), { status: 200 }))
	);
	return held;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('P3-E4: the web host reads membership only for the person the session holds (I1)', () => {
	it("refuses a whoami that answers for another tab's person before this tab's adapter has heard", async () => {
		const whoami = stubWhoami(whoamiOf('bea', 'member', 'd-bea'));
		const identity = await probeIdentity('https://acme.example/api/auth/loam/whoami', async () => {
			throw new Error('not loaded here');
		});
		expect(identity.adapter.getSession()).toMatchObject({ user: { id: 'bea' } });
		await expect(identity.ports.readMembership?.()).resolves.toEqual({
			role: 'member',
			digest: 'd-bea',
		});
		// Another tab signs Olu in: the cookie now names Olu, while this tab's session still holds Bea.
		whoami.answer = whoamiOf('olu', 'owner', 'd-olu');
		await expect(identity.ports.readMembership?.()).rejects.toThrow(/another person/);
		// Signed out at the provider while the adapter still holds Bea: a failure too, never Bea's `null`.
		whoami.answer = null;
		await expect(identity.ports.readMembership?.()).rejects.toThrow(/another person/);
	});

	it('answers null for no one, when no one is signed in on either side', async () => {
		stubWhoami(null);
		const identity = await probeIdentity('https://acme.example/api/auth/loam/whoami', async () => {
			throw new Error('not loaded here');
		});
		await expect(identity.ports.readMembership?.()).resolves.toBeNull();
	});
});

describe('DeferredAuthAdapter (4.2, N2)', () => {
	it('starts the real adapter from a probe answer that arrived while the auth chunk loaded', async () => {
		const signedOut = readWhoami(null).state;
		const bea = readWhoami(whoamiOf('bea', 'member', 'd')).state;
		let chunk: () => void = () => {};
		let started: AuthSessionState | undefined;
		const adapter = new DeferredAuthAdapter(signedOut, async (current) => {
			await new Promise<void>((resolve) => {
				chunk = resolve;
			});
			started = current();
			return {
				getSession: () => started as AuthSessionState,
				onAuthStateChange: () => ({ unsubscribe() {} }),
			} as unknown as AuthAdapter;
		});
		const loading = adapter.load();
		adapter.apply(bea);
		chunk();
		await loading;
		expect(started).toMatchObject({ status: 'authenticated', user: { id: 'bea' } });
		expect(adapter.getSession()).toMatchObject({ user: { id: 'bea' } });
	});
});
