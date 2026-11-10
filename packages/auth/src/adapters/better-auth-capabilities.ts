/**
 * @fileoverview `BetterAuthAdapter`'s capabilities: sessions (Better Auth's own routes), passkeys
 * (`@better-auth/passkey`'s client plugin) and organizations (the organization client plugin).
 */

import { AuthAdapterError, passkeyUnsupported } from '../errors.js';
import type {
	OrganizationAccess,
	OrganizationInvitation,
	OrganizationMember,
	PasskeyManagement,
	PasskeyRow,
	SessionManagement,
	SessionRow,
} from '../types.js';
import {
	type BetterAuthClient,
	type BetterAuthInvitation,
	type BetterAuthMember,
	type BetterAuthOrganizationClient,
	type BetterAuthPasskey,
	type BetterAuthPasskeyClient,
	type BetterAuthRole,
	call,
	mapThrownError,
	passkeyCeremonyError,
	providerError,
} from './better-auth-client.js';
import { deviceLabel, hasWebAuthn, sessionHandle, toDate } from './session-rows.js';

/**
 * Sessions through Better Auth's `/list-sessions` and `/revoke-*` routes. Handles map to tokens
 * in memory only, refreshed by every list; `forget` drops them, which the adapter does on
 * sign-out and whenever the signed-in user changes, so one person's handles never name another's
 * sessions.
 */
export function betterAuthSessions(
	client: BetterAuthClient,
	currentSessionId: () => string | undefined
): { sessions: SessionManagement; forget(): void } {
	let tokens = new Map<string, string>();
	// A list that started before a `forget` must not restore the tokens it read.
	let generation = 0;

	const list = async (): Promise<SessionRow[]> => {
		const started = generation;
		const rows = (await call(() => routes(client.listSessions)())) ?? [];
		const next = new Map<string, string>();
		const current = currentSessionId();
		const sessions: SessionRow[] = [];
		for (const row of rows) {
			const handle = await sessionHandle(row.token);
			next.set(handle, row.token);
			const device = deviceLabel(row.userAgent);
			sessions.push({
				handle,
				current: row.id === current,
				createdAt: toDate(row.createdAt),
				updatedAt: toDate(row.updatedAt),
				...(row.expiresAt ? { expiresAt: toDate(row.expiresAt) } : {}),
				...(device ? { device } : {}),
			});
		}
		if (started === generation) tokens = next;
		return sessions;
	};

	const forget = () => {
		generation += 1;
		tokens = new Map();
	};

	const sessions: SessionManagement = {
		listSessions: list,
		async revokeSession(target) {
			if (target === 'all') {
				await call(() => routes(client.revokeSessions)());
				return;
			}
			if (target === 'others') {
				await call(() => routes(client.revokeOtherSessions)());
				return;
			}
			// A handle from before this page loaded: list once to learn its token.
			if (!tokens.has(target)) await list();
			const token = tokens.get(target);
			if (token === undefined) {
				throw AuthAdapterError.providerError('better-auth', 'No session has this handle');
			}
			await call(() => routes(client.revokeSession)({ token }));
			tokens.delete(target);
		},
	};
	return { sessions, forget };
}

/**
 * A route of the client, called as itself. Better Auth's client is a path proxy: every property
 * is a route, so a method is never detached or called with `.call` (which would name a route).
 */
function routes<F>(route: F | undefined): F {
	if (!route) throw AuthAdapterError.providerError('better-auth', 'The client has no such route');
	return route;
}

function toPasskeyRow(passkey: BetterAuthPasskey): PasskeyRow {
	const deviceType =
		passkey.deviceType === 'singleDevice' || passkey.deviceType === 'multiDevice'
			? passkey.deviceType
			: undefined;
	return {
		id: passkey.id,
		...(passkey.name ? { name: passkey.name } : {}),
		createdAt: toDate(passkey.createdAt),
		...(deviceType ? { deviceType } : {}),
		...(typeof passkey.backedUp === 'boolean' ? { backedUp: passkey.backedUp } : {}),
	};
}

/**
 * Passkeys through `@better-auth/passkey`'s client plugin (`passkeyClient()`). Without the plugin
 * on the client and the server, the provider answers `PROVIDER_ERROR`.
 */
export function betterAuthPasskeys(client: BetterAuthClient): PasskeyManagement {
	const passkey = (): BetterAuthPasskeyClient => routes(client.passkey);
	return {
		async listPasskeys() {
			const rows = (await call(() => passkey().listUserPasskeys())) ?? [];
			return rows.map(toPasskeyRow);
		},
		async addPasskey(options) {
			if (!hasWebAuthn()) throw passkeyUnsupported();
			const name = options?.name;
			const created = await call(
				() => passkey().addPasskey(name === undefined ? undefined : { name }),
				passkeyCeremonyError
			);
			if (!created) {
				throw AuthAdapterError.providerError('better-auth', 'The provider returned no passkey');
			}
			return toPasskeyRow(created);
		},
		async renamePasskey(id, name) {
			await call(() => passkey().updatePasskey({ id, name }));
		},
		async removePasskey(id) {
			await call(() => passkey().deletePasskey({ id }));
		},
	};
}

