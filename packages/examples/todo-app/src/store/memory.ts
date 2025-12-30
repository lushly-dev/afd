/**
 * @fileoverview In-memory todo store
 *
 * Simple in-memory storage for todos. In a real app, this would be
 * replaced with a database adapter.
 */

import type { Todo, TodoFilter, TodoStats, Priority } from '../types.js';

/**
 * Generate a unique ID.
 */
function generateId(): string {
	return `todo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get current ISO timestamp.
 */
function now(): string {
	return new Date().toISOString();
}

/**
 * In-memory todo store.
 */
class TodoStore {
	private todos: Map<string, Todo> = new Map();

	/**
	 * Create a new todo.
	 */
	create(data: {
		title: string;
		description?: string;
		priority?: Priority;
	}): Todo {
		const todo: Todo = {
			id: generateId(),
			title: data.title,
			description: data.description,
			priority: data.priority ?? 'medium',
			completed: false,
			createdAt: now(),
			updatedAt: now(),
		};

		this.todos.set(todo.id, todo);
		return todo;
	}

	/**
	 * Get a todo by ID.
	 */
	get(id: string): Todo | undefined {
		return this.todos.get(id);
	}

	/**
	 * List todos with optional filtering.
	 */
	list(filter: TodoFilter = {}): Todo[] {
		let results = Array.from(this.todos.values());

		// Filter by completion status
		if (filter.completed !== undefined) {
			results = results.filter((t) => t.completed === filter.completed);
		}

		// Filter by priority
		if (filter.priority) {
			results = results.filter((t) => t.priority === filter.priority);
		}

		// Search in title/description
		if (filter.search) {
			const search = filter.search.toLowerCase();
			results = results.filter(
				(t) =>
					t.title.toLowerCase().includes(search) ||
					t.description?.toLowerCase().includes(search)
			);
		}

		// Sort
		const sortBy = filter.sortBy ?? 'createdAt';
		const sortOrder = filter.sortOrder ?? 'desc';
		const priorityOrder: Record<Priority, number> = { high: 3, medium: 2, low: 1 };

		results.sort((a, b) => {
			let comparison = 0;

			switch (sortBy) {
				case 'priority':
					comparison = priorityOrder[a.priority] - priorityOrder[b.priority];
					break;
				case 'title':
					comparison = a.title.localeCompare(b.title);
					break;
				case 'updatedAt':
					comparison = a.updatedAt.localeCompare(b.updatedAt);
					break;
				case 'createdAt':
				default:
					comparison = a.createdAt.localeCompare(b.createdAt);
			}

			return sortOrder === 'asc' ? comparison : -comparison;
		});

		// Pagination
		const offset = filter.offset ?? 0;
		const limit = filter.limit ?? 100;
		results = results.slice(offset, offset + limit);

		return results;
	}

	/**
	 * Update a todo.
	 */
	update(
		id: string,
		data: Partial<Pick<Todo, 'title' | 'description' | 'priority'>>
	): Todo | undefined {
		const todo = this.todos.get(id);
		if (!todo) {
			return undefined;
		}

		const updated: Todo = {
			...todo,
			...data,
			updatedAt: now(),
		};

		this.todos.set(id, updated);
		return updated;
	}

	/**
	 * Toggle todo completion status.
	 */
	toggle(id: string): Todo | undefined {
		const todo = this.todos.get(id);
		if (!todo) {
			return undefined;
		}

		const completed = !todo.completed;
		const updated: Todo = {
			...todo,
			completed,
			completedAt: completed ? now() : undefined,
			updatedAt: now(),
		};

		this.todos.set(id, updated);
		return updated;
	}

	/**
	 * Delete a todo.
	 */
	delete(id: string): boolean {
		return this.todos.delete(id);
	}

	/**
	 * Clear completed todos.
	 */
	clearCompleted(): number {
		let count = 0;
		for (const [id, todo] of this.todos) {
			if (todo.completed) {
				this.todos.delete(id);
				count++;
			}
		}
		return count;
	}

	/**
	 * Get todo statistics.
	 */
	getStats(): TodoStats {
		const todos = Array.from(this.todos.values());
		const completed = todos.filter((t) => t.completed).length;
		const pending = todos.length - completed;

		return {
			total: todos.length,
			completed,
			pending,
			byPriority: {
				low: todos.filter((t) => t.priority === 'low').length,
				medium: todos.filter((t) => t.priority === 'medium').length,
				high: todos.filter((t) => t.priority === 'high').length,
			},
			completionRate: todos.length > 0 ? completed / todos.length : 0,
		};
	}

	/**
	 * Clear all todos (for testing).
	 */
	clear(): void {
		this.todos.clear();
	}

	/**
	 * Get count of todos.
	 */
	count(): number {
		return this.todos.size;
	}
}

/**
 * Singleton store instance.
 */
export const store = new TodoStore();
