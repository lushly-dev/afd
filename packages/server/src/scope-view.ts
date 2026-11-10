/**
 * @fileoverview A request's scope view on its command context (`spec/authorization.md`, M6).
 *
 * The HTTP layer of a server with MCP authorization binds each admitted request's view
 * (`mcp-auth-view.ts`) under a module-private symbol, so every copy the router, the engine and the
 * meta-tools make carries it, and a nested call that passes its context on is decided too. Tool
 * arguments and `createContext` values are JSON and string keys, so they cannot carry one. This
 * module imports nothing at run time, so the engine and router, which `/direct` also bundles,
 * read a view without bringing the authorization layer: nothing binds one in process.
 */

import type { CommandContext, CommandError } from '@lushly-dev/afd-core';
import type { Credentials } from './mcp-auth-rules.js';
import type { RequestDecision } from './mcp-auth-scopes.js';

/** What one request may do: its credentials, the commands that exist for it, its decisions. */
export interface ScopeView {
	readonly credentials: Credentials;
	/** Whether the listings are filtered by scope (`filterToolsByScope`). */
	readonly filtered: boolean;
	/** Whether a registered command exists for this caller (M6, "Hidden commands"). */
	known(name: string): boolean;
	/** Whether this caller is shown a command on the listings and in suggestions. */
	shown(name: string): boolean;
	/** The decision on a `tools/call` of `tool` with `args`, over every call it names. */
	decideCall(tool: string, args: unknown): RequestDecision;
	/** The decision on calls of these commands, as `afd-call` and `afd-batch` name them. */
	decideCommands(calls: readonly { command: string; input: unknown }[]): RequestDecision;
	/** The decision on a request that names no command: the required scopes. */
	decideRequest(): RequestDecision;
	/** The decision on one command about to run, on its validated input (resolver only). */
	decideExecution(command: string, input: unknown): RequestDecision;
	/** The `INSUFFICIENT_SCOPE` failure naming `missing`. */
	insufficientScope(missing: readonly string[]): CommandError;
}

const VIEW = Symbol('afd.scopeView');
type ViewContext = CommandContext & { [VIEW]?: ScopeView };
/** `context` carrying `view`, or `context` itself without one. */
export function bindScopeView<T extends CommandContext>(
	context: T,
	view: ScopeView | undefined
): T {
	return view ? { ...context, [VIEW]: view } : context;
}

/** The scope view bound to `context`, if any. */
export function scopeViewOf(context: CommandContext | undefined): ScopeView | undefined {
	return (context as ViewContext | undefined)?.[VIEW];
}

/** `items` that exist for the caller of `context` (all of them without a view). */
export function knownOnly<T extends { name: string }>(items: T[], context?: CommandContext): T[] {
	const view = scopeViewOf(context);
	return view ? items.filter((item) => view.known(item.name)) : items;
}

/** `items` the caller of `context` is shown (all of them without a view). */
export function shownOnly<T extends { name: string }>(items: T[], context?: CommandContext): T[] {
	const view = scopeViewOf(context);
	return view ? items.filter((item) => view.shown(item.name)) : items;
}

/**
 * Commands as the caller of `context` may see them listed: those it is shown, each command's
 * `requires` naming only commands that exist for it (M6, "Hidden commands").
 */
export function listedCommands<T extends { name: string; requires?: string[] }>(
	items: T[],
	context?: CommandContext
): T[] {
	const view = scopeViewOf(context);
	if (!view) return items;
	return items
		.filter((item) => view.shown(item.name))
		.map((item) =>
			item.requires?.some((name) => !view.known(name))
				? { ...item, requires: item.requires.filter((name) => view.known(name)) }
				: item
		);
}
