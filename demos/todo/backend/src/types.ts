/**
 * @fileoverview Todo app type definitions
 */

/**
 * Priority levels for todos.
 * 0 = none, 1 = low, 2 = medium, 3 = high
 */
export type Priority = 0 | 1 | 2 | 3;

/**
 * Human-readable labels for priority levels.
 */
export const PRIORITY_LABELS: Record<Priority, string> = {
	0: 'none',
	1: 'low',
	2: 'medium',
	3: 'high',
};

/**
 * Todo item.
 */
export interface Todo {
	/** Unique identifier */
	id: string;

	/** Todo title */
	title: string;

	/** Optional description */
	description?: string;

	/** Priority level */
	priority: Priority;

	/** Whether the todo is completed */
	completed: boolean;

	/** Due date (ISO 8601 date-time) */
	dueDate?: string;

	/** Parent todo ID for subtasks (undefined for root-level todos) */
	parentId?: string;

	/** Creation timestamp */
	createdAt: string;

	/** Last update timestamp */
	updatedAt: string;

	/** Completion timestamp */
	completedAt?: string;
}

/**
 * Todo statistics.
 */
export interface TodoStats {
	/** Total number of todos */
	total: number;

	/** Number of completed todos */
	completed: number;

	/** Number of pending todos */
	pending: number;

	/** Number of overdue todos */
	overdue: number;

	/** Breakdown by priority */
	byPriority: Record<Priority, number>;

	/** Completion rate (0-1) */
	completionRate: number;
}

/**
 * Filter options for listing todos.
 */
export interface TodoFilter {
	/** Filter by completion status */
	completed?: boolean;

	/** Filter by priority */
	priority?: Priority;

	/** Search in title/description */
	search?: string;

	/** Filter todos due before this date (ISO 8601) */
	dueBefore?: string;

	/** Filter todos due after this date (ISO 8601) */
	dueAfter?: string;

	/** Filter by overdue status (due date passed and not completed) */
	overdue?: boolean;

	/** Filter by parent ID (null = root-level only, string = subtasks of that parent) */
	parentId?: string | null;

	/** Sort field */
	sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'title' | 'dueDate';

	/** Sort direction */
	sortOrder?: 'asc' | 'desc';

	/** Maximum results */
	limit?: number;

	/** Offset for pagination */
	offset?: number;
}

/**
 * A list that groups todos together.
 */
export interface List {
	/** Unique identifier */
	id: string;

	/** List name */
	name: string;

	/** Optional description */
	description?: string;

	/** IDs of todos in this list */
	todoIds: string[];

	/** Creation timestamp */
	createdAt: string;

	/** Last update timestamp */
	updatedAt: string;
}

/**
 * Filter options for listing lists.
 */
export interface ListFilter {
	/** Search in name/description */
	search?: string;

	/** Sort field */
	sortBy?: 'createdAt' | 'updatedAt' | 'name';

	/** Sort direction */
	sortOrder?: 'asc' | 'desc';

	/** Maximum results */
	limit?: number;

	/** Offset for pagination */
	offset?: number;
}

/**
 * A note item.
 */
export interface Note {
	/** Unique identifier */
	id: string;

	/** Note title */
	title: string;

	/** Note content (markdown supported) */
	content: string;

	/** Parent folder ID (undefined for root-level notes) */
	folderId?: string;

	/** Creation timestamp */
	createdAt: string;

	/** Last update timestamp */
	updatedAt: string;
}

/**
 * A folder that groups notes together.
 */
export interface NoteFolder {
	/** Unique identifier */
	id: string;

	/** Folder name */
	name: string;

	/** Optional description */
	description?: string;

	/** Creation timestamp */
	createdAt: string;

	/** Last update timestamp */
	updatedAt: string;
}

/**
 * Filter options for listing notes.
 */
export interface NoteFilter {
	/** Search in title/content */
	search?: string;

	/** Filter by folder ID (null = root-level only, string = notes in that folder) */
	folderId?: string | null;

	/** Sort field */
	sortBy?: 'createdAt' | 'updatedAt' | 'title';

	/** Sort direction */
	sortOrder?: 'asc' | 'desc';

	/** Maximum results */
	limit?: number;

	/** Offset for pagination */
	offset?: number;
}

/**
 * Filter options for listing note folders.
 */
export interface NoteFolderFilter {
	/** Search in name/description */
	search?: string;

	/** Sort field */
	sortBy?: 'createdAt' | 'updatedAt' | 'name';

	/** Sort direction */
	sortOrder?: 'asc' | 'desc';

	/** Maximum results */
	limit?: number;

	/** Offset for pagination */
	offset?: number;
}

/**
 * A note item.
 */
export interface Note {
	id: string;
	title: string;
	content: string;
	folderId?: string;
	createdAt: string;
	updatedAt: string;
}

export interface NoteFolder {
	id: string;
	name: string;
	description?: string;
	createdAt: string;
	updatedAt: string;
}

export interface NoteFilter {
	search?: string;
	folderId?: string | null;
	sortBy?: 'createdAt' | 'updatedAt' | 'title';
	sortOrder?: 'asc' | 'desc';
	limit?: number;
	offset?: number;
}

export interface NoteFolderFilter {
	search?: string;
	sortBy?: 'createdAt' | 'updatedAt' | 'name';
	sortOrder?: 'asc' | 'desc';
	limit?: number;
	offset?: number;
}
