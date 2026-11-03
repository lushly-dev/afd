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
import { actorKey, LOCAL_ACTOR } from './access.js';
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
	/** Lines 2 to 6 of an owned command, the handler, and after an `auth-*` command, its actor (3.4). */
	run(
		name: string,
		input: unknown,
		call: CommandContext & KernelFieldContext,
		next: () => Promise<CommandResult>
	): Promise<CommandResult>;
	/** As a reload: the next call's actor is the first one seen (10). */
	forgetActor(): void;
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

/** The actor the adapter reports now, as a key. */
export const sessionActor = (auth: AuthAdapter): string => {
	const state = auth.getSession();
	// As the auth middleware reads it: an expired session, or a malformed expiry, is no session.
	const expiry = state.session?.expiresAt;
	return state.status === 'authenticated' &&
		(expiry === undefined || new Date(expiry).getTime() > Date.now())
		? state.user.id
		: LOCAL_ACTOR;
};

export function createScopeMiddleware(deps: ScopeMiddlewareDeps): CommandMiddleware {
	const { scope } = deps;
	return async (name, input, context, next) => {
		const call = context as CommandContext & KernelFieldContext;
		const late = deps.late();
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
		if (name.startsWith('layout-') && !scope.allows(actorKey(call), requested)) {
			return projectNotFound();
		}
		return late ? late.run(name, input, call, next) : next();
	};
}
