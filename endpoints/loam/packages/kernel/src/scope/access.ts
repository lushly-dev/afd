/**
 * @fileoverview The access decision (phase 2 specification, 3.4): pure, in first paint, and the only
 * place a project's membership is read. Active scope is never an input (D4).
 */

import type { ProjectV1, ScopeV1 } from './records.js';

/** The actor of a signed-out person on a personal store. */
export const LOCAL_ACTOR = 'local';

export interface AccessInputV1 {
	/** `context.actor?.id`, or {@link LOCAL_ACTOR}. */
	actor: string;
	scope: ScopeV1;
	/** Undefined when no record has that id. */
	project: ProjectV1 | undefined;
}

/** The actor's id a decision reads: `local` when the call has none (phase 2 specification, 4). */
export const actorKey = (context: { actor?: { id?: string } }): string =>
	context.actor?.id ?? LOCAL_ACTOR;

/**
 * Whether the actor may enter the scope. No project: allowed, since until phase 3 whoever reaches the
 * kernel is a member (D11, D32). A missing project, or a restricted one without the actor, is not, and
 * the caller answers both the same way.
 */
export function decideAccess(input: AccessInputV1): { allowed: boolean } {
	const { project } = input;
	if (input.scope.project === undefined) return { allowed: true };
	if (project === undefined || project.id !== input.scope.project) return { allowed: false };
	const { access } = project;
	return { allowed: access.mode !== 'restricted' || access.members.includes(input.actor) };
}
