/**
 * @fileoverview In-memory todo store
 *
 * Holds the live todos, the deleted ones (which todo-restore brings back) and the change
 * history that todo-history reads. All the store's logic is here; `FileStore` loads this state
 * from its files, runs the same methods and saves the result.
 */

import type { ChangeEntry, Priority, Stamp, Todo, TodoFilter, TodoStats } from '../types.js';

/** How many changes the history keeps; older ones drop off. */
export const HISTORY_LIMIT = 1000;

/** The state a store holds, as `FileStore` persists it. */
export interface TodoState {
	todos: Map<string, Todo>;
	deleted: Map<string, Todo>;
	history: ChangeEntry[];
}

/** A stamp from the system clock and `Math.random`, for callers outside a command. */
export function systemStamp(): Stamp {
	const at = Date.now();
	return {
		now: new Date(at).toISOString(),
		newId: () => `todo-${at}-${Math.random().toString(36).slice(2, 9)}`,
	};
}

type Editable = Partial<Pick<Todo, 'title' | 'description' | 'priority' | 'completed'>>;

const PRIORITY_ORDER: Record<Priority, number> = { high: 3, medium: 2, low: 1 };

/**
 * In-memory todo store.
 */
export class TodoStore {
	private todos: Map<string, Todo>;
	private deleted: Map<string, Todo>;
	private changes: ChangeEntry[];

	constructor(state?: Partial<TodoState>) {
		this.todos = state?.todos ?? new Map();
		this.deleted = state?.deleted ?? new Map();
		this.changes = state?.history ?? [];
	}

	/** The state, for `FileStore` to save. */
	snapshot(): TodoState {
		return { todos: this.todos, deleted: this.deleted, history: this.changes };
	}

	/**
	 * Create a new todo.
	 */
	create(
		data: { title: string; description?: string; priority?: Priority },
		stamp: Stamp = systemStamp()
	): Todo {
		const todo: Todo = {
			id: stamp.newId(),
			title: data.title,
			description: data.description,
			priority: data.priority ?? 'medium',
			completed: false,
			createdAt: stamp.now,
			updatedAt: stamp.now,
		};

		this.todos.set(todo.id, todo);
		return todo;
	}

	/**
	 * Get a live todo by ID. A deleted todo is not returned: see {@link getDeleted}.
	 */
	get(id: string): Todo | undefined {
		return this.todos.get(id);
	}

	/**
	 * Get a deleted todo by ID.
	 */
	getDeleted(id: string): Todo | undefined {
		return this.deleted.get(id);
	}

	/**
	 * List live todos, or deleted ones with `deleted: true`, filtered, sorted and paged.
	 */
	list(filter: TodoFilter = {}): Todo[] {
		let results = Array.from((filter.deleted ? this.deleted : this.todos).values());

		if (filter.completed !== undefined) {
			results = results.filter((t) => t.completed === filter.completed);
		}

		if (filter.priority) {
			results = results.filter((t) => t.priority === filter.priority);
		}

		if (filter.search) {
			const search = filter.search.toLowerCase();
			results = results.filter(
				(t) =>
					t.title.toLowerCase().includes(search) || t.description?.toLowerCase().includes(search)
			);
		}

		const sortBy = filter.sortBy ?? 'createdAt';
		const sortOrder = filter.sortOrder ?? 'desc';

		results.sort((a, b) => {
			let comparison = 0;

			switch (sortBy) {
				case 'priority':
					comparison = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
					break;
				case 'title':
					comparison = a.title.localeCompare(b.title);
					break;
				case 'updatedAt':
					comparison = a.updatedAt.localeCompare(b.updatedAt);
					break;
				case 'deletedAt':
					comparison = (a.deletedAt ?? '').localeCompare(b.deletedAt ?? '');
					break;
				default:
					comparison = a.createdAt.localeCompare(b.createdAt);
			}

			return sortOrder === 'asc' ? comparison : -comparison;
		});

		// No limit means every match, so a caller can count with list(filter).length.
		const offset = filter.offset ?? 0;
		return filter.limit === undefined
			? results.slice(offset)
			: results.slice(offset, offset + filter.limit);
	}

