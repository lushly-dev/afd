/**
 * @fileoverview Shared helpers for tool listing, tool routing, discovery and
 * execution: group/action derivation for the grouped strategy and context scoping.
 */

import type { CommandContext, CommandError } from '@lushly-dev/afd-core';
import { findSimilarTools, truncateName } from '@lushly-dev/afd-core';
import { isCommandAllowed } from './command-allow.js';
import type { ZodCommandDefinition } from './schema.js';

/** Derives a grouped-strategy tool name from a command (`McpServerOptions.groupByFn`). */
export type GroupByFn = (command: ZodCommandDefinition) => string | undefined;

/** Minimal command shape needed for context checks. */
type Contextual = Pick<ZodCommandDefinition, 'contexts'>;

/**
 * Default group (and discovery category) of a command: its `category`, else the
 * first kebab-case segment of its name, else `'general'`.
 */
export function defaultCommandGroup(
	command: Pick<ZodCommandDefinition, 'name' | 'category'>
): string {
	return command.category || command.name.split('-')[0] || 'general';
}

/**
 * Grouped-strategy tool name of a command. Uses `groupByFn` when given (falling
 * back to `'general'` when it returns nothing), otherwise {@link defaultCommandGroup}.
 */
export function commandGroup(command: ZodCommandDefinition, groupByFn?: GroupByFn): string {
	return groupByFn ? groupByFn(command) || 'general' : defaultCommandGroup(command);
}

/**
 * Grouped-strategy action of a command: the name without its first segment
 * (`todo-create-batch` → `create-batch`), or the whole name if it has one segment.
 */
export function commandAction(command: Pick<ZodCommandDefinition, 'name'>): string {
	const parts = command.name.split('-');
	return parts.length > 1 ? parts.slice(1).join('-') : command.name;
}

/**
 * Whether a command is visible and callable in the active context. Everything is
 * accessible when no context is active; commands without `contexts` are universal.
 */
export function isAccessibleInContext(
	command: Contextual,
	activeContext: string | null | undefined
): boolean {
	if (!activeContext) return true;
	if (!command.contexts?.length) return true;
	return command.contexts.includes(activeContext);
}

/** Commands accessible in the active context (all of them when none is active). */
export function filterByContext<T extends Contextual>(
	commands: T[],
	activeContext: string | null | undefined
): T[] {
	if (!activeContext) return commands;
	return commands.filter((command) => isAccessibleInContext(command, activeContext));
}

/**
 * The meta-tools the tool router serves, as core's `AFD_META_TOOL_NAMES` lists them (a test keeps
 * the two equal). Written out here because the engine, which `/direct` and Loam's first paint
 * bundle, reads them, and importing core's `builtin-tools` would split it into a chunk of its own.
 */
export const ROUTED_META_TOOL_NAMES: readonly string[] = [
	'afd-call',
	'afd-batch',
	'afd-pipe',
	'afd-discover',
	'afd-detail',
];

/**
 * What a surface serves, for {@link canCall}: whether it routes the meta-tools, and the command
 * it registers and exposes to the caller's interface under a name.
 */
export interface CallableSurface {
	/** Whether the surface serves the meta-tools (`afd-discover`, `afd-call` and the rest). */
	metaTools: boolean;
	/** The command registered and exposed under `name` on this surface, if any. */
	command(name: string): Contextual | undefined;
	/**
	 * Whether the caller of `context` is shown `name` under MCP authorization (M6). Absent, every
	 * command is shown. The callers that hold the request's scope view pass it in, so this module,
	 * which `/direct` and the engine bundle, never loads `scope-view`.
	 */
	shown?(name: string, context: CommandContext | undefined): boolean;
}

/**
 * Whether the caller of `context` can call `name` on `surface` (`spec/recovery.md`, rule 2 and
 * "Engine errors"): served (a meta-tool on a surface that routes them) or registered and exposed,
 * admitted by the call's `allow` list, shown to the caller under MCP authorization, and allowed in
 * the active context. A refusal names a command, in its suggestion and in a `call` recovery,
 * only when this holds, so the two never disagree. A meta-tool is called as its own tool, and
 * the context and authorization checks do not apply to it.
 */
