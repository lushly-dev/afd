/**
 * @fileoverview The `auth` chunk (phase 3 specification, 4.2 and 4.3), which stage B loads in `provider` mode only:
 * Better Auth's client with its passkey and organization plugins, `BetterAuthAdapter` started from the probe's state,
 * Loam's own session capability over `loamServerPlugin`'s endpoints, the passkey capability with the provider's codes
 * kept, and `SessionSync`, so a sign-out in one tab reaches every tab of the profile. The page reads the session again
 * when it becomes visible, comes online, and every 60 seconds while visible, so another device's revocation shows.
 */

import { passkeyClient } from '@better-auth/passkey/client';
import {
	type AuthAdapter,
	type AuthSessionState,
	BetterAuthAdapter,
	type BetterAuthAdapterOptions,
	type OrganizationAccess,
	type OrganizationInvitation,
	type PasskeyRow,
	type SessionRow,
	SessionSync,
} from '@lushly-dev/afd-auth';
import type { LoamAccountAccessV1 } from '@lushly-dev/loam-kernel';
import { createAuthClient } from 'better-auth/client';
import { organizationClient } from 'better-auth/client/plugins';
import type { ProviderIdentity } from './identity.js';

type BetterAuthClient = BetterAuthAdapterOptions['client'];

/** How often a visible page reads the session again (4.3). */
export const REFRESH_EVERY_MS = 60_000;

/** The codes the passkey client answers when the person dismissed the ceremony, or it timed out. */
const CANCELLED = new Set([
	'AUTH_CANCELLED',
	'REGISTRATION_CANCELLED',
	'ERROR_CEREMONY_ABORTED',
	'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
]);

/** A refusal with the provider's code, which the kernel keeps where it is its own (15). */
const refusal = (code: string | undefined, message: string | undefined): Error =>
	Object.assign(new Error(message ?? 'The sign-in provider refused the request'), {
		code: code !== undefined && CANCELLED.has(code) ? 'PASSKEY_CANCELLED' : code,
	});

type Answer<T> = Promise<{ data?: T | null; error?: { code?: string; message?: string } | null }>;

async function answered<T>(run: () => Answer<T>): Promise<T | null | undefined> {
	const result = await run();
	if (result?.error)
		throw Object.assign(refusal(result.error.code, result.error.message), {
			status: (result.error as { status?: number }).status,
		});
	return result?.data;
}

interface PasskeyAnswer {
	id: string;
	name?: string | null;
	createdAt: string | Date;
	deviceType?: string;
	backedUp?: boolean;
}

const passkeyRow = (row: PasskeyAnswer): PasskeyRow => ({
	id: row.id,
	...(row.name ? { name: row.name } : {}),
	createdAt: new Date(row.createdAt),
	...(row.deviceType === 'singleDevice' || row.deviceType === 'multiDevice'
		? { deviceType: row.deviceType }
		: {}),
	...(typeof row.backedUp === 'boolean' ? { backedUp: row.backedUp } : {}),
});

