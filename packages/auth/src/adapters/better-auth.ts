/**
 * @fileoverview BetterAuth adapter
 *
 * Bridges better-auth client to the AuthAdapter interface.
 * Types are defined locally to avoid hard dependency on better-auth.
 */

import { AuthAdapterError } from '../errors.js';
import { type ListenerErrorHandler, ListenerSet } from '../listeners.js';
import { areSessionStatesEqual } from '../session-state.js';
import type { AuthAdapter, AuthSessionState, SignInOptions, SignInOutcome } from '../types.js';
import { LOADING, UNAUTHENTICATED } from '../types.js';
import { isKnownNetworkFailure } from './provider-errors.js';

/** Minimal interface for better-auth client — avoids hard import */
interface BetterAuthErrorResponse {
	message?: string;
	status?: number;
	statusText?: string;
	code?: string;
}

/**
 * The small portion of Better Auth's response contract used by this adapter.
 * Better Auth reports provider failures as resolved `{ data, error }` values;
 * they do not necessarily reject the promise.
 */
interface BetterAuthMethodResult {
	data?: unknown | null;
	error?: BetterAuthErrorResponse | null;
}

type BetterAuthMethodResponse = BetterAuthMethodResult | undefined;

interface BetterAuthClient {
	signIn: {
		social: (params: {
			provider: string;
			callbackURL?: string;
			scopes?: string[];
		}) => Promise<BetterAuthMethodResponse>;
		email: (params: { email: string; password: string }) => Promise<BetterAuthMethodResponse>;
	};
	signOut: () => Promise<BetterAuthMethodResponse>;
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
	/**
	 * Receives errors thrown by `onAuthStateChange` subscribers. Without it,
	 * they are rethrown in a microtask. Either way the other subscribers still
	 * run.
	 */
	onListenerError?: ListenerErrorHandler;
}

export class BetterAuthAdapter implements AuthAdapter {
	private readonly client: BetterAuthClient;
	private readonly listeners: ListenerSet<AuthSessionState>;
	private currentState: AuthSessionState = LOADING;
	private unsubscribeStore: (() => void) | null = null;

	constructor(options: BetterAuthAdapterOptions) {
		this.client = options.client;
		this.listeners = new ListenerSet(options.onListenerError);
		this.setupSubscription();
	}

	async signIn(options: SignInOptions): Promise<SignInOutcome> {
		try {
			let result: BetterAuthMethodResponse;
			if (options.method === 'credentials') {
				result = await this.client.signIn.email({
					email: options.email,
					password: options.password ?? '',
				});
			} else {
				result = await this.client.signIn.social({
					provider: options.provider,
					callbackURL: options.redirectTo,
					scopes: options.scopes,
				});
			}

			const providerError = this.getResolvedProviderError(result);
			if (providerError) {
				if (options.method === 'credentials' && providerError.status === 401) {
					throw AuthAdapterError.invalidCredentials();
				}
				throw AuthAdapterError.providerError('better-auth', this.describeError(providerError));
			}
			return toSignInOutcome(result);
		} catch (error) {
			throw this.mapThrownError(error);
		}
	}

	async signOut(): Promise<void> {
		try {
			const result = await this.client.signOut();
			const providerError = this.getResolvedProviderError(result);
			if (providerError) {
				throw AuthAdapterError.providerError('better-auth', this.describeError(providerError));
			}
		} catch (error) {
			throw this.mapThrownError(error);
		}
	}

	getSession(): AuthSessionState {
		return this.currentState;
	}

	onAuthStateChange(callback: (state: AuthSessionState) => void): { unsubscribe: () => void } {
		return this.listeners.add(callback);
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

		// Read before subscribing so stores that invoke the callback immediately do
		// not replace an equivalent initial snapshot with a new object.
		this.currentState = this.mapToState(store.get());
		this.unsubscribeStore = store.subscribe((value) => {
			this.updateState(value);
		});
		// A store can change while subscribe() is being attached without calling
		// the callback. Reconcile once more so the adapter never exposes a stale
		// initial snapshot.
		this.updateState(store.get());
	}

	private updateState(value: { data: BetterAuthSessionData | null; isPending: boolean }): void {
		const newState = this.mapToState(value);
		if (areSessionStatesEqual(newState, this.currentState)) return;

		this.currentState = newState;
		this.listeners.emit(newState);
	}

	private getResolvedProviderError(
		result: BetterAuthMethodResponse
	): BetterAuthErrorResponse | null {
		return result?.error ?? null;
	}

	private describeError(error: BetterAuthErrorResponse): string | undefined {
		if (error.message) return error.message;
		if (error.statusText) return error.statusText;
		if (error.code) return error.code;
		return error.status === undefined ? undefined : `status ${error.status}`;
	}

	private mapThrownError(error: unknown): AuthAdapterError {
		if (error instanceof AuthAdapterError) return error;

		const message = error instanceof Error ? error.message : String(error);
		if (isKnownNetworkFailure(error, message)) {
			return AuthAdapterError.networkError();
		}

		return AuthAdapterError.providerError('better-auth', message);
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

/**
 * Better Auth answers a social sign-in with `{ url, redirect: true }` and
 * navigates the browser there; the session exists only after the callback.
 */
function toSignInOutcome(result: BetterAuthMethodResponse): SignInOutcome {
	const data = result?.data;
	if (typeof data === 'object' && data !== null && 'redirect' in data && data.redirect === true) {
		const url = 'url' in data && typeof data.url === 'string' ? data.url : undefined;
		return url === undefined ? { kind: 'redirect' } : { kind: 'redirect', url };
	}
	return { kind: 'signed-in' };
}
