/**
 * @fileoverview The part of Better Auth's client this package calls, typed here so the package
 * never imports `better-auth`, and the one place its `{ data, error }` answers become values or
 * `AuthAdapterError`s.
 */

import { AuthAdapterError, passkeyCancelled } from '../errors.js';
import { isKnownNetworkFailure } from './provider-errors.js';

export interface BetterAuthErrorResponse {
	message?: string;
	status?: number;
	statusText?: string;
	code?: string;
}

/**
 * Better Auth reports provider failures as resolved `{ data, error }` values; they do not
 * necessarily reject the promise.
 */
export interface BetterAuthMethodResult<T = unknown> {
	data?: T | null;
	error?: BetterAuthErrorResponse | null;
}

export type BetterAuthMethodResponse<T = unknown> = BetterAuthMethodResult<T> | undefined;

type Answer<T = unknown> = Promise<BetterAuthMethodResponse<T>>;

/** A date as Better Auth's client returns it: a `Date`, or its JSON string. */
export type WireDate = string | Date;

export interface BetterAuthSessionData {
	session: { id: string; expiresAt: WireDate };
	user: { id: string; email: string; name?: string; image?: string | null };
}

export interface BetterAuthSessionValue {
	data: BetterAuthSessionData | null;
	isPending: boolean;
	/**
	 * The last fetch's failure. Better Auth's `refetch` never rejects: on a network failure or a
	 * 5xx it stores the error here, keeps the stale `data` and resolves. A 401 clears `data`.
	 */
	error?: unknown;
	/** A fetch is under way. Better Auth clears this when the latest fetch has its answer. */
	isRefetching?: boolean;
	/** Better Auth's session atom fetches the session again through this. */
	refetch?: () => Promise<unknown>;
}

export interface BetterAuthSessionStore {
	subscribe: (callback: (value: BetterAuthSessionValue) => void) => () => void;
	get: () => BetterAuthSessionValue;
}

export interface BetterAuthSessionRow {
	id: string;
	token: string;
	userAgent?: string | null;
	createdAt: WireDate;
	updatedAt: WireDate;
	expiresAt?: WireDate | null;
}

export interface BetterAuthPasskey {
	id: string;
	name?: string | null;
	createdAt: WireDate;
	deviceType?: string | null;
	backedUp?: boolean | null;
}

export interface BetterAuthMember {
	id: string;
	userId: string;
	role: string;
	createdAt: WireDate;
	user: { id: string; email: string; name?: string | null; image?: string | null };
}

export interface BetterAuthInvitation {
	id: string;
	organizationId: string;
	email: string;
	role: string;
	status: string;
	expiresAt: WireDate;
}

/**
 * Better Auth's default roles. Its client types a role as the union of the configured roles,
 * which always holds these, so a client with custom roles still matches; any role name reaches
 * the provider at run time, which decides.
 */
export type BetterAuthRole = 'owner' | 'admin' | 'member';

/** The passkey client plugin's actions (`@better-auth/passkey/client`). */
export interface BetterAuthPasskeyClient {
	addPasskey(input?: { name?: string }): Answer<BetterAuthPasskey>;
	listUserPasskeys(): Answer<BetterAuthPasskey[]>;
	updatePasskey(input: { id: string; name: string }): Answer;
	deletePasskey(input: { id: string }): Answer;
}

/** The organization client plugin's actions (`better-auth/client/plugins`). */
export interface BetterAuthOrganizationClient {
	getActiveMemberRole(input: { query: { organizationId: string } }): Answer<{ role: string }>;
	listMembers(input: {
		query: { organizationId: string; limit?: number; offset?: number };
	}): Answer<{ members: BetterAuthMember[]; total?: number }>;
	inviteMember(input: {
		organizationId: string;
		email: string;
		role: BetterAuthRole;
	}): Answer<BetterAuthInvitation>;
	listInvitations(input: { query: { organizationId: string } }): Answer<BetterAuthInvitation[]>;
	cancelInvitation(input: { invitationId: string }): Answer;
	removeMember(input: { organizationId: string; memberIdOrEmail: string }): Answer;
	updateMemberRole(input: {
		organizationId: string;
		memberId: string;
		role: BetterAuthRole;
	}): Answer;
	leave(input: { organizationId: string }): Answer;
	listUserInvitations(): Answer<BetterAuthInvitation[]>;
	acceptInvitation(input: { invitationId: string }): Answer;
	rejectInvitation(input: { invitationId: string }): Answer;
}

export interface BetterAuthClient {
	signIn: {
		social(input: { provider: string; callbackURL?: string; scopes?: string[] }): Answer;
		email(input: { email: string; password: string }): Answer;
		/** The passkey client plugin's sign-in. */
		passkey?(input?: { autoFill?: boolean }): Answer;
	};
	signOut(): Answer;
	useSession: BetterAuthSessionStore | (() => BetterAuthSessionStore);
	listSessions?(): Answer<BetterAuthSessionRow[]>;
	revokeSession?(input: { token: string }): Answer;
	revokeOtherSessions?(): Answer;
	revokeSessions?(): Answer;
	/** With `@better-auth/passkey`'s `passkeyClient()`. */
	passkey?: BetterAuthPasskeyClient;
	/** With `organizationClient()`. */
	organization?: BetterAuthOrganizationClient;
}

const PROVIDER = 'better-auth';

export function describeError(error: BetterAuthErrorResponse): string | undefined {
	if (error.message) return error.message;
	if (error.statusText) return error.statusText;
	if (error.code) return error.code;
	return error.status === undefined ? undefined : `status ${error.status}`;
}

export function providerError(error: BetterAuthErrorResponse): AuthAdapterError {
	return AuthAdapterError.providerError(PROVIDER, describeError(error));
}

/** A thrown value as an `AuthAdapterError`: a network failure, or the provider's error. */
export function mapThrownError(error: unknown): AuthAdapterError {
	if (error instanceof AuthAdapterError) return error;
	const message = error instanceof Error ? error.message : String(error);
	if (isKnownNetworkFailure(error, message)) return AuthAdapterError.networkError();
	return AuthAdapterError.providerError(PROVIDER, message);
}

/**
 * Call a client method and return its `data`. A resolved `error` becomes `PROVIDER_ERROR` unless
 * `onError` maps it first, and a thrown value goes through {@link mapThrownError}.
 */
export async function call<T>(
	run: () => Promise<BetterAuthMethodResponse<T>>,
	onError?: (error: BetterAuthErrorResponse) => AuthAdapterError | undefined
): Promise<T | null | undefined> {
	let result: BetterAuthMethodResponse<T>;
	try {
		result = await run();
	} catch (error) {
		throw mapThrownError(error);
	}
	const error = result?.error;
	if (error) throw onError?.(error) ?? providerError(error);
	return result?.data;
}

/**
 * The codes Better Auth's passkey client answers when the person dismissed the ceremony or it
 * timed out: its own, and SimpleWebAuthn's for an aborted ceremony and a `NotAllowedError`.
 */
const PASSKEY_CANCELLED_CODES = new Set([
	'AUTH_CANCELLED',
	'REGISTRATION_CANCELLED',
	'ERROR_CEREMONY_ABORTED',
	'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
]);

export function passkeyCeremonyError(error: BetterAuthErrorResponse): AuthAdapterError | undefined {
	return error.code !== undefined && PASSKEY_CANCELLED_CODES.has(error.code)
		? passkeyCancelled()
		: undefined;
}