export function canCall(
	surface: CallableSurface,
	name: string,
	context: CommandContext | undefined,
	activeContext: string | null | undefined
): boolean {
	if (!isCommandAllowed(context, name)) return false;
	if (ROUTED_META_TOOL_NAMES.includes(name)) return surface.metaTools;
	const command = surface.command(name);
	if (!command) return false;
	if (surface.shown && !surface.shown(name, context)) return false;
	return isAccessibleInContext(command, activeContext);
}

/** How many close matches a `COMMAND_NOT_FOUND` suggestion names at most. */
const MAX_NOT_FOUND_MATCHES = 3;

/** The commands a `COMMAND_NOT_FOUND` suggestion and recovery may point to, in order. */
const NOT_FOUND_NEXT = ['afd-discover', 'afd-help'] as const;

/** The command a `COMMAND_NOT_FOUND` names next: the first of {@link NOT_FOUND_NEXT} `can` admits. */
export type NotFoundNext = (typeof NOT_FOUND_NEXT)[number];

/** The first command a not-found answer may point to, of those `can` admits; `null` for none. */
export function notFoundNext(can: (name: string) => boolean): NotFoundNext | null {
	return NOT_FOUND_NEXT.find((name) => can(name)) ?? null;
}

/**
 * Recovery guidance for an unknown command name: at most
 * {@link MAX_NOT_FOUND_MATCHES} close matches (bounded fuzzy matching; none for
 * very long names) and a pointer to `afd-discover` or `afd-help`. It never lists every
 * command, which in lazy mode would load the whole surface into the agent's
 * context on a single typo.
 *
 * @param commandName - The unknown name (untrusted; never echoed)
 * @param commandNames - Names the caller may call
 * @param next - The command the caller can call to list the others ({@link notFoundNext}). With
 *   `null` the suggestion ends as Rust's and C++'s do (`spec/error-codes.md`, "Suggestions name
 *   only tools the host provides")
 */
export function notFoundSuggestion(
	commandName: string,
	commandNames: string[],
	next: NotFoundNext | null = 'afd-discover'
): string {
	const pointer = next
		? `Use ${next} to list all commands.`
		: 'Check the command name against the available commands.';
	const [best, ...others] = findSimilarTools(commandName, commandNames, MAX_NOT_FOUND_MATCHES);
	if (best === undefined) return pointer;
	const alsoClose = others.length
		? ` Other close matches: ${others.map((name) => `'${name}'`).join(', ')}.`
		: '';
	return `Did you mean '${best}'?${alsoClose} ${pointer}`;
}

/**
 * The `COMMAND_NOT_FOUND` error for an unknown name at lookup (a call, `afd-call`, a batch item or
 * a pipeline step). Its suggestion and its recovery name the same command, `next`, or none
 * (`spec/recovery.md`, "Engine errors").
 */
export function notFoundError(
	commandName: string,
	commandNames: string[],
	next: NotFoundNext | null
): CommandError {
	return {
		code: 'COMMAND_NOT_FOUND',
		message: `Command '${truncateName(commandName)}' not found`,
		suggestion: notFoundSuggestion(commandName, commandNames, next),
		...(next && { recovery: { kind: 'call', command: next } }),
	};
}

/**
 * The `COMMAND_NOT_IN_CONTEXT` error for a command outside the active context.
 *
 * @param belongsTo - The command's contexts
 * @param can - Whether the caller can call a command ({@link canCall}). When it can call
 *   `afd-context-list`, the suggestion and the recovery name it (and the suggestion names
 *   `afd-context-enter` too, when the caller can call that); otherwise the suggestion names the
 *   command's contexts, as Rust's and C++'s do, and the error carries no recovery. Default: every
 *   command can be called
 */
export function notInContextError(
	commandName: string,
	activeContext: string,
	belongsTo: readonly string[] = [],
	can: (name: string) => boolean = () => true
): CommandError {
	const error = {
		code: 'COMMAND_NOT_IN_CONTEXT',
		message: `Command '${commandName}' is not available in context '${activeContext}'`,
	};
	const list = 'afd-context-list';
	if (!can(list)) {
		return {
			...error,
			suggestion: `Switch to a context this command belongs to (${belongsTo.map((name) => `'${name}'`).join(', ')}), or call it with no active context.`,
		};
	}
	return {
		...error,
		suggestion: `Use ${list} to see available contexts${can('afd-context-enter') ? ', or afd-context-enter to switch' : ''}.`,
		recovery: { kind: 'call', command: list },
	};
}
