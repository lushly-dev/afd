/**
 * @fileoverview The registry the copilot calls through DirectClient: the main to-do example's
 * commands and middleware, run in this process.
 *
 * `createDirectRegistry` runs every call through the same engine as the MCP server: Zod input
 * validation, the middleware (approvals, the change history, logging), error sanitization and
 * the `expose.agent` check. `createDirectToolSurface` adds the server's own tool list, so
 * `listTools()` returns what an MCP server with these commands lists. Do not hand-roll a registry
 * that calls `command.handler(input)` directly: it skips all of that.
 */

import { allCommands } from '@afd/example-todo-ts/commands';
import {
	createTodoMiddleware,
	type Env,
	type TodoServerDeps,
} from '@afd/example-todo-ts/server-options';
import {
	createDirectRegistry,
	createDirectToolSurface,
	type DirectCommandRegistry,
} from '@lushly-dev/afd-server';

/**
 * The copilot's registry. The middleware is the MCP server's (`createTodoMiddleware`), so a call
 * from the copilot is held, journaled and recorded exactly as the same call over MCP would be.
 *
 * @example
 * ```typescript
 * const client = createDirectClient(createCopilotRegistry(process.env), {
 *   actor: { kind: 'agent' },
 *   allow: (name) => name === 'todo-list',
 * });
 * await client.call('todo-list', {});
 * ```
 */
export function createCopilotRegistry(env: Env, deps: TodoServerDeps = {}): DirectCommandRegistry {
	return createDirectRegistry(allCommands, {
		middleware: createTodoMiddleware(env, deps),
		tools: createDirectToolSurface(),
		devMode: env.NODE_ENV === 'development',
	});
}
