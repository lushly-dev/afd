/**
 * @fileoverview File-based todo store with JSON persistence
 *
 * This store persists todos to a JSON file, allowing multiple server instances
 * (HTTP and stdio/MCP, or the TypeScript and Python backends) to share the same data.
 *
 * The default file, `packages/examples/todo/data/todos.json`, is gitignored. When it
 * is missing it is created from the committed seed, `data/todos.seed.json`. A custom
 * path starts empty unless a seed is passed explicitly.
 *
 * Environment variables:
 *   TODO_STORE_PATH - Path to the JSON file (default: data/todos.json)
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Priority, Todo, TodoFilter, TodoStats } from '../types.js';
import { readTodoFile, writeTodoFile } from './json-file.js';

// From this file: store/ → src/ (or dist/) → typescript/ → backends/ → todo/
const EXAMPLE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Default data file: gitignored, created from the seed on first run. */
export const DEFAULT_STORE_PATH = resolve(EXAMPLE_ROOT, 'data', 'todos.json');

/** Committed seed data copied into a missing default data file. */
export const DEFAULT_SEED_PATH = resolve(EXAMPLE_ROOT, 'data', 'todos.seed.json');

/**
 * Options for {@link FileStore}.
 */
export interface FileStoreOptions {
	/**
	 * JSON file whose todos initialize a missing data file. Defaults to
	 * {@link DEFAULT_SEED_PATH} for the default data file, and to none (start empty)
	 * for a custom path.
	 */
	seedPath?: string;
}

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
 * File-based todo store with JSON persistence.
 *
 * Writes are atomic (temp file + rename), and a file that cannot be parsed throws
 * a `TodoStoreCorruptError` rather than being treated as empty.
 */
export class FileStore {
	readonly filePath: string;

	constructor(filePath?: string, options: FileStoreOptions = {}) {
		this.filePath = filePath ?? DEFAULT_STORE_PATH;
		const seedPath = options.seedPath ?? (filePath === undefined ? DEFAULT_SEED_PATH : undefined);

		mkdirSync(dirname(this.filePath), { recursive: true });

		if (!existsSync(this.filePath)) {
			const initial = seedPath && existsSync(seedPath) ? readTodoFile(seedPath) : new Map();
			this.saveTodos(initial);
		}

		// Fail at startup, not on the first command, when the file is unreadable.
		this.loadTodos();
	}

	/**
	 * Load todos from file.
	 *
	 * @throws TodoStoreCorruptError when the file exists but cannot be parsed
	 */
	private loadTodos(): Map<string, Todo> {
		try {
			return readTodoFile(this.filePath);
		} catch (error) {
			// Deleted while the server runs: start again from an empty store.
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return new Map();
			}
			throw error;
		}
	}

	/**
	 * Save todos to file atomically.
	 */
	private saveTodos(todos: Map<string, Todo>): void {
		writeTodoFile(this.filePath, todos);
	}

	/**
	 * Create a new todo.
	 */
	create(data: { title: string; description?: string; priority?: Priority }): Todo {
		const todos = this.loadTodos();

		const todo: Todo = {
			id: generateId(),
			title: data.title,
			description: data.description,
			priority: data.priority ?? 'medium',
			completed: false,
			createdAt: now(),
			updatedAt: now(),
		};

		todos.set(todo.id, todo);
		this.saveTodos(todos);
		return todo;
	}

	/**
	 * Get a todo by ID.
	 */
	get(id: string): Todo | undefined {
		const todos = this.loadTodos();
		return todos.get(id);
	}

	/**
	 * List todos with optional filtering.
	 */
	list(filter: TodoFilter = {}): Todo[] {
		const todos = this.loadTodos();
		let results = Array.from(todos.values());

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
					t.title.toLowerCase().includes(search) || t.description?.toLowerCase().includes(search)
			);
		}

		// Sort
		const sortBy = filter.sortBy ?? 'createdAt';
		const sortOrder = filter.sortOrder ?? 'desc';
		const priorityOrder: Record<Priority, number> = {
			high: 3,
			medium: 2,
			low: 1,
		};

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
		data: Partial<Pick<Todo, 'title' | 'description' | 'priority' | 'completed'>>
	): Todo | undefined {
		const todos = this.loadTodos();
		const todo = todos.get(id);
		if (!todo) {
			return undefined;
		}

		// Filter out undefined values to avoid overwriting existing properties
		const filteredData: Partial<Pick<Todo, 'title' | 'description' | 'priority' | 'completed'>> =
			{};
		if (data.title !== undefined) filteredData.title = data.title;
		if (data.description !== undefined) filteredData.description = data.description;
		if (data.priority !== undefined) filteredData.priority = data.priority;
		if (data.completed !== undefined) filteredData.completed = data.completed;

		const updated: Todo = {
			...todo,
			...filteredData,
			updatedAt: now(),
		};

		// Handle completedAt timestamp
		if (data.completed !== undefined) {
			if (data.completed && !todo.completed) {
				updated.completedAt = now();
			} else if (!data.completed && todo.completed) {
				updated.completedAt = undefined;
			}
		}

		todos.set(id, updated);
		this.saveTodos(todos);
		return updated;
	}

	/**
	 * Toggle todo completion status.
	 */
	toggle(id: string): Todo | undefined {
		const todos = this.loadTodos();
		const todo = todos.get(id);
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

		todos.set(id, updated);
		this.saveTodos(todos);
		return updated;
	}

	/**
	 * Delete a todo.
	 */
	delete(id: string): boolean {
		const todos = this.loadTodos();
		const existed = todos.delete(id);
		if (existed) {
			this.saveTodos(todos);
		}
		return existed;
	}

	/**
	 * Clear completed todos.
	 */
	clearCompleted(): { cleared: number; remaining: number } {
		const todos = this.loadTodos();
		let cleared = 0;
		for (const [id, todo] of todos) {
			if (todo.completed) {
				todos.delete(id);
				cleared++;
			}
		}
		this.saveTodos(todos);
		return { cleared, remaining: todos.size };
	}

	/**
	 * Get todo statistics.
	 */
	getStats(): TodoStats {
		const todos = this.loadTodos();
		const allTodos = Array.from(todos.values());
		const completed = allTodos.filter((t) => t.completed).length;
		const pending = allTodos.length - completed;

		return {
			total: allTodos.length,
			completed,
			pending,
			byPriority: {
				low: allTodos.filter((t) => t.priority === 'low').length,
				medium: allTodos.filter((t) => t.priority === 'medium').length,
				high: allTodos.filter((t) => t.priority === 'high').length,
			},
			completionRate: allTodos.length > 0 ? completed / allTodos.length : 0,
		};
	}

	/**
	 * Clear all todos (for testing).
	 */
	clear(): void {
		this.saveTodos(new Map());
	}

	/**
	 * Get count of todos.
	 */
	count(): number {
		return this.loadTodos().size;
	}
}
