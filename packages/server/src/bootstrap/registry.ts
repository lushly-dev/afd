/**
 * @fileoverview Bootstrap commands registry
 *
 * Provides a function to get all bootstrap commands for an AFD server.
 */

import type { CommandDefinition } from '@lushly-dev/afd-core';
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

/**
 * Get all bootstrap commands for an AFD server.
 *
 * @param getCommands - Function to get all user-defined commands
 * @param options - Optional configuration
 * @returns Array of bootstrap command definitions
 */
export function getBootstrapCommands(
	getCommands: () => CommandDefinition[],
	options?: {
		getJsonSchema?: (cmd: CommandDefinition) => Record<string, unknown>;
		contexts?: ContextConfig[];
		contextState?: ContextState;
	}
): CommandDefinition[] {
	// SAFETY: Each creator returns CommandDefinition<SpecificInput, SpecificOutput>, which is structurally
	// compatible with CommandDefinition but TypeScript's invariant generics require the double cast.
	const cmds: CommandDefinition[] = [
		createAfdHelpCommand(getCommands) as unknown as CommandDefinition,
		createAfdDocsCommand(getCommands) as unknown as CommandDefinition,
		createAfdSchemaCommand(getCommands, options?.getJsonSchema) as unknown as CommandDefinition,
	];

	// Add context commands when contexts are configured
	if (options?.contexts?.length && options.contextState) {
		const getContexts = () => options.contexts ?? [];
		cmds.push(
			createAfdContextListCommand(
				getContexts,
				options.contextState
			) as unknown as CommandDefinition,
			createAfdContextEnterCommand(
				getContexts,
				options.contextState
			) as unknown as CommandDefinition,
			createAfdContextExitCommand(options.contextState) as unknown as CommandDefinition
		);
	}

	return cmds;
}
