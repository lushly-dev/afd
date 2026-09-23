import { describe, expect, it } from 'vitest';
import { areSessionStatesEqual, areUsersEqual } from './session-state.js';
import type { AuthSessionState } from './types.js';
import { LOADING, UNAUTHENTICATED } from './types.js';

function authenticated(
	overrides: { sessionId?: string; expiresAt?: Date; name?: string } = {}
): AuthSessionState {
	return {
		status: 'authenticated',
		session: {
			id: overrides.sessionId ?? 's1',
			expiresAt: overrides.expiresAt ?? new Date('2030-01-01T00:00:00Z'),
		},
		user: { id: 'u1', email: 'one@example.com', name: overrides.name ?? 'One' },
	};
}

describe('areSessionStatesEqual', () => {
	it('compares non-authenticated states by status', () => {
		expect(areSessionStatesEqual(LOADING, { status: 'loading', session: null, user: null })).toBe(
			true
		);
		expect(areSessionStatesEqual(LOADING, UNAUTHENTICATED)).toBe(false);
		expect(areSessionStatesEqual(UNAUTHENTICATED, authenticated())).toBe(false);
	});

	it('compares authenticated states by value, not identity', () => {
		expect(areSessionStatesEqual(authenticated(), authenticated())).toBe(true);
		expect(areSessionStatesEqual(authenticated(), authenticated({ sessionId: 's2' }))).toBe(false);
		expect(areSessionStatesEqual(authenticated(), authenticated({ name: 'Renamed' }))).toBe(false);
		expect(
			areSessionStatesEqual(
				authenticated(),
				authenticated({ expiresAt: new Date('2031-01-01T00:00:00Z') })
			)
		).toBe(false);
	});
});

describe('areUsersEqual', () => {
	it('compares every profile field', () => {
		const user = { id: 'u1', email: 'one@example.com', name: 'One', image: 'a.png' };
		expect(areUsersEqual(user, { ...user })).toBe(true);
		expect(areUsersEqual(user, { ...user, image: 'b.png' })).toBe(false);
		expect(areUsersEqual(user, { ...user, email: 'two@example.com' })).toBe(false);
	});
});
