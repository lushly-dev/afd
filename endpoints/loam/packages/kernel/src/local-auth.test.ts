/**
 * `local` mode's identity adapter (D85, renamed by D162): a rename of the Mock's behaviour, not a change of it. The
 * same calls answer the same over `LocalAuthAdapter` as over `MockAuthAdapter`, on the same clock: sign-in, the
 * person's id, the session, its expiry, the session and passkey commands the late stage attaches, and sign-out.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalAuthAdapter } from './local-auth.js';
import { createScopedWorkspace } from './scope/fixtures.js';
import { createSteppingClock } from './session.js';
import type { LoamKernelV5 } from './types.js';

const kernels: LoamKernelV5[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

/** What a page does with its identity in `local` mode, each call's whole result in order. */
async function transcript(make: (clock: { now: () => number }) => MockAuthAdapter) {
	const clock = createSteppingClock();
	const auth = make({ now: clock });
	const made = await createScopedWorkspace({ empty: true, clock, auth });
	kernels.push(made.kernel);
	const { kernel } = made;
	const calls: [string, Record<string, unknown>?][] = [
		['auth-session-get'],
		['auth-sign-in', { method: 'credentials', email: 'bea@example.com', password: 'x' }],
		['auth-session-get'],
		['session-list'],
		['account-passkey-add', { name: 'Laptop' }],
		['account-passkey-list'],
		['auth-sign-out'],
		['auth-session-get'],
		['auth-sign-in', { method: 'passkey' }],
		['auth-session-get'],
		['session-revoke', { session: 'all' }],
		['auth-session-get'],
	];
	const results: unknown[] = [];
	for (const [name, input] of calls) {
		const result = await kernel.call(name, input ?? {});
		// The trace ID and the duration are per call, not the adapter's.
		results.push({ name, success: result.success, data: result.data, error: result.error });
	}
	return { results, auth };
}

describe("D162: `local` mode's identity is LocalAuthAdapter, the Mock's behaviour under its own name", () => {
	it('is its own class, which the shell constructs, and stays an AuthAdapter of the same shape', () => {
		const local = new LocalAuthAdapter();
		expect(local.constructor.name).toBe('LocalAuthAdapter');
		expect(LocalAuthAdapter).not.toBe(MockAuthAdapter);
		expect(local.getSession().status).toBe('unauthenticated');
	});

	it("signs in as the same person, by the same id, with an hour's session on the given clock", async () => {
		let now = Date.UTC(2026, 10, 21);
		const local = new LocalAuthAdapter({ clock: { now: () => now } });
		await local.signIn({ method: 'credentials', email: 'bea@example.com', password: 'x' });
		const state = local.getSession();
		expect(state.status).toBe('authenticated');
		if (state.status !== 'authenticated') return;
		expect(state.user).toEqual({
			id: 'mock-user-bea@example.com',
			email: 'bea@example.com',
			name: 'bea',
		});
		expect(state.session.expiresAt?.getTime()).toBe(now + 3_600_000);
		now += 3_600_000;
		await local.refresh();
		expect(local.getSession().status).toBe('unauthenticated');
	});

	it('answers every identity command exactly as the Mock did, the session and passkey capabilities included', async () => {
		const mock = await transcript((clock) => new MockAuthAdapter({ clock }));
		const local = await transcript((clock) => new LocalAuthAdapter({ clock }));
		expect(local.results).toEqual(mock.results);
		// Not a vacuous match: the calls succeed, and the late stage attached the capabilities to the local adapter.
		expect(local.results.filter((result) => (result as { success: boolean }).success)).toHaveLength(
			local.results.length
		);
		expect(local.auth.sessions).toBeDefined();
		expect(local.auth.passkeys).toBeDefined();
		expect(local.results[2]).toMatchObject({
			data: { user: { id: 'mock-user-bea@example.com' } },
		});
	}, 30_000); // Two workspaces' late stages, one after the other.
});
