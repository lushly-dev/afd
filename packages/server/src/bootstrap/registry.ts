/**
 * @fileoverview Bootstrap commands registry
 *
 * Provides a function to get all bootstrap commands for an AFD server.
 */

import { z } from 'zod';
import { defineCommand, type ZodCommandDefinition } from '../schema.js';
import type { ContextConfig } from '../server-types.js';
import {
	type ContextState,
	createAfdContextEnterCommand,
	createAfdContextExitCommand,
	createAfdContextListCommand,
} from './afd-context.js';
import { createAfdDocsCommand } from './afd-docs.js';
import { createAfdHelpCommand } from './afd-help.js';
import { createAfdSchemaCommand } from './afd-schema.js';
import type { DescribedCommand, GetDescribedCommands } from './described-command.js';

/** Names of the discovery bootstrap tools registered by `createMcpServer({ bootstrap: true })`. */
export const BOOTSTRAP_COMMAND_NAMES: readonly string[] = ['afd-help', 'afd-docs', 'afd-schema'];

/** Names of the context tools registered when `createMcpServer({ contexts })` is set. */
export const CONTEXT_COMMAND_NAMES: readonly string[] = [
	'afd-context-list',
	'afd-context-enter',
	'afd-context-exit',
];

/**
 * Get all bootstrap commands for an AFD server: afd-help, afd-docs and afd-schema,
 * plus the afd-context-* commands when `contexts` and `contextState` are given.
 *
 * Every returned command is a `ZodCommandDefinition` with `expose: { mcp: true }`.
 * The discovery tools describe only the MCP-exposed commands that `getCommands`
 * returns. With `createMcpServer`, prefer the `bootstrap: true` option, which also
 * lists the built-in and context commands.
 *
 * @param getCommands - Function to get the commands to describe
 * @param options - Optional configuration
 * @returns Array of bootstrap command definitions
 */
export function getBootstrapCommands(
	getCommands: GetDescribedCommands,
	options?: {
		getJsonSchema?: (cmd: DescribedCommand) => Record<string, unknown>;
		contexts?: ContextConfig[];
		contextState?: ContextState;
	}
): ZodCommandDefinition[] {
	const cmds: ZodCommandDefinition[] = [
		createAfdHelpCommand(getCommands),
		createAfdDocsCommand(getCommands),
		createAfdSchemaCommand(getCommands, options?.getJsonSchema),
	];

	// Add context commands when contexts are configured
	if (options?.contexts?.length && options.contextState) {
		const getContexts = () => options.contexts ?? [];
		const contextState = options.contextState;
		cmds.push(
			defineCommand({
				...createAfdContextListCommand(getContexts, contextState),
				input: z.object({}),
				expose: { mcp: true },
			}),
			defineCommand({
				...createAfdContextEnterCommand(getContexts, contextState),
				input: z.object({ context: z.string().min(1).describe('Context name to enter') }),
				expose: { mcp: true },
			}),
			defineCommand({
				...createAfdContextExitCommand(contextState),
				input: z.object({}),
				expose: { mcp: true },
			})
		);
	}

	return cmds;
}
