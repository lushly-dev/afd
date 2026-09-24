// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MockAuthAdapter } from './adapters/mock.js';
import { createAuthHooks } from './react.js';
import type { AuthAdapter, AuthSessionState } from './types.js';
import { UNAUTHENTICATED } from './types.js';

describe('createAuthHooks', () => {
	describe('useAuth', () => {
		it('returns the adapter instance', () => {
			const adapter = new MockAuthAdapter();
			const { useAuth } = createAuthHooks(adapter);
			const { result } = renderHook(() => useAuth());
			expect(result.current).toBe(adapter);
		});
	});

	describe('useSession', () => {
		it('returns current session state', () => {
			const adapter = new MockAuthAdapter();
			const { useSession } = createAuthHooks(adapter);
			const { result } = renderHook(() => useSession());
			expect(result.current.status).toBe('unauthenticated');
		});

		it('updates when auth state changes', async () => {
			const adapter = new MockAuthAdapter();
			const { useSession } = createAuthHooks(adapter);
			const { result } = renderHook(() => useSession());

			expect(result.current.status).toBe('unauthenticated');

			await act(async () => {
				adapter._setUser({ id: 'u1', email: 'test@example.com' });
			});

			expect(result.current.status).toBe('authenticated');
			if (result.current.status === 'authenticated') {
				expect(result.current.user.email).toBe('test@example.com');
			}
		});
	});

	describe('useUser', () => {
		it('returns null when unauthenticated', () => {
			const adapter = new MockAuthAdapter();
			const { useUser } = createAuthHooks(adapter);
			const { result } = renderHook(() => useUser());
			expect(result.current).toBeNull();
		});

		it('returns user when authenticated', async () => {
			const adapter = new MockAuthAdapter();
			const { useUser } = createAuthHooks(adapter);
			const { result } = renderHook(() => useUser());

			await act(async () => {
				adapter._setUser({ id: 'u1', email: 'test@example.com', name: 'Test' });
			});

			expect(result.current).toEqual({
				id: 'u1',
				email: 'test@example.com',
				name: 'Test',
			});
		});
	});

	it('observes a state change that occurs while the subscription is attaching', () => {
		let state: AuthSessionState = UNAUTHENTICATED;
		const listeners = new Set<() => void>();
		const authenticated: AuthSessionState = {
			status: 'authenticated',
			session: { id: 's1', expiresAt: new Date('2026-12-31T00:00:00Z') },
			user: { id: 'u1', email: 'test@example.com' },
		};
		const adapter: AuthAdapter = {
			signIn: async () => {},
			signOut: async () => {},
			getSession: () => state,
			onAuthStateChange: (callback) => {
				listeners.add(() => callback(state));
				// Simulate a provider update between render and subscription's
				// post-subscribe consistency check without emitting an event.
				state = authenticated;
				return {
					unsubscribe: () => {
						listeners.clear();
					},
				};
			},
		};
		const { useSession } = createAuthHooks(adapter);

		const { result } = renderHook(() => useSession());

		expect(result.current).toBe(authenticated);
	});

	it('caches semantically equivalent snapshots from adapters that allocate on every read', async () => {
		let state: AuthSessionState = UNAUTHENTICATED;
		const listeners = new Set<(state: AuthSessionState) => void>();
		const adapter: AuthAdapter = {
			signIn: async () => {},
			signOut: async () => {},
			getSession: () =>
				state.status === 'authenticated'
					? {
							status: 'authenticated',
							session: {
								id: state.session.id,
								expiresAt: state.session.expiresAt && new Date(state.session.expiresAt),
							},
							user: { ...state.user },
						}
					: { status: state.status, session: null, user: null },
			onAuthStateChange: (callback) => {
				listeners.add(callback);
				return { unsubscribe: () => listeners.delete(callback) };
			},
		};
		const { useSession } = createAuthHooks(adapter);
		const { result, rerender } = renderHook(() => useSession());
		const initialSnapshot = result.current;

		rerender();
		expect(result.current).toBe(initialSnapshot);

		state = {
			status: 'authenticated',
			session: { id: 's1', expiresAt: new Date('2026-12-31T00:00:00Z') },
			user: { id: 'u1', email: 'test@example.com' },
		};
		await act(async () => {
			for (const listener of listeners) listener(state);
		});

		const authenticatedSnapshot = result.current;
		rerender();
		expect(result.current).toBe(authenticatedSnapshot);
	});
});
