/**
 * @fileoverview BetterAuth adapter
 *
 * Bridges better-auth client to the AuthAdapter interface.
 * Types are defined locally to avoid hard dependency on better-auth.
 */

import { AuthAdapterError, passkeyUnsupported } from '../errors.js';
import { type ListenerErrorHandler, ListenerSet } from '../listeners.js';
import { areSessionStatesEqual } from '../session-state.js';
import type {
	AuthAdapter,
	AuthSessionState,
	OrganizationAccess,
	PasskeyManagement,
	SessionManagement,
	SignInOptions,
	SignInOutcome,
} from '../types.js';
import { LOADING, UNAUTHENTICATED } from '../types.js';
import {
	betterAuthOrganization,
	betterAuthPasskeys,
	betterAuthSessions,
} from './better-auth-capabilities.js';
import {
	type BetterAuthClient,
	type BetterAuthMethodResponse,
	type BetterAuthSessionValue,
	describeError,
	mapThrownError,
	passkeyCeremonyError,
} from './better-auth-client.js';
import { hasWebAuthn } from './session-rows.js';

export type { BetterAuthClient } from './better-auth-client.js';

export interface BetterAuthAdapterOptions {
	/**
	 * better-auth client instance. `passkeys` and passkey sign-in need `@better-auth/passkey`'s
	 * `passkeyClient()`, and `organization` needs `organizationClient()`, on the client and their
	 * plugins on the server; without them the provider answers `PROVIDER_ERROR`. `sessions` uses
	 * Better Auth's own session routes.
	 */
	client: BetterAuthClient;
	/**
	 * The state to report until the client's session store has answered, such as a session the
	 * page read from its server before the client loaded. Default: `loading`.
	 */
	initial?: AuthSessionState;
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
	private store: { get: () => BetterAuthSessionValue } | null = null;
	/** `initial` until the store first answers; then `undefined`. */
	private initial: AuthSessionState | undefined;
	readonly sessions: SessionManagement;
	readonly passkeys: PasskeyManagement;
	readonly organization: OrganizationAccess;

	constructor(options: BetterAuthAdapterOptions) {
		this.client = options.client;
		this.initial = options.initial;
		this.listeners = new ListenerSet(options.onListenerError);
		this.sessions = betterAuthSessions(this.client, () => {
			const state = this.currentState;
			return state.status === 'authenticated' ? state.session.id : undefined;
		});
		this.passkeys = betterAuthPasskeys(this.client);
		this.organization = betterAuthOrganization(this.client);
		this.setupSubscription();
	}

	async signIn(options: SignInOptions): Promise<SignInOutcome> {
		try {
			let result: BetterAuthMethodResponse;
			if (options.method === 'passkey') {
				const { signIn } = this.client;
				if (!signIn.passkey || !hasWebAuthn()) throw passkeyUnsupported();
				result = await signIn.passkey(
					options.autoFill === undefined ? undefined : { autoFill: options.autoFill }
				);
			} else if (options.method === 'credentials') {
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

			const providerError = result?.error ?? null;
			if (providerError) {
				if (options.method === 'credentials' && providerError.status === 401) {
					throw AuthAdapterError.invalidCredentials();
				}
				if (options.method === 'passkey') {
					const cancelled = passkeyCeremonyError(providerError);
					if (cancelled) throw cancelled;
				}
				throw AuthAdapterError.providerError('better-auth', describeError(providerError));
			}
			return toSignInOutcome(result);
		} catch (error) {
			throw mapThrownError(error);
		}
	}

	async signOut(): Promise<void> {
		try {
			const result = await this.client.signOut();
			const providerError = result?.error ?? null;
			if (providerError) {
				throw AuthAdapterError.providerError('better-auth', describeError(providerError));
			}
		} catch (error) {
			throw mapThrownError(error);
		}
	}

	/**
	 * Fetch the session from the provider now, through the session store's `refetch`. Resolves
	 * once the store holds the answer, which reaches `getSession()` and the listeners.
	 */
	async refresh(): Promise<void> {
		const refetch = this.store?.get().refetch;
		if (!refetch) return;
		try {
			await refetch();
		} catch (error) {
			throw mapThrownError(error);
		}
		const store = this.store;
		if (store) this.updateState(store.get());
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
		const storeAccessor = this.client.useSession;
		const store =
			typeof storeAccessor === 'function' ? storeAccessor.call(this.client) : storeAccessor;

		this.store = store;
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

	private updateState(value: BetterAuthSessionValue): void {
		const newState = this.mapToState(value);
		if (areSessionStatesEqual(newState, this.currentState)) return;

		this.currentState = newState;
		this.listeners.emit(newState);
	}

	private mapToState(value: BetterAuthSessionValue): AuthSessionState {
		if (value.isPending) {
			return this.initial ?? LOADING;
		}
		this.initial = undefined;

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
				image: value.data.user.image ?? undefined,
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
