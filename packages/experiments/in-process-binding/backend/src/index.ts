/**
 * @fileoverview Library entry point
 *
 * Import from this module to get direct access to the registry
 * without starting a server. This enables zero-overhead command execution.
 *
 * @example
 * ```typescript
 * import { registry } from '@afd/experiment-in-process';
 *
 * // Direct execution - ~0.1-1ms vs ~10-100ms for MCP
 * const result = await registry.execute('todo-create', { title: 'Fast!' });
 * ```
 */

// Export individual commands for type inference
export {
	allCommands,
	type ClearResult,
	clearCompleted,
	createTodo,
	type DeleteResult,
	deleteTodo,
	getStats,
	getTodo,
	type ListResult,
	listTodos,
	toggleTodo,
	updateTodo,
} from './commands/index.js';
// Export the registry for direct command execution
export { CommandRegistry, registry } from './registry.js';
// Export store for testing
export { store, TodoStore } from './store/index.js';
// Export types
export type { Priority, Todo, TodoFilter, TodoStats } from './types.js';
