/**
 * @fileoverview Auth middleware for gating commands behind authentication
 */

import type { CommandMiddleware } from '@lushly-dev/afd-core';
import { failure } from '@lushly-dev/afd-core';
import type { AuthAdapter } from './types.js';

export interface AuthMiddlewareOptions {
	/** Command names that bypass auth checks */
	exclude?: string[];
}

/**
 * Create middleware that gates commands behind authentication.
 *
 * - Unauthenticated → failure with UNAUTHORIZED
 * - Loading → failure with UNAUTHORIZED (retryable)
 * - Authenticated → injects `context.auth` and calls next()
 */
export function createAuthMiddleware(
	adapter: AuthAdapter,
	options: AuthMiddlewareOptions = {}
): CommandMiddleware {
	const excluded = new Set(options.exclude ?? []);

	return async (commandName, _input, context, next) => {
		if (excluded.has(commandName)) {
			return next();
		}

		const state = adapter.getSession();

		if (state.status === 'unauthenticated') {
			return failure({
				code: 'UNAUTHORIZED',
				message: 'Authentication required',
				suggestion: 'Sign in to access this command',
				retryable: false,
			});
		}

		if (state.status === 'loading') {
			return failure({
				code: 'UNAUTHORIZED',
				message: 'Authentication state is loading',
				suggestion: 'Wait for authentication to complete and try again',
				retryable: true,
			});
		}

		context.auth = state;
		return next();
	};
}
