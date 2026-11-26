/**
 * @fileoverview Context state, and its binding to the `CommandContext` of a call.
 *
 * HTTP clients each get their own context stack (keyed by MCP session), so the state cannot
 * live in a closure shared by the whole server. The HTTP handler binds the caller's state to
 * the command context's host state (`host-state.ts`); the tool router, execution engine and
 * `afd-context-*` commands read it back. It survives the `{ ...context }` copies made for batch
 * items and pipeline steps, never serializes, and cannot be set by `createContext`.
 * `createDirectRegistry` binds a state per call, built from the call's `activeContext` option,
 * so this module stays free of the bootstrap commands and of Node.js built-ins.
 */

import type { CommandContext } from '@lushly-dev/afd-core';
import { hostState, withHostState } from './host-state.js';

/** Default maximum depth of a context stack. */
export const DEFAULT_CONTEXT_MAX_DEPTH = 16;

export interface ContextState {
	stack: string[];
	/** Maximum stack depth (default: 16). `afd-context-enter` fails once it is reached. */
	maxDepth?: number;
	/**
	 * `false` for the per-request state of a stateless MCP 2026-07-28 request: the active
	 * context comes from the request's `_meta["dev.afd/context"]`, and `afd-context-enter` and
	 * `afd-context-exit` validate but never change it. Omitted (persistent) otherwise.
	 */
	persistent?: boolean;
	getActive(): string | null;
	enter(name: string): void;
	exit(): string | null;
}

/**
 * Create a context state manager: one stack of entered contexts.
 *
 * The MCP server keeps one for stdio and one per HTTP session. Re-entering the active context
 * is a no-op, and `enter` throws once `maxDepth` contexts are stacked.
 */
export function createContextState(
	options: { maxDepth?: number; persistent?: boolean } = {}
): ContextState {
	const maxDepth = options.maxDepth ?? DEFAULT_CONTEXT_MAX_DEPTH;
	if (!Number.isSafeInteger(maxDepth) || maxDepth <= 0) {
		throw new Error('Context maxDepth must be a positive integer');
	}
	const stack: string[] = [];

	return {
		stack,
		maxDepth,
		...(options.persistent === false && { persistent: false }),
		getActive() {
			return stack.length > 0 ? (stack[stack.length - 1] ?? null) : null;
		},
		enter(name: string) {
			if (stack[stack.length - 1] === name) return;
			if (stack.length >= maxDepth) {
				throw new Error(`Context stack is limited to ${maxDepth} levels`);
			}
			stack.push(name);
		},
		exit() {
			return stack.pop() ?? null;
		},
	};
}

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
	return withHostState(context, { contextState: state });
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
	const state = hostState(context);
	return Object.hasOwn(state, 'contextState') ? state.contextState : fallback;
}
