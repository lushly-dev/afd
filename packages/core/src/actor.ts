/**
 * @fileoverview The principal behind a command call, and the context defaults AFD
 * surfaces fill in (`actor`, `clock`, `random`).
 */

import { type Clock, type RandomSource, systemClock, systemRandom } from './clock.js';
import type { CommandContext } from './commands.js';

/** The kinds of principal that can call a command. */
export const ACTOR_KINDS = ['human', 'agent', 'service', 'script', 'test'] as const;

/** What kind of principal is calling: a person, an AI agent, a service, a script or a test. */
export type ActorKind = (typeof ACTOR_KINDS)[number];

/**
 * Who is calling a command.
 *
 * Surfaces fill in `kind`: `DirectClient` defaults to `human`, the MCP server to `agent`,
 * and the testing package to `test`. Auth middleware sets a human actor's `id` and
 * `label` from the session, and another actor's `onBehalfOf`. Middleware and handlers read `context.actor` to key trust, approval,
 * rate-limit or data rules on it; AFD itself only reports `kind` (as
 * `metadata.actorKind`), never the id.
 */
export interface Actor {
	/** What kind of principal this is. */
	kind: ActorKind;
	/** Stable identifier within the application, e.g. a user ID. */
	id?: string;
	/** Display name, e.g. "Claude (advisor)". */
	label?: string;
	/** The human an agent or service is acting for. */
	onBehalfOf?: string;
}

/** Whether `value` is one of {@link ACTOR_KINDS}. */
export function isActorKind(value: unknown): value is ActorKind {
	return typeof value === 'string' && (ACTOR_KINDS as readonly string[]).includes(value);
}

/** Whether `value` is a well-formed {@link Actor}. */
export function isActor(value: unknown): value is Actor {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const actor = value as Record<string, unknown>;
	return (
		isActorKind(actor.kind) &&
		(actor.id === undefined || typeof actor.id === 'string') &&
		(actor.label === undefined || typeof actor.label === 'string') &&
		(actor.onBehalfOf === undefined || typeof actor.onBehalfOf === 'string')
	);
}

/** Defaults for {@link withContextDefaults}. */
export interface ContextDefaults {
	/** Clock when the context has none. Default: {@link systemClock}. */
	clock?: Clock;
	/** Random source when the context has none. Default: {@link systemRandom}. */
	random?: RandomSource;
	/** Actor when the context has none. Default: none (the context keeps no actor). */
	actor?: Actor;
}

/**
 * A copy of `context` with `clock`, `random` and (when given) `actor` filled in where it
 * has none. Values already on the context always win. The actor is copied too.
 */
export function withContextDefaults(
	context: CommandContext = {},
	defaults: ContextDefaults = {}
): CommandContext & { clock: Clock; random: RandomSource } {
	const actor = context.actor ?? defaults.actor;
	return {
		...context,
		clock: context.clock ?? defaults.clock ?? systemClock,
		random: context.random ?? defaults.random ?? systemRandom,
		// A copy: middleware may refine `context.actor` in place, and a shared default
		// object would carry one caller's identity into the next call.
		...(actor ? { actor: { ...actor } } : {}),
	};
}
