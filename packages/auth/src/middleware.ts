/**
 * @fileoverview Auth middleware for gating commands behind authentication
 */

import type { CommandMiddleware } from '@lushly-dev/afd-core';
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
}

/**
 * Create middleware that gates commands behind authentication.
 *
 * - Unauthenticated → failure with UNAUTHORIZED
 * - Loading → failure with UNAUTHORIZED (retryable)
 * - Authenticated but `expiresAt` reached → failure with TOKEN_EXPIRED (retryable)
 * - Authenticated → sets `context.auth` and calls next()
 *
 * Excluded commands, and the built-in auth commands, always run. They see
 * `context.auth` only when the adapter holds an unexpired session.
 */
export function createAuthMiddleware(
	adapter: AuthAdapter,
	options: AuthMiddlewareOptions = {}
): CommandMiddleware {
	const excluded = new Set<string>([...AUTH_COMMAND_NAMES, ...(options.exclude ?? [])]);

	return async (commandName, _input, context, next) => {
		const state = adapter.getSession();
		const verified =
			state.status === 'authenticated' && !isSessionExpired(state.session) ? state : undefined;

		// Overwrite or remove whatever the caller put in the context.
		if (verified) {
			context.auth = verified;
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
