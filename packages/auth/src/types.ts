/**
 * @fileoverview Core auth types for AFD authentication adapter
 *
 * Uses discriminated unions for type-safe session access.
 * Consumers check `status` before accessing `user` — TypeScript enforces this at compile time.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION & USER
// ═══════════════════════════════════════════════════════════════════════════════

export interface Session {
	id: string;
	/**
	 * When the session stops being valid. Omitted when the provider manages the
	 * token lifetime itself and does not report an expiry (Convex).
	 * `createAuthMiddleware` rejects a session whose `expiresAt` is at or before
	 * the current time.
	 */
	expiresAt?: Date;
}

export interface User {
	id: string;
	email: string;
	name?: string;
	image?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER & SIGN-IN OPTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export type Provider = 'github' | 'google' | 'email' | (string & {});

export interface CredentialsSignInOptions {
	method: 'credentials';
	email: string;
	password?: string;
}

export interface OAuthSignInOptions {
	method: 'oauth';
	provider: Provider;
	scopes?: string[];
	redirectTo?: string;
}

export type SignInOptions = CredentialsSignInOptions | OAuthSignInOptions;

/**
 * What an adapter knows about a sign-in when `signIn()` resolves.
 *
 * - `signed-in`: the provider accepted the sign-in. The new session can still
 *   reach `getSession()` later, through `onAuthStateChange`.
 * - `redirect`: sign-in continues at the provider (OAuth). No session exists
 *   until the provider redirects back to the app.
 * - `pending`: the provider needs another step first, such as email
 *   verification.
 */
export type SignInOutcome =
	| { kind: 'signed-in' }
	| { kind: 'redirect'; url?: string }
	| { kind: 'pending' };

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH SESSION STATE (Discriminated Union)
// ═══════════════════════════════════════════════════════════════════════════════

export type AuthSessionState =
	| { status: 'unauthenticated'; session: null; user: null }
	| { status: 'loading'; session: null; user: null }
	| { status: 'authenticated'; session: Session; user: User };

/** The `authenticated` member of {@link AuthSessionState}. */
export type AuthenticatedSessionState = Extract<AuthSessionState, { status: 'authenticated' }>;

/**
 * Constant for the unauthenticated state.
 * Reuse this to avoid object allocation on every check.
 */
export const UNAUTHENTICATED: AuthSessionState = Object.freeze({
	status: 'unauthenticated' as const,
	session: null,
	user: null,
});

/**
 * Constant for the loading state.
 * Reuse this to avoid object allocation on every check.
 */
export const LOADING: AuthSessionState = Object.freeze({
	status: 'loading' as const,
	session: null,
	user: null,
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ADAPTER INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

export interface AuthAdapter {
	/**
	 * Start a sign-in. Resolve with a {@link SignInOutcome} when the provider
	 * says how the sign-in continues. Resolving with nothing is still allowed
	 * and is treated like `signed-in`.
	 */
	// biome-ignore lint/suspicious/noConfusingVoidType: adapters written before SignInOutcome resolve with Promise<void> and must stay assignable
	signIn(options: SignInOptions): Promise<SignInOutcome | void>;
	signOut(): Promise<void>;
	getSession(): AuthSessionState;
	onAuthStateChange(callback: (state: AuthSessionState) => void): { unsubscribe: () => void };
}
