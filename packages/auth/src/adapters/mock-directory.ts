/**
 * @fileoverview The records behind `withMockCapabilities`: the Mock's session, passkeys,
 * organizations with roles from its options, and invitations, in memory. Ids count up, so a run
 * is deterministic.
 */

import type { Clock } from '@lushly-dev/afd-core';
import { AuthAdapterError, passkeyCancelled, passkeyUnsupported } from '../errors.js';
import type {
	OrganizationAccess,
	OrganizationInvitation,
	OrganizationMember,
	PasskeyManagement,
	PasskeyRow,
	SessionManagement,
	User,
} from '../types.js';
import type { MockAuthAdapter } from './mock.js';
import { sessionHandle } from './session-rows.js';

/** Organization id to user id to role, as `MockAuthAdapterOptions.roles` gives them. */
export type MockRoles = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** How the next passkey ceremony ends. */
export type MockPasskeyCeremony = 'complete' | 'cancel' | 'unsupported';

const MOCK_USER_PREFIX = 'mock-user-';
const INVITATION_LIFETIME_MS = 48 * 3600_000;
/** The roles Better Auth's organization plugin lets manage members and invitations by default. */
const MANAGERS = new Set(['owner', 'admin']);

/** The Mock's user for an id: `mock-user-<email>` gives the email back. */
export function mockUser(id: string): User {
	const email = id.startsWith(MOCK_USER_PREFIX) ? id.slice(MOCK_USER_PREFIX.length) : id;
	return { id, email, name: email.split('@')[0] };
}

interface StoredPasskey {
	row: PasskeyRow;
	user: User;
}

interface StoredMember {
	id: string;
	role: string;
	createdAt: Date;
	user: User;
}

/** The Mock's provider-side records, shared by its capabilities. */
export class MockDirectory {
	ceremony: MockPasskeyCeremony = 'complete';
	private readonly clock: Clock;
	private readonly passkeyRecords: StoredPasskey[] = [];
	private readonly members = new Map<string, Map<string, StoredMember>>();
	private readonly invitations = new Map<string, OrganizationInvitation>();
	private next = 0;

	constructor(
		private readonly mock: MockAuthAdapter,
		roles: MockRoles = {}
	) {
		this.clock = mock.clock;
		for (const [organizationId, byUser] of Object.entries(roles)) {
			for (const [userId, role] of Object.entries(byUser)) {
				this.addMember(organizationId, mockUser(userId), role);
			}
		}
	}

	/** The user a passkey ceremony signs in: the holder of the passkey added last. */
	passkeyUser(): User {
		this.checkCeremony();
		const latest = this.passkeyRecords.at(-1);
		// With no passkey to choose, the person can only dismiss the browser's dialog.
		if (!latest) throw passkeyCancelled();
		return latest.user;
	}

	readonly sessions: SessionManagement = {
		listSessions: async () => {
			const state = this.mock.getSession();
			if (state.status !== 'authenticated') return [];
			const createdAt = this.mock._sessionStartedAt();
			return [
				{
					handle: await sessionHandle(state.session.id),
					current: true,
					createdAt,
					updatedAt: createdAt,
					...(state.session.expiresAt ? { expiresAt: state.session.expiresAt } : {}),
				},
			];
		},
		revokeSession: async (target) => {
			const state = this.mock.getSession();
			// The Mock holds one session per page: 'others' has nothing to revoke.
			if (target === 'others' && state.status === 'authenticated') return;
			if (
				target === 'all' ||
				(state.status === 'authenticated' && target === (await sessionHandle(state.session.id)))
			) {
				this.mock._reset();
				return;
			}
			throw this.fail('No session has this handle');
		},
	};

	readonly passkeys: PasskeyManagement = {
		listPasskeys: async () => {
			const user = this.requireUser();
			return this.passkeyRecords.filter((p) => p.user.id === user.id).map((p) => ({ ...p.row }));
		},
		addPasskey: async (options) => {
			const user = this.requireUser();
			this.checkCeremony();
			const row: PasskeyRow = {
				id: this.id('passkey'),
				...(options?.name ? { name: options.name } : {}),
				createdAt: this.now(),
				deviceType: 'multiDevice',
				backedUp: true,
			};
			this.passkeyRecords.push({ row, user });
			return { ...row };
		},
		renamePasskey: async (id, name) => {
			this.ownPasskey(id).row.name = name;
		},
		removePasskey: async (id) => {
			const record = this.ownPasskey(id);
			this.passkeyRecords.splice(this.passkeyRecords.indexOf(record), 1);
		},
	};

