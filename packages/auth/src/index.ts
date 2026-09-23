/**
 * @fileoverview @lushly-dev/afd-auth - Provider-agnostic authentication adapter
 *
 * @packageDocumentation
 */

// Adapters
export type { BetterAuthAdapterOptions } from './adapters/better-auth.js';
export { BetterAuthAdapter } from './adapters/better-auth.js';
export type { MockAuthAdapterOptions } from './adapters/mock.js';
export { MockAuthAdapter } from './adapters/mock.js';
// Built-in command names (always allowed by the middleware)
export { AUTH_COMMAND_NAMES } from './command-names.js';
// Errors
export type { AuthErrorCode } from './errors.js';
export { AuthAdapterError } from './errors.js';
// Listener error reporting
export type { ListenerErrorHandler } from './listeners.js';
// Middleware
export type { AuthMiddlewareOptions } from './middleware.js';
export { createAuthMiddleware } from './middleware.js';
// Session sync
export type { SessionSyncOptions } from './session-sync.js';
export { SessionSync } from './session-sync.js';
// Types
export type {
	AuthAdapter,
	AuthenticatedSessionState,
	AuthSessionState,
	CredentialsSignInOptions,
	OAuthSignInOptions,
	Provider,
	Session,
	SignInOptions,
	User,
} from './types.js';
export { LOADING, UNAUTHENTICATED } from './types.js';
