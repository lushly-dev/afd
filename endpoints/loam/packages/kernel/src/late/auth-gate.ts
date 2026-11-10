/**
 * @fileoverview The auth gate's lists and the gate (phase 3 specification, 2.1 and 3.2): which commands run
 * signed out or without membership in `provider` mode, and afd-auth's middleware with the kernel's
 * refusal of an agent member's id as a person's. In `late/`: stage A holds only boot commands, which are
 * all signed-out ones, so first paint needs neither (13).
 */

import { type AuthAdapter, createAuthMiddleware } from '@lushly-dev/afd-auth';
import {
	type Actor,
	type CommandContext,
	type CommandMiddleware,
	type CommandResult,
	failure,
} from '@lushly-dev/afd-core';
import { isVerifiedCredentials } from '@lushly-dev/afd-server/credentials';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { INTERNAL_COMMANDS } from '../commands.js';
import { kernelFailure } from '../errors.js';
import {
	type AccessActorV1,
	AGENT_MEMBER_PREFIX,
	inWorkspace,
	LOCAL_ACTOR,
} from '../scope/access.js';
import type { ScopeRuntime } from '../scope/runtime.js';

/** Run with no session in `provider` mode: every call the chrome makes on the signed-out main (2.1). */
export const SIGNED_OUT_COMMANDS = [
	'auth-sign-in',
	'auth-sign-out',
	'auth-session-get',
	'shell-info-get',
	'appearance-get',
	'appearance-set',
	'layout-get',
	'layout-set',
	'palette-open',
	'palette-close',
	'palette-search',
	'overlay-list',
	'overlay-dismiss',
	'modal-open',
	'toast-show',
	'scope-get',
	'section-get',
	'app-list',
	'workspace-get',
] as const;

/** Run with a session but no membership: a person's own account, sessions and invitations (2.1). */
export const MEMBER_EXEMPT_COMMANDS = [
	'account-get',
	'account-update',
	'account-passkey-list',
	'account-passkey-add',
	'account-passkey-rename',
	'account-passkey-remove',
	'account-invitation-list',
	'account-invitation-accept',
	'account-invitation-reject',
	'session-list',
	'session-revoke',
] as const;

/**
 * The kernel's own internal commands of phase 3 (4.4): exempt by name from the gate and from line 0, as
 * `INTERNAL_COMMANDS` are, since only the kernel runs them.
 */
export const KERNEL_SETTLE_COMMANDS = [
	'session-settle',
	'membership-settle',
	'agent-member-settle',
] as const;

/** What `provider` mode's gate lets through with no session: the signed-out and the kernel's own commands. */
const SESSIONLESS: ReadonlySet<string> = new Set([
	...SIGNED_OUT_COMMANDS,
	...INTERNAL_COMMANDS,
	...KERNEL_SETTLE_COMMANDS,
]);

/** What line 0 never decides (3.3): those, and the member-exempt commands. */
const UNGATED: ReadonlySet<string> = new Set([...SESSIONLESS, ...MEMBER_EXEMPT_COMMANDS]);

/** Whether line 0 decides `name`: every command not in the lists, `INTERNAL_COMMANDS` or the settle commands. */
export const gatedByLineZero = (name: string): boolean => !UNGATED.has(name);

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

/**
 * Line 0 (3.3): for every gated command, steps 1 and 2 of `decideAccess` alone, the call's person a member
 * of the workspace. Its refusal is journaled with the scope the call asked for, before any other line.
 */
export function lineZero(
	scope: Pick<ScopeRuntime, 'membership' | 'workspace' | 'note'>,
	call: CommandContext & { scope?: { workspace: string; project?: string } },
	name: string
): CommandResult<never> | undefined {
	if (!gatedByLineZero(name) || inWorkspace(scope.membership, call.actor)) return undefined;
	call.scope ??= { workspace: scope.workspace.id };
	scope.note(call.traceId, { scope: call.scope });
	return notMember(call.actor);
}

/** The agent interface's agent when a call names none (phase 3 specification, 3.1). */
export const SHELL_AGENT = 'shell-agent';

/** The agent names the kernel keeps for itself (3.1): its own, and the two persons it names. */
const RESERVED_AGENTS = [LOCAL_ACTOR, 'signed-out', SHELL_AGENT];

/**
 * An agent interface's actor (3.1): `options.agent`, 1 to 64 characters of `^[a-z0-9][a-z0-9-]*$`, so it can
 * never spell an `agt_` id, or `shell-agent`. A reserved name, or one off the pattern, is
 * `AGENT_NAME_RESERVED`: no caller names an agent member, or the kernel's own. In `late/`: the agent
 * interface waits for stage B, so no agent call runs before this has loaded (13).
 */
export function agentActor(name: string | undefined): Actor | CommandResult<never> {
	if (name === undefined) return { kind: 'agent', id: SHELL_AGENT };
	// A string: the pattern alone would take `123`, which `test` turns into one.
	if (
		typeof name === 'string' &&
		/^[a-z0-9][a-z0-9-]{0,63}$/.test(name) &&
		!RESERVED_AGENTS.includes(name)
	) {
		return { kind: 'agent', id: name };
	}
	return failure({
		code: 'AGENT_NAME_RESERVED',
		message: 'Not an agent name the agent interface takes',
		suggestion: 'Name it with 1 to 64 of a-z, 0-9 and -, not local, signed-out or shell-agent',
		retryable: false,
	});
}

export interface AuthGateOptions {
	identity: IdentityV1;
}

/**
 * The kernel's auth gate over `held` (2.1, 3.2, 4.1): afd-auth's middleware, with
 *
 * - `exclude`: in `local` mode every held command, as phases 0 to 2 have it; in `provider` mode only the
 *   signed-out commands and the kernel's own;
 * - `isVerifiedCredentials`, so a call whose credentials afd-server verified keeps its actor and never
 *   reads the adapter's session (4.1). Sessions expire on the system clock, as the Mock's do: the kernel's
 *   clock reaches the middleware and the Mock together with `session-settle`'s expiry timer (4.4);
 * - before it, a session whose user id starts `agt_` is signed out and the call refused
 *   `AGENT_CANNOT_SIGN_IN`: no person's id may (3.2), so a forged or misconfigured adapter cannot make an
 *   agent member a person.
 */
export function createAuthGate(
	auth: AuthAdapter,
	held: readonly ZodCommandDefinition[],
	options: AuthGateOptions
): CommandMiddleware {
	const exclude = held
		.map((command) => command.name)
		.filter((name) => options.identity.mode === 'local' || SESSIONLESS.has(name));
	const gate = createAuthMiddleware(auth, { exclude, isVerifiedCredentials });
	return async (name, input, context, next) => {
		const state = auth.getSession();
		if (
			state.status === 'authenticated' &&
			state.user.id.startsWith(AGENT_MEMBER_PREFIX) &&
			!isVerifiedCredentials(context.credentials)
		) {
			await auth.signOut();
			delete context.auth;
			return kernelFailure(
				'AGENT_CANNOT_SIGN_IN',
				'An agent member cannot sign in',
				'Agent members act through delegation or a connection; sign in as a person'
			);
		}
		return gate(name, input, context, next);
	};
}
