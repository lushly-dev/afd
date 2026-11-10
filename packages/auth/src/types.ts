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

/**
 * Sign in with a passkey (WebAuthn). `autoFill` offers the person's passkeys in the browser's
 * autofill (conditional mediation) instead of a dialog. An adapter without passkeys rejects it.
 */
export interface PasskeySignInOptions {
	method: 'passkey';
	autoFill?: boolean;
}

export type SignInOptions = CredentialsSignInOptions | OAuthSignInOptions | PasskeySignInOptions;

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
	/**
	 * Read the session from the provider again now, rather than waiting for the provider's own
	 * refresh. Resolves once `getSession()` holds the provider's answer.
	 */
	refresh?(): Promise<void>;
	/** The signed-in person's sessions on every device, when the provider can list them. */
	sessions?: SessionManagement;
	/** The signed-in person's passkeys, when the provider supports them. */
	passkeys?: PasskeyManagement;
	/** Organizations and their members, when the provider has them. */
	organization?: OrganizationAccess;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPABILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The signed-in person's sessions. A session is named by its `handle`, never its token: the
 * first 16 hex characters of SHA-256 over the token, mapped back to the token in memory only.
 */
export interface SessionManagement {
	listSessions(): Promise<SessionRow[]>;
	/**
	 * Revoke one session by its handle, every session but this one (`'others'`) or every
	 * session, this one included (`'all'`). An unknown handle rejects with `PROVIDER_ERROR`.
	 */
	revokeSession(target: string | 'others' | 'all'): Promise<void>;
}

/** One session, as the person may see it. No token and no IP address. */
export interface SessionRow {
	/** The first 16 hex characters of SHA-256 over the session's token. */
	handle: string;
	/** Whether this is the session the adapter is signed in with. */
	current: boolean;
	createdAt: Date;
	updatedAt: Date;
	expiresAt?: Date;
	/** A label read from the user agent, such as `Chrome on macOS`. */
	device?: string;
}

/**
 * The signed-in person's passkeys. A dismissed ceremony rejects with `PASSKEY_CANCELLED`, and a
 * browser without WebAuthn with `PASSKEY_UNSUPPORTED`.
 */
export interface PasskeyManagement {
	listPasskeys(): Promise<PasskeyRow[]>;
	addPasskey(options?: { name?: string }): Promise<PasskeyRow>;
	renamePasskey(id: string, name: string): Promise<void>;
	removePasskey(id: string): Promise<void>;
}

/** One passkey. No public key or credential id. */
export interface PasskeyRow {
	id: string;
	name?: string;
	createdAt: Date;
	deviceType?: 'singleDevice' | 'multiDevice';
	backedUp?: boolean;
}

/** A member of an organization. `id` is the membership's id; `userId` the person's. */
export interface OrganizationMember {
	id: string;
	userId: string;
	role: string;
	createdAt: Date;
	user: { id: string; email: string; name?: string; image?: string };
}

/** An invitation to an organization. */
export interface OrganizationInvitation {
	id: string;
	organizationId: string;
	email: string;
	role: string;
	status: 'pending' | 'accepted' | 'rejected' | 'canceled';
	expiresAt: Date;
}

/**
 * Organizations at the provider. Every call names the organization by id, and an empty id is a
 * `TypeError`: the session's active organization is never read, so no call can fall back to it.
 */
export interface OrganizationAccess {
	/** The signed-in person's role in the organization, or `null` when they are not a member. */
	membership(organizationId: string): Promise<{ role: string } | null>;
	listMembers(
		organizationId: string,
		options?: { limit?: number; offset?: number }
	): Promise<OrganizationMember[]>;
	invite(
		organizationId: string,
		invitation: { email: string; role: string }
	): Promise<OrganizationInvitation>;
	listInvitations(organizationId: string): Promise<OrganizationInvitation[]>;
	/** Cancel an invitation of this organization; one of another organization rejects. */
	cancelInvitation(organizationId: string, invitationId: string): Promise<void>;
	/** Remove a member, named by membership id. */
	removeMember(organizationId: string, memberId: string): Promise<void>;
	/** Set a member's role, named by membership id. */
	setRole(organizationId: string, memberId: string, role: string): Promise<void>;
	/** The signed-in person leaves the organization. */
	leave(organizationId: string): Promise<void>;
	/** The invitations addressed to the signed-in person, for the invitee. */
	listOwnInvitations(): Promise<OrganizationInvitation[]>;
	/** Accept an invitation addressed to the signed-in person. */
	acceptInvitation(invitationId: string): Promise<void>;
	/** Reject an invitation addressed to the signed-in person. */
	rejectInvitation(invitationId: string): Promise<void>;
}