	readonly organization: OrganizationAccess = {
		membership: async (organizationId) => {
			const user = this.requireUser();
			const member = this.organizationMembers(organizationId).get(user.id);
			return member ? { role: member.role } : null;
		},
		listMembers: async (organizationId, options = {}) => {
			this.requireMember(organizationId);
			const offset = options.offset ?? 0;
			const all = [...this.organizationMembers(organizationId).values()];
			const page = all.slice(
				offset,
				options.limit === undefined ? undefined : offset + options.limit
			);
			return page.map((member) => this.toMember(member));
		},
		invite: async (organizationId, { email, role }) => {
			this.requireManager(organizationId);
			const invitation: OrganizationInvitation = {
				id: this.id('invitation'),
				organizationId,
				email,
				role,
				status: 'pending',
				expiresAt: new Date(this.clock.now() + INVITATION_LIFETIME_MS),
			};
			this.invitations.set(invitation.id, invitation);
			return { ...invitation };
		},
		listInvitations: async (organizationId) => {
			this.requireMember(organizationId);
			return [...this.invitations.values()]
				.filter((invitation) => invitation.organizationId === organizationId)
				.map((invitation) => ({ ...invitation }));
		},
		cancelInvitation: async (organizationId, invitationId) => {
			this.requireManager(organizationId);
			const invitation = this.invitations.get(invitationId);
			if (invitation?.organizationId !== organizationId) {
				throw this.fail('No invitation of this organization has this id');
			}
			invitation.status = 'canceled';
		},
		removeMember: async (organizationId, memberId) => {
			this.requireManager(organizationId);
			const member = this.memberById(organizationId, memberId);
			this.checkNotLastOwner(
				organizationId,
				member,
				'YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER'
			);
			this.organizationMembers(organizationId).delete(member.user.id);
		},
		setRole: async (organizationId, memberId, role) => {
			this.requireManager(organizationId);
			const member = this.memberById(organizationId, memberId);
			if (role !== 'owner') {
				this.checkNotLastOwner(
					organizationId,
					member,
					'YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER'
				);
			}
			member.role = role;
		},
		leave: async (organizationId) => {
			const member = this.requireMember(organizationId);
			this.checkNotLastOwner(
				organizationId,
				member,
				'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER'
			);
			this.organizationMembers(organizationId).delete(member.user.id);
		},
		listOwnInvitations: async () => {
			const user = this.requireUser();
			return [...this.invitations.values()]
				.filter((invitation) => invitation.email === user.email && invitation.status === 'pending')
				.map((invitation) => ({ ...invitation }));
		},
		acceptInvitation: async (invitationId) => {
			const user = this.requireUser();
			const invitation = this.ownInvitation(invitationId, user);
			invitation.status = 'accepted';
			this.addMember(invitation.organizationId, user, invitation.role);
		},
		rejectInvitation: async (invitationId) => {
			const user = this.requireUser();
			this.ownInvitation(invitationId, user).status = 'rejected';
		},
	};

	private fail(details: string): AuthAdapterError {
		return AuthAdapterError.providerError('mock', details);
	}

	private now(): Date {
		return new Date(this.clock.now());
	}

	private id(kind: string): string {
		this.next += 1;
		return `mock-${kind}-${this.next}`;
	}

	private checkCeremony(): void {
		const ceremony = this.ceremony;
		if (ceremony === 'unsupported') throw passkeyUnsupported();
		if (ceremony === 'cancel') throw passkeyCancelled();
	}

	private requireUser(): User {
		const state = this.mock.getSession();
		if (state.status !== 'authenticated') throw this.fail('Not signed in');
		return state.user;
	}

	private ownPasskey(id: string): StoredPasskey {
		const user = this.requireUser();
		const record = this.passkeyRecords.find((p) => p.row.id === id && p.user.id === user.id);
		if (!record) throw this.fail('Passkey not found');
		return record;
	}

	private organizationMembers(organizationId: string): Map<string, StoredMember> {
		if (typeof organizationId !== 'string' || organizationId.length === 0) {
			throw new TypeError('organizationId must be a non-empty string');
		}
		let members = this.members.get(organizationId);
		if (!members) {
			members = new Map();
			this.members.set(organizationId, members);
		}
		return members;
	}

	private addMember(organizationId: string, user: User, role: string): void {
		const members = this.organizationMembers(organizationId);
		members.set(user.id, { id: this.id('member'), role, createdAt: this.now(), user });
	}

	private requireMember(organizationId: string): StoredMember {
		const user = this.requireUser();
		const member = this.organizationMembers(organizationId).get(user.id);
		if (!member) throw this.fail('YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION');
		return member;
	}

	private requireManager(organizationId: string): void {
		if (!MANAGERS.has(this.requireMember(organizationId).role)) {
			throw this.fail('YOU_ARE_NOT_ALLOWED_TO_MANAGE_THIS_ORGANIZATION');
		}
	}

	private memberById(organizationId: string, memberId: string): StoredMember {
		for (const member of this.organizationMembers(organizationId).values()) {
			if (member.id === memberId) return member;
		}
		throw this.fail('MEMBER_NOT_FOUND');
	}

	private checkNotLastOwner(organizationId: string, member: StoredMember, code: string): void {
		if (member.role !== 'owner') return;
		const owners = [...this.organizationMembers(organizationId).values()].filter(
			(m) => m.role === 'owner'
		);
		if (owners.length === 1) throw this.fail(code);
	}

	private ownInvitation(invitationId: string, user: User): OrganizationInvitation {
		const invitation = this.invitations.get(invitationId);
		if (
			invitation?.email !== user.email ||
			invitation.status !== 'pending' ||
			invitation.expiresAt.getTime() <= this.clock.now()
		) {
			throw this.fail('INVITATION_NOT_FOUND');
		}
		return invitation;
	}

	private toMember(member: StoredMember): OrganizationMember {
		return {
			id: member.id,
			userId: member.user.id,
			role: member.role,
			createdAt: member.createdAt,
			user: { ...member.user },
		};
	}
}
