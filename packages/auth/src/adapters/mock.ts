/**
 * @fileoverview Mock auth adapter for testing
 */

import { type Clock, systemClock } from '@lushly-dev/afd-core';
import { AuthAdapterError, type AuthErrorCode } from '../errors.js';
import { type ListenerErrorHandler, ListenerSet } from '../listeners.js';
import type {
	AuthAdapter,
	AuthSessionState,
	OrganizationAccess,
	PasskeyManagement,
	Session,
	SessionManagement,
	SignInOptions,
	SignInOutcome,
	User,
} from '../types.js';
import { LOADING, UNAUTHENTICATED } from '../types.js';
import { MockDirectory, type MockPasskeyCeremony, type MockRoles } from './mock-capabilities.js';
import { sessionHandle } from './session-rows.js';

export type { MockPasskeyCeremony, MockRoles } from './mock-capabilities.js';

const SESSION_LIFETIME_MS = 3600_000;

export interface MockAuthAdapterOptions {
	/** Simulated async delay in milliseconds (default: 0) */
	delay?: number;
	/**
	 * Receives errors thrown by `onAuthStateChange` subscribers. Without it,
	 * they are rethrown in a microtask. Either way the other subscribers still
	 * run and the adapter method that changed the state does not reject.
	 */
	onListenerError?: ListenerErrorHandler;
	/**
	 * The clock every time the Mock records reads: a session's `createdAt` and `expiresAt` (one
	 * hour after sign-in), a passkey's or member's `createdAt`, an invitation's expiry. Default:
	 * the system clock. A kernel passes its own, so an expiry falls on the kernel's time.
	 */
	clock?: Clock;
	/**
	 * Organization members and their roles, by organization id and then user id, such as
	 * `{ 'org-1': { 'mock-user-ada@example.com': 'owner' } }`. Default: no organizations.
	 */
	roles?: MockRoles;
}

export class MockAuthAdapter implements AuthAdapter {
	private state: AuthSessionState = UNAUTHENTICATED;
	private readonly listeners: ListenerSet<AuthSessionState>;
	private readonly delay: number;
	private readonly clock: Clock;
	private readonly directory: MockDirectory;
	/** When the current session began, for `sessions.listSessions()`. */
	private sessionCreatedAt = new Date(0);
	readonly passkeys: PasskeyManagement;
	readonly organization: OrganizationAccess;
	readonly sessions: SessionManagement;

	constructor(options: MockAuthAdapterOptions = {}) {
		this.delay = options.delay ?? 0;
		this.clock = options.clock ?? systemClock;
		this.listeners = new ListenerSet(options.onListenerError);
		this.directory = new MockDirectory(
			this.clock,
			() => (this.state.status === 'authenticated' ? this.state.user : undefined),
			options.roles
		);
		this.passkeys = this.directory.passkeys;
		this.organization = this.directory.organization;
		this.sessions = {
			listSessions: async () => {
				const state = this.state;
				if (state.status !== 'authenticated') return [];
				return [
					{
						handle: await sessionHandle(state.session.id),
						current: true,
						createdAt: this.sessionCreatedAt,
						updatedAt: this.sessionCreatedAt,
						...(state.session.expiresAt ? { expiresAt: state.session.expiresAt } : {}),
					},
				];
			},
			revokeSession: async (target) => {
				const state = this.state;
				// The Mock holds one session per page: 'others' has nothing to revoke.
				if (target === 'others' && state.status === 'authenticated') return;
				if (
					target === 'all' ||
					(state.status === 'authenticated' && target === (await sessionHandle(state.session.id)))
				) {
					this.setState(UNAUTHENTICATED);
					return;
				}
				throw AuthAdapterError.providerError('mock', 'No session has this handle');
			},
		};
	}

	async signIn(options: SignInOptions): Promise<SignInOutcome> {
		if (this.delay > 0) {
			await this.sleep(this.delay);
		}

		if (options.method === 'passkey') {
			this.startSession(this.directory.passkeyUser());
			return { kind: 'signed-in' };
		}

		const email = options.method === 'credentials' ? options.email : `user@${options.provider}.com`;
		// From the email, so the same person is the same user across adapters, reloads and replays.
		this.startSession({ id: `mock-user-${email}`, email, name: email.split('@')[0] });
		return { kind: 'signed-in' };
	}

	/** Sign out a session whose `expiresAt` has passed on the Mock's clock, as a provider would. */
	async refresh(): Promise<void> {
		const state = this.state;
		const expiresAt = state.status === 'authenticated' ? state.session.expiresAt : undefined;
		if (expiresAt && expiresAt.getTime() <= this.clock.now()) {
			this.setState(UNAUTHENTICATED);
		}
	}

	async signOut(): Promise<void> {
		if (this.delay > 0) {
			await this.sleep(this.delay);
		}
		this.setState(UNAUTHENTICATED);
	}

	getSession(): AuthSessionState {
		return this.state;
	}

	onAuthStateChange(callback: (state: AuthSessionState) => void): { unsubscribe: () => void } {
		return this.listeners.add(callback);
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// TEST HELPERS
	// ═══════════════════════════════════════════════════════════════════════════

	_reset(): void {
		this.setState(UNAUTHENTICATED);
	}

	/**
	 * Sign in as `user`. The session expires in one hour unless `session`
	 * overrides its fields, for example `{ expiresAt: new Date(0) }` for an
	 * expired session or `{ expiresAt: undefined }` for one without an expiry.
	 */
	_setUser(user: User, session: Partial<Session> = {}): void {
		this.startSession(user, session);
	}

	/**
	 * How the following passkey ceremonies end until this is called again: `complete` (the
	 * default), `cancel` (`PASSKEY_CANCELLED`) or `unsupported` (`PASSKEY_UNSUPPORTED`). A passkey
	 * sign-in that completes signs in the holder of the passkey added last.
	 */
	_setPasskeyCeremony(outcome: MockPasskeyCeremony): void {
		this.directory.ceremony = outcome;
	}

	_setLoading(): void {
		this.setState(LOADING);
	}

	_triggerError(code: AuthErrorCode): AuthAdapterError {
		const factories: Record<string, () => AuthAdapterError> = {
			INVALID_CREDENTIALS: () => AuthAdapterError.invalidCredentials(),
			TOKEN_EXPIRED: () => AuthAdapterError.tokenExpired(),
			PROVIDER_ERROR: () => AuthAdapterError.providerError('mock'),
			NETWORK_ERROR: () => AuthAdapterError.networkError(),
			REFRESH_FAILED: () => AuthAdapterError.refreshFailed(),
			PASSKEY_CANCELLED: () => AuthAdapterError.passkeyCancelled(),
			PASSKEY_UNSUPPORTED: () => AuthAdapterError.passkeyUnsupported(),
		};
		const factory = factories[code];
		if (!factory) {
			throw new Error(`Unknown error code: ${code}`);
		}
		return factory();
	}

	_getListenerCount(): number {
		return this.listeners.size;
	}

	private startSession(user: User, session: Partial<Session> = {}): void {
		const now = this.clock.now();
		this.sessionCreatedAt = new Date(now);
		this.setState({
			status: 'authenticated',
			session: {
				id: `mock-session-${now}`,
				expiresAt: new Date(now + SESSION_LIFETIME_MS),
				...session,
			},
			user,
		});
	}

	private setState(state: AuthSessionState): void {
		this.state = state;
		this.listeners.emit(state);
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
