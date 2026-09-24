/**
 * @fileoverview Convex auth adapter
 *
 * Bridges @convex-dev/auth React hooks to the AuthAdapter interface.
 * This is a React hook — must be called inside a component.
 */

import { useEffect, useRef, useState } from 'react';
import { AuthAdapterError } from '../errors.js';
import { type ListenerErrorHandler, ListenerSet, reportListenerError } from '../listeners.js';
import { areSessionStatesEqual, areUsersEqual } from '../session-state.js';
import type {
	AuthAdapter,
	AuthSessionState,
	SignInOptions,
	SignInOutcome,
	User,
} from '../types.js';
import { LOADING, UNAUTHENTICATED } from '../types.js';
import { describeThrown, isKnownNetworkFailure } from './provider-errors.js';

/** Id of `Password()` from `@convex-dev/auth/providers/Password`. */
const DEFAULT_PASSWORD_PROVIDER_ID = 'password';

/** The part of `useAuthActions()` from `@convex-dev/auth/react` that the adapter calls. */
export interface ConvexAuthActions {
	/** Resolves with `{ signingIn, redirect? }` in @convex-dev/auth. */
	signIn: (provider: string, params?: Record<string, string>) => Promise<unknown>;
	signOut: () => Promise<void>;
}

export interface ConvexAuthAdapterOptions {
	/** Return value of useAuthActions() from @convex-dev/auth/react */
	useAuthActions: () => ConvexAuthActions;
	/** Return value of useConvexAuth() from convex/react */
	useConvexAuth: () => { isAuthenticated: boolean; isLoading: boolean };
	/**
	 * A Convex query hook that returns the current user, e.g. useQuery(api.users.me).
	 * While it returns `undefined` (still loading) the adapter reports `loading`.
	 * `null` while Convex is authenticated (no user document) is reported as
	 * `unauthenticated`.
	 */
	meQuery: () => User | null | undefined;
	/**
	 * Id of the Password provider used for `credentials` sign-in (default:
	 * `'password'`, the id of the stock `Password()` provider). Set it when the
	 * provider is configured with a custom `id`.
	 */
	passwordProviderId?: string;
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
 * Must be called inside a ConvexProvider + ConvexAuthProvider tree. It returns
 * the same adapter object on every render; the adapter always uses the latest
 * actions and options passed to the hook.
 */
export function useConvexAuthAdapter(options: ConvexAuthAdapterOptions): AuthAdapter {
	const actions = options.useAuthActions();
	const { isAuthenticated, isLoading } = options.useConvexAuth();
	const me = options.meQuery();

	const latest = useRef({ actions, options });
	latest.current = { actions, options };

	const stateRef = useRef<AuthSessionState>(LOADING);
	const notifiedStateRef = useRef<AuthSessionState>(LOADING);
	const [listeners] = useState(
		() =>
			new ListenerSet<AuthSessionState>((error) =>
				reportListenerError(error, latest.current.options.onListenerError)
			)
	);

	// Keep the previous object when its values are unchanged. Auth hooks may
	// rerender for unrelated Convex data, and useSyncExternalStore requires a
	// cached snapshot in that case.
	const previousState = stateRef.current;
	const nextState = deriveState(previousState, isLoading, isAuthenticated, me);
	const currentState = areSessionStatesEqual(previousState, nextState) ? previousState : nextState;
	stateRef.current = currentState;

	useEffect(() => {
		if (!areSessionStatesEqual(notifiedStateRef.current, currentState)) {
			notifiedStateRef.current = currentState;
			listeners.emit(currentState);
		}
	}, [currentState, listeners]);

	const [adapter] = useState<AuthAdapter>(() => ({
		signIn: (signInOptions) =>
			signInWithConvex(
				latest.current.actions,
				latest.current.options.passwordProviderId ?? DEFAULT_PASSWORD_PROVIDER_ID,
				signInOptions
			),
		signOut: async () => {
			try {
				await latest.current.actions.signOut();
			} catch (error) {
				throw mapConvexError(error, false);
			}
		},
		getSession: () => stateRef.current,
		onAuthStateChange: (callback) => listeners.add(callback),
	}));

	return adapter;
}

function deriveState(
	previous: AuthSessionState,
	isLoading: boolean,
	isAuthenticated: boolean,
	me: User | null | undefined
): AuthSessionState {
	if (isLoading) return LOADING;
	if (!isAuthenticated || me === null) return UNAUTHENTICATED;
	// The token is valid but the user query has not resolved yet.
	if (me === undefined) return LOADING;

	const previousUser = previous.status === 'authenticated' ? previous.user : null;
	return {
		status: 'authenticated',
		// Convex refreshes its JWT internally and does not expose an expiry, so
		// the session carries no expiresAt rather than an invented one.
		session:
			previous.status === 'authenticated' && previousUser?.id === me.id
				? previous.session
				: { id: `convex-${me.id}` },
		user: previousUser && areUsersEqual(previousUser, me) ? previousUser : me,
	};
}

async function signInWithConvex(
	actions: ConvexAuthActions,
	passwordProviderId: string,
	options: SignInOptions
): Promise<SignInOutcome> {
	const request = toSignInRequest(passwordProviderId, options);
	try {
		return toSignInOutcome(await actions.signIn(...request));
	} catch (error) {
		throw mapConvexError(error, options.method === 'credentials');
	}
}

/**
 * The stock Password provider signs in with `flow: 'signIn'`. OAuth providers
 * take only `redirectTo`; their scopes are part of the server-side provider
 * config, so scopes passed at sign-in are rejected rather than dropped.
 */
function toSignInRequest(
	passwordProviderId: string,
	options: SignInOptions
): [provider: string, params?: Record<string, string>] {
	if (options.method === 'credentials') {
		if (options.password === undefined) {
			throw new AuthAdapterError({
				code: 'INVALID_CREDENTIALS',
				message: 'A password is required to sign in with the Convex Password provider',
				suggestion: 'Provide the account password and try again',
			});
		}
		return [
			passwordProviderId,
			{ email: options.email, password: options.password, flow: 'signIn' },
		];
	}

	if (options.scopes !== undefined && options.scopes.length > 0) {
		throw new AuthAdapterError({
			code: 'PROVIDER_ERROR',
			message: 'Convex Auth does not accept OAuth scopes at sign-in',
			suggestion: `Configure scopes on the '${options.provider}' provider in convex/auth.ts, then sign in without scopes`,
		});
	}
	return options.redirectTo === undefined
		? [options.provider]
		: [options.provider, { redirectTo: options.redirectTo }];
}

/**
 * @convex-dev/auth resolves signIn() with `{ signingIn, redirect? }`: a
 * redirect starts an OAuth flow, and `signingIn: false` without one means a
 * further step (such as email verification) is needed.
 */
function toSignInOutcome(result: unknown): SignInOutcome {
	if (typeof result !== 'object' || result === null) return { kind: 'signed-in' };

	const redirect = 'redirect' in result ? result.redirect : undefined;
	if (redirect instanceof URL) return { kind: 'redirect', url: redirect.href };
	if (typeof redirect === 'string') return { kind: 'redirect', url: redirect };
	if ('signingIn' in result && result.signingIn === false) return { kind: 'pending' };
	return { kind: 'signed-in' };
}

/**
 * Map a Convex error to the codes the other adapters use. The Password
 * provider fails with `InvalidAccountId`, `InvalidSecret` or
 * `Invalid credentials`, and the account lock with `TooManyFailedAttempts`.
 * Production deployments hide server error text unless it is thrown as a
 * `ConvexError`, so those failures surface as PROVIDER_ERROR.
 */
function mapConvexError(error: unknown, credentials: boolean): AuthAdapterError {
	if (error instanceof AuthAdapterError) return error;

	const message = describeThrown(error);
	if (credentials && /InvalidAccountId|InvalidSecret|Invalid credentials/i.test(message)) {
		return AuthAdapterError.invalidCredentials();
	}
	if (/TooManyFailedAttempts/.test(message)) {
		return new AuthAdapterError({
			code: 'PROVIDER_ERROR',
			message: 'Too many failed sign-in attempts for this account',
			suggestion: 'Wait before trying again, or reset the password',
		});
	}
	if (isKnownNetworkFailure(error, message)) {
		return AuthAdapterError.networkError();
	}
	return AuthAdapterError.providerError('convex', message);
}
