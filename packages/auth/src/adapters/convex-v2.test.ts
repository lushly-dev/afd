// @vitest-environment jsdom

import type { useSignInWithEmailPassword } from '@convex-dev/auth-v2/methods/email-password/react';
import type { useSignInWithGithub } from '@convex-dev/auth-v2/methods/github/react';
import type { useSignInWithGoogle } from '@convex-dev/auth-v2/methods/google/react';
import type { ConvexAuthActionsContextType } from '@convex-dev/auth-v2/react';
import { renderHook } from '@testing-library/react';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { AuthAdapterError } from '../errors.js';
import type { User } from '../types.js';
import { type ConvexAuthV2AdapterOptions, useConvexAuthAdapter } from './convex.js';
import type {
	ConvexOauthSignIn,
	ConvexOauthStartResult,
	ConvexPasswordSignIn,
	ConvexPasswordSignInResult,
} from './convex-v2.js';

describe('useConvexAuthAdapter with @convex-dev/auth 2.x', () => {
	const mockUser: User = { id: 'u1', email: 'test@example.com', name: 'Test' };

	function createOptions(
		overrides: Partial<Pick<ConvexAuthV2AdapterOptions, 'signInWithPassword' | 'oauth'>> = {}
	) {
		const state: { isAuthenticated: boolean; isLoading: boolean; user: User | null | undefined } = {
			isAuthenticated: false,
			isLoading: false,
			user: null,
		};
		const signOut = vi.fn(async () => {});
		const signInWithPassword = vi.fn<ConvexPasswordSignIn>(async () => ({ status: 'complete' }));
		const github = vi.fn<ConvexOauthSignIn>(async () => ({
			status: 'redirect',
			redirect: new URL('https://github.com/login/oauth/authorize?state=s'),
		}));
		const options: ConvexAuthV2AdapterOptions = {
			signOut,
			signInWithPassword,
			oauth: { github },
			useConvexAuth: () => ({ isAuthenticated: state.isAuthenticated, isLoading: state.isLoading }),
			meQuery: () => state.user,
			...overrides,
		};
		return { options, state, signOut, signInWithPassword, github };
	}

	async function rejection(promise: Promise<unknown>): Promise<AuthAdapterError> {
		const error = await promise.then(
			() => undefined,
			(thrown: unknown) => thrown
		);
		expect(error).toBeInstanceOf(AuthAdapterError);
		return error as AuthAdapterError;
	}

	it('accepts the real 2.x sign-in and sign-out functions', () => {
		expectTypeOf<
			ReturnType<typeof useSignInWithEmailPassword>['signIn']
		>().toExtend<ConvexPasswordSignIn>();
		expectTypeOf<ReturnType<typeof useSignInWithGithub>['signIn']>().toExtend<ConvexOauthSignIn>();
		expectTypeOf<ReturnType<typeof useSignInWithGoogle>['signIn']>().toExtend<ConvexOauthSignIn>();
		expectTypeOf<ConvexAuthActionsContextType['signOut']>().toExtend<
			ConvexAuthV2AdapterOptions['signOut']
		>();
		expectTypeOf<
			Awaited<ReturnType<ReturnType<typeof useSignInWithEmailPassword>['signIn']>>
		>().toExtend<ConvexPasswordSignInResult>();
		expectTypeOf<
			Awaited<ReturnType<ReturnType<typeof useSignInWithGithub>['signIn']>>
		>().toExtend<ConvexOauthStartResult>();
	});

	it('refuses options that mix the 0.0.x and 2.x shapes', () => {
		const v2 = createOptions().options;
		const v0Actions = () => ({ signIn: async () => ({}), signOut: async () => {} });
		type Options = Parameters<typeof useConvexAuthAdapter>[0];
		// @ts-expect-error useAuthActions selects the 0.0.x shape, which takes no signOut
		const withSignOut: Options = { ...v2, useAuthActions: v0Actions };
		const { signOut: _signOut, ...v2SignIns } = v2;
		// @ts-expect-error the 0.0.x shape takes no 2.x sign-in functions
		const withSignIns: Options = { ...v2SignIns, useAuthActions: v0Actions };
		expect([withSignOut, withSignIns]).toHaveLength(2);
	});

	it('treats an explicitly undefined useAuthActions as the 2.x shape', async () => {
		const { options, signOut } = createOptions();
		const { result } = renderHook(() =>
			useConvexAuthAdapter({ ...options, useAuthActions: undefined })
		);
		await result.current.signOut();
		expect(signOut).toHaveBeenCalledTimes(1);
	});

	it('derives the session from useConvexAuth and meQuery, as with 0.0.x', () => {
		const { options, state } = createOptions();
		const { result, rerender } = renderHook(() => useConvexAuthAdapter(options));
		expect(result.current.getSession().status).toBe('unauthenticated');

		state.isAuthenticated = true;
		state.user = mockUser;
		rerender();
		const session = result.current.getSession();
		expect(session.status === 'authenticated' && session.session).toEqual({ id: 'convex-u1' });
	});

	it('signs in with email and password', async () => {
		const { options, signInWithPassword } = createOptions();
		const { result } = renderHook(() => useConvexAuthAdapter(options));

		await expect(
			result.current.signIn({ method: 'credentials', email: 'a@b.c', password: 'pw' })
		).resolves.toEqual({ kind: 'signed-in' });
		expect(signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw' });
	});

	it.each([
		'INVALID_CREDENTIALS',
		'USER_NOT_FOUND',
		'PASSWORD_TOO_SHORT',
		'PASSWORD_TOO_LONG',
		'PASSWORD_HAS_SURROUNDING_WHITESPACE',
	])('maps %s to INVALID_CREDENTIALS', async (code) => {
		const { options } = createOptions({
			signInWithPassword: async () => ({ status: 'error', userError: { error: code } }),
		});
		const { result } = renderHook(() => useConvexAuthAdapter(options));

		const error = await rejection(
			result.current.signIn({ method: 'credentials', email: 'a@b.c', password: 'pw' })
		);
		expect(error.code).toBe('INVALID_CREDENTIALS');
	});

	it('reports a rate limit with how long to wait', async () => {
		const { options } = createOptions({
			signInWithPassword: async () => ({
				status: 'error',
				userError: { error: 'RATE_LIMITED', retryAfterMs: 1500 },
			}),
		});
		const { result } = renderHook(() => useConvexAuthAdapter(options));

		const error = await rejection(
			result.current.signIn({ method: 'credentials', email: 'a@b.c', password: 'pw' })
		);
		expect(error.code).toBe('PROVIDER_ERROR');
		expect(error.suggestion).toContain('Wait 2 seconds');
	});

	it('says one second, not one seconds', async () => {
		const { options } = createOptions({
			signInWithPassword: async () => ({
				status: 'error',
				userError: { error: 'RATE_LIMITED', retryAfterMs: 400 },
			}),
		});
		const { result } = renderHook(() => useConvexAuthAdapter(options));

		const error = await rejection(
			result.current.signIn({ method: 'credentials', email: 'a@b.c', password: 'pw' })
		);
		expect(error.suggestion).toContain('Wait 1 second before');
	});

	it('maps an OTHER_ERROR from a failed fetch to NETWORK_ERROR', async () => {
		const { options } = createOptions({
			signInWithPassword: async () => ({
				status: 'error',
				userError: { error: 'OTHER_ERROR', cause: new TypeError('Failed to fetch') },
			}),
		});
		const { result } = renderHook(() => useConvexAuthAdapter(options));

		const error = await rejection(
			result.current.signIn({ method: 'credentials', email: 'a@b.c', password: 'pw' })
		);
		expect(error.code).toBe('NETWORK_ERROR');
	});

	it('rejects credentials without a password, or without signInWithPassword', async () => {
		const { options, signInWithPassword } = createOptions();
		const { result } = renderHook(() => useConvexAuthAdapter(options));
		const missingPassword = await rejection(
			result.current.signIn({ method: 'credentials', email: 'a@b.c' })
		);
		expect(missingPassword.code).toBe('INVALID_CREDENTIALS');
		expect(signInWithPassword).not.toHaveBeenCalled();

		const { options: noPassword } = createOptions({ signInWithPassword: undefined });
		const { result: other } = renderHook(() => useConvexAuthAdapter(noPassword));
		const unconfigured = await rejection(
			other.current.signIn({ method: 'credentials', email: 'a@b.c', password: 'pw' })
		);
		expect(unconfigured.code).toBe('PROVIDER_ERROR');
		expect(unconfigured.suggestion).toContain('useSignInWithEmailPassword');
	});

	it('starts an OAuth flow and reports the redirect, forwarding redirectTo', async () => {
		const { options, github } = createOptions();
		const { result } = renderHook(() => useConvexAuthAdapter(options));

		await expect(result.current.signIn({ method: 'oauth', provider: 'github' })).resolves.toEqual({
			kind: 'redirect',
			url: 'https://github.com/login/oauth/authorize?state=s',
		});
		expect(github).toHaveBeenLastCalledWith(undefined);

		await result.current.signIn({ method: 'oauth', provider: 'github', redirectTo: '/home' });
		expect(github).toHaveBeenLastCalledWith({ redirectTo: '/home' });
	});

	it('rejects OAuth scopes, an unconfigured provider and a passkey', async () => {
		const { options, github } = createOptions();
		const { result } = renderHook(() => useConvexAuthAdapter(options));

		const scopes = await rejection(
			result.current.signIn({ method: 'oauth', provider: 'github', scopes: ['repo'] })
		);
		expect(scopes.code).toBe('PROVIDER_ERROR');
		expect(github).not.toHaveBeenCalled();

		const unknown = await rejection(result.current.signIn({ method: 'oauth', provider: 'google' }));
		expect(unknown.code).toBe('PROVIDER_ERROR');
		expect(unknown.suggestion).toContain("'google'");

		const inherited = await rejection(
			result.current.signIn({ method: 'oauth', provider: 'toString' })
		);
		expect(inherited.code).toBe('PROVIDER_ERROR');

		const passkey = await rejection(result.current.signIn({ method: 'passkey' }));
		expect(passkey.code).toBe('PASSKEY_UNSUPPORTED');
	});

	it('maps an OAuth start failure and a thrown sign-in function', async () => {
		const { options } = createOptions({
			oauth: {
				github: async () => ({
					status: 'error',
					userError: { error: 'OTHER_ERROR', cause: new Error('Server Error') },
				}),
				google: async () => {
					throw new TypeError('Failed to fetch');
				},
			},
		});
		const { result } = renderHook(() => useConvexAuthAdapter(options));

		const failed = await rejection(result.current.signIn({ method: 'oauth', provider: 'github' }));
		expect(failed.code).toBe('PROVIDER_ERROR');
		const thrown = await rejection(result.current.signIn({ method: 'oauth', provider: 'google' }));
		expect(thrown.code).toBe('NETWORK_ERROR');
	});

	it('ignores a rate limit wait that is not a positive number', async () => {
		const { options } = createOptions({
			signInWithPassword: async () => ({
				status: 'error',
				userError: { error: 'RATE_LIMITED', retryAfterMs: Number.NaN },
			}),
		});
		const { result } = renderHook(() => useConvexAuthAdapter(options));

		const error = await rejection(
			result.current.signIn({ method: 'credentials', email: 'a@b.c', password: 'pw' })
		);
		expect(error.suggestion).toBe('Wait before trying again, or reset the password');
	});

	it('maps a failed sign-out', async () => {
		const { options } = createOptions();
		const { result } = renderHook(() =>
			useConvexAuthAdapter({
				...options,
				signOut: async () => {
					throw new TypeError('Failed to fetch');
				},
			})
		);
		const error = await rejection(result.current.signOut());
		expect(error.code).toBe('NETWORK_ERROR');
	});

	it('signs out through the passed signOut and uses the latest functions', async () => {
		const { options, signOut } = createOptions();
		const { result, rerender } = renderHook((props) => useConvexAuthAdapter(props), {
			initialProps: options,
		});
		const adapter = result.current;
		await adapter.signOut();
		expect(signOut).toHaveBeenCalledTimes(1);

		const later = vi.fn(async () => {});
		rerender({ ...options, signOut: later });
		expect(result.current).toBe(adapter);
		await adapter.signOut();
		expect(later).toHaveBeenCalledTimes(1);
		expect(signOut).toHaveBeenCalledTimes(1);
	});
});
