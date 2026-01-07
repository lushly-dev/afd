/**
 * @fileoverview Export all todo commands
 */

export { createTodo } from './create.js';
export { listTodos, type ListResult } from './list.js';
export { getTodo } from './get.js';
export { updateTodo } from './update.js';
export { toggleTodo } from './toggle.js';
export { deleteTodo, type DeleteResult } from './delete.js';
export { clearCompleted, type ClearResult } from './clear.js';
export { getStats } from './stats.js';

// Re-export as array for convenience
import { createTodo } from './create.js';
import { listTodos } from './list.js';
import { getTodo } from './get.js';
import { updateTodo } from './update.js';
import { toggleTodo } from './toggle.js';
import { deleteTodo } from './delete.js';
import { clearCompleted } from './clear.js';
import { getStats } from './stats.js';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server';

/**
 * All todo commands as an array.
 */
export const allCommands = [
	createTodo,
	listTodos,
	getTodo,
	updateTodo,
	toggleTodo,
	deleteTodo,
	clearCompleted,
	getStats,
] as unknown as ZodCommandDefinition[];
