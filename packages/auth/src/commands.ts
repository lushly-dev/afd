/**
 * @fileoverview AFD command wrappers for auth operations
 *
 * Requires optional peer dependencies: @lushly-dev/afd-server, zod
 */

import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import { type AuthCommandsOptions, createAuthMutationCommands } from './mutation-commands.js';
import { createAuthSessionGetCommand } from './session-get-command.js';
import type { AuthAdapter } from './types.js';

export { type AuthCommandsOptions, createAuthMutationCommands } from './mutation-commands.js';
export { createAuthSessionGetCommand } from './session-get-command.js';

/**
 * Create AFD command definitions for auth operations.
 *
 * Returns ZodCommandDefinition[] that can be passed directly to `createMcpServer`.
 * Requires `@lushly-dev/afd-server` and `zod` as peer dependencies.
 */
export function createAuthCommands(
	adapter: AuthAdapter,
	options: AuthCommandsOptions = {}
): ZodCommandDefinition[] {
	return [...createAuthMutationCommands(adapter, options), createAuthSessionGetCommand(adapter)];
}
