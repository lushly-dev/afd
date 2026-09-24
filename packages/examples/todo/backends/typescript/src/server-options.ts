/**
 * @fileoverview MCP server options for the todo backend, shared by
 * `server.ts` and the tests.
 */

import { createLoggingMiddleware, type McpHandlerOptions } from '@lushly-dev/afd-server';
import { allCommands } from './commands/index.js';

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * Ports of the dev frontends in the todo README: `pnpm dev:web` (`npx serve`,
 * port 3000) and the Vite dev servers of both frontends (5173, and 5174 when
 * both run at once).
 */
export const DEV_FRONTEND_PORTS = [3000, 5173, 5174] as const;

/** The dev frontends' origins, on both loopback names. */
export function devFrontendOrigins(): string[] {
	return DEV_FRONTEND_PORTS.flatMap((port) => [
		`http://localhost:${port}`,
		`http://127.0.0.1:${port}`,
	]);
}

/**
 * Browser origins allowed to call the server: the dev frontends plus the exact
 * origins in `ALLOWED_ORIGINS` (comma-separated). `*` and `null` are refused.
 */
export function resolveAllowedOrigins(env: Env): string[] {
	const extra = (env.ALLOWED_ORIGINS ?? '')
		.split(',')
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0);
	for (const origin of extra) {
		let valid = false;
		try {
			const url = new URL(origin);
			valid = (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin;
		} catch {}
		if (!valid) {
			throw new Error(
				`ALLOWED_ORIGINS entry "${origin}" must be an exact http(s) origin such as http://localhost:8080 ("*" and "null" are not allowed)`
			);
		}
	}
	return [...new Set([...devFrontendOrigins(), ...extra])];
}

/**
 * Options for `createMcpServer` (add `transport`) or `createMcpHandler`.
 *
 * Dev mode (`NODE_ENV=development`) enables verbose errors and stack traces and
 * accepts any browser origin. Otherwise only same-origin requests and the
 * origins from {@link resolveAllowedOrigins} are accepted.
 */
export function createTodoServerOptions(env: Env): McpHandlerOptions {
	const devMode = env.NODE_ENV === 'development';
	const logLevel = env.LOG_LEVEL ?? 'info';

	return {
		name: 'todo-app',
		version: '1.0.0',
		commands: allCommands,
		// Adds the afd-help, afd-docs and afd-schema bootstrap tools
		bootstrap: true,
		port: Number.parseInt(env.PORT ?? '3100', 10),
		host: env.HOST ?? 'localhost',
		devMode,
		// Send CORS headers so the browser frontends can read responses. This does
		// not widen which origins are accepted: that is allowedOrigins.
		cors: true,
		allowedOrigins: resolveAllowedOrigins(env),

		// Add logging middleware - verbose in dev mode
		middleware:
			devMode || logLevel === 'debug'
				? [createLoggingMiddleware({ logInput: true, logResult: true })]
				: [createLoggingMiddleware()],

		// Log command execution
		onCommand(command, input, result) {
			if (logLevel === 'debug') {
				console.error(`[Command] ${command}:`, { input, result });
			}
		},

		// Log errors
		onError(error) {
			console.error('[Error]', error);
		},
	};
}
