// @vitest-environment jsdom

import type { ConvexAuthActionsContext } from '@convex-dev/auth/react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { AuthSessionState, User } from '../types.js';
import { type ConvexAuthAdapterOptions, useConvexAuthAdapter } from './convex.js';

describe('useConvexAuthAdapter', () => {
	const mockUser = { id: 'u1', email: 'test@example.com', name: 'Test' };

	/**
	 * `user: undefined` means the `me` query is still loading; omit `user` for
	 * a query that resolved with no user.
	 */
	function createMockOptions(
		overrides: {
			isAuthenticated?: boolean;
			isLoading?: boolean;
			user?: User | null | undefined;
		} = {}
	) {
		const state = { isAuthenticated: false, isLoading: false, user: null, ...overrides };
		const signIn = vi.fn<(provider: string, params?: Record<string, string>) => Promise<unknown>>(
			async () => ({ signingIn: true })
		);
		const signOut = vi.fn(async () => {});

		return {
			useAuthActions: () => ({ signIn, signOut }),
			useConvexAuth: () => ({
				isAuthenticated: state.isAuthenticated,
				isLoading: state.isLoading,
			}),
			meQuery: () => state.user,
			_signIn: signIn,
			_signOut: signOut,
			_state: state,
		};
	}

	it('accepts the real @convex-dev/auth actions', () => {
		expectTypeOf<ConvexAuthActionsContext>().toExtend<
			ReturnType<ConvexAuthAdapterOptions['useAuthActions']>
		>();
	});

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

	it('reports loading while the me query is loading, then the user', () => {
		const opts = createMockOptions({ isAuthenticated: true, user: undefined });
		const { result, rerender } = renderHook(() => useConvexAuthAdapter(opts));
		const states: string[] = [];
		result.current.onAuthStateChange((state) => states.push(state.status));

		expect(result.current.getSession().status).toBe('loading');

		opts._state.user = mockUser;
		rerender();

		expect(result.current.getSession().status).toBe('authenticated');
		expect(states).toEqual(['authenticated']);
	});

	it('reports unauthenticated when the me query resolves with no user', () => {
		const opts = createMockOptions({ isAuthenticated: true });
		const { result } = renderHook(() => useConvexAuthAdapter(opts));
		expect(result.current.getSession().status).toBe('unauthenticated');
	});

	it('does not invent an expiry for the Convex session', () => {
		vi.stubEnv('NODE_ENV', 'development');
		const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
		const opts = createMockOptions({ isAuthenticated: true, user: mockUser });
		const { result, rerender } = renderHook(() => useConvexAuthAdapter(opts));
		rerender();

		const session = result.current.getSession();
		expect(session.status === 'authenticated' && session.session).toEqual({ id: 'convex-u1' });
		expect(debug).not.toHaveBeenCalled();
		debug.mockRestore();
		vi.unstubAllEnvs();
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
			expect(updated.session).toBe(firstSnapshot.session);
		}
	});

	it('returns the same adapter on every render and uses the latest actions', async () => {
		const opts = createMockOptions();
		let signIn = vi.fn(async () => ({ signingIn: true }));
		const { result, rerender } = renderHook(() =>
			useConvexAuthAdapter({ ...opts, useAuthActions: () => ({ signIn, signOut: opts._signOut }) })
		);
		const first = result.current;

		signIn = vi.fn(async () => ({ signingIn: true }));
		rerender();

		expect(result.current).toBe(first);
		await act(async () => {
			await result.current.signIn({ method: 'oauth', provider: 'github' });
		});
		expect(signIn).toHaveBeenCalledWith('github');
	});

	describe('signIn', () => {
		it('signs in with the stock Password provider and the signIn flow', async () => {
			const opts = createMockOptions();
			const { result } = renderHook(() => useConvexAuthAdapter(opts));

			let outcome: unknown;
			await act(async () => {
				outcome = await result.current.signIn({
					method: 'credentials',
					email: 'test@example.com',
					password: 'pass',
				});
			});

			expect(opts._signIn).toHaveBeenCalledWith('password', {
				email: 'test@example.com',
				password: 'pass',
				flow: 'signIn',
			});
			expect(outcome).toEqual({ kind: 'signed-in' });
		});

		it('uses a configured password provider id', async () => {
			const opts = { ...createMockOptions(), passwordProviderId: 'password-custom' };
			const { result } = renderHook(() => useConvexAuthAdapter(opts));

			await result.current.signIn({ method: 'credentials', email: 'a@example.com', password: 'p' });

			expect(opts._signIn).toHaveBeenCalledWith('password-custom', {
				email: 'a@example.com',
				password: 'p',
				flow: 'signIn',
			});
		});

		it('rejects credentials without a password before calling Convex', async () => {
			const opts = createMockOptions();
			const { result } = renderHook(() => useConvexAuthAdapter(opts));

			await expect(
				result.current.signIn({ method: 'credentials', email: 'a@example.com' })
			).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', retryable: false });
			expect(opts._signIn).not.toHaveBeenCalled();
		});

		it('delegates oauth signIn to Convex and forwards redirectTo', async () => {
			const opts = createMockOptions();
			const { result } = renderHook(() => useConvexAuthAdapter(opts));

			await result.current.signIn({ method: 'oauth', provider: 'github' });
			await result.current.signIn({ method: 'oauth', provider: 'github', redirectTo: '/after' });
			await result.current.signIn({ method: 'oauth', provider: 'github', scopes: [] });

			expect(opts._signIn).toHaveBeenNthCalledWith(1, 'github');
			expect(opts._signIn).toHaveBeenNthCalledWith(2, 'github', { redirectTo: '/after' });
			expect(opts._signIn).toHaveBeenNthCalledWith(3, 'github');
		});

		it('rejects OAuth scopes, which Convex configures on the server', async () => {
			const opts = createMockOptions();
			const { result } = renderHook(() => useConvexAuthAdapter(opts));

			await expect(
				result.current.signIn({ method: 'oauth', provider: 'github', scopes: ['repo'] })
			).rejects.toMatchObject({
				code: 'PROVIDER_ERROR',
				message: 'Convex Auth does not accept OAuth scopes at sign-in',
			});
			expect(opts._signIn).not.toHaveBeenCalled();
		});

		it('reports redirect and pending outcomes', async () => {
			const opts = createMockOptions();
			const { result } = renderHook(() => useConvexAuthAdapter(opts));

			opts._signIn.mockResolvedValueOnce({
				signingIn: false,
				redirect: new URL('https://example.convex.site/api/auth/signin/github?code=1'),
			});
			await expect(result.current.signIn({ method: 'oauth', provider: 'github' })).resolves.toEqual(
				{
					kind: 'redirect',
					url: 'https://example.convex.site/api/auth/signin/github?code=1',
				}
			);

			opts._signIn.mockResolvedValueOnce({ signingIn: false, redirect: 'https://x.example/' });
			await expect(result.current.signIn({ method: 'oauth', provider: 'github' })).resolves.toEqual(
				{ kind: 'redirect', url: 'https://x.example/' }
			);

			opts._signIn.mockResolvedValueOnce({ signingIn: false });
			await expect(
				result.current.signIn({ method: 'credentials', email: 'a@example.com', password: 'p' })
			).resolves.toEqual({ kind: 'pending' });

			opts._signIn.mockResolvedValueOnce(undefined);
			await expect(result.current.signIn({ method: 'oauth', provider: 'github' })).resolves.toEqual(
				{ kind: 'signed-in' }
			);
		});

		it.each([
			['Uncaught Error: InvalidSecret', 'INVALID_CREDENTIALS'],
			['[CONVEX A(auth:signIn)] Uncaught Error: InvalidAccountId', 'INVALID_CREDENTIALS'],
			['Uncaught Error: Invalid credentials', 'INVALID_CREDENTIALS'],
			['Uncaught Error: TooManyFailedAttempts', 'PROVIDER_ERROR'],
			['Failed to fetch', 'NETWORK_ERROR'],
			['[Request ID: 1] Server Error', 'PROVIDER_ERROR'],
		])('maps a credentials failure "%s" to %s', async (message, code) => {
			const opts = createMockOptions();
			const { result } = renderHook(() => useConvexAuthAdapter(opts));
			opts._signIn.mockRejectedValueOnce(new Error(message));

			await expect(
				result.current.signIn({ method: 'credentials', email: 'a@example.com', password: 'p' })
			).rejects.toMatchObject({ code, suggestion: expect.any(String) });
		});

		it('reads the data of a ConvexError and does not treat OAuth errors as bad credentials', async () => {
			const opts = createMockOptions();
			const { result } = renderHook(() => useConvexAuthAdapter(opts));
			const convexError = Object.assign(new Error('ConvexError'), { data: 'InvalidSecret' });

			opts._signIn.mockRejectedValueOnce(convexError);
			await expect(
				result.current.signIn({ method: 'credentials', email: 'a@example.com', password: 'p' })
			).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

			opts._signIn.mockRejectedValueOnce('Invalid credentials');
			await expect(
				result.current.signIn({ method: 'oauth', provider: 'github' })
			).rejects.toMatchObject({
				code: 'PROVIDER_ERROR',
				message: "Authentication provider 'convex' error: Invalid credentials",
			});
		});
	});

	it('delegates signOut to Convex signOut and maps its errors', async () => {
		const opts = createMockOptions();
		const { result } = renderHook(() => useConvexAuthAdapter(opts));

		await act(async () => {
			await result.current.signOut();
		});
		expect(opts._signOut).toHaveBeenCalled();

		opts._signOut.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await expect(result.current.signOut()).rejects.toMatchObject({
			code: 'NETWORK_ERROR',
			retryable: true,
		});
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
		const opts = createMockOptions({ isAuthenticated: true, user: mockUser });
		const { result, rerender } = renderHook(() => useConvexAuthAdapter(opts));

		const states: AuthSessionState[] = [];
		const { unsubscribe } = result.current.onAuthStateChange((state) => {
			states.push(state);
		});
		unsubscribe();
		opts._state.isAuthenticated = false;
		rerender();

		expect(states).toEqual([]);
	});
});
