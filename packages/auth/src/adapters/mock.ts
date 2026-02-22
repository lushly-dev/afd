/**
 * @fileoverview Mock auth adapter for testing
 */

import { AuthAdapterError } from '../errors.js';
import type { AuthAdapter, AuthSessionState, SignInOptions, User } from '../types.js';
import { LOADING, UNAUTHENTICATED } from '../types.js';

export interface MockAuthAdapterOptions {
	/** Simulated async delay in milliseconds (default: 0) */
	delay?: number;
}

export class MockAuthAdapter implements AuthAdapter {
	private state: AuthSessionState = UNAUTHENTICATED;
	private listeners = new Set<(state: AuthSessionState) => void>();
	private readonly delay: number;

	constructor(options: MockAuthAdapterOptions = {}) {
		this.delay = options.delay ?? 0;
	}

	async signIn(options: SignInOptions): Promise<void> {
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
		this.listeners.add(callback);
		return {
			unsubscribe: () => {
				this.listeners.delete(callback);
			},
		};
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// TEST HELPERS
	// ═══════════════════════════════════════════════════════════════════════════

	_reset(): void {
		this.setState(UNAUTHENTICATED);
	}

	_setUser(user: User): void {
		this.setState({
			status: 'authenticated',
			session: {
				id: `mock-session-${Date.now()}`,
				expiresAt: new Date(Date.now() + 3600_000),
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
		for (const listener of this.listeners) {
			listener(state);
		}
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
