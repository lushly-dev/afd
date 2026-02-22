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
	expiresAt: Date;
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

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH SESSION STATE (Discriminated Union)
// ═══════════════════════════════════════════════════════════════════════════════

export type AuthSessionState =
	| { status: 'unauthenticated'; session: null; user: null }
	| { status: 'loading'; session: null; user: null }
	| { status: 'authenticated'; session: Session; user: User };

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
	signIn(options: SignInOptions): Promise<void>;
	signOut(): Promise<void>;
	getSession(): AuthSessionState;
	onAuthStateChange(callback: (state: AuthSessionState) => void): { unsubscribe: () => void };
}
