/**
 * @fileoverview Per-request MCP Tasks dispatch seam (`spec/command-metadata.md`, "Tasks").
 *
 * The MCP lane binds a {@link TaskDispatch} to each `tools/call` context under a module-private
 * symbol (like `scope-view.ts` and `confirmations.ts`), so `createContext` and tool arguments can
 * never forge one. This module imports nothing at run time, so the tool router — which `/direct`
 * also bundles — reads it without pulling Node.js built-ins or the task runtime into `/direct`.
 */

import type { CommandContext, CommandError } from '@lushly-dev/afd-core';
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

const DISPATCH = Symbol('afd.taskDispatch');

type TaskDispatchContext = CommandContext & { [DISPATCH]?: TaskDispatch };

/** Return a copy of `context` bound to `dispatch`. */
export function bindTaskDispatch<T extends CommandContext>(context: T, dispatch: TaskDispatch): T {
	return { ...context, [DISPATCH]: dispatch };
}

/** The task dispatch bound to `context`, if any. */
export function taskDispatchOf(context: CommandContext | undefined): TaskDispatch | undefined {
	return (context as TaskDispatchContext | undefined)?.[DISPATCH];
}

/** Return a copy of `context` without any bound task dispatch (for nested calls inside a task). */
export function withoutTaskDispatch<T extends CommandContext>(context: T): T {
	if (!(context as TaskDispatchContext)[DISPATCH]) return context;
	const copy = { ...context } as TaskDispatchContext;
	delete copy[DISPATCH];
	return copy as T;
}
