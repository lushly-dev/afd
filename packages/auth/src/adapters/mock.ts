/**
 * @fileoverview Mock auth adapter for testing
 */

import type { Clock } from '@lushly-dev/afd-core';
import { AuthAdapterError, type AuthErrorCode, passkeyUnsupported } from '../errors.js';
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

const SESSION_LIFETIME_MS = 3600_000;
const SYSTEM_CLOCK: Clock = { now: () => Date.now() };

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
	 * The clock every time the Mock records reads: a session's `expiresAt` (one hour after
	 * sign-in), and with `withMockCapabilities` a passkey's or member's `createdAt` and an
	 * invitation's expiry. Default: the system clock. A kernel passes its own, so an expiry falls
	 * on the kernel's time.
	 */
	clock?: Clock;
}

/**
 * The Mock signs in and out, holds one session per page, and gates commands. Its `sessions`,
 * `passkeys` and `organization` capabilities are `undefined` until `withMockCapabilities` from
 * `@lushly-dev/afd-auth/mock-capabilities` attaches them, so a host that only signs in never
 * bundles them; until then a passkey sign-in is `PASSKEY_UNSUPPORTED`.
 */
export class MockAuthAdapter implements AuthAdapter {
	private state: AuthSessionState = UNAUTHENTICATED;
	private readonly listeners: ListenerSet<AuthSessionState>;
	private readonly delay: number;
	/** The clock the Mock times sessions on; `withMockCapabilities` reads it too. */
	readonly clock: Clock;
	// `declare`: no field is emitted, so each stays `undefined` until attached.
	declare readonly sessions?: SessionManagement;
	declare readonly passkeys?: PasskeyManagement;
	declare readonly organization?: OrganizationAccess;
	/** Set by `withMockCapabilities`: the person a passkey ceremony signs in. */
	declare _passkeyUser?: () => User;

	constructor(options: MockAuthAdapterOptions = {}) {
		this.delay = options.delay ?? 0;
		this.clock = options.clock ?? SYSTEM_CLOCK;
		this.listeners = new ListenerSet(options.onListenerError);
	}

	async signIn(options: SignInOptions): Promise<SignInOutcome> {
		if (this.delay > 0) {
			await this.sleep(this.delay);
		}

		if (options.method === 'passkey') {
			if (!this._passkeyUser) throw passkeyUnsupported();
			this.startSession(this._passkeyUser());
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

	_setLoading(): void {
		this.setState(LOADING);
	}

	_triggerError(
		code: Exclude<AuthErrorCode, 'PASSKEY_CANCELLED' | 'PASSKEY_UNSUPPORTED'>
	): AuthAdapterError {
		const factories: Record<string, () => AuthAdapterError> = {
			INVALID_CREDENTIALS: () => AuthAdapterError.invalidCredentials(),
			TOKEN_EXPIRED: () => AuthAdapterError.tokenExpired(),
			PROVIDER_ERROR: () => AuthAdapterError.providerError('mock'),
			NETWORK_ERROR: () => AuthAdapterError.networkError(),
			REFRESH_FAILED: () => AuthAdapterError.refreshFailed(),
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
