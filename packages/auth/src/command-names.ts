/**
 * @fileoverview Names of the built-in auth commands
 *
 * Kept apart from commands.ts so the middleware can use them without pulling
 * in the optional `@lushly-dev/afd-server` and `zod` peer dependencies.
 */

/**
 * The commands created by `createAuthCommands`. `createAuthMiddleware` always
 * lets them through, so a signed-out caller can sign in, sign out and read
 * the session state.
 */
export const AUTH_COMMAND_NAMES = ['auth-sign-in', 'auth-sign-out', 'auth-session-get'] as const;
