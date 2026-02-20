/**
 * @fileoverview Export all todo commands
 */

export { type ClearResult, clearCompleted } from './clear.js';
export { createTodo } from './create.js';
// Batch operations
export { type BatchCreateResult, createBatch, type FailedItem } from './create-batch.js';
export { type DeleteResult, deleteTodo } from './delete.js';
export { type BatchDeleteResult, deleteBatch, type FailedDelete } from './delete-batch.js';
export { getTodo } from './get.js';
export { type ListResult, listTodos } from './list.js';
export { getStats } from './stats.js';
export { toggleTodo } from './toggle.js';
export { type BatchToggleResult, type FailedToggle, toggleBatch } from './toggle-batch.js';
export { updateTodo } from './update.js';

import type { ZodCommandDefinition } from '@lushly-dev/afd-server';
import { clearCompleted } from './clear.js';
// Re-export as array for convenience
import { createTodo } from './create.js';
import { createBatch } from './create-batch.js';
import { deleteTodo } from './delete.js';
import { deleteBatch } from './delete-batch.js';
import { getTodo } from './get.js';
import { listTodos } from './list.js';
import { getStats } from './stats.js';
import { toggleTodo } from './toggle.js';
import { toggleBatch } from './toggle-batch.js';
import { updateTodo } from './update.js';

/**
 * All todo commands as an array.
 * Cast to unknown first to satisfy TypeScript's strict type checking
 * when mixing different generic command types.
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
	// Batch operations
	createBatch,
	deleteBatch,
	toggleBatch,
] as unknown as ZodCommandDefinition[];
