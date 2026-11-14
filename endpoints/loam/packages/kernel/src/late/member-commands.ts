/**
 * @fileoverview Step 4's commands (phase 3 specification, 3.4, 5.1, 5.3, 5.4 and 7.2), in the `late-identity` chunk:
 * the person's account and invitations, and the workspace's members. Every one's whole effect is at the provider, so
 * each is recorded and a replay answers it from its entry (3.4). The owner commands, `OWNER_COMMANDS`, are decided by
 * `isOwner` on the membership the kernel re-read before them (4.4, 7.6), after line 0, and are human commands too:
 * no agent runs one, and none is served over MCP. Every call to the provider names the bound organization by its id,
 * never the session's active one (2.3). Everything reaches this chunk through the kit or as a type (13).
 */

import type { AuthAdapter, OrganizationInvitation } from '@lushly-dev/afd-auth';
import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import type { LoamKernelErrorCode } from '../errors.js';
import type { AccessActorV1, MemberRoleV1, MembershipV1 } from '../scope/access.js';
import type { AgentMemberV1 } from '../scope/records.js';
import type { DocumentKit } from './document-kit.js';

/** How a person could restore their own access (5.7; D97). */
export type AccountRecoveryV1 = 'oidc' | 'email' | 'none';

/** `account-get`'s answer (5.1). */
export interface AccountV1 {
	id: string;
	email: string;
	name: string;
	image: string | null;
	organizations: { id: string; slug: string; name: string; role: string; bound: boolean }[];
	workspace: { member: boolean; role: MemberRoleV1 | null; owner: boolean };
	/** The active persona's id, or `default` (step 5 adds personas). */
	persona: string;
	methods: string[];
	recovery: AccountRecoveryV1;
	/** When the person last restored their access (5.7), ISO, or null. */
	recoveredAt: string | null;
}

/** A person of the workspace as `member-list` shows them (7.2): the email only to an owner. */
export interface MemberV1 {
	id: string;
	name: string;
	image: string | null;
	role: MemberRoleV1;
	email?: string;
}

/** An agent member as `member-list` shows it: never a seat (7.2, D40). */
export interface AgentMemberRowV1 {
	id: string;
	name: string;
	kind: AgentMemberV1['kind'];
	sponsor: string;
	status: AgentMemberV1['status'];
}

/** An invitation as the invitee sees it (5.3). */
export interface OwnInvitationV1 {
	id: string;
	organization: { slug: string; name: string };
	role: string;
	expiresAt: string;
}

/** A pending invitation as an owner sees it (7.2). */
export interface MemberInvitationV1 {
	id: string;
	email: string;
	role: string;
	expiresAt: string;
}

/**
 * Loam's account capability on its adapter, beside afd-auth's `organization` (4.1): `loamServerPlugin`'s `account`,
 * `members` and `invitations` reads, and Better Auth's `update-user`. The web host's `auth` chunk gives it.
 */
export interface LoamAccountAccessV1 {
	get(): Promise<
		Omit<AccountV1, 'persona' | 'recoveredAt'> & { recoveredAt: string | Date | null }
	>;
	update(changes: { name?: string; image?: string | null }): Promise<void>;
	members(page: { limit?: number; offset?: number }): Promise<{
		people: (MemberV1 & { memberId: string })[];
		total: number;
	}>;
	invitations(): Promise<OwnInvitationV1[]>;
}

/** An adapter with Loam's account capability, as the web host's is in `provider` mode. */
export type LoamAuthAdapter = AuthAdapter & { account?: LoamAccountAccessV1 };

/**
 * Owner commands (3.4's fourth row): an owner's, others `OWNER_REQUIRED`; never an agent's (`HUMAN_REQUIRED`), never
 * served over MCP. Frozen here with the names steps 6 builds, as `HUMAN_COMMANDS` is.
 */
export const OWNER_COMMANDS: readonly string[] = Object.freeze([
	'member-invite',
	'member-invitation-list',
	'member-invitation-cancel',
	'member-remove',
	'member-role-set',
	'agent-member-add',
	'agent-member-update',
	'agent-member-remove',
	'workspace-app-set',
]);

