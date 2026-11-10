/**
 * @fileoverview The access decision, version 2 (phase 3 specification, 3.3; D86): pure, in first paint,
 * and the only place workspace membership and a project's members are read. It decides for the person a
 * call is for, `personKey(actor)`, intersected with an agent member's own record. Neither the active
 * scope, a persona nor the session's active organization is an input (D4, D11).
 */

import type { ActorKind } from '@lushly-dev/afd-core';
import type { AgentMemberV1, ProjectV1, ScopeV1 } from './records.js';

/** The person of a call that has none, on a personal store (`local` mode). */
export const LOCAL_ACTOR = 'local';

/** The prefix of an agent member's id; no person's id may start with it (3.2). */
export const AGENT_MEMBER_PREFIX = 'agt_';

/** A role in the bound organization (phase 3 specification, 7.1). */
export type MemberRoleV1 = 'owner' | 'admin' | 'member';

/** Who is a member of the workspace (phase 3 specification, 3.3). */
export interface MembershipV1 {
	mode: 'local' | 'provider';
	/** `provider`: person id to role in the bound organization. `local`: unused, every actor is a member and an owner. */
	members: ReadonlyMap<string, MemberRoleV1>;
	/** The provider's digest of the membership, recorded by `session-settle` (4.4). */
	digest: string;
}

/** `local` mode's membership: every actor is a member and an owner (2.1). */
export const LOCAL_MEMBERSHIP: MembershipV1 = Object.freeze({
	mode: 'local',
	members: new Map(),
	digest: LOCAL_ACTOR,
});

/** The actor a decision reads: the call's whole actor, not only its id. */
export type AccessActorV1 = { kind: ActorKind; id?: string; onBehalfOf?: string } | undefined;

export interface AccessInputV2 {
	/** Undefined when signed out. */
	actor: AccessActorV1;
	scope: ScopeV1;
	/** Undefined when no record has that id. */
	project: ProjectV1 | undefined;
	membership: MembershipV1;
	/** The agent member's record when `actor.id` starts `agt_`, else undefined: `agentOf(context)` (9.5). */
	agent: AgentMemberV1 | undefined;
}

export type AccessDecisionV2 =
	| { allowed: true }
	| { allowed: false; reason: 'workspace' | 'project' };

/**
 * Whom a call is for: a human's id, an agent's `onBehalfOf`. Any other kind, an agent acting for no
 * one, or no actor has no person.
 */
export const personKey = (actor: AccessActorV1): string | undefined =>
	actor?.kind === 'human' ? actor.id : actor?.kind === 'agent' ? actor.onBehalfOf : undefined;

/**
 * The person a record of a call is keyed by, decides "self" by, or names in `createdBy` and
 * `updatedBy`: {@link personKey}, or `local` when the call has none (3.1). In `provider` mode, a call with
 * no person never gets past line 0, but the kernel's own commands, which line 0 exempts.
 */
export const personOf = (context: { actor?: AccessActorV1 }): string =>
	personKey(context.actor) ?? LOCAL_ACTOR;

/**
 * Whether `person` is a Loam owner: in `provider` mode, a member whose role is `owner` or `admin` (D96);
 * in `local` mode, every actor. The only reader of an owner's role (7.1).
 */
export const isOwner = (membership: MembershipV1, person: string | undefined): boolean => {
	if (membership.mode === 'local') return true;
	const role = person === undefined ? undefined : membership.members.get(person);
	return role === 'owner' || role === 'admin';
};

const refuse = (reason: 'workspace' | 'project'): AccessDecisionV2 => ({ allowed: false, reason });

/**
 * Steps 1 and 2 of {@link decideAccess} alone, which line 0 runs (3.3): the call's person, a member of the
 * workspace. In `local` mode, always.
 */
export function inWorkspace(membership: MembershipV1, actor: AccessActorV1): boolean {
	if (membership.mode === 'local') return true;
	const person = personKey(actor);
	return person !== undefined && membership.members.has(person);
}

/**
 * Whether the call's person, and its agent member if any, may enter the scope (3.3):
 *
 * 1. The person, {@link personKey}: in `local` mode, absent either, `local`; in `provider` mode none is
 *    refused for the workspace.
 * 2. Workspace: in `provider` mode, the person is a member.
 * 3. Project, when the scope names one: it exists, and a restricted one lists the person.
 * 4. Agent member, when `actor.id` starts `agt_`: its record exists and is `active`, `onBehalfOf` is its
 *    sponsor, and the scope is within its `access`. Refused as a missing project.
 *
 * So an agent never has more access than the person it acts for, and an agent member never more than its
 * record or its sponsor.
 */
export function decideAccess(input: AccessInputV2): AccessDecisionV2 {
	const { actor, scope, project, membership, agent } = input;
	if (!inWorkspace(membership, actor)) return refuse('workspace');
	const person = personKey(actor) ?? LOCAL_ACTOR;
	if (scope.project !== undefined) {
		if (project?.id !== scope.project) return refuse('project');
		const { access } = project;
		if (access.mode === 'restricted' && !access.members.includes(person)) return refuse('project');
	}
	if (actor?.id?.startsWith(AGENT_MEMBER_PREFIX)) {
		const projects = agent?.access.projects;
		if (
			agent?.id !== actor.id ||
			agent.status !== 'active' ||
			actor.onBehalfOf !== agent.sponsor ||
			(scope.project === undefined
				? !agent.access.workspace
				: projects !== 'sponsor' && !projects?.includes(scope.project))
		) {
			return refuse('project');
		}
	}
	return { allowed: true };
}
