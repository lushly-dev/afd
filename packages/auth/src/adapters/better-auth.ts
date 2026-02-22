/**
 * @fileoverview BetterAuth adapter
 *
 * Bridges better-auth client to the AuthAdapter interface.
 * Types are defined locally to avoid hard dependency on better-auth.
 */

import { AuthAdapterError } from '../errors.js';
import type { AuthAdapter, AuthSessionState, SignInOptions } from '../types.js';
import { LOADING, UNAUTHENTICATED } from '../types.js';

/** Minimal interface for better-auth client — avoids hard import */
interface BetterAuthClient {
	signIn: {
		social: (params: { provider: string; callbackURL?: string }) => Promise<unknown>;
		email: (params: { email: string; password: string }) => Promise<unknown>;
	};
	signOut: () => Promise<unknown>;
	useSession: () => {
		subscribe: (
			callback: (value: { data: BetterAuthSessionData | null; isPending: boolean }) => void
		) => () => void;
		get: () => { data: BetterAuthSessionData | null; isPending: boolean };
	};
}

interface BetterAuthSessionData {
	session: { id: string; expiresAt: string | Date };
	user: { id: string; email: string; name?: string; image?: string };
}

export interface BetterAuthAdapterOptions {
	/** better-auth client instance */
	client: BetterAuthClient;
}

export class BetterAuthAdapter implements AuthAdapter {
	private readonly client: BetterAuthClient;
	private listeners = new Set<(state: AuthSessionState) => void>();
	private currentState: AuthSessionState = LOADING;
	private unsubscribeStore: (() => void) | null = null;

	constructor(options: BetterAuthAdapterOptions) {
		this.client = options.client;
		this.setupSubscription();
	}

	async signIn(options: SignInOptions): Promise<void> {
		try {
			if (options.method === 'credentials') {
				await this.client.signIn.email({
					email: options.email,
					password: options.password ?? '',
				});
			} else {
				await this.client.signIn.social({
					provider: options.provider,
					callbackURL: options.redirectTo,
				});
			}
		} catch (error) {
			if (error instanceof AuthAdapterError) throw error;
			throw AuthAdapterError.providerError(
				'better-auth',
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	async signOut(): Promise<void> {
		try {
			await this.client.signOut();
		} catch (error) {
			if (error instanceof AuthAdapterError) throw error;
			throw AuthAdapterError.providerError(
				'better-auth',
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	getSession(): AuthSessionState {
		return this.currentState;
	}

	onAuthStateChange(callback: (state: AuthSessionState) => void): { unsubscribe: () => void } {
		this.listeners.add(callback);
		return {
			unsubscribe: () => {
				this.listeners.delete(callback);
			},
		};
	}

	/**
	 * Clean up the nanostore subscription.
	 */
	dispose(): void {
		if (this.unsubscribeStore) {
			this.unsubscribeStore();
			this.unsubscribeStore = null;
		}
		this.listeners.clear();
	}

	private setupSubscription(): void {
		// biome-ignore lint/correctness/useHookAtTopLevel: useSession is a better-auth store accessor, not a React hook
		const store = this.client.useSession();
		this.unsubscribeStore = store.subscribe((value) => {
			const newState = this.mapToState(value);
			if (newState.status !== this.currentState.status) {
				this.currentState = newState;
				for (const listener of this.listeners) {
					listener(newState);
				}
			}
		});

		// Initialize from current store value
		this.currentState = this.mapToState(store.get());
	}

	private mapToState(value: {
		data: BetterAuthSessionData | null;
		isPending: boolean;
	}): AuthSessionState {
		if (value.isPending) {
			return LOADING;
		}

		if (!value.data) {
			return UNAUTHENTICATED;
		}

		return {
			status: 'authenticated',
			session: {
				id: value.data.session.id,
				expiresAt:
					value.data.session.expiresAt instanceof Date
						? value.data.session.expiresAt
						: new Date(value.data.session.expiresAt),
			},
			user: {
				id: value.data.user.id,
				email: value.data.user.email,
				name: value.data.user.name,
				image: value.data.user.image,
			},
		};
	}
}
