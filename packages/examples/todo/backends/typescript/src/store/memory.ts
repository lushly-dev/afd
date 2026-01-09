/**
 * @fileoverview In-memory todo store
 *
 * Simple in-memory storage for todos. In a real app, this would be
 * replaced with a database adapter.
 */

import type { Todo, TodoFilter, TodoStats, Priority, List, ListFilter } from "../types.js";

/**
 * Generate a unique ID.
 */
function generateId(prefix: string = 'todo'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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
export class TodoStore {
  private todos: Map<string, Todo> = new Map();
  private lists: Map<string, List> = new Map();

  /**
   * Create a new todo.
   */
  create(data: {
    title: string;
    description?: string;
    priority?: Priority;
    dueDate?: string;
    tags?: string[];
  }): Todo {
    const todo: Todo = {
      id: generateId(),
      title: data.title,
      description: data.description,
      priority: data.priority ?? "medium",
      completed: false,
      dueDate: data.dueDate,
      tags: data.tags ?? [],
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

    // Filter by due date - before
    if (filter.dueBefore) {
      const beforeDate = new Date(filter.dueBefore);
      results = results.filter(
        (t) => t.dueDate && new Date(t.dueDate) < beforeDate
      );
    }

    // Filter by due date - after
    if (filter.dueAfter) {
      const afterDate = new Date(filter.dueAfter);
      results = results.filter(
        (t) => t.dueDate && new Date(t.dueDate) > afterDate
      );
    }

    // Filter by overdue status
    if (filter.overdue !== undefined) {
      const currentTime = new Date();
      if (filter.overdue) {
        // Only overdue: has due date, not completed, and past due
        results = results.filter(
          (t) => t.dueDate && !t.completed && new Date(t.dueDate) < currentTime
        );
      } else {
        // Not overdue: no due date, completed, or due date is in the future
        results = results.filter(
          (t) => !t.dueDate || t.completed || new Date(t.dueDate) >= currentTime
        );
      }
    }

    // Filter by tags (must have ALL specified tags)
    if (filter.tags && filter.tags.length > 0) {
      const filterTags = filter.tags.map(t => t.toLowerCase());
      results = results.filter((todo) =>
        filterTags.every(tag => todo.tags.some(t => t.toLowerCase() === tag))
      );
    }

    // Filter by anyTag (must have AT LEAST ONE of specified tags)
    if (filter.anyTag && filter.anyTag.length > 0) {
      const filterTags = filter.anyTag.map(t => t.toLowerCase());
      results = results.filter((todo) =>
        filterTags.some(tag => todo.tags.some(t => t.toLowerCase() === tag))
      );
    }

    // Sort
    const sortBy = filter.sortBy ?? "createdAt";
    const sortOrder = filter.sortOrder ?? "desc";
    const priorityOrder: Record<Priority, number> = {
      high: 3,
      medium: 2,
      low: 1,
    };

    results.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "priority":
          comparison = priorityOrder[a.priority] - priorityOrder[b.priority];
          break;
        case "title":
          comparison = a.title.localeCompare(b.title);
          break;
        case "updatedAt":
          comparison = a.updatedAt.localeCompare(b.updatedAt);
          break;
        case "dueDate":
          // Todos without due dates sort to the end
          if (!a.dueDate && !b.dueDate) comparison = 0;
          else if (!a.dueDate) comparison = 1;
          else if (!b.dueDate) comparison = -1;
          else comparison = a.dueDate.localeCompare(b.dueDate);
          break;
        case "createdAt":
        default:
          comparison = a.createdAt.localeCompare(b.createdAt);
      }

      return sortOrder === "asc" ? comparison : -comparison;
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
    data: Partial<Pick<Todo, "title" | "description" | "priority" | "completed" | "tags">> & { dueDate?: string | null }
  ): Todo | undefined {
    const todo = this.todos.get(id);
    if (!todo) {
      return undefined;
    }

    // Filter out undefined values to avoid overwriting existing properties
    const filteredData: Partial<Pick<Todo, "title" | "description" | "priority" | "completed" | "dueDate" | "tags">> = {};
    if (data.title !== undefined) filteredData.title = data.title;
    if (data.description !== undefined) filteredData.description = data.description;
    if (data.priority !== undefined) filteredData.priority = data.priority;
    if (data.completed !== undefined) filteredData.completed = data.completed;
    if (data.tags !== undefined) filteredData.tags = data.tags;
    // Handle dueDate: null clears it, undefined leaves it unchanged
    if (data.dueDate !== undefined) {
      filteredData.dueDate = data.dueDate === null ? undefined : data.dueDate;
    }

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

    this.todos.set(id, updated);
    return updated;
  }

  /**
   * Add tags to a todo.
   */
  addTags(id: string, tags: string[]): Todo | undefined {
    const todo = this.todos.get(id);
    if (!todo) {
      return undefined;
    }

    // Normalize tags to lowercase and dedupe
    const existingTags = new Set(todo.tags.map(t => t.toLowerCase()));
    const newTags = tags.filter(tag => !existingTags.has(tag.toLowerCase()));

    if (newTags.length === 0) {
      return todo; // No new tags to add
    }

    const updated: Todo = {
      ...todo,
      tags: [...todo.tags, ...newTags],
      updatedAt: now(),
    };

    this.todos.set(id, updated);
    return updated;
  }

  /**
   * Remove tags from a todo.
   */
  removeTags(id: string, tags: string[]): Todo | undefined {
    const todo = this.todos.get(id);
    if (!todo) {
      return undefined;
    }

    const tagsToRemove = new Set(tags.map(t => t.toLowerCase()));
    const remainingTags = todo.tags.filter(t => !tagsToRemove.has(t.toLowerCase()));

    if (remainingTags.length === todo.tags.length) {
      return todo; // No tags were removed
    }

    const updated: Todo = {
      ...todo,
      tags: remainingTags,
      updatedAt: now(),
    };

    this.todos.set(id, updated);
    return updated;
  }

  /**
   * Get all unique tags used across all todos.
   */
  getAllTags(): string[] {
    const tagSet = new Set<string>();
    for (const todo of this.todos.values()) {
      for (const tag of todo.tags) {
        tagSet.add(tag.toLowerCase());
      }
    }
    return Array.from(tagSet).sort();
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
  clearCompleted(): { cleared: number; remaining: number } {
    let cleared = 0;
    for (const [id, todo] of this.todos) {
      if (todo.completed) {
        this.todos.delete(id);
        cleared++;
      }
    }
    return { cleared, remaining: this.todos.size };
  }

  /**
   * Get todo statistics.
   */
  getStats(): TodoStats {
    const todos = Array.from(this.todos.values());
    const completed = todos.filter((t) => t.completed).length;
    const pending = todos.length - completed;
    const currentTime = new Date();
    const overdue = todos.filter(
      (t) => t.dueDate && !t.completed && new Date(t.dueDate) < currentTime
    ).length;

    return {
      total: todos.length,
      completed,
      pending,
      overdue,
      byPriority: {
        low: todos.filter((t) => t.priority === "low").length,
        medium: todos.filter((t) => t.priority === "medium").length,
        high: todos.filter((t) => t.priority === "high").length,
      },
      completionRate: todos.length > 0 ? completed / todos.length : 0,
    };
  }

  /**
   * Clear all todos and lists (for testing).
   */
  clear(): void {
    this.todos.clear();
    this.lists.clear();
  }

  /**
   * Get count of todos.
   */
  count(): number {
    return this.todos.size;
  }

  // ==================== List Methods ====================

  /**
   * Create a new list.
   */
  createList(data: {
    name: string;
    description?: string;
    todoIds?: string[];
  }): List {
    const list: List = {
      id: generateId('list'),
      name: data.name,
      description: data.description,
      todoIds: data.todoIds ?? [],
      createdAt: now(),
      updatedAt: now(),
    };

    this.lists.set(list.id, list);
    return list;
  }

  /**
   * Get a list by ID.
   */
  getList(id: string): List | undefined {
    return this.lists.get(id);
  }

  /**
   * List all lists with optional filtering.
   */
  listLists(filter: ListFilter = {}): List[] {
    let results = Array.from(this.lists.values());

    // Search in name/description
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter(
        (l) =>
          l.name.toLowerCase().includes(search) ||
          l.description?.toLowerCase().includes(search)
      );
    }

    // Sort
    const sortBy = filter.sortBy ?? "createdAt";
    const sortOrder = filter.sortOrder ?? "desc";

    results.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "updatedAt":
          comparison = a.updatedAt.localeCompare(b.updatedAt);
          break;
        case "createdAt":
        default:
          comparison = a.createdAt.localeCompare(b.createdAt);
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

    // Pagination
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * Update a list.
   */
  updateList(
    id: string,
    data: Partial<Pick<List, "name" | "description" | "todoIds">>
  ): List | undefined {
    const list = this.lists.get(id);
    if (!list) {
      return undefined;
    }

    // Filter out undefined values
    const filteredData: Partial<Pick<List, "name" | "description" | "todoIds">> = {};
    if (data.name !== undefined) filteredData.name = data.name;
    if (data.description !== undefined) filteredData.description = data.description;
    if (data.todoIds !== undefined) filteredData.todoIds = data.todoIds;

    const updated: List = {
      ...list,
      ...filteredData,
      updatedAt: now(),
    };

    this.lists.set(id, updated);
    return updated;
  }

  /**
   * Delete a list.
   */
  deleteList(id: string): boolean {
    return this.lists.delete(id);
  }

  /**
   * Get count of lists.
   */
  countLists(): number {
    return this.lists.size;
  }

  /**
   * Clear all lists (for testing).
   */
  clearLists(): void {
    this.lists.clear();
  }
}

/**
 * Singleton store instance for tests.
 * When TODO_STORE_TYPE=memory, the store factory uses this instance
 * to ensure tests and commands share the same store.
 */
export const memoryStore = new TodoStore();

/**
 * Alias for memoryStore for backwards compatibility with test imports.
 */
export const store = memoryStore;
