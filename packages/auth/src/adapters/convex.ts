/**
 * @fileoverview Convex auth adapter
 *
 * Bridges @convex-dev/auth React hooks to the AuthAdapter interface.
 * This is a React hook — must be called inside a component.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { type ListenerErrorHandler, ListenerSet, reportListenerError } from '../listeners.js';
import { areSessionStatesEqual, areUsersEqual } from '../session-state.js';
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
	/**
	 * Receives errors thrown by `onAuthStateChange` subscribers. Without it,
	 * they are rethrown in a microtask. Either way the other subscribers still
	 * run.
	 */
	onListenerError?: ListenerErrorHandler;
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

	const onListenerErrorRef = useRef(options.onListenerError);
	onListenerErrorRef.current = options.onListenerError;
	const [listeners] = useState(
		() =>
			new ListenerSet<AuthSessionState>((error) =>
				reportListenerError(error, onListenerErrorRef.current)
			)
	);
	const stateRef = useRef<AuthSessionState>(LOADING);
	const notifiedStateRef = useRef<AuthSessionState>(LOADING);

	// Derive a state while retaining the previous object when its meaningful
	// values are unchanged. Auth hooks may rerender for unrelated Convex data,
	// and useSyncExternalStore requires a cached snapshot in that case.
	const previousState = stateRef.current;
	let nextState: AuthSessionState;
	if (isLoading) {
		nextState = LOADING;
	} else if (isAuthenticated && me) {
		const previousSession =
			previousState.status === 'authenticated' && previousState.user.id === me.id
				? previousState.session
				: {
						id: `convex-${me.id}`,
						expiresAt: new Date(Date.now() + 86_400_000), // Synthetic — 24h
					};
		nextState = {
			status: 'authenticated',
			session: previousSession,
			user:
				previousState.status === 'authenticated' && areUsersEqual(previousState.user, me)
					? previousState.user
					: me,
		};
		if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
			// Dev-only warning for synthetic expiresAt
			console.debug(
				'[afd-auth] Convex adapter uses synthetic expiresAt — token lifecycle managed by Convex internally'
			);
		}
	} else {
		nextState = UNAUTHENTICATED;
	}

	const currentState = areSessionStatesEqual(previousState, nextState) ? previousState : nextState;
	stateRef.current = currentState;

	useEffect(() => {
		if (!areSessionStatesEqual(notifiedStateRef.current, currentState)) {
			notifiedStateRef.current = currentState;
			listeners.emit(currentState);
		}
	}, [currentState, listeners]);

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
		(callback: (state: AuthSessionState) => void): { unsubscribe: () => void } =>
			listeners.add(callback),
		[listeners]
	);

	return { signIn, signOut, getSession, onAuthStateChange };
}
