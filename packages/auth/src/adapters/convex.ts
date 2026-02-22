/**
 * @fileoverview Convex auth adapter
 *
 * Bridges @convex-dev/auth React hooks to the AuthAdapter interface.
 * This is a React hook — must be called inside a component.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { AuthAdapter, AuthSessionState, SignInOptions, User } from '../types.js';
import { LOADING, UNAUTHENTICATED } from '../types.js';

export interface ConvexAuthAdapterOptions {
	/** Return value of useAuthActions() from @convex-dev/auth/react */
	useAuthActions: () => {
		signIn: (provider: string, params?: Record<string, unknown>) => Promise<void>;
		signOut: () => Promise<void>;
	};
	/** Return value of useConvexAuth() from convex/react */
	useConvexAuth: () => { isAuthenticated: boolean; isLoading: boolean };
	/** A Convex query hook that returns the current user, e.g. useQuery(api.users.me) */
	meQuery: () => User | null | undefined;
}

/**
 * React hook that creates an AuthAdapter backed by Convex.
 *
 * Must be called inside a ConvexProvider + ConvexAuthProvider tree.
 */
export function useConvexAuthAdapter(options: ConvexAuthAdapterOptions): AuthAdapter {
	const { signIn: convexSignIn, signOut: convexSignOut } = options.useAuthActions();
	const { isAuthenticated, isLoading } = options.useConvexAuth();
	const me = options.meQuery();

	const listenersRef = useRef(new Set<(state: AuthSessionState) => void>());
	const stateRef = useRef<AuthSessionState>(LOADING);

	// Derive current state
	let currentState: AuthSessionState;
	if (isLoading) {
		currentState = LOADING;
	} else if (isAuthenticated && me) {
		currentState = {
			status: 'authenticated',
			session: {
				id: `convex-${me.id}`,
				expiresAt: new Date(Date.now() + 86_400_000), // Synthetic — 24h
			},
			user: me,
		};
		if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
			// Dev-only warning for synthetic expiresAt
			console.debug(
				'[afd-auth] Convex adapter uses synthetic expiresAt — token lifecycle managed by Convex internally'
			);
		}
	} else {
		currentState = UNAUTHENTICATED;
	}

	// Notify listeners on state change
	const prevStatusRef = useRef(stateRef.current.status);
	stateRef.current = currentState;

	useEffect(() => {
		if (prevStatusRef.current !== currentState.status) {
			prevStatusRef.current = currentState.status;
			for (const listener of listenersRef.current) {
				listener(currentState);
			}
		}
	}, [currentState]);

	const signIn = useCallback(
		async (opts: SignInOptions): Promise<void> => {
			if (opts.method === 'credentials') {
				await convexSignIn('credentials', { email: opts.email, password: opts.password });
			} else {
				await convexSignIn(opts.provider);
			}
		},
		[convexSignIn]
	);

	const signOut = useCallback(async (): Promise<void> => {
		await convexSignOut();
	}, [convexSignOut]);

	const getSession = useCallback((): AuthSessionState => {
		return stateRef.current;
	}, []);

	const onAuthStateChange = useCallback(
		(callback: (state: AuthSessionState) => void): { unsubscribe: () => void } => {
			listenersRef.current.add(callback);
			return {
				unsubscribe: () => {
					listenersRef.current.delete(callback);
				},
			};
		},
		[]
	);

	return { signIn, signOut, getSession, onAuthStateChange };
}
