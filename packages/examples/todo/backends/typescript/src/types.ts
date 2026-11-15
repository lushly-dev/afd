/**
 * @fileoverview Todo app type definitions
 */

/**
 * Priority levels for todos.
 */
export type Priority = 'low' | 'medium' | 'high';

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

	/** Creation timestamp */
	createdAt: string;

	/** Last update timestamp */
	updatedAt: string;

	/** Completion timestamp */
	completedAt?: string;

	/** When it was deleted; set only on a deleted todo, which todo-restore brings back */
	deletedAt?: string;
}

/**
 * The time and id source for one change, from the command context's clock and random, so a
 * test or a replay controls them.
 */
export interface Stamp {
	/** ISO 8601 time of the change */
	now: string;
	/** A new todo id */
	newId: () => string;
}

/** Who made a change, from `context.actor`. */
export interface ChangeActor {
	kind: string;
	id?: string;
}

/**
 * One change in the history todo-history reads: who, when, which todos, and its undo.
 */
export interface ChangeEntry {
	/** Position in the log, rising */
	seq: number;
	/** ISO 8601 time, from the command context's clock */
	at: string;
	actor: ChangeActor;
	command: string;
	/** The todos the change touched */
	ids: string[];
	undoCommand?: string;
	undoArgs?: Record<string, unknown>;
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

	/** Breakdown by priority */
	byPriority: {
		low: number;
		medium: number;
		high: number;
	};

	/** Completion rate (0-1) */
	completionRate: number;
}

/**
 * Filter options for listing todos.
 */
export interface TodoFilter {
	/** List deleted todos instead of live ones */
	deleted?: boolean;

	/** Filter by completion status */
	completed?: boolean;

	/** Filter by priority */
	priority?: Priority;

	/** Search in title/description */
	search?: string;

	/** Sort field */
	sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'title' | 'deletedAt';

	/** Sort direction */
	sortOrder?: 'asc' | 'desc';

	/** Maximum results; every match when omitted */
	limit?: number;

	/** Offset for pagination */
	offset?: number;
}
