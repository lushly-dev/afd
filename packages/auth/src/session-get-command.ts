/**
 * @fileoverview `auth-session-get`, a module of its own so a host can define it before first paint
 * and load the sign-in commands later.
 *
 * Requires optional peer dependencies: @lushly-dev/afd-server, zod
 */

// The transport-free entry keeps this module free of the MCP SDK and Node builtins.
import {
	defineCommandWithSchema,
	success,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import * as z from 'zod/mini';
import type { AuthAdapter } from './types.js';

const emptyInput = z.object({});

/**
 * Create `auth-session-get`: the read {@link createAuthCommands} includes.
 */
export function createAuthSessionGetCommand(adapter: AuthAdapter): ZodCommandDefinition {
	return defineCommandWithSchema({
		name: 'auth-session-get',
		description: 'Get the current authentication session state',
		category: 'auth',
		tags: ['auth', 'session'],
		mutation: false,
		expose: { palette: true, agent: true, cli: true, mcp: true },
		input: emptyInput,
		jsonSchema: { type: 'object', properties: {} },
		async handler() {
			const session = adapter.getSession();
			return success(session, {
				reasoning: `Current auth status: ${session.status}`,
			});
		},
	}) as unknown as ZodCommandDefinition;
}