/** Step 4's commands whose whole effect is at the provider (3.4): recorded, answered from their entries in a replay. */
export const MEMBER_PROVIDER_COMMANDS: readonly string[] = Object.freeze([
	'account-get',
	'account-update',
	'account-invitation-list',
	'account-invitation-accept',
	'account-invitation-reject',
	'member-list',
	'member-invite',
	'member-invitation-list',
	'member-invitation-cancel',
	'member-remove',
	'member-role-set',
]);

/**
 * After these, the person's own membership may have changed (5.3, 7.2): the kernel reads it again, and the next call
 * waits for that read, as after a sign-in (4.4).
 */
export const MEMBERSHIP_CHANGING_COMMANDS: readonly string[] = Object.freeze([
	'account-invitation-accept',
	'member-remove',
	'member-role-set',
]);

/** The provider's codes the kernel keeps or maps (15). */
const MAPPED: Readonly<Record<string, LoamKernelErrorCode>> = {
	OWNER_REQUIRED: 'OWNER_REQUIRED',
	MEMBER_LAST_OWNER: 'MEMBER_LAST_OWNER',
	YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER: 'MEMBER_LAST_OWNER',
	INVITATION_NOT_FOUND: 'INVITATION_NOT_FOUND',
	YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: 'INVITATION_NOT_FOUND',
	MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
	USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: 'MEMBER_INVITATION_EXISTS',
	USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: 'MEMBER_INVITATION_EXISTS',
	YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE: 'OWNER_REQUIRED',
	YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION: 'OWNER_REQUIRED',
	YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER: 'OWNER_REQUIRED',
	YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER: 'OWNER_REQUIRED',
	YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION: 'OWNER_REQUIRED',
	EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION:
		'EMAIL_VERIFICATION_REQUIRED',
	WORKSPACE_NOT_MEMBER: 'WORKSPACE_NOT_MEMBER',
};

const SUGGESTIONS: Readonly<Partial<Record<LoamKernelErrorCode, string>>> = {
	OWNER_REQUIRED: 'Ask an owner of the workspace to do this',
	MEMBER_LAST_OWNER: 'Make another member an owner first',
	INVITATION_NOT_FOUND:
		'List the invitations with account-invitation-list or member-invitation-list',
	MEMBER_NOT_FOUND: 'List the members with member-list and name one of them',
	MEMBER_INVITATION_EXISTS:
		'They are a member or invited already: list the invitations with member-invitation-list',
	EMAIL_VERIFICATION_REQUIRED: 'Verify your email address, then accept the invitation again',
	WORKSPACE_NOT_MEMBER:
		'Ask an owner of the workspace to invite you, and list your invitations with account-invitation-list',
};

export interface MemberCommandsDeps {
	auth: LoamAuthAdapter;
	identity?: IdentityV1 | undefined;
	kit: Pick<DocumentKit, 'define' | 'success' | 'z' | 'kernelFailure'> & {
		personKey(actor: AccessActorV1): string | undefined;
		isOwner(membership: MembershipV1, person: string | undefined): boolean;
	};
	membership(): MembershipV1;
	/** The kernel's `agent-member` table (3.3): installed agent members. */
	agents(): readonly AgentMemberV1[];
}

const iso = (value: string | Date | null | undefined): string | null =>
	value === null || value === undefined ? null : new Date(value).toISOString();

