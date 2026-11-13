/**
 * @fileoverview A `provider` deployment's identity in first paint (phase 3 specification, 4.2): the session probe,
 * one `GET <base_path><path>/loam/whoami` in parallel with the boot's reads, and `DeferredAuthAdapter`, which answers
 * the probe's state until stage B loads the `auth` chunk with Better Auth's client, then delegates to it. `local` mode
 * sends no probe and never loads `auth`.
 */

import { type AuthAdapter, type AuthSessionState, UNAUTHENTICATED } from '@lushly-dev/afd-auth';
import type { KernelOptionsV3 } from '@lushly-dev/loam-kernel';

/** Stage A waits at most this long for the probe, then paints signed out (4.2). */
export const PROBE_WAIT_MS = 1_500;

type Role = 'owner' | 'admin' | 'member';

/** What `whoami` answers, read: the session, the person and their membership of the bound organization. */
export interface WhoamiV1 {
	state: AuthSessionState;
	membership: { role: Role; digest: string } | null;
	/** `IDENTITY_ORGANIZATION_UNKNOWN` or, to an owner, `IDENTITY_BINDING_MISMATCH` (2.3). */
	warning?: string;
}

const SIGNED_OUT: WhoamiV1 = { state: UNAUTHENTICATED, membership: null };

/** Two states the kernel would read alike: the same status, person, session and expiry. */
const same = (a: AuthSessionState, b: AuthSessionState): boolean =>
	JSON.stringify([a.status, a.user, a.session]) === JSON.stringify([b.status, b.user, b.session]);
const text = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** `whoami`'s answer read strictly: anything malformed is signed out (4.2). */
export function readWhoami(raw: unknown): WhoamiV1 {
	const { session, user, membership, warning } = (raw ?? {}) as Record<
		string,
		Record<string, unknown> | undefined
	>;
	const expires = new Date(session?.expiresAt as string);
	if (!text(session?.id) || !text(user?.id) || !text(user?.email) || Number.isNaN(+expires))
		return SIGNED_OUT;
	const role = membership?.role as Role;
	return {
		state: {
			status: 'authenticated',
			session: { id: session.id, expiresAt: expires },
			user: {
				id: user.id,
				email: user.email,
				...(text(user.name) ? { name: user.name } : {}),
				...(text(user.image) ? { image: user.image } : {}),
			},
		},
		membership:
			['owner', 'admin', 'member'].includes(role) && text(membership?.digest)
				? { role, digest: membership.digest }
				: null,
		...(text(warning) ? { warning } : {}),
	};
}

/**
 * The adapter first paint holds: the probe's state, until `load()` brings the real one, to which every listener
 * and call then moves. Sign-in, sign-out, a refresh and the capabilities wait for it.
 */
export class DeferredAuthAdapter implements AuthAdapter {
	#state: AuthSessionState;
	#real: AuthAdapter | undefined;
	#loading: Promise<AuthAdapter> | undefined;
	readonly #load: () => Promise<AuthAdapter>;
	readonly #listeners = new Set<(state: AuthSessionState) => void>();
	readonly sessions: NonNullable<AuthAdapter['sessions']>;
	readonly passkeys: NonNullable<AuthAdapter['passkeys']>;

	/**
	 * `load` reads the state through `current` when it builds the real adapter, not when the load starts: a probe that
	 * answers while the `auth` chunk loads is then where the real adapter starts (the review of step 3's N2).
	 */
	constructor(
		initial: AuthSessionState,
		load: (current: () => AuthSessionState) => Promise<AuthAdapter>
	) {
		this.#state = initial;
		this.#load = () => load(() => this.#state);
		// Each capability's method awaits the real adapter, then calls its own.
		const later = <T extends object>(name: 'sessions' | 'passkeys', methods: string[]) =>
			Object.fromEntries(
				methods.map((method) => [
					method,
					async (...args: unknown[]) =>
						((await this.load())[name] as unknown as Record<string, (...a: unknown[]) => unknown>)[
							method
						]?.(...args),
				])
			) as T;
		this.sessions = later('sessions', ['listSessions', 'revokeSession']);
		this.passkeys = later('passkeys', [
			'listPasskeys',
			'addPasskey',
			'renamePasskey',
			'removePasskey',
		]);
	}

