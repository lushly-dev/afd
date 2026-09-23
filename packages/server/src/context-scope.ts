/**
 * @fileoverview Binds a caller's context state to the `CommandContext` of a remote call.
 *
 * HTTP clients each get their own context stack (keyed by MCP session), so the state cannot
 * live in a closure shared by the whole server. The HTTP handler binds the caller's state to
 * the command context under a private symbol; the tool router, execution engine and
 * `afd-context-*` commands read it back. Symbol keys survive the `{ ...context }` copies made
 * for batch items and pipeline steps, never serialize, and cannot be set by `createContext`.
 */

import type { CommandContext } from '@lushly-dev/afd-core';
import type { ContextState } from './bootstrap/afd-context.js';

const CONTEXT_STATE = Symbol('afd.contextState');

type ScopedContext = CommandContext & { [CONTEXT_STATE]?: ContextState | null };

/**
 * Return a copy of `context` bound to `state`.
 *
 * `null` marks a caller without a session (a stateless HTTP request): it sees no active
 * context and cannot enter one.
 */
export function bindContextState(
	context: CommandContext,
	state: ContextState | null
): CommandContext {
	const scoped: ScopedContext = { ...context, [CONTEXT_STATE]: state };
	return scoped;
}

/**
 * The context state bound to `context`, or `fallback` when none is bound (stdio and
 * in-process calls use the server's single state).
 *
 * @returns the bound state, `null` for a caller without a session, or `fallback`
 */
export function resolveContextState(
	context: CommandContext | undefined,
	fallback?: ContextState
): ContextState | null | undefined {
	const scoped = context as ScopedContext | undefined;
	return scoped && CONTEXT_STATE in scoped ? scoped[CONTEXT_STATE] : fallback;
}
