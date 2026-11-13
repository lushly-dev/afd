/**
 * @fileoverview The organization plugin's hooks (phase 3 specification, 2.3, 7.1 and 7.5): Loam's rules
 * about the organization, written into the provider, since a person can call its endpoints directly.
 */

import { readBinding } from './binding.js';
import { adapterOf, type LoamProviderState, memberOf, ownerRequired, refusal } from './plugin.js';
import { rolesOf } from './roles.js';

export interface MemberLike {
	organizationId: string;
	role: string;
}

/** The hooks `createLoamAuthOptions` gives the organization plugin, over the plugin's shared state. */
export function createOrganizationHooks(state: LoamProviderState) {
	/** The bound organization, by its pinned id; before the binding exists, the one its slug names. */
	const isBound = async (organizationId: string, slug?: string): Promise<boolean> => {
		const binding = await readBinding(adapterOf(state), state.workspace);
		return binding ? binding.organizationId === organizationId : slug === state.organization;
	};
	const ownersOf = async (organizationId: string): Promise<number> =>
		(
			await adapterOf(state).findMany<{ role: string }>({
				model: 'member',
				where: [{ field: 'organizationId', value: organizationId }],
			})
		).filter((member) => rolesOf(member.role).includes('owner')).length;
	const lastOwner = () =>
		refusal(
			'BAD_REQUEST',
			'MEMBER_LAST_OWNER',
			'The organization keeps at least one owner. Make another member an owner first'
		);
	const organizationFixed = () =>
		refusal(
			'FORBIDDEN',
			'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION',
			"The workspace's organization is fixed: a deployer rebinds it on the server, never a person"
		);
	const isLastOwner = async (member: MemberLike) =>
		rolesOf(member.role).includes('owner') && (await ownersOf(member.organizationId)) <= 1;

	return {
		/**
		 * The bound organization cannot be renamed or re-slugged (2.3); no role holds the right either. The
		 * hook is given the new fields, so the organization's current slug is read, as the delete hook has it,
		 * for the time before a binding exists.
		 */
		async beforeUpdateOrganization({ member }: { member: MemberLike }) {
			const current = await adapterOf(state).findOne<{ slug: string }>({
				model: 'organization',
				where: [{ field: 'id', value: member.organizationId }],
			});
			if (await isBound(member.organizationId, current?.slug)) throw organizationFixed();
		},
		/** Nor deleted: `disableOrganizationDeletion` and access control refuse it first. */
		async beforeDeleteOrganization({
			organization,
		}: {
			organization: { id: string; slug: string };
		}) {
			if (await isBound(organization.id, organization.slug)) throw organizationFixed();
		},
		/**
		 * Membership only through an accepted invitation (7.5), which adds its member without this hook:
		 * every other add, by `addMember` or by creating an organization, is refused. Step 4's
		 * `bootstrapOrganization` makes the first organization without a member, then invites its owner.
		 */
		async beforeAddMember(): Promise<void> {
			throw refusal(
				'FORBIDDEN',
				'MEMBER_INVITATION_REQUIRED',
				'People join the organization by invitation. Invite them with member-invite'
			);
		},
		/** The last owner (7.1): Better Auth refuses some of these cases itself; this refuses every one. */
		async beforeRemoveMember({ member }: { member: MemberLike }) {
			if (await isLastOwner(member)) throw lastOwner();
		},
		async beforeUpdateMemberRole({ member, newRole }: { member: MemberLike; newRole: string }) {
			if (!rolesOf(newRole).includes('owner') && (await isLastOwner(member))) throw lastOwner();
		},
		/** Only an `owner` invites an `owner` (D96, 7.5); the role endpoints are checked in the plugin. */
		async beforeCreateInvitation({
			invitation,
			inviter,
		}: {
			invitation: { organizationId: string; role: string };
			inviter: { id: string };
		}) {
			if (!rolesOf(invitation.role).includes('owner')) return;
			const held = await memberOf(adapterOf(state), invitation.organizationId, inviter.id);
			if (!rolesOf(held?.role).includes('owner')) throw ownerRequired();
		},
		/**
		 * A removed person's sessions go at once (7.5), so no tab of theirs keeps a session the provider
		 * would still accept. `revoke-person` (step 3) adds their OAuth consents and refresh tokens, which
		 * exist from step 7.
		 */
		async afterRemoveMember({
			user,
			organization,
		}: {
			user: { id: string };
			organization: { id: string; slug: string };
		}) {
			if (await isBound(organization.id, organization.slug))
				await state.context?.internalAdapter.deleteUserSessions(user.id);
		},
	};
}