function toMember(member: BetterAuthMember): OrganizationMember {
	const { user } = member;
	return {
		id: member.id,
		userId: member.userId,
		role: member.role,
		createdAt: toDate(member.createdAt),
		user: {
			id: user.id,
			email: user.email,
			...(user.name ? { name: user.name } : {}),
			...(user.image ? { image: user.image } : {}),
		},
	};
}

const INVITATION_STATUSES = new Set(['pending', 'accepted', 'rejected', 'canceled']);

function toInvitation(invitation: BetterAuthInvitation): OrganizationInvitation {
	const status = INVITATION_STATUSES.has(invitation.status)
		? (invitation.status as OrganizationInvitation['status'])
		: 'pending';
	return {
		id: invitation.id,
		organizationId: invitation.organizationId,
		email: invitation.email,
		role: invitation.role,
		status,
		expiresAt: toDate(invitation.expiresAt),
	};
}

/**
 * Better Auth's organization routes fall back to the session's active organization when
 * `organizationId` is missing or empty. Refuse that here, so no call can reach it.
 */
function named(organizationId: string): string {
	if (typeof organizationId !== 'string' || organizationId.length === 0) {
		throw new TypeError('organizationId must be a non-empty string');
	}
	return organizationId;
}

/** A membership id: Better Auth would read a value with `@` as an email. */
function membership(memberId: string): string {
	if (typeof memberId !== 'string' || memberId.length === 0 || memberId.includes('@')) {
		throw new TypeError('memberId must be a membership id, not an email');
	}
	return memberId;
}

const NOT_A_MEMBER = 'YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION';

/**
 * Organizations through the organization client plugin (`organizationClient()`). Without the
 * plugin on the client and the server, the provider answers `PROVIDER_ERROR`.
 */
export function betterAuthOrganization(client: BetterAuthClient): OrganizationAccess {
	const organization = (): BetterAuthOrganizationClient => routes(client.organization);

	const listInvitations = async (organizationId: string) => {
		const query = { organizationId: named(organizationId) };
		const rows = (await call(() => organization().listInvitations({ query }))) ?? [];
		return rows.map(toInvitation);
	};

	return {
		async membership(organizationId) {
			const query = { organizationId: named(organizationId) };
			let result: Awaited<ReturnType<BetterAuthOrganizationClient['getActiveMemberRole']>>;
			try {
				result = await organization().getActiveMemberRole({ query });
			} catch (error) {
				throw mapThrownError(error);
			}
			if (result?.error) {
				if (result.error.code === NOT_A_MEMBER) return null;
				throw providerError(result.error);
			}
			return result?.data ? { role: result.data.role } : null;
		},
		async listMembers(organizationId, options = {}) {
			// Only the page: nothing in `options` can name the organization.
			const { limit, offset } = options;
			const query = {
				organizationId: named(organizationId),
				...(limit === undefined ? {} : { limit }),
				...(offset === undefined ? {} : { offset }),
			};
			const data = await call(() => organization().listMembers({ query }));
			return (data?.members ?? []).map(toMember);
		},
		async invite(organizationId, { email, role }) {
			const body = { organizationId: named(organizationId), email, role: role as BetterAuthRole };
			const created = await call(() => organization().inviteMember(body));
			if (!created) {
				throw AuthAdapterError.providerError('better-auth', 'The provider returned no invitation');
			}
			return toInvitation(created);
		},
		listInvitations,
		async cancelInvitation(organizationId, invitationId) {
			// Better Auth cancels by id alone, in whichever organization holds it: check it is this one's.
			const invitations = await listInvitations(organizationId);
			if (!invitations.some((invitation) => invitation.id === invitationId)) {
				throw AuthAdapterError.providerError(
					'better-auth',
					'No invitation of this organization has this id'
				);
			}
			await call(() => organization().cancelInvitation({ invitationId }));
		},
		async removeMember(organizationId, memberId) {
			// Better Auth reads an `@` as an email: members are named by membership id only.
			const body = { organizationId: named(organizationId), memberIdOrEmail: membership(memberId) };
			await call(() => organization().removeMember(body));
		},
		async setRole(organizationId, memberId, role) {
			const body = {
				organizationId: named(organizationId),
				memberId,
				role: role as BetterAuthRole,
			};
			await call(() => organization().updateMemberRole(body));
		},
		async leave(organizationId) {
			const body = { organizationId: named(organizationId) };
			await call(() => organization().leave(body));
		},
		async listOwnInvitations() {
			const rows = (await call(() => organization().listUserInvitations())) ?? [];
			return rows.map(toInvitation);
		},
		async acceptInvitation(invitationId) {
			await call(() => organization().acceptInvitation({ invitationId }));
		},
		async rejectInvitation(invitationId) {
			await call(() => organization().rejectInvitation({ invitationId }));
		},
	};
}
