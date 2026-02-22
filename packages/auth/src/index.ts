/**
 * @fileoverview @lushly-dev/afd-auth - Provider-agnostic authentication adapter
 *
 * @packageDocumentation
 */

export type { BetterAuthAdapterOptions } from './adapters/better-auth.js';
export { BetterAuthAdapter } from './adapters/better-auth.js';
export type { ConvexAuthAdapterOptions } from './adapters/convex.js';
export { useConvexAuthAdapter } from './adapters/convex.js';
export type { MockAuthAdapterOptions } from './adapters/mock.js';
// Adapters
export { MockAuthAdapter } from './adapters/mock.js';
// Commands
export { createAuthCommands } from './commands.js';
// Errors
export type { AuthErrorCode } from './errors.js';
export { AuthAdapterError } from './errors.js';
// Middleware
export { createAuthMiddleware } from './middleware.js';
export type { SessionSyncOptions } from './session-sync.js';
// Session sync
export { SessionSync } from './session-sync.js';
// Types
export type {
	AuthAdapter,
	AuthSessionState,
	CredentialsSignInOptions,
	OAuthSignInOptions,
	Provider,
	Session,
	SignInOptions,
	User,
} from './types.js';
export { LOADING, UNAUTHENTICATED } from './types.js';
