/**
 * @fileoverview `scopeMiddleware` (phase 2 specification, 3.4; D72): last in the kernel's chain, after
 * auth and the journal, so every refusal is journaled with the scope and the actor, and what is
 * journaled is the effective scope. First paint holds what a boot command needs: the default scope,
 * line 1 and the `layout-*` check. The rest, lines 2 to 6 of an owned command, a change of actor and a
 * replay's actor, is `late/scope-change.ts`'s `LateScope`, since no owned command and no `auth-*` command
 * exists until that chunk has loaded, and a replay loads it before its first entry.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import {
	type CommandContext,
	type CommandMiddleware,
	type CommandResult,
	failure,
} from '@lushly-dev/afd-core';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure } from '../errors.js';
import { type AccessActorV1, AGENT_MEMBER_PREFIX, inWorkspace } from './access.js';
import type { ScopeChangeV2, ScopeV1 } from './records.js';
import type { ScopeRuntime } from './runtime.js';

/** What `late/` adds to the middleware once it has loaded (3.4, 3.5). */
export interface LateScope {
	/** The one function that changes the active scope; a refusal, or undefined once applied. */
	applyScopeChange(
		to: ScopeV1,
		reason: ScopeChangeV2['reason'],
		context: CommandContext
	): CommandResult<never> | undefined;
	/**
	 * Before line 1: a replay's recorded actor (10), then a change of actor that refuses the active project
	 * leaves it, and a call made in it runs where it lands (3.4). A replay loads `late/` before its first
	 * entry, so first paint needs neither.
	 */
	before(call: CommandContext & KernelFieldContext, name: string): void;
	/**
	 * Whether line 0 decides `name` (phase 3 specification, 3.3): every command but the signed-out and
	 * member-exempt lists, `INTERNAL_COMMANDS` and the kernel's own settle commands. The lists load here, with
	 * the late commands: stage A holds only boot commands, which are all signed-out ones (13).
	 */
	gated(name: string): boolean;
	/** Lines 2 to 6 of an owned command, the handler, and after an `auth-*` command, its actor (3.4). */
	run(
		name: string,
		input: unknown,
		call: CommandContext & KernelFieldContext,
		next: () => Promise<CommandResult>
	): Promise<CommandResult>;
	/** As a reload: the next call's actor is the first one seen (10). */
	forgetActor(): void;
	/** Why the active app cannot open in the recorded scope (`canOpen`), or undefined (F3). */
	activeRefusal(): CommandResult<never> | undefined;
	/**
	 * `app-settle`'s: an active app {@link LateScope.activeRefusal} refuses is no app, landed as a change of
	 * scope lands a left one (F3). The one it left, and why.
	 */
	settleActive(): { left: string; code: string } | undefined;
}

export interface ScopeMiddlewareDeps {
	scope: ScopeRuntime;
	late(): LateScope | undefined;
}

/** `PROJECT_NOT_FOUND`: one message for "does not exist" and "you may not" (3.4). */
export const projectNotFound = (): CommandResult<never> =>
	kernelFailure(
		'PROJECT_NOT_FOUND',
		'No project with that name is available to you',
		'List the projects you can open with project-list'
	);

/**
 * The person the adapter reports now, as the auth middleware would stamp them, or undefined signed out. An
 * expired session, a malformed expiry, or a user id starting `agt_`, which no person's may (3.2), is none.
 */
export const sessionActor = (auth: AuthAdapter): AccessActorV1 => {
	const state = auth.getSession();
	const expiry = state.session?.expiresAt;
	return state.status === 'authenticated' &&
		!state.user.id.startsWith(AGENT_MEMBER_PREFIX) &&
		(expiry === undefined || new Date(expiry).getTime() > Date.now())
		? { kind: 'human', id: state.user.id }
		: undefined;
};

/**
 * Line 0's refusal (phase 3 specification, 3.3): signed out, afd-auth's `UNAUTHORIZED`; an agent or another
 * caller acting for no one, or a person who is not a member, `WORKSPACE_NOT_MEMBER`.
 */
function notMember(actor: AccessActorV1): CommandResult<never> {
	if (actor === undefined) {
		return failure({
			code: 'UNAUTHORIZED',
			message: 'Authentication required',
			suggestion: 'Sign in with auth-sign-in to access this command',
			retryable: false,
		});
	}
	return kernelFailure(
		'WORKSPACE_NOT_MEMBER',
		actor.kind === 'human'
			? 'You are not a member of this workspace'
			: `This ${actor.kind === 'agent' ? 'agent' : 'caller'} acts for no member of the workspace`,
		'Ask an owner of the workspace to invite you, and list your invitations with account-invitation-list'
	);
}

export function createScopeMiddleware(deps: ScopeMiddlewareDeps): CommandMiddleware {
	const { scope } = deps;
	return async (name, input, context, next) => {
		const call = context as CommandContext & KernelFieldContext;
		const late = deps.late();
		// Line 0, before everything else about the call, journaled with the scope it asked for (3.3).
		if (late?.gated(name) && !inWorkspace(scope.membership, call.actor)) {
			call.scope ??= { workspace: scope.workspace.id };
			scope.note(call.traceId, { scope: call.scope });
			return notMember(call.actor);
		}
		late?.before(call, name);
		// Absent is the workspace: no server holds an active scope (3.3).
		const requested: ScopeV1 = call.scope ?? { workspace: scope.workspace.id };
		call.scope = requested;
		scope.note(call.traceId, { scope: requested });
		if (requested.workspace !== scope.workspace.id) {
			return kernelFailure(
				'SCOPE_WORKSPACE_UNKNOWN',
				'Not this workspace',
				`Use '${scope.workspace.id}'`
			);
		}
		// `layout-*` reads the call's scope's record, so the access decision comes first (3.4).
		if (name.startsWith('layout-') && !scope.allows(call.actor, requested)) {
			return projectNotFound();
		}
		return late ? late.run(name, input, call, next) : next();
	};
}
