/**
 * @fileoverview Mock auth adapter for testing
 */

import { AuthAdapterError } from '../errors.js';
import { type ListenerErrorHandler, ListenerSet } from '../listeners.js';
import type {
	AuthAdapter,
	AuthSessionState,
	Session,
	SignInOptions,
	SignInOutcome,
	User,
} from '../types.js';
import { LOADING, UNAUTHENTICATED } from '../types.js';

export interface MockAuthAdapterOptions {
	/** Simulated async delay in milliseconds (default: 0) */
	delay?: number;
	/**
	 * Receives errors thrown by `onAuthStateChange` subscribers. Without it,
	 * they are rethrown in a microtask. Either way the other subscribers still
	 * run and the adapter method that changed the state does not reject.
	 */
	onListenerError?: ListenerErrorHandler;
}

export class MockAuthAdapter implements AuthAdapter {
	private state: AuthSessionState = UNAUTHENTICATED;
	private readonly listeners: ListenerSet<AuthSessionState>;
	private readonly delay: number;

	constructor(options: MockAuthAdapterOptions = {}) {
		this.delay = options.delay ?? 0;
		this.listeners = new ListenerSet(options.onListenerError);
	}

	async signIn(options: SignInOptions): Promise<SignInOutcome> {
		if (this.delay > 0) {
			await this.sleep(this.delay);
		}

		const email = options.method === 'credentials' ? options.email : `user@${options.provider}.com`;

		this.setState({
			status: 'authenticated',
			session: {
				id: `mock-session-${Date.now()}`,
				expiresAt: new Date(Date.now() + 3600_000),
			},
			user: {
				id: `mock-user-${Date.now()}`,
				email,
				name: email.split('@')[0],
			},
		});
		return { kind: 'signed-in' };
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
		this.setState({
			status: 'authenticated',
			session: {
				id: `mock-session-${Date.now()}`,
				expiresAt: new Date(Date.now() + 3600_000),
				...session,
			},
			user,
		});
	}

	_setLoading(): void {
		this.setState(LOADING);
	}

	_triggerError(
		code:
			| 'INVALID_CREDENTIALS'
			| 'TOKEN_EXPIRED'
			| 'PROVIDER_ERROR'
			| 'NETWORK_ERROR'
			| 'REFRESH_FAILED'
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

	private setState(state: AuthSessionState): void {
		this.state = state;
		this.listeners.emit(state);
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
