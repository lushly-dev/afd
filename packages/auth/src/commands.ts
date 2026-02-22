/**
 * @fileoverview AFD command wrappers for auth operations
 *
 * Requires optional peer dependencies: @lushly-dev/afd-server, zod
 */

import { failure, success } from '@lushly-dev/afd-core';
import { type ZodCommandDefinition, defineCommand } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { AuthAdapterError } from './errors.js';
import type { AuthAdapter } from './types.js';

/**
 * Create AFD command definitions for auth operations.
 *
 * Returns ZodCommandDefinition[] that can be passed directly to `createMcpServer`.
 * Requires `@lushly-dev/afd-server` and `zod` as peer dependencies.
 */
export function createAuthCommands(adapter: AuthAdapter): ZodCommandDefinition[] {
	const signIn = defineCommand({
		name: 'auth-sign-in',
		description: 'Sign in with credentials or OAuth provider',
		category: 'auth',
		tags: ['auth', 'session'],
		mutation: true,
		expose: { palette: true, agent: true, cli: true, mcp: false },
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
		expose: { palette: true, agent: true, cli: true, mcp: false },
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
		expose: { palette: true, agent: true, cli: true, mcp: true },
		input: z.object({}),
		async handler() {
			const session = adapter.getSession();
			return success(session, {
				reasoning: `Current auth status: ${session.status}`,
			});
		},
	});

	// Cast needed for heterogeneous generic command arrays (same pattern as todo example)
	return [signIn, signOut, sessionGet] as unknown as ZodCommandDefinition[];
}
