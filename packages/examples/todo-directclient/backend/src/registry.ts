/**
 * @fileoverview Command Registry - Exportable without starting a server
 *
 * This is the KEY INNOVATION for in-process binding:
 * - Registry can be imported directly by co-located agents
 * - No server startup required for direct execution
 * - Same command definitions power both the MCP server and direct calls
 *
 * `createDirectRegistry` runs every call through the same engine as the MCP
 * server: Zod input validation (so `{ "title": { "nested": true } }` is
 * rejected before it reaches the store), middleware, error sanitization, and
 * the `expose.agent` check. Do not hand-roll a registry that calls
 * `command.handler(input)` directly; it skips all of that.
 */

import { createDirectRegistry, type DirectCommandRegistry } from '@lushly-dev/afd-server';
import { allCommands } from './commands/index.js';

/**
 * The command registry type, compatible with `DirectClient`.
 */
export type CommandRegistry = DirectCommandRegistry;

/**
 * Singleton registry instance for the in-app agent.
 * Import this for direct command execution.
 *
 * @example
 * ```typescript
 * import { registry } from '@afd/example-todo-directclient/registry';
 *
 * // Direct execution - no server, no transport overhead, still validated
 * const result = await registry.execute('todo-create', { title: 'Fast!' });
 * ```
 */
export const registry: CommandRegistry = createDirectRegistry(allCommands, {
	interface: 'agent',
});
