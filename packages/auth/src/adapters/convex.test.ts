// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthSessionState } from '../types.js';
import { useConvexAuthAdapter } from './convex.js';

describe('useConvexAuthAdapter', () => {
	const mockUser = { id: 'u1', email: 'test@example.com', name: 'Test' };

	function createMockOptions(
		overrides: {
			isAuthenticated?: boolean;
			isLoading?: boolean;
			user?: typeof mockUser | null | undefined;
		} = {}
	) {
		const signIn = vi.fn();
		const signOut = vi.fn();

		return {
			useAuthActions: () => ({ signIn, signOut }),
			useConvexAuth: () => ({
				isAuthenticated: overrides.isAuthenticated ?? false,
				isLoading: overrides.isLoading ?? false,
			}),
			meQuery: () => (overrides.user === undefined ? null : overrides.user),
			_signIn: signIn,
			_signOut: signOut,
			_state: overrides,
		};
	}

	it('returns loading state when Convex is loading', () => {
		const opts = createMockOptions({ isLoading: true });
		const { result } = renderHook(() => useConvexAuthAdapter(opts));
		expect(result.current.getSession().status).toBe('loading');
	});

	it('returns unauthenticated when not authenticated', () => {
		const opts = createMockOptions({ isAuthenticated: false });
		const { result } = renderHook(() => useConvexAuthAdapter(opts));
		expect(result.current.getSession().status).toBe('unauthenticated');
	});

	it('returns authenticated when Convex has user', () => {
		const opts = createMockOptions({ isAuthenticated: true, user: mockUser });
		const { result } = renderHook(() => useConvexAuthAdapter(opts));

		const session = result.current.getSession();
		expect(session.status).toBe('authenticated');
		if (session.status === 'authenticated') {
			expect(session.user.email).toBe('test@example.com');
			expect(session.session.id).toContain('convex-');
		}
	});

	it('notifies on same-status profile changes and keeps unchanged snapshots stable', () => {
		const opts = createMockOptions({ isAuthenticated: true, user: mockUser });
		const { result, rerender } = renderHook(() => useConvexAuthAdapter(opts));
		const firstSnapshot = result.current.getSession();
		const states: AuthSessionState[] = [];
		result.current.onAuthStateChange((state) => states.push(state));

		rerender();
		expect(result.current.getSession()).toBe(firstSnapshot);
		expect(states).toHaveLength(0);

		opts._state.user = { ...mockUser, name: 'Updated' };
		rerender();

		expect(states).toHaveLength(1);
		const updated = result.current.getSession();
		expect(updated.status).toBe('authenticated');
		if (updated.status === 'authenticated') {
			expect(updated.user.name).toBe('Updated');
		}
	});

	it('delegates signIn to Convex signIn', async () => {
		const opts = createMockOptions();
		const { result } = renderHook(() => useConvexAuthAdapter(opts));

		await act(async () => {
			await result.current.signIn({
				method: 'credentials',
				email: 'test@example.com',
				password: 'pass',
			});
		});

		expect(opts._signIn).toHaveBeenCalledWith('credentials', {
			email: 'test@example.com',
			password: 'pass',
		});
	});

	it('delegates oauth signIn to Convex', async () => {
		const opts = createMockOptions();
		const { result } = renderHook(() => useConvexAuthAdapter(opts));

		await act(async () => {
			await result.current.signIn({ method: 'oauth', provider: 'github' });
		});

		expect(opts._signIn).toHaveBeenCalledWith('github');
	});

	it('delegates signOut to Convex signOut', async () => {
		const opts = createMockOptions();
		const { result } = renderHook(() => useConvexAuthAdapter(opts));

		await act(async () => {
			await result.current.signOut();
		});

		expect(opts._signOut).toHaveBeenCalled();
	});

	it('keeps notifying later listeners when one throws', () => {
		const errors: unknown[] = [];
		const opts = {
			...createMockOptions({ isAuthenticated: true, user: mockUser }),
			onListenerError: (error: unknown) => errors.push(error),
		};
		const { result, rerender } = renderHook(() => useConvexAuthAdapter(opts));
		const failure = new Error('listener failed');
		const seen: string[] = [];
		result.current.onAuthStateChange(() => {
			throw failure;
		});
		result.current.onAuthStateChange((state) => seen.push(state.status));

		opts._state.isAuthenticated = false;
		expect(() => rerender()).not.toThrow();

		expect(seen).toEqual(['unauthenticated']);
		expect(errors).toEqual([failure]);
	});

	it('supports onAuthStateChange subscribe/unsubscribe', () => {
		const opts = createMockOptions();
		const { result } = renderHook(() => useConvexAuthAdapter(opts));

		const states: AuthSessionState[] = [];
		const { unsubscribe } = result.current.onAuthStateChange((state) => {
			states.push(state);
		});

		expect(typeof unsubscribe).toBe('function');
		unsubscribe();
	});
});