	/** The real adapter, loaded once; its state reaches this one's listeners from then on. */
	load(): Promise<AuthAdapter> {
		this.#loading ??= this.#load().then((real) => {
			this.#real = real;
			real.onAuthStateChange((state) => this.#emit(state));
			this.#emit(real.getSession());
			return real;
		});
		return this.#loading;
	}

	/** A state the host learned before the real adapter loaded: a probe that answered late (4.2). */
	apply(state: AuthSessionState): void {
		if (!this.#real) this.#emit(state);
	}

	#emit(state: AuthSessionState): void {
		if (same(state, this.#state)) return;
		this.#state = state;
		for (const listener of [...this.#listeners]) listener(state);
	}

	getSession(): AuthSessionState {
		return this.#state;
	}

	onAuthStateChange(callback: (state: AuthSessionState) => void): { unsubscribe(): void } {
		this.#listeners.add(callback);
		return { unsubscribe: () => this.#listeners.delete(callback) };
	}

	async signIn(options: Parameters<AuthAdapter['signIn']>[0]) {
		return (await this.load()).signIn(options);
	}

	async signOut(): Promise<void> {
		await (await this.load()).signOut();
	}

	async refresh(): Promise<void> {
		await (await this.load()).refresh?.();
	}
}

/** What `main.ts` builds for a `provider` deployment. */
export interface ProviderIdentity {
	adapter: DeferredAuthAdapter;
	/** Stage A's membership, from the probe (4.2). */
	membership: NonNullable<KernelOptionsV3['membership']>;
	ports: NonNullable<KernelOptionsV3['identityPorts']>;
	/** The last answer `whoami` gave: what main shows of membership and the binding. */
	last(): WhoamiV1;
	/** Ask the kernel to read membership again, as a refresh finds it may have changed (4.3). */
	membershipMayHaveChanged(): void;
}

/**
 * Probe the session, waiting at most {@link PROBE_WAIT_MS}: a later answer is applied to the adapter, which the
 * kernel settles (4.2). `url` is `<base><path>/loam/whoami`; `load` brings the `auth` chunk.
 */
export async function probeIdentity(
	url: string | undefined,
	load: (current: () => AuthSessionState, identity: ProviderIdentity) => Promise<AuthAdapter>
): Promise<ProviderIdentity> {
	let last = SIGNED_OUT;
	const watchers = new Set<() => void>();
	const whoami = async (): Promise<WhoamiV1> => {
		if (!url) throw new Error('No provider path');
		const response = await fetch(url, { credentials: 'same-origin' });
		if (!response.ok) throw new Error(`whoami answered ${response.status}`);
		last = readWhoami(await response.json());
		return last;
	};
	const probe = whoami().catch(() => SIGNED_OUT);
	const first = await Promise.race([
		probe,
		new Promise<undefined>((resolve) => setTimeout(resolve, PROBE_WAIT_MS)),
	]);
	const identity: ProviderIdentity = {
		adapter: new DeferredAuthAdapter((first ?? SIGNED_OUT).state, (current) =>
			load(current, identity)
		),
		membership: {
			mode: 'provider',
			members: new Map(
				first?.membership && first.state.user ? [[first.state.user.id, first.membership.role]] : []
			),
			digest: first?.membership?.digest ?? '',
		},
		ports: {
			/**
			 * The membership of the person the session holds, or a failure: `whoami` reads the cookie, which another tab's
			 * sign-in may already have changed while this tab's adapter has not heard (the review of step 3's I1). A
			 * failed read is the kernel's to retry, and never decides as the wrong person.
			 */
			async readMembership() {
				const read = await whoami();
				const held = identity.adapter.getSession();
				const holder = held.status === 'authenticated' ? held.user.id : null;
				const answered = read.state.status === 'authenticated' ? read.state.user.id : null;
				if (answered !== holder)
					throw new Error('whoami answered for another person than the session holds');
				return answered ? read.membership : null;
			},
			watchMembership(listener) {
				watchers.add(listener);
				return () => watchers.delete(listener);
			},
		},
		last: () => last,
		membershipMayHaveChanged() {
			for (const watcher of [...watchers]) watcher();
		},
	};
	if (!first) void probe.then((late) => identity.adapter.apply(late.state));
	return identity;
}
