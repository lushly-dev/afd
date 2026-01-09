/**
 * AFD Todo Demo - Command Registry
 *
 * Exports all commands for the todo demo application.
 */
import type { ZodCommandDefinition } from '@lushly-dev/afd-server';
import type { TaskStore } from '../stores/task-store.js';
import type { ListStore } from '../stores/list-store.js';
import { createTaskCreateCommand } from './task-create.js';
import { createTaskUpdateCommand } from './task-update.js';
import { createTaskDeleteCommand } from './task-delete.js';
import { createTaskListCommand } from './task-list.js';

// Re-export types
export type { DeleteResult } from './task-delete.js';
export type { TaskListResult } from './task-list.js';

export function createCommands(taskStore: TaskStore, _listStore: ListStore) {
	// Note: Using explicit array instead of ZodCommandDefinition[] to preserve
	// individual command types for proper type checking
	const commands = [
		// Task commands
		createTaskCreateCommand(taskStore),
		createTaskUpdateCommand(taskStore),
		createTaskDeleteCommand(taskStore),
		createTaskListCommand(taskStore),
		// List commands would go here in Wave 1 - List Commands (Issue #65)
	] as const;

	// Cast to satisfy server's expected type
	return commands as unknown as ZodCommandDefinition[];
}
