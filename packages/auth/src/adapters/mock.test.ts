import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AuthSessionState } from '../types.js';
import { MockAuthAdapter } from './mock.js';

describe('MockAuthAdapter', () => {
	it('starts in unauthenticated state', () => {
		const adapter = new MockAuthAdapter();
		const state = adapter.getSession();
		expect(state.status).toBe('unauthenticated');
		expect(state.session).toBeNull();
		expect(state.user).toBeNull();
	});

	it('signs in with credentials', async () => {
		const adapter = new MockAuthAdapter();
		await adapter.signIn({ method: 'credentials', email: 'test@example.com' });
		const state = adapter.getSession();
		expect(state.status).toBe('authenticated');
		if (state.status === 'authenticated') {
			expect(state.user.email).toBe('test@example.com');
			expect(state.session.id).toMatch(/^mock-session-/);
		}
	});

	it('signs in with oauth', async () => {
		const adapter = new MockAuthAdapter();
		await adapter.signIn({ method: 'oauth', provider: 'github' });
		const state = adapter.getSession();
		expect(state.status).toBe('authenticated');
		if (state.status === 'authenticated') {
			expect(state.user.email).toBe('user@github.com');
		}
	});

	it('signs out', async () => {
		const adapter = new MockAuthAdapter();
		await adapter.signIn({ method: 'credentials', email: 'test@example.com' });
		expect(adapter.getSession().status).toBe('authenticated');

		await adapter.signOut();
		expect(adapter.getSession().status).toBe('unauthenticated');
	});

	it('notifies listeners on state change', async () => {
		const adapter = new MockAuthAdapter();
		const states: AuthSessionState[] = [];

		adapter.onAuthStateChange((state) => {
			states.push(state);
		});

		await adapter.signIn({ method: 'credentials', email: 'test@example.com' });
		await adapter.signOut();

		expect(states).toHaveLength(2);
		expect(states[0]?.status).toBe('authenticated');
		expect(states[1]?.status).toBe('unauthenticated');
	});

	it('supports unsubscribe', async () => {
		const adapter = new MockAuthAdapter();
		const states: AuthSessionState[] = [];

		const { unsubscribe } = adapter.onAuthStateChange((state) => {
			states.push(state);
		});

		await adapter.signIn({ method: 'credentials', email: 'test@example.com' });
		unsubscribe();
		await adapter.signOut();

		expect(states).toHaveLength(1);
		expect(states[0]?.status).toBe('authenticated');
	});

	it('resets via _reset()', async () => {
		const adapter = new MockAuthAdapter();
		await adapter.signIn({ method: 'credentials', email: 'test@example.com' });
		adapter._reset();
		expect(adapter.getSession().status).toBe('unauthenticated');
	});

	it('sets user via _setUser()', () => {
		const adapter = new MockAuthAdapter();
		const user = { id: 'u1', email: 'jane@example.com', name: 'Jane' };
		adapter._setUser(user);

		const state = adapter.getSession();
		expect(state.status).toBe('authenticated');
		if (state.status === 'authenticated') {
			expect(state.user).toEqual(user);
		}
	});

	it('sets loading via _setLoading()', () => {
		const adapter = new MockAuthAdapter();
		adapter._setLoading();
		expect(adapter.getSession().status).toBe('loading');
	});

	it('triggers errors via _triggerError()', () => {
		const adapter = new MockAuthAdapter();
		const error = adapter._triggerError('INVALID_CREDENTIALS');
		expect(error.code).toBe('INVALID_CREDENTIALS');
		expect(error.retryable).toBe(false);
	});

	it('tracks listener count via _getListenerCount()', () => {
		const adapter = new MockAuthAdapter();
		expect(adapter._getListenerCount()).toBe(0);

		const { unsubscribe: unsub1 } = adapter.onAuthStateChange(() => {});
		const { unsubscribe: unsub2 } = adapter.onAuthStateChange(() => {});
		expect(adapter._getListenerCount()).toBe(2);

		unsub1();
		expect(adapter._getListenerCount()).toBe(1);

		unsub2();
		expect(adapter._getListenerCount()).toBe(0);
	});

	it('supports configurable delay', async () => {
		const adapter = new MockAuthAdapter({ delay: 50 });
		const start = Date.now();
		await adapter.signIn({ method: 'credentials', email: 'test@example.com' });
		const elapsed = Date.now() - start;
		expect(elapsed).toBeGreaterThanOrEqual(40); // Allow slight timing variance
	});

	it('notifies multiple listeners', async () => {
		const adapter = new MockAuthAdapter();
		let count1 = 0;
		let count2 = 0;

		adapter.onAuthStateChange(() => {
			count1++;
		});
		adapter.onAuthStateChange(() => {
			count2++;
		});

		await adapter.signIn({ method: 'credentials', email: 'test@example.com' });
		expect(count1).toBe(1);
		expect(count2).toBe(1);
	});

	it('provides type-safe discriminated union narrowing', () => {
		const adapter = new MockAuthAdapter();
		const state = adapter.getSession();

		if (state.status === 'authenticated') {
			expectTypeOf(state.user).toEqualTypeOf<{
				id: string;
				email: string;
				name?: string;
				image?: string;
			}>();
			expectTypeOf(state.session).toEqualTypeOf<{ id: string; expiresAt: Date }>();
		}

		if (state.status === 'unauthenticated') {
			expectTypeOf(state.user).toBeNull();
			expectTypeOf(state.session).toBeNull();
		}

		if (state.status === 'loading') {
			expectTypeOf(state.user).toBeNull();
			expectTypeOf(state.session).toBeNull();
		}
	});
});
