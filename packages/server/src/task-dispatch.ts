/**
 * @fileoverview Per-request MCP Tasks dispatch seam (`spec/tasks.md`).
 *
 * The MCP lane binds a {@link TaskDispatch} to each `tools/call` context's host state
 * (`host-state.ts`, like `scope-view.ts` and `confirmations.ts`), so `createContext` and tool
 * arguments can never forge one. This module loads only `host-state.ts`, so the tool router, which
 * `/direct` also bundles, reads it without pulling Node.js built-ins or the task runtime into
 * `/direct`.
 */

import type { CommandContext, CommandError } from '@lushly-dev/afd-core';
import { hostState, withHostState } from './host-state.js';
import type { ZodCommandDefinition } from './schema.js';
import type { ToolCallResult } from './tool-router.js';

/** How a transport lane handles a command routed to it that declares `task: 'optional' | 'required'`. */
export interface TaskDispatch {
	/**
	 * Handle a single-command call to `command` (`optional` or `required`).
	 *
	 * - Returns `undefined` when the command should run inline (an `optional` command on a request
	 *   that does not declare tasks or on an unidentified HTTP server).
	 * - Returns a `ToolCallResult` when the call is refused as a tool error (unidentified HTTP
	 *   callers on `required`, or a task limit / store failure).
	 * - Throws a lane-specific signal (e.g. `CreateTaskSignal` on the modern lane, or
	 *   `ProtocolError`/`JsonRpcError` `-32021`) when a task is started or the capability is missing.
	 */
	dispatch(
		command: ZodCommandDefinition,
		input: unknown,
		context: CommandContext
	): Promise<ToolCallResult | undefined>;
	/** Error for a `task: 'required'` command named inside `afd-batch` or `afd-pipe`. */
	refuseComposite(tool: 'afd-batch' | 'afd-pipe', commandName: string): CommandError;
}

/** Return a copy of `context` bound to `dispatch`. */
export function bindTaskDispatch<T extends CommandContext>(context: T, dispatch: TaskDispatch): T {
	return withHostState(context, { taskDispatch: dispatch });
}

/** The task dispatch bound to `context`, if any. */
export function taskDispatchOf(context: CommandContext | undefined): TaskDispatch | undefined {
	return hostState(context).taskDispatch;
}

/** Return a copy of `context` without any bound task dispatch (for nested calls inside a task). */
export function withoutTaskDispatch<T extends CommandContext>(context: T): T {
	if (!hostState(context).taskDispatch) return context;
	return withHostState(context, { taskDispatch: undefined });
}
