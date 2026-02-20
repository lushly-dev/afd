/**
 * @fileoverview Export all todo commands
 */

export { type ClearResult, clearCompleted } from './clear.js';
export { completeTodo } from './complete.js';
export { createTodo } from './create.js';
// Batch operations
export { type BatchCreateResult, createBatch, type FailedItem } from './create-batch.js';
export { type DeleteResult, deleteTodo } from './delete.js';
export { type BatchDeleteResult, deleteBatch, type FailedDelete } from './delete-batch.js';
export { getTodo } from './get.js';
export { type ListResult, listTodos } from './list.js';
// List operations
export { createList } from './list-create.js';
export { deleteList, type ListDeleteResult } from './list-delete.js';
export { type ListListResult, listLists } from './list-list.js';
// Due date filtering
export { listToday, type TodayResult } from './list-today.js';
export { listUpcoming, type UpcomingResult } from './list-upcoming.js';
export { updateList } from './list-update.js';
// Note operations
export { createNote } from './note-create.js';
export { deleteNote, type NoteDeleteResult } from './note-delete.js';
export { getNote } from './note-get.js';
export { listNotes, type NoteListResult } from './note-list.js';
export { updateNote } from './note-update.js';
// Note folder operations
export { createNoteFolder } from './notefolder-create.js';
export { deleteNoteFolder, type NoteFolderDeleteResult } from './notefolder-delete.js';
export { getNoteFolder } from './notefolder-get.js';
export { listNoteFolders, type NoteFolderListResult } from './notefolder-list.js';
export { updateNoteFolder } from './notefolder-update.js';
// Search
export { type SearchResult, searchTodos } from './search.js';
export { getStats } from './stats.js';
// Subtask operations
export { addSubtask } from './subtask-add.js';
export { listSubtasks, type SubtaskListResult } from './subtask-list.js';
export { moveSubtask } from './subtask-move.js';
export { toggleTodo } from './toggle.js';
export { type BatchToggleResult, type FailedToggle, toggleBatch } from './toggle-batch.js';
export { uncompleteTodo } from './uncomplete.js';
export { updateTodo } from './update.js';

import type { ZodCommandDefinition } from '@lushly-dev/afd-server';
import { clearCompleted } from './clear.js';
import { completeTodo } from './complete.js';
// Re-export as array for convenience
import { createTodo } from './create.js';
import { createBatch } from './create-batch.js';
import { deleteTodo } from './delete.js';
import { deleteBatch } from './delete-batch.js';
import { getTodo } from './get.js';
import { listTodos } from './list.js';
// List operations
import { createList } from './list-create.js';
import { deleteList } from './list-delete.js';
import { listLists } from './list-list.js';
// Due date filtering
import { listToday } from './list-today.js';
import { listUpcoming } from './list-upcoming.js';
import { updateList } from './list-update.js';
// Search
import { searchTodos } from './search.js';
import { getStats } from './stats.js';
// Subtask operations
import { addSubtask } from './subtask-add.js';
import { listSubtasks } from './subtask-list.js';
import { moveSubtask } from './subtask-move.js';
import { toggleTodo } from './toggle.js';
import { toggleBatch } from './toggle-batch.js';
import { uncompleteTodo } from './uncomplete.js';
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
	// Due date filtering
	listToday,
	listUpcoming,
	// Search
	searchTodos,
	// Subtask operations
	addSubtask,
	listSubtasks,
	moveSubtask,
] as unknown as ZodCommandDefinition[];
