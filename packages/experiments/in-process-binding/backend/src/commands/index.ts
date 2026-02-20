/**
 * @fileoverview Export all todo commands
 */

export { type ClearResult, clearCompleted } from './clear.js';
export { createTodo } from './create.js';
export { type DeleteResult, deleteTodo } from './delete.js';
export { getTodo } from './get.js';
export { type ListResult, listTodos } from './list.js';
export { getStats } from './stats.js';
export { toggleTodo } from './toggle.js';
export { updateTodo } from './update.js';

import type { ZodCommandDefinition } from '@lushly-dev/afd-server';
import { clearCompleted } from './clear.js';
// Re-export as array for convenience
import { createTodo } from './create.js';
import { deleteTodo } from './delete.js';
import { getTodo } from './get.js';
import { listTodos } from './list.js';
import { getStats } from './stats.js';
import { toggleTodo } from './toggle.js';
import { updateTodo } from './update.js';

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