	/**
	 * Update a live todo.
	 */
	update(id: string, data: Editable, now: string = systemStamp().now): Todo | undefined {
		const todo = this.todos.get(id);
		if (!todo) {
			return undefined;
		}

		// Leave out undefined values so they do not overwrite existing fields
		const changes: Editable = {};
		if (data.title !== undefined) changes.title = data.title;
		if (data.description !== undefined) changes.description = data.description;
		if (data.priority !== undefined) changes.priority = data.priority;
		if (data.completed !== undefined) changes.completed = data.completed;

		const updated: Todo = { ...todo, ...changes, updatedAt: now };
		// An empty description is none (an undo of an edit that added one sends "")
		if (updated.description === '') {
			delete updated.description;
		}

		if (data.completed !== undefined) {
			if (data.completed && !todo.completed) {
				updated.completedAt = now;
			} else if (!data.completed && todo.completed) {
				delete updated.completedAt;
			}
		}

		this.todos.set(id, updated);
		return updated;
	}

	/**
	 * Toggle a live todo's completion status.
	 */
	toggle(id: string, now: string = systemStamp().now): Todo | undefined {
		const todo = this.todos.get(id);
		if (!todo) {
			return undefined;
		}

		return this.update(id, { completed: !todo.completed }, now);
	}

	/**
	 * Delete a live todo: it moves to the deleted todos, from which {@link restore} brings it
	 * back, until {@link clearDeleted} or {@link clearAll} removes it for good.
	 *
	 * @returns The deleted todo, or undefined when no live todo has this ID
	 */
	delete(id: string, now: string = systemStamp().now): Todo | undefined {
		const todo = this.todos.get(id);
		if (!todo) {
			return undefined;
		}

		this.todos.delete(id);
		const deleted: Todo = { ...todo, deletedAt: now };
		this.deleted.set(id, deleted);
		return deleted;
	}

	/**
	 * Bring a deleted todo back exactly as it was before the delete.
	 *
	 * @returns The restored todo, or undefined when no deleted todo has this ID
	 */
	restore(id: string): Todo | undefined {
		const deleted = this.deleted.get(id);
		if (!deleted) {
			return undefined;
		}

		this.deleted.delete(id);
		const { deletedAt: _deletedAt, ...todo } = deleted;
		this.todos.set(id, todo);
		return todo;
	}

	/**
	 * Remove the completed live todos for good.
	 */
	clearCompleted(): { clearedIds: string[]; remaining: number } {
		const clearedIds: string[] = [];
		for (const [id, todo] of this.todos) {
			if (todo.completed) {
				this.todos.delete(id);
				clearedIds.push(id);
			}
		}
		return { clearedIds, remaining: this.todos.size };
	}

	/**
	 * Remove every deleted todo for good.
	 */
	clearDeleted(): { clearedIds: string[]; remaining: number } {
		const clearedIds = Array.from(this.deleted.keys());
		this.deleted.clear();
		return { clearedIds, remaining: this.todos.size };
	}

	/**
	 * Remove every todo, live and deleted, for good.
	 */
	clearAll(): { clearedIds: string[]; remaining: number } {
		const clearedIds = [...this.todos.keys(), ...this.deleted.keys()];
		this.todos.clear();
		this.deleted.clear();
		return { clearedIds, remaining: 0 };
	}

	/**
	 * Statistics over the live todos.
	 */
	getStats(): TodoStats {
		const todos = Array.from(this.todos.values());
		const completed = todos.filter((t) => t.completed).length;

		return {
			total: todos.length,
			completed,
			pending: todos.length - completed,
			byPriority: {
				low: todos.filter((t) => t.priority === 'low').length,
				medium: todos.filter((t) => t.priority === 'medium').length,
				high: todos.filter((t) => t.priority === 'high').length,
			},
			completionRate: todos.length > 0 ? completed / todos.length : 0,
		};
	}

	/**
	 * Add a change to the history, keeping the latest {@link HISTORY_LIMIT}.
	 */
	record(change: Omit<ChangeEntry, 'seq'>): ChangeEntry {
		const last = this.changes[this.changes.length - 1];
		const entry: ChangeEntry = { seq: (last?.seq ?? 0) + 1, ...change };
		this.changes.push(entry);
		if (this.changes.length > HISTORY_LIMIT) {
			this.changes.splice(0, this.changes.length - HISTORY_LIMIT);
		}
		return entry;
	}

	/**
	 * The recorded changes, oldest first.
	 */
	history(): ChangeEntry[] {
		return [...this.changes];
	}

	/**
	 * Remove everything: live and deleted todos and the history (for tests).
	 */
	clear(): void {
		this.todos.clear();
		this.deleted.clear();
		this.changes = [];
	}

	/**
	 * Count of live todos.
	 */
	count(): number {
		return this.todos.size;
	}
}
