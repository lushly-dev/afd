/**
 * @fileoverview `scopeMiddleware` (phase 2 specification, 3.4; D72): last in the kernel's chain, after
 * auth and the journal, so every refusal is journaled with the scope and the actor, and what is
 * journaled is the effective scope. First paint holds what a boot command needs: the default scope,
 * line 1 and the `layout-*` check. The rest, lines 2 to 6 of an owned command, a change of actor and a
 * replay's actor, is `late/scope-change.ts`'s `LateScope`, since no owned command and no `auth-*` command
 * exists until that chunk has loaded, and a replay loads it before its first entry.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import type { CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure } from '../errors.js';
import { type AccessActorV1, AGENT_MEMBER_PREFIX } from './access.js';
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
	 * Before line 1: line 0 (phase 3 specification, 3.3), whose refusal it returns, journaled with the scope
	 * the call asked for; then a replay's recorded actor (10), then a change of actor that refuses the active
	 * project leaves it, and a call made in it runs where it lands (3.4). Line 0 is here, not in first paint,
	 * by 13's rule for the kernel's row: stage A holds only boot commands, all signed-out ones, which line 0
	 * exempts. A replay loads `late/` before its first entry.
	 */
	before(call: CommandContext & KernelFieldContext, name: string): CommandResult<never> | undefined;
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
 * Expiry is on the kernel's clock, which the middleware and the Mock share (phase 3 specification, 4.4).
 */
export const sessionActor = (auth: AuthAdapter, clock: { now(): number } = Date): AccessActorV1 => {
	const state = auth.getSession();
	const expiry = state.session?.expiresAt;
	return state.status === 'authenticated' &&
		!state.user.id.startsWith(AGENT_MEMBER_PREFIX) &&
		(expiry === undefined || new Date(expiry).getTime() > clock.now())
		? { kind: 'human', id: state.user.id }
		: undefined;
};

export function createScopeMiddleware(deps: ScopeMiddlewareDeps): CommandMiddleware {
	const { scope } = deps;
	return async (name, input, context, next) => {
		const call = context as CommandContext & KernelFieldContext;
		const late = deps.late();
		// Line 0 first, then a replay's actor and a change of actor, all `late/`'s (phase 3 specification, 3.3).
		const refused = late?.before(call, name);
		if (refused) return refused;
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
		// `layout-*` reads the call's scope's record, so the access decision comes first (3.4): a project's.
		// A workspace-level layout is a signed-out command's in `provider` mode (phase 3 specification, 2.1).
		if (
			name.startsWith('layout-') &&
			requested.project !== undefined &&
			!scope.allows(call.actor, requested)
		) {
			return projectNotFound();
		}
		return late ? late.run(name, input, call, next) : next();
	};
}
