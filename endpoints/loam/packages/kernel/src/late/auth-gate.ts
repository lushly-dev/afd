/**
 * @fileoverview The auth gate's lists and the gate (phase 3 specification, 2.1 and 3.2): which commands run
 * signed out or without membership in `provider` mode, and afd-auth's middleware with the kernel's
 * refusal of an agent member's id as a person's. In `late/`: stage A holds only boot commands, which are
 * all signed-out ones, so first paint needs neither (13).
 */

import { type AuthAdapter, createAuthMiddleware } from '@lushly-dev/afd-auth';
import type { CommandMiddleware } from '@lushly-dev/afd-core';
import { isVerifiedCredentials } from '@lushly-dev/afd-server/credentials';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { INTERNAL_COMMANDS } from '../commands.js';
import { kernelFailure } from '../errors.js';
import { AGENT_MEMBER_PREFIX } from '../scope/access.js';

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
