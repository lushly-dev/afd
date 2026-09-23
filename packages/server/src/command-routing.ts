/**
 * @fileoverview Shared helpers for tool listing, tool routing, discovery and
 * execution: group/action derivation for the grouped strategy and context scoping.
 */

import type { CommandError } from '@lushly-dev/afd-core';
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

/** The `COMMAND_NOT_IN_CONTEXT` error for a command outside the active context. */
export function notInContextError(commandName: string, activeContext: string): CommandError {
	return {
		code: 'COMMAND_NOT_IN_CONTEXT',
		message: `Command '${commandName}' is not available in context '${activeContext}'`,
		suggestion: 'Use afd-context-list to see available contexts, or afd-context-enter to switch.',
	};
}
