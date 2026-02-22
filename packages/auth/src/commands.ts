/**
 * @fileoverview AFD command wrappers for auth operations
 *
 * Requires optional peer dependencies: @lushly-dev/afd-server, zod
 */

import type { CommandDefinition } from '@lushly-dev/afd-core';
import { failure, success } from '@lushly-dev/afd-core';
import { defineCommand } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { AuthAdapterError } from './errors.js';
import type { AuthAdapter } from './types.js';

/**
 * Create AFD command definitions for auth operations.
 *
 * Returns standard CommandDefinition[] that can be registered with a server.
 * Requires `@lushly-dev/afd-server` and `zod` as peer dependencies.
 */
export function createAuthCommands(adapter: AuthAdapter): CommandDefinition[] {
	const signIn = defineCommand({
		name: 'auth-sign-in',
		description: 'Sign in with credentials or OAuth provider',
		category: 'auth',
		tags: ['auth', 'session'],
		mutation: true,
		input: z.discriminatedUnion('method', [
			z.object({
				method: z.literal('credentials'),
				email: z.string().email(),
				password: z.string().optional(),
			}),
			z.object({
				method: z.literal('oauth'),
				provider: z.string(),
				scopes: z.array(z.string()).optional(),
				redirectTo: z.string().optional(),
			}),
		]),
		async handler(input) {
			try {
				await adapter.signIn(input);
				const session = adapter.getSession();
				return success(session, {
					reasoning: `Signed in via ${input.method}`,
				});
			} catch (error) {
				if (error instanceof AuthAdapterError) {
					return failure({
						code: error.code,
						message: error.message,
						suggestion: error.suggestion,
						retryable: error.retryable,
					});
				}
				throw error;
			}
		},
	});

	const signOut = defineCommand({
		name: 'auth-sign-out',
		description: 'Sign out of the current session',
		category: 'auth',
		tags: ['auth', 'session'],
		mutation: true,
		destructive: true,
		confirmPrompt: 'Sign out of your account?',
		input: z.object({}),
		async handler() {
			try {
				await adapter.signOut();
				return success(null, {
					reasoning: 'Successfully signed out',
				});
			} catch (error) {
				if (error instanceof AuthAdapterError) {
					return failure({
						code: error.code,
						message: error.message,
						suggestion: error.suggestion,
						retryable: error.retryable,
					});
				}
				throw error;
			}
		},
	});

	const sessionGet = defineCommand({
		name: 'auth-session-get',
		description: 'Get the current authentication session state',
		category: 'auth',
		tags: ['auth', 'session'],
		mutation: false,
		input: z.object({}),
		async handler() {
			const session = adapter.getSession();
			return success(session, {
				reasoning: `Current auth status: ${session.status}`,
			});
		},
	});

	// Convert to CommandDefinition and set expose
	const signInDef = signIn.toCommandDefinition();
	signInDef.expose = { palette: true, agent: true, cli: true, mcp: false };

	const signOutDef = signOut.toCommandDefinition();
	signOutDef.expose = { palette: true, agent: true, cli: true, mcp: false };

	const sessionGetDef = sessionGet.toCommandDefinition();
	sessionGetDef.expose = { palette: true, agent: true, cli: true, mcp: true };

	return [signInDef, signOutDef, sessionGetDef] as CommandDefinition[];
}