/** A request to the provider, its code kept on a refusal (15). `path` is under `authBase`. */
const requester =
	(authBase: string) =>
	async (path: string, body?: unknown): Promise<Record<string, unknown>> => {
		const response = await fetch(`${authBase}${path}`, {
			method: body === undefined ? 'GET' : 'POST',
			credentials: 'same-origin',
			headers: body === undefined ? {} : { 'content-type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
		// The status travels with the code: a refusal (4xx) is not retried as an outage is (the review of step 4's N1).
		if (!response.ok)
			throw Object.assign(refusal(json?.code as string | undefined, json?.message as string), {
				status: response.status,
			});
		return json ?? {};
	};

/** Loam's session capability (4.6): `loamServerPlugin`'s endpoints, handles and never tokens, no fresh session to list. */
function loamSessions(authBase: string): NonNullable<AuthAdapter['sessions']> {
	const loam = requester(authBase);
	const request = (path: string, body?: unknown) => loam(`/loam/${path}`, body);
	return {
		async listSessions() {
			const { sessions } = (await request('sessions')) as {
				sessions: Array<Record<string, string | boolean | null>>;
			};
			return sessions.map(
				(row): SessionRow => ({
					handle: row.handle as string,
					current: row.current === true,
					createdAt: new Date(row.createdAt as string),
					updatedAt: new Date(row.updatedAt as string),
					...(row.expiresAt ? { expiresAt: new Date(row.expiresAt as string) } : {}),
					...(row.device ? { device: row.device as string } : {}),
				})
			);
		},
		// Loam's provider answers how many it revoked, which `session-revoke` reports.
		revokeSession: (target) => request('revoke-person', { target }) as unknown as Promise<void>,
	};
}

/** Loam's account capability (5.1, 5.3, 5.4, 7.2): `loamServerPlugin`'s reads and Better Auth's `update-user`. */
function loamAccount(authBase: string): LoamAccountAccessV1 {
	const request = requester(authBase);
	return {
		get: async () => (await request('/loam/account')) as never,
		async update(changes) {
			await request('/update-user', changes);
		},
		async members({ limit, offset }) {
			const query = new URLSearchParams();
			if (limit !== undefined) query.set('limit', String(limit));
			if (offset !== undefined) query.set('offset', String(offset));
			return (await request(`/loam/members?${query}`)) as never;
		},
		invitations: async () =>
			((await request('/loam/invitations')) as { invitations: never[] }).invitations,
	};
}

/**
 * The organization capability over Better Auth's routes (7.2), each naming the bound organization by id, never the
 * session's active one (2.3), and keeping the provider's codes, which the kernel maps (15).
 */
function loamOrganization(authBase: string): OrganizationAccess {
	const request = requester(authBase);
	const invitation = (row: Record<string, unknown>): OrganizationInvitation => ({
		id: row.id as string,
		organizationId: row.organizationId as string,
		email: row.email as string,
		role: row.role as string,
		status: row.status as OrganizationInvitation['status'],
		expiresAt: new Date(row.expiresAt as string),
	});
	const unsupported = async (): Promise<never> => {
		throw refusal('IDENTITY_PROVIDER_UNAVAILABLE', 'Loam reads its members through member-list');
	};
	return {
		membership: unsupported,
		listMembers: unsupported,
		leave: unsupported,
		invite: async (organizationId, { email, role }) =>
			invitation(await request('/organization/invite-member', { organizationId, email, role })),
		listInvitations: async (organizationId) =>
			(
				(await request(
					`/organization/list-invitations?organizationId=${encodeURIComponent(organizationId)}`
				)) as unknown as Record<string, unknown>[]
			).map(invitation),
		async cancelInvitation(_organizationId, invitationId) {
			await request('/organization/cancel-invitation', { invitationId });
		},
		async removeMember(organizationId, memberId) {
			await request('/organization/remove-member', { organizationId, memberIdOrEmail: memberId });
		},
		async setRole(organizationId, memberId, role) {
			await request('/organization/update-member-role', { organizationId, memberId, role });
		},
		listOwnInvitations: unsupported,
		async acceptInvitation(invitationId) {
			await request('/organization/accept-invitation', { invitationId });
		},
		async rejectInvitation(invitationId) {
			await request('/organization/reject-invitation', { invitationId });
		},
	};
}

/** The passkey capability over the passkey client, keeping the provider's codes (5.2, 5.8). */
function loamPasskeys(client: BetterAuthClient): NonNullable<AuthAdapter['passkeys']> {
	const passkey = client.passkey as NonNullable<BetterAuthClient['passkey']>;
	return {
		listPasskeys: async () =>
			((await answered(() => passkey.listUserPasskeys() as Answer<PasskeyAnswer[]>)) ?? []).map(
				passkeyRow
			),
		async addPasskey(options) {
			if (typeof globalThis.PublicKeyCredential !== 'function') {
				throw refusal('PASSKEY_UNSUPPORTED', 'This browser cannot create a passkey');
			}
			const created = await answered(
				() =>
					passkey.addPasskey(
						options?.name ? { name: options.name } : undefined
					) as Answer<PasskeyAnswer>
			);
			if (!created) throw refusal(undefined, 'The provider returned no passkey');
			return passkeyRow(created);
		},
		async renamePasskey(id, name) {
			await answered(() => passkey.updatePasskey({ id, name }) as Answer<unknown>);
		},
		async removePasskey(id) {
			await answered(() => passkey.deletePasskey({ id }) as Answer<unknown>);
			// The authenticator learns the credential is gone, where the browser can say so (W32).
			const signal = (
				globalThis.PublicKeyCredential as unknown as {
					signalUnknownCredential?(options: { rpId: string; credentialId: string }): Promise<void>;
				}
			)?.signalUnknownCredential;
			await signal?.({ rpId: location.hostname, credentialId: id }).catch(() => undefined);
		},
	};
}

/**
 * The real adapter for a `provider` deployment: `authBase` is `<origin><base_path><path>`. `initial` is the probe's
 * state, reported until the client's session store answers.
 */
export function createProviderAdapter(
	authBase: string,
	initial: AuthSessionState,
	identity: Pick<ProviderIdentity, 'membershipMayHaveChanged'>,
	view: Window = window
): AuthAdapter {
	const client = createAuthClient({
		baseURL: authBase,
		fetchOptions: { credentials: 'same-origin' },
		plugins: [passkeyClient(), organizationClient()],
	}) as unknown as BetterAuthClient;
	const adapter = new BetterAuthAdapter({ client, initial });
	const real = Object.assign(adapter, {
		sessions: loamSessions(authBase),
		passkeys: loamPasskeys(client),
		organization: loamOrganization(authBase),
		account: loamAccount(authBase),
	});
	// Created here, and only in `provider` mode: the Mock's sessions are per page (4.2).
	const sync = new SessionSync({ channelName: 'loam-session' });
	let person = initial.status === 'authenticated' ? initial.user.id : null;
	real.onAuthStateChange((state) => {
		const now = state.status === 'authenticated' ? state.user.id : null;
		if (state.status === 'loading' || now === person) return;
		person = now;
		sync.notifySessionChanged(
			now === null ? { type: 'signed-out' } : { type: 'signed-in', userId: now }
		);
	});
	/** Read the session again, and tell the kernel membership may have changed (4.3, 7.6). */
	const refresh = () => {
		void real.refresh().catch(() => undefined);
		identity.membershipMayHaveChanged();
	};
	sync.onSessionChanged(refresh);
	const visible = () => view.document.visibilityState === 'visible';
	view.document.addEventListener('visibilitychange', () => {
		if (visible()) refresh();
	});
	view.addEventListener('online', refresh);
	view.setInterval(() => {
		if (visible()) refresh();
	}, REFRESH_EVERY_MS);
	return real;
}

interface LinkAnswer {
	success: boolean;
	data?: never;
	error?: { code?: string; message?: string };
}

/** A provider request as a link page's answer: its data, or its code and message (15). */
async function answer(run: () => Promise<Record<string, unknown>>): Promise<LinkAnswer> {
	try {
		return { success: true, data: (await run()) as never };
	} catch (cause) {
		const { code, message } = (cause ?? {}) as { code?: string; message?: string };
		return {
			success: false,
			error: { ...(code ? { code } : {}), ...(message ? { message } : {}) },
		};
	}
}

/**
 * What the join and recovery pages ask of the provider (phase 3 specification, 5.6, 5.7): each page's check, a passkey
 * registered with its `join:`/`recover:` context and signed in, or for the session's person after single sign-on
 * recovery, and a password set instead where the deployment allows passwords.
 */
export function createLinkProvider(authBase: string) {
	const request = requester(authBase);
	const client = createAuthClient({
		baseURL: authBase,
		fetchOptions: { credentials: 'same-origin' },
		plugins: [passkeyClient()],
	}) as unknown as BetterAuthClient;
	const passkey = client.passkey as NonNullable<BetterAuthClient['passkey']>;
	const query = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
	return {
		checkJoin: (invitation: string, token: string) =>
			answer(() => request(`/loam/join/check?${query({ invitation, token })}`)),
		checkRecover: (token: string) =>
			answer(() => request(`/loam/recover/check?${query({ token })}`)),
		completeOidc: () => answer(() => request('/loam/recover/oidc/complete', {})),
		setName: (invitation: string, token: string, name: string) =>
			answer(() => request('/loam/join/name', { invitation, token, name })),
		registerPasskey: (context?: string) =>
			answer(async () => {
				if (typeof globalThis.PublicKeyCredential !== 'function') {
					throw refusal('PASSKEY_UNSUPPORTED', 'This browser cannot create a passkey');
				}
				const made = await answered(
					() =>
						(
							passkey.addPasskey as unknown as (options: {
								context?: string;
								createSession?: boolean;
							}) => Answer<Record<string, unknown>>
						)(context ? { context, createSession: true } : {}) as Answer<Record<string, unknown>>
				);
				return made ?? {};
			}),
		setPassword: (kind: 'join' | 'recover', fields: Record<string, string>) =>
			answer(() =>
				request(kind === 'join' ? '/loam/join/password' : '/loam/recover/password', fields)
			),
		signOut: async () => {
			await request('/sign-out', {}).catch(() => undefined);
		},
	};
}

/** Recovery's request (5.7): the answer is the same whatever the provider found. */
export async function requestRecovery(authBase: string, email: string): Promise<void> {
	await requester(authBase)('/loam/recover/request', { email });
}

/**
 * The single sign-on recovery ceremony's start (5.7): any session in this browser signed out and the nonce set, then
 * the deployer's sign-in, which returns to the recovery page.
 */
export async function recoverWithProvider(authBase: string, provider: string): Promise<void> {
	const request = requester(authBase);
	const started = (await request('/loam/recover/oidc/start', { provider })) as {
		callbackURL: string;
	};
	const social = (await request('/sign-in/social', {
		provider,
		callbackURL: started.callbackURL,
		errorCallbackURL: started.callbackURL,
	})) as { url?: string };
	if (social.url) location.assign(social.url);
}