export function createMemberCommands(deps: MemberCommandsDeps) {
	const { kit, auth } = deps;
	const { z } = kit;
	const provider = deps.identity?.mode === 'provider';
	const fail = (
		code: LoamKernelErrorCode,
		message: string,
		retryable = false
	): CommandResult<never> =>
		kit.kernelFailure(
			code,
			message,
			SUGGESTIONS[code] ?? 'Try again in a moment; the sign-in provider did not answer',
			{ retryable }
		);
	/** The provider's failure as the kernel answers it: a code of its own where it has one (15). */
	const refusal = (cause: unknown): CommandResult<never> => {
		const { code, message } = (cause ?? {}) as { code?: unknown; message?: unknown };
		const text = typeof message === 'string' ? message : 'The sign-in provider refused the request';
		const mapped = typeof code === 'string' ? MAPPED[code] : undefined;
		return mapped ? fail(mapped, text) : fail('IDENTITY_PROVIDER_UNAVAILABLE', text, true);
	};
	const noProvider = (): CommandResult<never> =>
		kit.kernelFailure(
			'IDENTITY_PROVIDER_UNAVAILABLE',
			'A local workspace has no identity provider: its one person is its owner',
			'Deploy with [identity] mode = "provider" to have members, invitations and an account'
		);
	const account = (): LoamAccountAccessV1 | undefined => (provider ? auth.account : undefined);
	const organization = () => (provider ? auth.organization : undefined);

	/** The person the call is for: a human's id, an agent's `onBehalfOf` (3.1). */
	const personOf = (context: CommandContext) => kit.personKey(context.actor as AccessActorV1);
	/** The bound organization's id, from the account, once: the binding never moves (2.3). */
	let bound: string | undefined;
	const boundId = async (): Promise<string> => {
		if (bound) return bound;
		const read = await (account() as LoamAccountAccessV1).get();
		const found = read.organizations.find((held) => held.bound);
		if (!found)
			throw Object.assign(new Error('You are not a member of this workspace'), {
				code: 'WORKSPACE_NOT_MEMBER',
			});
		bound = found.id;
		return bound;
	};
	/** `OWNER_REQUIRED` unless the call's person is an owner, on the membership read again before it (7.1). */
	const ownerRefusal = (context: CommandContext): CommandResult<never> | undefined =>
		kit.isOwner(deps.membership(), personOf(context))
			? undefined
			: fail('OWNER_REQUIRED', 'Only an owner of the workspace can do this');
	/** Whether the call's person holds the provider's `owner` role, which alone grants or removes it (7.1). */
	const holdsOwnerRole = (context: CommandContext) => {
		const person = personOf(context);
		return person !== undefined && deps.membership().members.get(person) === 'owner';
	};

	const empty = z.strictObject({});
	const EMPTY_JSON: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };
	const id = z.string().check(z.minLength(1), z.maxLength(256));
	const ID_JSON: JsonSchema = { type: 'string', minLength: 1, maxLength: 256 };
	const role = z.enum(['owner', 'admin', 'member']);
	const ROLE_JSON: JsonSchema = { type: 'string', enum: ['owner', 'admin', 'member'] };

	/** The person's account in `local` mode: the one person, an owner of a workspace with no provider. */
	const localAccount = (context: CommandContext): AccountV1 => {
		const state = auth.getSession();
		const user = state.status === 'authenticated' ? state.user : undefined;
		return {
			id: personOf(context) ?? 'local',
			email: user?.email ?? '',
			name: user?.name ?? user?.email ?? 'You',
			image: null,
			organizations: [],
			workspace: { member: true, role: 'owner', owner: true },
			persona: 'default',
			methods: [],
			recovery: 'none',
			recoveredAt: null,
		};
	};
	const readAccount = async (context: CommandContext): Promise<AccountV1> => {
		const held = account();
		if (!held) return localAccount(context);
		const read = await held.get();
		return { ...read, persona: 'default', recoveredAt: iso(read.recoveredAt) };
	};

	const accountGet = kit.define<typeof empty, AccountV1>({
		name: 'account-get',
		description:
			'Get your account: name, email, organizations, membership of this workspace, ways to sign in and to recover',
		category: 'account',
		mutation: false,
		executionTime: 'fast',
		input: empty,
		jsonSchema: EMPTY_JSON,
		async handler(_input, context) {
			try {
				return kit.success(await readAccount(context));
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	const updateInput = z.strictObject({
		name: z.optional(z.string().check(z.minLength(1), z.maxLength(80))),
		image: z.optional(z.nullable(z.string().check(z.maxLength(2048)))),
	});
	const accountUpdate = kit.define<typeof updateInput, AccountV1>({
		name: 'account-update',
		title: 'Change your profile',
		description: 'Change your name or image, as other members see them',
		category: 'account',
		mutation: true,
		undoable: true,
		executionTime: 'fast',
		input: updateInput,
		jsonSchema: {
			type: 'object',
			properties: {
				name: { type: 'string', minLength: 1, maxLength: 80 },
				image: { anyOf: [{ type: 'string', maxLength: 2048 }, { type: 'null' }] } as JsonSchema,
			},
			additionalProperties: false,
		},
		async handler(input, context) {
			const held = account();
			if (!held) return noProvider();
			try {
				const before = await readAccount(context);
				await held.update(input);
				const after = await readAccount(context);
				const undoArgs: Record<string, unknown> = {};
				if (input.name !== undefined) undoArgs.name = before.name;
				if (input.image !== undefined) undoArgs.image = before.image;
				return kit.success(after, { undoCommand: 'account-update', undoArgs });
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	const invitationList = kit.define<typeof empty, { invitations: OwnInvitationV1[] }>({
		name: 'account-invitation-list',
		description: 'List the invitations made to your verified email',
		category: 'account',
		mutation: false,
		executionTime: 'fast',
		input: empty,
		jsonSchema: EMPTY_JSON,
		async handler() {
			const held = account();
			if (!held) return kit.success({ invitations: [] });
			try {
				return kit.success({ invitations: await held.invitations() });
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	const invitationInput = z.strictObject({ invitation: id });
	const INVITATION_JSON: JsonSchema = {
		type: 'object',
		properties: { invitation: ID_JSON },
		required: ['invitation'],
		additionalProperties: false,
	};
	/** One of the person's own pending invitations, or `INVITATION_NOT_FOUND`, the same for any other id. */
	const ownInvitation = async (invitation: string) => {
		const found = (await (account() as LoamAccountAccessV1).invitations()).find(
			(held) => held.id === invitation
		);
		return found ?? fail('INVITATION_NOT_FOUND', 'You have no pending invitation with this id');
	};

	const invitationAccept = kit.define<
		typeof invitationInput,
		{ organization: { slug: string; name: string }; role: string }
	>({
		name: 'account-invitation-accept',
		title: 'Accept an invitation',
		description:
			'Accept an invitation made to your verified email, and become a member of its workspace',
		category: 'account',
		mutation: true,
		executionTime: 'fast',
		input: invitationInput,
		jsonSchema: INVITATION_JSON,
		async handler(input) {
			const organizations = organization();
			if (!account() || !organizations) return noProvider();
			try {
				const found = await ownInvitation(input.invitation);
				if ('success' in found) return found;
				await organizations.acceptInvitation(input.invitation);
				return kit.success({ organization: found.organization, role: found.role });
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	const invitationReject = kit.define<typeof invitationInput, { rejected: true }>({
		name: 'account-invitation-reject',
		title: 'Decline an invitation',
		description: 'Decline an invitation made to your verified email',
		category: 'account',
		mutation: true,
		destructive: true,
		executionTime: 'fast',
		input: invitationInput,
		jsonSchema: INVITATION_JSON,
		async handler(input) {
			const organizations = organization();
			if (!account() || !organizations) return noProvider();
			try {
				const found = await ownInvitation(input.invitation);
				if ('success' in found) return found;
				await organizations.rejectInvitation(input.invitation);
				return kit.success({ rejected: true as const });
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	const listInput = z.strictObject({
		limit: z.optional(z.int().check(z.minimum(1), z.maximum(200))),
		offset: z.optional(z.int().check(z.minimum(0))),
	});
	const memberList = kit.define<
		typeof listInput,
		{ people: MemberV1[]; agents: AgentMemberRowV1[]; total: number }
	>({
		name: 'member-list',
		description:
			"List the workspace's people, and its agent members apart: no agent is a seat. Emails only to an owner",
		category: 'member',
		mutation: false,
		executionTime: 'fast',
		input: listInput,
		jsonSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', minimum: 1, maximum: 200 },
				offset: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
			},
			additionalProperties: false,
		},
		async handler(input, context) {
			const agents = deps.agents().map(
				(agent): AgentMemberRowV1 => ({
					id: agent.id,
					name: agent.name,
					kind: agent.kind,
					sponsor: agent.sponsor,
					status: agent.status,
				})
			);
			const held = account();
			if (!held) {
				const me = localAccount(context);
				return kit.success({
					people: [
						{ id: me.id, name: me.name, image: null, role: 'owner' as const, email: me.email },
					],
					agents,
					total: 1,
				});
			}
			try {
				const read = await held.members(input);
				// The provider shows emails to an owner only; the kernel holds to it on the membership it decided with.
				const owner = kit.isOwner(deps.membership(), personOf(context));
				return kit.success({
					people: read.people.map(({ memberId: _memberId, email, ...person }) => ({
						...person,
						...(owner && email !== undefined ? { email } : {}),
					})),
					agents,
					total: read.total,
				});
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	/** An owner command's preamble: a provider, then `OWNER_REQUIRED` (7.1). */
	const ownerPreamble = (
		context: CommandContext
	):
		| CommandResult<never>
		| { organizations: NonNullable<AuthAdapter['organization']>; held: LoamAccountAccessV1 } => {
		const organizations = organization();
		const held = account();
		if (!organizations || !held) return noProvider();
		return ownerRefusal(context) ?? { organizations, held };
	};

	const inviteInput = z.strictObject({
		email: z.string().check(z.minLength(3), z.maxLength(320)),
		role,
	});
	const memberInvite = kit.define<typeof inviteInput, { invitation: string; expiresAt: string }>({
		name: 'member-invite',
		title: 'Invite a person',
		description:
			'Invite a person by email to the workspace; only an owner-role member invites an owner. A person removed and invited again regains the restricted projects that still name them',
		category: 'member',
		mutation: true,
		executionTime: 'fast',
		input: inviteInput,
		jsonSchema: {
			type: 'object',
			properties: { email: { type: 'string', minLength: 3, maxLength: 320 }, role: ROLE_JSON },
			required: ['email', 'role'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const ready = ownerPreamble(context);
			if ('success' in ready) return ready;
			if (input.role === 'owner' && !holdsOwnerRole(context)) {
				return fail('OWNER_REQUIRED', 'Only a member with the owner role can invite an owner');
			}
			try {
				const made: OrganizationInvitation = await ready.organizations.invite(await boundId(), {
					email: input.email.trim().toLowerCase(),
					role: input.role,
				});
				return kit.success(
					{ invitation: made.id, expiresAt: new Date(made.expiresAt).toISOString() },
					{ undoCommand: 'member-invitation-cancel', undoArgs: { invitation: made.id } }
				);
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	const pendingList = kit.define<typeof empty, { invitations: MemberInvitationV1[] }>({
		name: 'member-invitation-list',
		description: "List the workspace's pending invitations",
		category: 'member',
		mutation: false,
		executionTime: 'fast',
		input: empty,
		jsonSchema: EMPTY_JSON,
		async handler(_input, context) {
			const ready = ownerPreamble(context);
			if ('success' in ready) return ready;
			try {
				const rows = await ready.organizations.listInvitations(await boundId());
				return kit.success({
					invitations: rows
						.filter((row) => row.status === 'pending')
						.map((row) => ({
							id: row.id,
							email: row.email,
							role: row.role,
							expiresAt: new Date(row.expiresAt).toISOString(),
						})),
				});
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	const invitationCancel = kit.define<typeof invitationInput, { cancelled: true }>({
		name: 'member-invitation-cancel',
		title: 'Cancel an invitation',
		description: 'Cancel a pending invitation: its join link stops working',
		category: 'member',
		mutation: true,
		destructive: true,
		executionTime: 'fast',
		input: invitationInput,
		jsonSchema: INVITATION_JSON,
		async handler(input, context) {
			const ready = ownerPreamble(context);
			if ('success' in ready) return ready;
			try {
				const organizationId = await boundId();
				const rows = await ready.organizations.listInvitations(organizationId);
				if (!rows.some((row) => row.id === input.invitation && row.status === 'pending')) {
					return fail(
						'INVITATION_NOT_FOUND',
						'The workspace has no pending invitation with this id'
					);
				}
				await ready.organizations.cancelInvitation(organizationId, input.invitation);
				return kit.success({ cancelled: true as const });
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	const memberInput = z.strictObject({ member: id });
	/** A person of the workspace by their id, with their member row's id, or `MEMBER_NOT_FOUND`. */
	const memberNamed = async (held: LoamAccountAccessV1, person: string) => {
		const people: (MemberV1 & { memberId: string })[] = [];
		for (let offset = 0; ; offset += 200) {
			const page = await held.members({ limit: 200, offset });
			people.push(...page.people);
			if (page.people.length < 200 || people.length >= page.total) break;
		}
		return (
			people.find((row) => row.id === person) ??
			fail('MEMBER_NOT_FOUND', 'The workspace has no member with this id')
		);
	};

	const memberRemove = kit.define<typeof memberInput, { removed: true; suspended: string[] }>({
		name: 'member-remove',
		title: 'Remove a member',
		description:
			'Remove a person from the workspace: their sessions end at once. No undo: invite them again',
		category: 'member',
		mutation: true,
		destructive: true,
		executionTime: 'fast',
		input: memberInput,
		jsonSchema: {
			type: 'object',
			properties: { member: ID_JSON },
			required: ['member'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const ready = ownerPreamble(context);
			if ('success' in ready) return ready;
			try {
				const target = await memberNamed(ready.held, input.member);
				if ('success' in target) return target;
				// Only an owner-role member removes an owner (7.1): an admin's is OWNER_REQUIRED, before the provider.
				if (target.role === 'owner' && !holdsOwnerRole(context)) {
					return fail('OWNER_REQUIRED', 'Only a member with the owner role can remove an owner');
				}
				await ready.organizations.removeMember(await boundId(), target.memberId);
				// The agent members the person sponsors are suspended with step 6, which builds them.
				return kit.success({ removed: true as const, suspended: [] });
			} catch (cause) {
				const code = (cause as { code?: unknown } | null)?.code;
				// Better Auth's "only owner" refusal: an admin removing an owner is OWNER_REQUIRED, else the last owner (7.1).
				if (code === 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER') {
					return holdsOwnerRole(context)
						? fail('MEMBER_LAST_OWNER', 'The workspace keeps at least one owner')
						: fail('OWNER_REQUIRED', 'Only a member with the owner role can remove an owner');
				}
				return refusal(cause);
			}
		},
	});

	const roleInput = z.strictObject({ member: id, role });
	const memberRoleSet = kit.define<
		typeof roleInput,
		{ role: MemberRoleV1; previous: MemberRoleV1 }
	>({
		name: 'member-role-set',
		title: "Change a member's role",
		description:
			"Change a member's role to owner, admin or member; only an owner-role member grants or removes owner",
		category: 'member',
		mutation: true,
		undoable: true,
		executionTime: 'fast',
		input: roleInput,
		jsonSchema: {
			type: 'object',
			properties: { member: ID_JSON, role: ROLE_JSON },
			required: ['member', 'role'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const ready = ownerPreamble(context);
			if ('success' in ready) return ready;
			try {
				const target = await memberNamed(ready.held, input.member);
				if ('success' in target) return target;
				if ((input.role === 'owner' || target.role === 'owner') && !holdsOwnerRole(context)) {
					return fail(
						'OWNER_REQUIRED',
						'Only a member with the owner role can grant or remove owner'
					);
				}
				await ready.organizations.setRole(await boundId(), target.memberId, input.role);
				return kit.success(
					{ role: input.role, previous: target.role },
					{ undoCommand: 'member-role-set', undoArgs: { member: input.member, role: target.role } }
				);
			} catch (cause) {
				const code = (cause as { code?: unknown } | null)?.code;
				if (code === 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER') {
					return fail('MEMBER_LAST_OWNER', 'The workspace keeps at least one owner');
				}
				return refusal(cause);
			}
		},
	});

	return {
		commands: [
			accountGet,
			accountUpdate,
			invitationList,
			invitationAccept,
			invitationReject,
			memberList,
			memberInvite,
			pendingList,
			invitationCancel,
			memberRemove,
			memberRoleSet,
		] as unknown as ZodCommandDefinition[],
	};
}
