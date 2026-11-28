/**
 * @fileoverview Sign-in for @convex-dev/auth 2.x
 *
 * Version 2 has no `useAuthActions().signIn(provider, params)`. Each method
 * has its own hook (`useSignInWithEmailPassword(api.auth)`,
 * `useSignInWithGithub(api.auth)`, ...) whose `signIn` resolves to a result
 * value instead of throwing. The app calls those hooks and passes their
 * `signIn` functions here; this module turns their results into the
 * adapter's outcomes and error codes.
 */

import { AuthAdapterError, passkeyUnsupported } from '../errors.js';
import type { SignInOptions, SignInOutcome } from '../types.js';

/** What `useSignInWithEmailPassword(api.auth).signIn` resolves to in @convex-dev/auth 2.x. */
export type ConvexPasswordSignInResult =
	| { status: 'complete' }
	| { status: 'error'; userError: { error: string; retryAfterMs?: number; cause?: unknown } };

/** What an OAuth sign-in hook's `signIn` resolves to in @convex-dev/auth 2.x, when starting a flow. */
export type ConvexOauthStartResult =
	| { status: 'redirect'; redirect: URL }
	| { status: 'error'; userError: { error: string; cause?: unknown } };

/** `useSignInWithEmailPassword(api.auth).signIn` from `@convex-dev/auth/methods/email-password/react`. */
export type ConvexPasswordSignIn = (credentials: {
	email: string;
	password: string;
}) => Promise<ConvexPasswordSignInResult>;

/** The `signIn` of an OAuth method hook, such as `useSignInWithGithub(api.auth).signIn`. */
export type ConvexOauthSignIn = (options?: {
	redirectTo?: string;
}) => Promise<ConvexOauthStartResult>;

/** The sign-in functions a 2.x app passes to the adapter. */
export interface ConvexV2SignIns {
	signInWithPassword?: ConvexPasswordSignIn;
	oauth?: Readonly<Record<string, ConvexOauthSignIn>>;
}

/**
 * Sign in through the 2.x method functions. Failures reject with an
 * {@link AuthAdapterError}; `mapThrown` maps a thrown or `OTHER_ERROR` cause.
 */
export async function signInWithConvexV2(
	signIns: ConvexV2SignIns,
	options: SignInOptions,
	mapThrown: (error: unknown, credentials: boolean) => AuthAdapterError
): Promise<SignInOutcome> {
	if (options.method === 'passkey') throw passkeyUnsupported();

	if (options.method === 'credentials') {
		if (options.password === undefined) {
			throw new AuthAdapterError({
				code: 'INVALID_CREDENTIALS',
				message: 'A password is required to sign in with Convex Auth email and password',
				suggestion: 'Provide the account password and try again',
			});
		}
		const signIn = signIns.signInWithPassword;
		if (signIn === undefined) {
			throw new AuthAdapterError({
				code: 'PROVIDER_ERROR',
				message: 'Email and password sign-in is not configured for this Convex adapter',
				suggestion:
					'Pass signInWithPassword: useSignInWithEmailPassword(api.auth).signIn to useConvexAuthAdapter',
			});
		}
		let result: ConvexPasswordSignInResult;
		try {
			result = await signIn({ email: options.email, password: options.password });
		} catch (error) {
			throw mapThrown(error, true);
		}
		if (result.status === 'complete') return { kind: 'signed-in' };
		throw passwordError(result.userError, mapThrown);
	}

	if (options.scopes !== undefined && options.scopes.length > 0) {
		throw new AuthAdapterError({
			code: 'PROVIDER_ERROR',
			message: 'Convex Auth does not accept OAuth scopes at sign-in',
			suggestion: `Configure scopes where the '${options.provider}' method is set up in convex/auth.ts, then sign in without scopes`,
		});
	}
	// Own keys only: a provider id such as 'toString' must not reach Object.prototype.
	const oauth = signIns.oauth;
	const signIn =
		oauth !== undefined && Object.hasOwn(oauth, options.provider)
			? oauth[options.provider]
			: undefined;
	if (signIn === undefined) {
		throw new AuthAdapterError({
			code: 'PROVIDER_ERROR',
			message: `OAuth sign-in with '${options.provider}' is not configured for this Convex adapter`,
			suggestion: `Pass oauth: { '${options.provider}': <the provider's sign-in hook>(api.auth).signIn } to useConvexAuthAdapter`,
		});
	}
	let result: ConvexOauthStartResult;
	try {
		result = await signIn(
			options.redirectTo === undefined ? undefined : { redirectTo: options.redirectTo }
		);
	} catch (error) {
		throw mapThrown(error, false);
	}
	if (result.status === 'redirect') return { kind: 'redirect', url: result.redirect.href };
	throw mapThrown(result.userError.cause ?? result.userError.error, false);
}

/**
 * A wrong password and an unknown account are both INVALID_CREDENTIALS, so a
 * sign-in form does not tell an attacker which accounts exist. The password
 * rules (`PASSWORD_TOO_SHORT`, ...) apply at sign-in too: a password that
 * breaks them cannot be the account's, so they are INVALID_CREDENTIALS as well.
 */
function passwordError(
	userError: { error: string; retryAfterMs?: number; cause?: unknown },
	mapThrown: (error: unknown, credentials: boolean) => AuthAdapterError
): AuthAdapterError {
	switch (userError.error) {
		case 'INVALID_CREDENTIALS':
		case 'USER_NOT_FOUND':
		case 'PASSWORD_TOO_SHORT':
		case 'PASSWORD_TOO_LONG':
		case 'PASSWORD_HAS_SURROUNDING_WHITESPACE':
			return AuthAdapterError.invalidCredentials();
		case 'RATE_LIMITED': {
			const wait = userError.retryAfterMs;
			const seconds =
				typeof wait === 'number' && Number.isFinite(wait) && wait > 0
					? Math.ceil(wait / 1000)
					: undefined;
			return new AuthAdapterError({
				code: 'PROVIDER_ERROR',
				message: 'Too many failed sign-in attempts for this account',
				suggestion:
					seconds === undefined
						? 'Wait before trying again, or reset the password'
						: `Wait ${seconds} ${seconds === 1 ? 'second' : 'seconds'} before trying again, or reset the password`,
			});
		}
		default:
			return mapThrown(userError.cause ?? userError.error, true);
	}
}
