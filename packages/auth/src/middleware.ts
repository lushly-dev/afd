/**
 * @fileoverview Auth middleware for gating commands behind authentication
 */

import type { Actor, CommandMiddleware } from '@lushly-dev/afd-core';
import { failure } from '@lushly-dev/afd-core';
import { AUTH_COMMAND_NAMES } from './command-names.js';
import { isSessionExpired } from './session-state.js';
import type { AuthAdapter, AuthenticatedSessionState } from './types.js';

declare module '@lushly-dev/afd-core' {
	interface CommandContext {
		/**
		 * The verified, unexpired session, set by `createAuthMiddleware`.
		 *
		 * The middleware sets or deletes this on every call, excluded commands
		 * included, so a value supplied by the caller never reaches a handler.
		 */
		auth?: AuthenticatedSessionState;
	}
}

export interface AuthMiddlewareOptions {
	/**
	 * Command names that bypass auth checks. The built-in auth commands
	 * (`auth-sign-in`, `auth-sign-out`, `auth-session-get`) always bypass them
	 * and do not need to be listed.
	 */
	exclude?: string[];

	/**
	 * Recognises the `credentials` that afd-server set on a call itself, after verifying the
	 * call's token: pass `isVerifiedCredentials` from `@lushly-dev/afd-server/credentials`. Such a
	 * call's caller is the token, not the adapter's session, so the middleware keeps the call's
	 * actor, never reads the session for it, deletes `context.auth` and runs the command.
	 *
	 * A host that serves MCP with token authorization through this middleware must pass it, or
	 * the session's user is stamped on every token's call. Without it, no call is treated so:
	 * every call is gated on the session, as before. `credentials` a caller put on the context
	 * itself (a direct-registry call, say) are never recognised, since only afd-server can mark
	 * them.
	 */
	isVerifiedCredentials?: (credentials: unknown) => boolean;
}

/**
 * The actor for a call made with a verified session. A human (or unset) actor becomes the
 * session user (`id`, and `label` from the user's name). An agent, service or script keeps
 * its own identity and acts on behalf of the session user; a caller-supplied `onBehalfOf`
 * is replaced, so it can never name someone other than the verified user.
 */
function actorForSession(actor: Actor | undefined, session: AuthenticatedSessionState): Actor {
	const { user } = session;
	if (!actor || actor.kind === 'human') {
		return { kind: 'human', id: user.id, ...(user.name ? { label: user.name } : {}) };
	}
	return { ...actor, onBehalfOf: user.id };
}

/**
 * Create middleware that gates commands behind authentication.
 *
 * - Unauthenticated → failure with UNAUTHORIZED
 * - Loading → failure with UNAUTHORIZED (retryable)
 * - Authenticated but `expiresAt` reached → failure with TOKEN_EXPIRED (retryable)
 * - Authenticated → sets `context.auth`, fills `context.actor` from the session user and calls next()
 *
 * Excluded commands, and the built-in auth commands, always run. They see
 * `context.auth` only when the adapter holds an unexpired session.
 *
 * A call whose `credentials` afd-server verified (see
 * {@link AuthMiddlewareOptions.isVerifiedCredentials}) runs with its own actor, no
 * `context.auth` and no session check.
 */
export function createAuthMiddleware(
	adapter: AuthAdapter,
	options: AuthMiddlewareOptions = {}
): CommandMiddleware {
	const excluded = new Set<string>([...AUTH_COMMAND_NAMES, ...(options.exclude ?? [])]);
	const isVerifiedCredentials = options.isVerifiedCredentials;

	return async (commandName, _input, context, next) => {
		if (
			context.credentials !== undefined &&
			isVerifiedCredentials !== undefined &&
			isVerifiedCredentials(context.credentials) === true
		) {
			// The token is the caller: no session decides this call or names its actor.
			delete context.auth;
			return next();
		}

		const state = adapter.getSession();
		const verified =
			state.status === 'authenticated' && !isSessionExpired(state.session) ? state : undefined;

		// Overwrite or remove whatever the caller put in the context.
		if (verified) {
			context.auth = verified;
			context.actor = actorForSession(context.actor, verified);
		} else {
			delete context.auth;
		}

		if (excluded.has(commandName) || verified) {
			return next();
		}

		if (state.status === 'loading') {
			return failure({
				code: 'UNAUTHORIZED',
				message: 'Authentication state is loading',
				suggestion: 'Wait for authentication to complete and try again',
				retryable: true,
			});
		}

		if (state.status === 'authenticated') {
			return failure({
				code: 'TOKEN_EXPIRED',
				message: 'Session has expired',
				suggestion:
					'Try again once the auth provider has refreshed the session, or sign in again with auth-sign-in',
				retryable: true,
			});
		}

		return failure({
			code: 'UNAUTHORIZED',
			message: 'Authentication required',
			suggestion: 'Sign in with auth-sign-in to access this command',
			retryable: false,
		});
	};
}
