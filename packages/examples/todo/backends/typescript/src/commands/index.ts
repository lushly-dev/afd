/**
 * @fileoverview Export all todo commands
 */

export { createTodo } from './create.js';
export { listTodos, type ListResult } from './list.js';
export { getTodo } from './get.js';
export { updateTodo } from './update.js';
export { toggleTodo } from './toggle.js';
export { completeTodo } from './complete.js';
export { uncompleteTodo } from './uncomplete.js';
export { deleteTodo, type DeleteResult } from './delete.js';
export { clearCompleted, type ClearResult } from './clear.js';
export { getStats } from './stats.js';

// Batch operations
export { createBatch, type BatchCreateResult, type FailedItem } from './create-batch.js';
export { deleteBatch, type BatchDeleteResult, type FailedDelete } from './delete-batch.js';
export { toggleBatch, type BatchToggleResult, type FailedToggle } from './toggle-batch.js';

// List operations
export { createList } from './list-create.js';
export { updateList } from './list-update.js';
export { deleteList, type ListDeleteResult } from './list-delete.js';
export { listLists, type ListListResult } from './list-list.js';

// Re-export as array for convenience
import { createTodo } from './create.js';
import { listTodos } from './list.js';
import { getTodo } from './get.js';
import { updateTodo } from './update.js';
import { toggleTodo } from './toggle.js';
import { completeTodo } from './complete.js';
import { uncompleteTodo } from './uncomplete.js';
import { deleteTodo } from './delete.js';
import { clearCompleted } from './clear.js';
import { getStats } from './stats.js';
import { createBatch } from './create-batch.js';
import { deleteBatch } from './delete-batch.js';
import { toggleBatch } from './toggle-batch.js';
// List operations
import { createList } from './list-create.js';
import { updateList } from './list-update.js';
import { deleteList } from './list-delete.js';
import { listLists } from './list-list.js';
import type { ZodCommandDefinition } from '@afd/server';

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
	completeTodo,
	uncompleteTodo,
	deleteTodo,
	clearCompleted,
	getStats,
	// Batch operations
	createBatch,
	deleteBatch,
	toggleBatch,
	// List operations
	createList,
	updateList,
	deleteList,
	listLists,
] as unknown as ZodCommandDefinition[];
