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
import type { DocumentKit } from '../scope/command-kit.js';
import type { AgentMemberV1 } from '../scope/records.js';
import {
	AGENT_PROJECTS_MAX as AGENT_ACCESS_PROJECTS_MAX,
	type AgentMemberRowV1,
} from './agent-members.js';
import type { PersonaPresentationV1 } from './persona.js';

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
	/** Their active persona's presentation (6.1): name, pronouns, avatar; absent for `default`. */
	presentation?: PersonaPresentationV1;
}

/** An agent member as `member-list` and `agent-member-list` show it, filtered for the caller: never a seat (7.2, 8.2). */
export type { AgentMemberRowV1 } from './agent-members.js';

/** A connected agent as its person sees it (5.3): never a token, a secret or another person's agent. */
export interface OwnConnectedAgentV1 {
	agent: string;
	name: string;
	/** The metadata document's host, or empty for a client the deployer registered (9.4). */
	clientHost: string;
	scopes: string[];
	connectedAt: string;
	/** Where it may act (9.2): `{ workspace: true, projects: 'sponsor' }` unless its person narrowed it. */
	access: AgentMemberV1['access'];
	status: 'active' | 'suspended';
	suspended?: AgentMemberV1['suspended'];
}

/** `account-agent-update`'s answer: the access written, and the one before it, which its undo restores. */
export interface OwnAgentAccessV1 {
	agent: string;
	access: AgentMemberV1['access'];
	previous: AgentMemberV1['access'];
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
		/** `digest` is the provider's digest of each one's membership, which `membership-settle` journals (4.4). */
		people: (MemberV1 & { memberId: string; digest?: string })[];
		total: number;
	}>;
	invitations(): Promise<OwnInvitationV1[]>;
	/**
	 * The workspace's connected agents, every person's (9.2), from `loamServerPlugin`'s `connected-agents` endpoint: the
	 * provider's table is theirs alone. Absent: a provider with none (step 7 adds them).
	 */
	agents?(): Promise<ConnectedAgentV1[]>;
	/** The person's own connected agent disconnected (5.3): its record, consent and refresh tokens gone. */
	disconnectAgent?(agent: string): Promise<void>;
	/**
	 * The person's own connected agent's access written (9.2, #2784), only while it is still `previous`, the access the
	 * kernel read (`AGENT_ACCESS_CHANGED` otherwise): no token is revoked, and its next request reads the new record
	 * (9.5). The kernel has checked each project, so the provider checks the shape, the sponsor and the record alone.
	 */
	updateAgent?(
		agent: string,
		access: AgentMemberV1['access'],
		previous: AgentMemberV1['access']
	): Promise<void>;
	/** An owner's removal of a connected agent (9.2): kept `suspended: 'owner'`, or deleted with `forget`. */
	removeAgent?(agent: string, forget: boolean): Promise<void>;
}

/**
 * A connected agent as the provider answers it (9.2): `AgentMemberV1` with `kind: 'connected'`, and its scopes. Another
 * person's names none of its projects, only how many it withholds (#2784).
 */
export type ConnectedAgentV1 = AgentMemberV1 & {
	kind: 'connected';
	scopes: string[];
	withheldProjects?: number;
};

/**
 * An adapter with Loam's account capability, as the web host's is in `provider` mode; or, on the server, with
 * `accountFor`, the provider's server API for one person, since a token's call has no session (9.2).
 */
export type LoamAuthAdapter = AuthAdapter & {
	account?: LoamAccountAccessV1;
	accountFor?(person: string): LoamAccountAccessV1;
};

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
	'account-agent-list',
	'account-agent-disconnect',
	'account-agent-update',
	'member-list',
	'member-invite',
	'member-invitation-list',
	'member-invitation-cancel',
	'member-remove',
	'member-role-set',
	'member-leave',
]);

