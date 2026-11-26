/**
 * @fileoverview The `allow` call option of `createDirectRegistry`, bound to the command context of
 * one call.
 *
 * `DirectClient` passes its `allow` predicate to the registry as a call option, beside
 * `activeContext`. The registry binds it to the call's host state (`host-state.ts`), as it binds
 * the context state (`context-scope.ts`), so the copies made for `afd-call`, batch items, pipeline
 * steps and grouped tools all carry it, and the engine and the tool router check every command the
 * call runs.
 *
 * The context holds the host state's opaque frozen token, never the predicate: a handler that lists
 * its context's symbols finds an empty object it cannot call, read or swap for another predicate
 * (a forged token denies everything). Tool
 * arguments and `createContext` values are plain JSON and string keys, so they cannot carry one. A
 * token handed back to `execute` (a handler passing its own context on) only narrows the next
 * call, never widens it. Nothing binds a token on the MCP lanes, so they are unchanged.
 */

import type { CommandContext } from '@lushly-dev/afd-core';
import { type DirectAllow, directAllows } from '@lushly-dev/afd-core/internal/direct-allow';
import { hostState, withHostState } from './host-state.js';

/** The predicate bound to `context`: none when nothing is bound, deny-all for a forged token. */
function boundAllow(context: CommandContext | undefined): DirectAllow | undefined {
	const state = hostState(context);
	if (state.forged) return () => false;
	return state.commandAllow;
}

/**
 * Return `context` bound to `allow`, combined with any predicate it already carries: both must
 * permit a name. Without either, `context` is returned unchanged.
 */
export function bindCommandAllow(
	context: CommandContext,
	allow: DirectAllow | undefined
): CommandContext {
	const carried = boundAllow(context);
	if (!allow && !carried) return context;
	const combined: DirectAllow =
		allow && carried
			? (name) => directAllows(carried, name) && directAllows(allow, name)
			: ((allow ?? carried) as DirectAllow);
	return withHostState(context, { commandAllow: combined });
}

/** Whether the predicate bound to `context`, if any, permits `name`. */
export function isCommandAllowed(context: CommandContext | undefined, name: string): boolean {
	const allow = boundAllow(context);
	return !allow || directAllows(allow, name);
}

/** `items` without those whose name the predicate bound to `context` rejects. */
export function filterAllowed<T extends { name: string }>(
	items: T[],
	context: CommandContext | undefined
): T[] {
	const allow = boundAllow(context);
	return allow ? items.filter((item) => directAllows(allow, item.name)) : items;
}
