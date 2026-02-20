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

// Batch operations
export { createBatch, type BatchCreateResult, type FailedItem } from './create-batch.js';
export { deleteBatch, type BatchDeleteResult, type FailedDelete } from './delete-batch.js';
export { toggleBatch, type BatchToggleResult, type FailedToggle } from './toggle-batch.js';

// Re-export as array for convenience
import { createTodo } from './create.js';
import { listTodos } from './list.js';
import { getTodo } from './get.js';
import { updateTodo } from './update.js';
import { toggleTodo } from './toggle.js';
import { deleteTodo } from './delete.js';
import { clearCompleted } from './clear.js';
import { getStats } from './stats.js';
import { createBatch } from './create-batch.js';
import { deleteBatch } from './delete-batch.js';
import { toggleBatch } from './toggle-batch.js';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server';

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
