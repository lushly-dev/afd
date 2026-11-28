/**
 * @fileoverview Convex auth adapter
 *
 * Bridges @convex-dev/auth React hooks to the AuthAdapter interface, for the
 * 0.0.x line (`useAuthActions().signIn`) and the 2.x line (a hook per method).
 * This is a React hook — must be called inside a component.
 */

import { useEffect, useRef, useState } from 'react';
import { AuthAdapterError, passkeyUnsupported } from '../errors.js';
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
import {
	type ConvexOauthSignIn,
	type ConvexPasswordSignIn,
	type ConvexV2SignIns,
	signInWithConvexV2,
} from './convex-v2.js';
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
	/** 2.x options only; with `useAuthActions`, the 0.0.x shape signs out through it. */
	signOut?: never;
	/** 2.x options only. */
	signInWithPassword?: never;
	/** 2.x options only. */
	oauth?: never;
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
 * Options for `@convex-dev/auth` 2.x, where each sign-in method has its own
 * hook. Call those hooks in the component and pass the functions they return.
 * Only the methods passed can sign in; the others reject with PROVIDER_ERROR.
 */
export interface ConvexAuthV2AdapterOptions extends ConvexV2SignIns {
	/** 0.0.x options only: its presence selects the 0.0.x shape. */
	useAuthActions?: never;
	/** `useAuthActions().signOut` from `@convex-dev/auth/react` 2.x. */
	signOut: () => Promise<void>;
	/**
	 * `useSignInWithEmailPassword(api.auth).signIn` from
	 * `@convex-dev/auth/methods/email-password/react`, for `credentials` sign-in.
	 */
	signInWithPassword?: ConvexPasswordSignIn;
	/**
	 * OAuth sign-in by provider id, the `provider` of an `oauth` sign-in: for
	 * example `{ github: useSignInWithGithub(api.auth).signIn }`.
	 */
	oauth?: Readonly<Record<string, ConvexOauthSignIn>>;
	/** Return value of useConvexAuth() from convex/react */
	useConvexAuth: () => { isAuthenticated: boolean; isLoading: boolean };
	/** As in {@link ConvexAuthAdapterOptions.meQuery}. */
	meQuery: () => User | null | undefined;
	/** As in {@link ConvexAuthAdapterOptions.onListenerError}. */
	onListenerError?: ListenerErrorHandler;
}

/**
 * React hook that creates an AuthAdapter backed by Convex.
 *
 * Pass {@link ConvexAuthAdapterOptions} (`useAuthActions`) for
 * `@convex-dev/auth` 0.0.x and {@link ConvexAuthV2AdapterOptions}
 * (`signOut` and the method sign-in functions) for 2.x. Keep to one shape for
 * the component's life: the 0.0.x shape calls `useAuthActions` as a hook.
 *
 * Must be called inside a ConvexProvider + ConvexAuthProvider tree. It returns
 * the same adapter object on every render; the adapter always uses the latest
 * actions and options passed to the hook.
 */
export function useConvexAuthAdapter(
	options: ConvexAuthAdapterOptions | ConvexAuthV2AdapterOptions
): AuthAdapter {
	const backend: ConvexBackend = isV2Options(options)
		? { version: 2, options }
		: // biome-ignore lint/correctness/useHookAtTopLevel: the options keep one shape for the component's life (see above), so this runs on every render or on none
			{ version: 0, options, actions: options.useAuthActions() };
	const { isAuthenticated, isLoading } = options.useConvexAuth();
	const me = options.meQuery();

	const latest = useRef(backend);
	latest.current = backend;

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
		signIn: (signInOptions) => {
			const current = latest.current;
			if (current.version === 2) {
				return signInWithConvexV2(current.options, signInOptions, mapConvexError);
			}
			return signInWithConvex(
				current.actions,
				current.options.passwordProviderId ?? DEFAULT_PASSWORD_PROVIDER_ID,
				signInOptions
			);
		},
		signOut: async () => {
			const current = latest.current;
			try {
				await (current.version === 2 ? current.options : current.actions).signOut();
			} catch (error) {
				throw mapConvexError(error, false);
			}
		},
		getSession: () => stateRef.current,
		onAuthStateChange: (callback) => listeners.add(callback),
	}));

	return adapter;
}

/** Which @convex-dev/auth line the options are for, with what each one signs in through. */
type ConvexBackend =
	| { version: 0; options: ConvexAuthAdapterOptions; actions: ConvexAuthActions }
	| { version: 2; options: ConvexAuthV2AdapterOptions };

function isV2Options(
	options: ConvexAuthAdapterOptions | ConvexAuthV2AdapterOptions
): options is ConvexAuthV2AdapterOptions {
	return options.useAuthActions === undefined;
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

	if (options.method === 'passkey') {
		// The Convex adapter has no passkey sign-in.
		throw passkeyUnsupported();
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
