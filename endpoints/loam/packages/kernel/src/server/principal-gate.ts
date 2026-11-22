/**
 * @fileoverview The server kernel's gate (phase 3 specification, 9.5; step 7): `principalGate`, the first middleware of
 * every registry on a kernel built with `gate: 'principal'`, and the registry of principals it trusts. Loaded only by
 * such a kernel, so a browser's first paint holds none of it.
 *
 * **The server's kernel never runs a call as whoever an adapter has signed in, and every call on it, top-level or
 * nested, runs under the request's principal.** The gate sets `context.actor` from the call's principal and refuses a
 * call with none (`UNAUTHORIZED`), but two the kernel makes itself: boot's own work (`BOOT_FIELDS`) and the instance
 * refresh (`INSTANCE_FIELDS`, `app-instance-refresh` alone), each marked on the call's context by `execute` under a
 * symbol no caller can name. A principal is trusted only when this registry minted it, so an object a caller built
 * never passes; and an actor is never taken from the caller, only from the principal.
 */

// Types only from first paint's modules, so Rollup splits none of them out of its chunk for this one (13).
import type { Actor, CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import type { KernelPrincipalV1, PrincipalInputV1 } from '../scope/principal.js';

/** No person's id may start with it (3.2): `AGENT_MEMBER_PREFIX`, repeated so this chunk imports nothing at run time. */
const AGENT_MEMBER_PREFIX = 'agt_';

/**
 * A principal-gated kernel serves a `provider` deployment only (9.5), so line 0 can never read everyone as a member and
 * owner there. The kernel's error class is given, so this chunk imports nothing first paint shares.
 *
 * @throws `IDENTITY_MODE_INVALID` for any other identity
 */
export function assertProvider(
	identity: { mode: string },
	KernelError: new (init: {
		code: 'IDENTITY_MODE_INVALID';
		message: string;
		suggestion: string;
		details: Record<string, unknown>;
	}) => Error
): void {
	if (identity.mode === 'provider') return;
	throw new KernelError({
		code: 'IDENTITY_MODE_INVALID',
		message: "A principal-gated kernel needs `identity.mode` 'provider'",
		suggestion: `Build the server's kernel for a deployment whose [identity] mode is "provider"`,
		details: { mode: identity.mode },
	});
}

/**
 * Which of the kernel's own calls a context is, set by `execute` alone (9.5): boot's own work, the instance refresh, or
 * the provider's removal hook (phase 3's A8, phase 6's step 5).
 */
export type KernelOwnCall = 'boot' | 'instance' | 'hook';

/** The principals one kernel minted, and each one's actor. */
export interface PrincipalRegistry {
	/**
	 * Mint the principal for one request (9.2's steps 4 and 5): its actor, the person, that person's member row alone,
	 * and the connected agent's row. Frozen; trusted by this kernel's gate alone.
	 *
	 * @throws Error when the actor, person and agent do not agree: an agent's `onBehalfOf` and its row's sponsor are the
	 *   person, a human's id is the person, and no person's id starts `agt_`
	 */
	admit(input: PrincipalInputV1): KernelPrincipalV1;
	/** The principal whose actor this is, or undefined: a copied actor's or a decision's lookup (9.5). */
	of(actor: unknown): KernelPrincipalV1 | undefined;
	/** Whether this registry minted it, and its request has not ended. */
	has(principal: unknown): principal is KernelPrincipalV1;
	/** Its request has ended: from now on neither its actor nor itself admits a call. */
	retire(principal: KernelPrincipalV1): void;
}

const deepFreeze = <T>(value: T): T => {
	if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const each of Object.values(value)) deepFreeze(each);
	}
	return value;
};

/** A read-only map of one entry, or none: a `Map` frozen still takes `set`, so this one refuses it. */
function rowOf(
	person: string,
	role: PrincipalInputV1['role']
): ReadonlyMap<string, 'owner' | 'admin' | 'member'> {
	const map = new Map(role === null ? [] : [[person, role] as const]);
	const refuse = () => {
		throw new TypeError("A principal's membership is read-only");
	};
	return Object.freeze(Object.assign(map, { set: refuse, delete: refuse, clear: refuse }));
}