/**
 * After these, the person's own membership may have changed (5.3, 7.2): the kernel reads it again, and the next call
 * waits for that read, as after a sign-in (4.4).
 */
export const MEMBERSHIP_CHANGING_COMMANDS: readonly string[] = Object.freeze([
	'account-invitation-accept',
	'member-remove',
	'member-role-set',
	'member-leave',
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
	kit: Pick<DocumentKit, 'define' | 'success' | 'z' | 'kernelFailure' | 'projectNotFound'> & {
		personKey(actor: AccessActorV1): string | undefined;
		isOwner(membership: MembershipV1, person: string | undefined): boolean;
	};
	/** The membership a decision for the call reads: on the server, its principal's alone (9.5). */
	membership(context: CommandContext): MembershipV1;
	/**
	 * A project's id, by its id or slug, when the call's person may enter it (3.3, steps 1 to 3 for a person); else
	 * undefined, alike for one that does not exist and one they may not enter. Absent: none resolves.
	 */
	enterable?(ref: string, context: CommandContext): string | undefined;
	/** A principal-gated kernel's (9.5): the account is read only by the call's person, through `accountFor`. */
	gated?: boolean;
	/**
	 * Step 6's agent members (8): `member-list`'s agents, the rows `agent-member-list` answers, and the ones a removed
	 * person sponsors, suspended by the `agent-member-settle` after `member-remove` (7.2, 8.3). Absent: none.
	 */
	agents?: {
		rowsFor(context: CommandContext): Promise<AgentMemberRowV1[]>;
		removed(person: string): string[];
	};
	/**
	 * Step 5's personas (6.1): what other members see of a person, their active persona's presentation, and the active
	 * persona's id, which `account-get` reports. Absent: every person shows `default`.
	 */
	personas?: {
		presentationOf(person: string): Promise<PersonaPresentationV1>;
		activeOf(person: string): Promise<string>;
	};
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
	/**
	 * A provider's answer the kernel does not map (the review of step 4's N1): a definite refusal, a 4xx, is not
	 * retryable; an outage (a 5xx, or no answer at all), a timeout (408) or a rate limit (429) is.
	 */
	const providerFailure = (cause: unknown, text: string): CommandResult<never> => {
		const { status, retryAfter } = (cause ?? {}) as { status?: unknown; retryAfter?: unknown };
		// A timeout (408) or a rate limit (429) is worth trying again, after `X-Retry-After` where it says (IMPROVEMENT 2).
		if (status === 408 || status === 429) {
			return kit.kernelFailure(
				'IDENTITY_PROVIDER_UNAVAILABLE',
				text,
				typeof retryAfter === 'number' && Number.isFinite(retryAfter)
					? `The sign-in provider asked for a pause; try again in ${retryAfter} seconds`
					: 'The sign-in provider asked for a pause; try again in a moment',
				{
					retryable: true,
					...(typeof retryAfter === 'number' && Number.isFinite(retryAfter)
						? { details: { retryAfter } }
						: {}),
				}
			);
		}
		const refused = typeof status === 'number' && status >= 400 && status < 500;
		return refused
			? kit.kernelFailure(
					'IDENTITY_PROVIDER_UNAVAILABLE',
					text,
					'The sign-in provider refused this request; read its message, then change the request',
					{ retryable: false }
				)
			: fail('IDENTITY_PROVIDER_UNAVAILABLE', text, true);
	};
	const refusal = (cause: unknown): CommandResult<never> => {
		const { code, message } = (cause ?? {}) as { code?: unknown; message?: unknown };
		const text = typeof message === 'string' ? message : 'The sign-in provider refused the request';
		const mapped = typeof code === 'string' ? MAPPED[code] : undefined;
		return mapped ? fail(mapped, text) : providerFailure(cause, text);
	};
	const noProvider = (): CommandResult<never> =>
		kit.kernelFailure(
			'IDENTITY_PROVIDER_UNAVAILABLE',
			'A local workspace has no identity provider: its one person is its owner',
			'Deploy with [identity] mode = "provider" to have members, invitations and an account'
		);
	/**
	 * The account capability for the call's person: a browser's adapter's, by its session; on the server, the provider's
	 * server API by the token's person, never a session (9.2: "served for the token's person with no session").
	 */
	const account = (context: CommandContext): LoamAccountAccessV1 | undefined => {
		if (!provider) return undefined;
		// The server reads only by the call's person, never a session-bound capability (9.2, 9.5).
		if (!auth.accountFor) return deps.gated ? undefined : auth.account;
		const person = personOf(context);
		return person === undefined ? undefined : auth.accountFor(person);
	};
	const organization = () => (provider ? auth.organization : undefined);

	/** The person the call is for: a human's id, an agent's `onBehalfOf` (3.1). */
	const personOf = (context: CommandContext) => kit.personKey(context.actor as AccessActorV1);
	/** The bound organization's id, from the account, once: the binding never moves (2.3). */
	let bound: string | undefined;
	const boundId = async (context: CommandContext): Promise<string> => {
		if (bound) return bound;
		const read = await (account(context) as LoamAccountAccessV1).get();
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
		kit.isOwner(deps.membership(context), personOf(context))
			? undefined
			: fail('OWNER_REQUIRED', 'Only an owner of the workspace can do this');
	/** Whether the call's person holds the provider's `owner` role, which alone grants or removes it (7.1). */
	const holdsOwnerRole = (context: CommandContext) => {
		const person = personOf(context);
		return person !== undefined && deps.membership(context).members.get(person) === 'owner';
	};

	const empty = z.strictObject({});
	const EMPTY_JSON: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };
	const id = z.string().check(z.minLength(1), z.maxLength(256));
	const ID_JSON: JsonSchema = { type: 'string', minLength: 1, maxLength: 256 };
	const role = z.enum(['owner', 'admin', 'member']);
	const ROLE_JSON: JsonSchema = { type: 'string', enum: ['owner', 'admin', 'member'] };

	/**
	 * A `provider` deployment with no account capability for this call, as a server kernel given none: never `local`'s
	 * answer, which would read the adapter's person (9.5). Thrown, so the caller's refusal answers it as an outage.
	 */
	const unreachable = () =>
		Object.assign(new Error('This kernel cannot read the sign-in provider for this person'), {
			code: 'IDENTITY_PROVIDER_UNAVAILABLE',
		});
	/** The person's account in `local` mode: the one person, an owner of a workspace with no provider. */
	const localAccount = (context: CommandContext): AccountV1 => {
		if (provider) throw unreachable();
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
	/** The active persona's id (6.1), `default` without one. */
	const personaOf = (person: string | undefined) =>
		person && deps.personas ? deps.personas.activeOf(person) : Promise.resolve('default');
	/** What other members see of `person`'s persona: present only when it holds something (6.1). */
	const presented = async (person: string) => {
		const shown = (await deps.personas?.presentationOf(person)) ?? {};
		return Object.keys(shown).length > 0 ? { presentation: shown } : {};
	};
	const readAccount = async (context: CommandContext): Promise<AccountV1> => {
		const held = account(context);
		if (!held) {
			const local = localAccount(context);
			return { ...local, persona: await personaOf(local.id) };
		}
		const read = await held.get();
		return { ...read, persona: await personaOf(read.id), recoveredAt: iso(read.recoveredAt) };
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
			const held = account(context);
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
		async handler(_input, context) {
			const held = account(context);
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
	const ownInvitation = async (invitation: string, context: CommandContext) => {
		const found = (await (account(context) as LoamAccountAccessV1).invitations()).find(
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
		async handler(input, context) {
			const organizations = organization();
			if (!account(context) || !organizations) return noProvider();
			try {
				const found = await ownInvitation(input.invitation, context);
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
		async handler(input, context) {
			const organizations = organization();
			if (!account(context) || !organizations) return noProvider();
			try {
				const found = await ownInvitation(input.invitation, context);
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
			const held = account(context);
			if (!held) {
				// In `provider` mode with no capability for this person: refused, never the adapter's person (9.5).
				if (provider) return refusal(unreachable());
				const me = localAccount(context);
				return kit.success({
					people: [
						{
							id: me.id,
							name: me.name,
							image: null,
							role: 'owner' as const,
							email: me.email,
							...(await presented(me.id)),
						},
					],
					agents: (await deps.agents?.rowsFor(context)) ?? [],
					total: 1,
				});
			}
			try {
				const read = await held.members(input);
				// The provider shows emails to an owner only; the kernel holds to it on the membership it decided with.
				const owner = kit.isOwner(deps.membership(context), personOf(context));
				return kit.success({
					people: await Promise.all(
						read.people.map(async ({ memberId: _memberId, digest: _digest, email, ...person }) => ({
							...person,
							...(owner && email !== undefined ? { email } : {}),
							...(await presented(person.id)),
						}))
					),
					agents: (await deps.agents?.rowsFor(context)) ?? [],
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
		const held = account(context);
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
				const made: OrganizationInvitation = await ready.organizations.invite(
					await boundId(context),
					{
						email: input.email.trim().toLowerCase(),
						role: input.role,
					}
				);
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
				const rows = await ready.organizations.listInvitations(await boundId(context));
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
				const organizationId = await boundId(context);
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
		// Every page while the offset is short of the total: the provider skips a member row with no user, so a short page
		// is not the last (step 6's review, I6).
		for (let offset = 0, total = 1; offset < total; offset += 200) {
			const page = await held.members({ limit: 200, offset });
			people.push(...page.people);
			total = page.total;
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
			'Remove a person from the workspace: their sessions end at once, and the agent members they sponsor are suspended. No undo: invite them again',
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
				await ready.organizations.removeMember(await boundId(context), target.memberId);
				// The agent members the person sponsors, suspended by the top-level `agent-member-settle` after this call (8.3).
				return kit.success({
					removed: true as const,
					suspended: deps.agents?.removed(target.id) ?? [],
				});
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

	/**
	 * `member-leave` (phase 3's 7.2, phase 6's S4): the person leaves the workspace through Loam's own `leave` endpoint,
	 * which takes the removal path (the last-owner rule, then their sessions and the server's `agent-member-settle`), so
	 * their membership is read again, and settled, after it. Human, recorded: its whole effect is at the provider.
	 */
	const memberLeave = kit.define<typeof empty, { left: true }>({
		name: 'member-leave',
		title: 'Leave the workspace',
		description:
			'Leave this workspace: your sessions here end, and the agent members you sponsor are suspended. An owner invites you again',
		category: 'member',
		mutation: true,
		destructive: true,
		executionTime: 'fast',
		input: empty,
		jsonSchema: EMPTY_JSON,
		async handler(_input, context) {
			const organizations = organization();
			if (!account(context) || !organizations) return noProvider();
			try {
				await organizations.leave(await boundId(context));
				return kit.success({ left: true as const });
			} catch (cause) {
				const code = (cause as { code?: unknown } | null)?.code;
				if (code === 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER')
					return fail('MEMBER_LAST_OWNER', 'The workspace keeps at least one owner');
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
				await ready.organizations.setRole(await boundId(context), target.memberId, input.role);
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

	/** A connected agent as its person sees it in the agents tab (5.3). */
	const agentRow = (agent: ConnectedAgentV1): OwnConnectedAgentV1 => ({
		agent: agent.id,
		name: agent.name,
		clientHost: agent.client?.host ?? '',
		scopes: agent.scopes,
		connectedAt: new Date(agent.createdAt).toISOString(),
		access: agent.access,
		status: agent.status === 'active' ? 'active' : 'suspended',
		...(agent.suspended ? { suspended: agent.suspended } : {}),
	});
	/** The call's person's own connected agents, from the provider's table (9.2). */
	const ownAgents = async (context: CommandContext): Promise<ConnectedAgentV1[]> => {
		const read = account(context)?.agents;
		const person = personOf(context);
		if (!read || person === undefined) return [];
		return (await read()).filter((agent) => agent.sponsor === person);
	};
	/** Any id but one of the person's own: one answer for every other, naming nothing of anyone else's (5.3). */
	const noOwnAgent = () =>
		kit.kernelFailure(
			'AGENT_MEMBER_NOT_FOUND',
			'You have no connected agent with this id',
			'List yours with account-agent-list'
		);
	/** An owner's removal stands until an owner lifts it (9.2): its sponsor neither clears nor changes it. */
	const removedByOwner = () =>
		kit.kernelFailure(
			'AGENT_DISCONNECTED_BY_OWNER',
			'An owner removed this agent; it stays removed until an owner allows it again',
			'Ask an owner of the workspace to allow it again'
		);

	const agentList = kit.define<typeof empty, { agents: OwnConnectedAgentV1[] }>({
		name: 'account-agent-list',
		description:
			'List the external agents you connected over MCP: each acts for you, within your access, until you disconnect it',
		category: 'account',
		mutation: false,
		executionTime: 'fast',
		input: empty,
		jsonSchema: EMPTY_JSON,
		async handler(_input, context) {
			if (!account(context)) return kit.success({ agents: [] });
			try {
				return kit.success({ agents: (await ownAgents(context)).map(agentRow) });
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	const agentDisconnectInput = z.strictObject({ agent: id });
	const agentDisconnect = kit.define<typeof agentDisconnectInput, { disconnected: true }>({
		name: 'account-agent-disconnect',
		title: 'Disconnect an agent',
		description:
			'Disconnect an external agent you connected: its consent and refresh tokens end now, and its last access token within 10 minutes',
		category: 'account',
		mutation: true,
		destructive: true,
		executionTime: 'fast',
		input: agentDisconnectInput,
		jsonSchema: {
			type: 'object',
			properties: { agent: ID_JSON },
			required: ['agent'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const held = account(context);
			if (!held?.disconnectAgent) return noProvider();
			try {
				// Only the person's own: any other id answers as a missing one, naming nothing of anyone else's (5.3).
				const own = (await ownAgents(context)).find((agent) => agent.id === input.agent);
				if (!own) return noOwnAgent();
				// An owner's removal stands until an owner lifts it (9.2): its sponsor cannot clear it by disconnecting.
				if (own.status === 'suspended' && own.suspended === 'owner') return removedByOwner();
				await held.disconnectAgent(input.agent);
				return kit.success({ disconnected: true as const });
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	const PROJECT_REF_JSON: JsonSchema = { type: 'string', minLength: 1, maxLength: 256 };
	const accessInput = () =>
		z.strictObject({
			workspace: z.boolean(),
			projects: z.union([
				z
					.array(z.string().check(z.minLength(1), z.maxLength(256)))
					.check(z.maxLength(AGENT_ACCESS_PROJECTS_MAX)),
				z.enum(['sponsor']),
			]),
		});
	const ACCESS_JSON = {
		type: 'object',
		properties: {
			workspace: { type: 'boolean' },
			projects: {
				anyOf: [
					{ type: 'array', items: PROJECT_REF_JSON, maxItems: AGENT_ACCESS_PROJECTS_MAX },
					{ type: 'string', enum: ['sponsor'] },
				],
			},
		},
		required: ['workspace', 'projects'],
		additionalProperties: false,
	};
	const agentUpdateInput = z.strictObject({
		agent: id,
		access: accessInput(),
		// The access the caller last saw, by project id: a record changed since is refused, so an undo, which carries the
		// access its change wrote, never restores more than what it replaced (#2784's re-check).
		expected: z.optional(accessInput()),
	});
	/** Two accesses alike: the same flag and the same projects, in any order. */
	const sameAccess = (a: AgentMemberV1['access'], b: AgentMemberV1['access']): boolean => {
		if (a.workspace !== b.workspace) return false;
		if (a.projects === 'sponsor' || b.projects === 'sponsor') return a.projects === b.projects;
		const held = new Set(a.projects);
		return held.size === new Set(b.projects).size && b.projects.every((each) => held.has(each));
	};
	const accessChanged = () =>
		kit.kernelFailure(
			'AGENT_ACCESS_CHANGED',
			"This agent's access changed since it was read",
			'List yours again with account-agent-list, then choose its access again'
		);
	const agentUpdate = kit.define<typeof agentUpdateInput, OwnAgentAccessV1>({
		name: 'account-agent-update',
		title: "Change a connected agent's access",
		description:
			'Narrow or widen where an external agent you connected may act: every project you may open (projects "sponsor") or only the ones you name, and whether it may act at workspace level. It never acts beyond your own access. Give `expected`, the access you last saw, to refuse a change made since',
		category: 'account',
		mutation: true,
		undoable: true,
		executionTime: 'fast',
		input: agentUpdateInput,
		jsonSchema: {
			type: 'object',
			properties: {
				agent: ID_JSON,
				access: ACCESS_JSON,
				expected: ACCESS_JSON,
			},
			required: ['agent', 'access'],
			additionalProperties: false,
		} as unknown as JsonSchema,
		async handler(input, context) {
			const held = account(context);
			if (!held?.updateAgent) return noProvider();
			try {
				// Only the person's own, as `-disconnect` (5.3); one an owner removed stays as the owner left it (9.2).
				const own = (await ownAgents(context)).find((agent) => agent.id === input.agent);
				if (!own) return noOwnAgent();
				if (own.status === 'suspended' && own.suspended === 'owner') return removedByOwner();
				if (input.expected && !sameAccess(input.expected, own.access)) return accessChanged();
				let access: AgentMemberV1['access'];
				if (input.access.projects === 'sponsor') {
					access = { workspace: input.access.workspace, projects: 'sponsor' };
				} else {
					// Each by id or slug, kept as its id, once. One the person may not enter answers phase 2's
					// `PROJECT_NOT_FOUND`, the same bytes as one that does not exist, so it names nothing they cannot see.
					const ids: string[] = [];
					for (const ref of input.access.projects) {
						const found = deps.enterable?.(ref, context);
						if (found === undefined) return kit.projectNotFound();
						if (!ids.includes(found)) ids.push(found);
					}
					access = { workspace: input.access.workspace, projects: ids };
				}
				await held.updateAgent(input.agent, access, own.access);
				return kit.success(
					{ agent: input.agent, access, previous: own.access },
					{
						undoCommand: 'account-agent-update',
						undoArgs: { agent: input.agent, access: own.access, expected: access },
					}
				);
			} catch (cause) {
				// The provider's own refusals, for a record that changed since the list (a race): as the kernel's own.
				const code = (cause as { code?: unknown } | null)?.code;
				if (code === 'AGENT_MEMBER_NOT_FOUND' || code === 'AGENT_MEMBER_SPONSOR_ONLY')
					return noOwnAgent();
				if (code === 'AGENT_DISCONNECTED_BY_OWNER') return removedByOwner();
				// Changed since the list (another tab, or an undo of a change already replaced): nothing is written.
				if (code === 'AGENT_ACCESS_CHANGED') return accessChanged();
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
			agentList,
			agentDisconnect,
			agentUpdate,
			memberList,
			memberInvite,
			pendingList,
			invitationCancel,
			memberRemove,
			memberLeave,
			memberRoleSet,
		] as unknown as ZodCommandDefinition[],
	};
}
