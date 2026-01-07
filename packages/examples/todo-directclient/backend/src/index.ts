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

// Export the registry for direct command execution
export { registry, CommandRegistry } from './registry.js';

// Export individual commands for type inference
export {
	createTodo,
	listTodos,
	getTodo,
	updateTodo,
	toggleTodo,
	deleteTodo,
	clearCompleted,
	getStats,
	allCommands,
	type ListResult,
	type DeleteResult,
	type ClearResult,
} from './commands/index.js';

// Export types
export type { Todo, TodoStats, TodoFilter, Priority } from './types.js';

// Export store for testing
export { store, TodoStore } from './store/index.js';
