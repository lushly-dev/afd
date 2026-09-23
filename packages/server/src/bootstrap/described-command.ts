/**
 * @fileoverview The command shape the bootstrap tools describe.
 */

import type {
	CommandContext,
	CommandExample,
	CommandParameter,
	ExposeOptions,
	JsonSchema,
} from '@lushly-dev/afd-core';
import { isMcpExposed } from '@lushly-dev/afd-core';

/**
 * What afd-help, afd-docs and afd-schema read from a command. Both core
 * `CommandDefinition`s (with `parameters`) and `ZodCommandDefinition`s (with
 * `jsonSchema`) satisfy it.
 */
export interface DescribedCommand {
	name: string;
	description: string;
	category?: string;
	tags?: string[];
	mutation?: boolean;
	requires?: string[];
	examples?: CommandExample[];
	expose?: ExposeOptions;
	parameters?: CommandParameter[];
	jsonSchema?: JsonSchema;
}

/**
 * Supplies the commands a bootstrap tool describes. Called on every invocation with
 * that invocation's command context, so callers can scope the list per request.
 */
export type GetDescribedCommands = (context?: CommandContext) => readonly DescribedCommand[];

/**
 * The commands a bootstrap tool may describe: only MCP-exposed ones, like every
 * other discovery surface (`tools/list`, afd-discover, afd-detail).
 */
export function describableCommands(
	getCommands: GetDescribedCommands,
	context?: CommandContext
): DescribedCommand[] {
	return getCommands(context).filter((command) => isMcpExposed(command));
}