export function createPrincipalRegistry(): PrincipalRegistry {
	const minted = new WeakSet<object>();
	const byActor = new WeakMap<object, KernelPrincipalV1>();
	return {
		admit(input) {
			const { person, agent } = input;
			const actor: Actor = { ...input.actor };
			if (typeof person !== 'string' || person === '' || person.startsWith(AGENT_MEMBER_PREFIX)) {
				throw new Error("A principal's person is a person's id, never an agent member's");
			}
			if (actor.kind === 'agent') {
				if (
					!agent ||
					actor.onBehalfOf !== person ||
					actor.id !== agent.id ||
					agent.sponsor !== person ||
					!agent.id.startsWith(AGENT_MEMBER_PREFIX)
				) {
					throw new Error("An agent's principal names its own record, sponsored by its person");
				}
			} else if (actor.kind !== 'human' || actor.id !== person || agent !== undefined) {
				throw new Error("A person's principal is that person, with no agent");
			}
			const principal: KernelPrincipalV1 = deepFreeze({
				actor: deepFreeze(actor),
				person,
				membership: Object.freeze({
					mode: 'provider' as const,
					members: rowOf(person, input.role),
					digest: input.digest ?? '',
				}),
				...(agent ? { agent: deepFreeze(structuredClone(agent)) } : {}),
			});
			minted.add(principal);
			byActor.set(principal.actor, principal);
			return principal;
		},
		of: (actor) => (typeof actor === 'object' && actor !== null ? byActor.get(actor) : undefined),
		has: (principal): principal is KernelPrincipalV1 =>
			typeof principal === 'object' && principal !== null && minted.has(principal),
		retire(principal) {
			minted.delete(principal);
			byActor.delete(principal.actor);
		},
	};
}

/** `UNAUTHORIZED`, as afd-auth's middleware answers a call with no session. */
const unauthorized = (): CommandResult<never> => ({
	success: false,
	error: {
		code: 'UNAUTHORIZED',
		message:
			'This call has no principal: the server kernel runs a call only for a verified token or session',
		suggestion: 'Send the request with a bearer token the hosted server accepts',
		retryable: false,
	},
});

/**
 * `principalGate` (9.5): the actor from the call's principal, or the call refused. Boot's own work passes with no
 * actor, the instance refresh with none for `app-instance-refresh` alone, and the provider's removal hook as its own actor
 * for `agent-member-settle` alone (A8); nothing else passes any mark.
 */
export function createPrincipalGate(options: {
	principals: PrincipalRegistry;
	/** The symbol under which `execute` marks the kernel's own calls. */
	own: symbol;
}): CommandMiddleware {
	const { principals, own } = options;
	return async (name, _input, context, next) => {
		const call = context as CommandContext & {
			principal?: unknown;
			[key: symbol]: KernelOwnCall | undefined;
		};
		const mark = call[own];
		// `agent-member-settle` is the provider hook's alone on the server (A4): boot's mark never carries it.
		if (mark === 'boot' && name === 'agent-member-settle') return unauthorized();
		if (mark === 'boot' || (mark === 'instance' && name === 'app-instance-refresh')) {
			delete call.actor;
			delete call.principal;
			return next();
		}
		// The provider's removal hook (A8): `agent-member-settle` alone, as the actor `execute` gave it, with no principal.
		if (mark === 'hook') {
			delete call.principal;
			return name === 'agent-member-settle' ? next() : unauthorized();
		}
		const principal = call.principal;
		if (!principals.has(principal)) {
			delete call.actor;
			delete call.principal;
			return unauthorized();
		}
		// Never an actor the caller sent: only the principal's.
		call.actor = principal.actor as Actor;
		return next();
	};
}

/** The kernel's `execute`, as the server's calls reach it (9.5; phase 6's step 5). */
type Execute = (
	iface: 'palette',
	name: string,
	input: unknown,
	options: { scope?: { workspace: string; project?: string } },
	fields: Record<string, unknown>,
	hookActor?: Actor
) => Promise<CommandResult>;

/**
 * A gated kernel's own entries, here so first paint holds none of them: minting and retiring principals, `callAs` (a
 * command run as a principal at a scope, through the palette's whole chain: phase 6's transport, its 6.2), and the
 * provider's removal hook (phase 3's A4, A8), `agent-member-settle` with `hook`'s fields, journaled as the removing
 * person when known, else as the hook itself.
 */
export function serverCalls(principals: PrincipalRegistry, execute: Execute, hook: object) {
	return {
		admitPrincipal: principals.admit,
		retirePrincipal: principals.retire,
		callAs: (
			principal: KernelPrincipalV1,
			name: string,
			input: unknown,
			scope: { workspace: string; project?: string }
		) => execute('palette', name, input, { scope }, { actor: principal.actor as Actor }),
		runProviderHook: (input: unknown, actor?: Actor) =>
			execute(
				'palette',
				'agent-member-settle',
				input,
				{},
				hook as Record<string, unknown>,
				actor ?? { kind: 'service', id: 'provider-hook' }
			),
	};
}
