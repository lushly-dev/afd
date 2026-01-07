/**
 * @fileoverview Bootstrap commands registry
 * 
 * Provides a function to get all bootstrap commands for an AFD server.
 */

import type { CommandDefinition } from '@lushly-dev/afd-core';
import { createAfdHelpCommand } from './afd-help.js';
import { createAfdDocsCommand } from './afd-docs.js';
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
	}
): CommandDefinition[] {
	return [
		createAfdHelpCommand(getCommands) as unknown as CommandDefinition,
		createAfdDocsCommand(getCommands) as unknown as CommandDefinition,
		createAfdSchemaCommand(getCommands, options?.getJsonSchema) as unknown as CommandDefinition,
	];
}
