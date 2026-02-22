/**
 * @fileoverview Auth-specific error types
 *
 * Provides structured errors for authentication failures with
 * retryable flags and static factory methods.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR CODES
// ═══════════════════════════════════════════════════════════════════════════════

export type AuthErrorCode =
	| 'INVALID_CREDENTIALS'
	| 'TOKEN_EXPIRED'
	| 'PROVIDER_ERROR'
	| 'NETWORK_ERROR'
	| 'REFRESH_FAILED';

const RETRYABLE_CODES = new Set<AuthErrorCode>(['NETWORK_ERROR', 'REFRESH_FAILED']);

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ADAPTER ERROR
// ═══════════════════════════════════════════════════════════════════════════════

export class AuthAdapterError extends Error {
	readonly code: AuthErrorCode;
	readonly suggestion: string;
	readonly retryable: boolean;

	constructor(error: {
		code: AuthErrorCode;
		message: string;
		suggestion: string;
	}) {
		super(error.message);
		this.name = 'AuthAdapterError';
		this.code = error.code;
		this.suggestion = error.suggestion;
		this.retryable = RETRYABLE_CODES.has(error.code);
	}

	static invalidCredentials(): AuthAdapterError {
		return new AuthAdapterError({
			code: 'INVALID_CREDENTIALS',
			message: 'Invalid email or password',
			suggestion: 'Check your credentials and try again',
		});
	}

	static tokenExpired(): AuthAdapterError {
		return new AuthAdapterError({
			code: 'TOKEN_EXPIRED',
			message: 'Session has expired',
			suggestion: 'Sign in again to continue',
		});
	}

	static providerError(provider: string, details?: string): AuthAdapterError {
		const message = details
			? `Authentication provider '${provider}' error: ${details}`
			: `Authentication provider '${provider}' encountered an error`;
		return new AuthAdapterError({
			code: 'PROVIDER_ERROR',
			message,
			suggestion: `Try again or use a different sign-in method`,
		});
	}

	static networkError(): AuthAdapterError {
		return new AuthAdapterError({
			code: 'NETWORK_ERROR',
			message: 'Network request failed',
			suggestion: 'Check your connection and try again',
		});
	}

	static refreshFailed(): AuthAdapterError {
		return new AuthAdapterError({
			code: 'REFRESH_FAILED',
			message: 'Failed to refresh session',
			suggestion: 'Sign in again to continue',
		});
	}
}
