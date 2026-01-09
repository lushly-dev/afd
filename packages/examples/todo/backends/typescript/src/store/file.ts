/**
 * @fileoverview File-based todo store with JSON persistence
 *
 * This store persists todos to a JSON file, allowing multiple server instances
 * (HTTP and stdio/MCP) to share the same data.
 *
 * Environment variables:
 *   TODO_STORE_PATH - Path to the JSON file (default: ./data/todos.json)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Todo, TodoFilter, TodoStats, Priority, List, ListFilter } from "../types.js";

// Get the directory of this file for consistent path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
 * File-based todo store with JSON persistence.
 */
export class FileStore {
  private filePath: string;
  private listsFilePath: string;

  constructor(filePath?: string) {
    // Default path: packages/examples/todo/data/todos.json
    // From this file: store/file.ts → src/ → typescript/ → backends/ → todo/ → data/
    this.filePath = filePath ?? resolve(__dirname, "..", "..", "..", "..", "data", "todos.json");
    this.listsFilePath = filePath
      ? filePath.replace(/\.json$/, '-lists.json')
      : resolve(__dirname, "..", "..", "..", "..", "data", "lists.json");

    // Ensure the directory exists
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Initialize empty files if they don't exist
    if (!existsSync(this.filePath)) {
      this.saveTodos(new Map());
    }
    if (!existsSync(this.listsFilePath)) {
      this.saveLists(new Map());
    }
  }

  /**
   * Load todos from file.
   */
  private loadTodos(): Map<string, Todo> {
    try {
      const data = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(data);

      // Handle both array format and object format
      if (Array.isArray(parsed)) {
        const map = new Map<string, Todo>();
        for (const todo of parsed) {
          map.set(todo.id, todo);
        }
        return map;
      }

      // Object format: { "id": todo }
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  /**
   * Save todos to file.
   */
  private saveTodos(todos: Map<string, Todo>): void {
    // Save as array for better readability
    const data = Array.from(todos.values());
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * Create a new todo.
   */
  create(data: {
    title: string;
    description?: string;
    priority?: Priority;
  }): Todo {
    const todos = this.loadTodos();

    const todo: Todo = {
      id: generateId(),
      title: data.title,
      description: data.description,
      priority: data.priority ?? "medium",
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
          t.title.toLowerCase().includes(search) ||
          t.description?.toLowerCase().includes(search)
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
    data: Partial<
      Pick<Todo, "title" | "description" | "priority" | "completed">
    >
  ): Todo | undefined {
    const todos = this.loadTodos();
    const todo = todos.get(id);
    if (!todo) {
      return undefined;
    }

    // Filter out undefined values to avoid overwriting existing properties
    const filteredData: Partial<
      Pick<Todo, "title" | "description" | "priority" | "completed">
    > = {};
    if (data.title !== undefined) filteredData.title = data.title;
    if (data.description !== undefined)
      filteredData.description = data.description;
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
    const currentTime = new Date();
    const overdue = allTodos.filter(
      (t) => t.dueDate && !t.completed && new Date(t.dueDate) < currentTime
    ).length;

    return {
      total: allTodos.length,
      completed,
      pending,
      overdue,
      byPriority: {
        low: allTodos.filter((t) => t.priority === "low").length,
        medium: allTodos.filter((t) => t.priority === "medium").length,
        high: allTodos.filter((t) => t.priority === "high").length,
      },
      completionRate: allTodos.length > 0 ? completed / allTodos.length : 0,
    };
  }

  /**
   * Clear all todos and lists (for testing).
   */
  clear(): void {
    this.saveTodos(new Map());
    this.saveLists(new Map());
  }

  /**
   * Get count of todos.
   */
  count(): number {
    return this.loadTodos().size;
  }

  // ==================== List Methods ====================

  /**
   * Load lists from file.
   */
  private loadLists(): Map<string, List> {
    try {
      const data = readFileSync(this.listsFilePath, "utf-8");
      const parsed = JSON.parse(data);

      // Handle both array format and object format
      if (Array.isArray(parsed)) {
        const map = new Map<string, List>();
        for (const list of parsed) {
          map.set(list.id, list);
        }
        return map;
      }

      // Object format: { "id": list }
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  /**
   * Save lists to file.
   */
  private saveLists(lists: Map<string, List>): void {
    // Save as array for better readability
    const data = Array.from(lists.values());
    writeFileSync(this.listsFilePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * Create a new list.
   */
  createList(data: {
    name: string;
    description?: string;
    todoIds?: string[];
  }): List {
    const lists = this.loadLists();

    const list: List = {
      id: generateId('list'),
      name: data.name,
      description: data.description,
      todoIds: data.todoIds ?? [],
      createdAt: now(),
      updatedAt: now(),
    };

    lists.set(list.id, list);
    this.saveLists(lists);
    return list;
  }

  /**
   * Get a list by ID.
   */
  getList(id: string): List | undefined {
    const lists = this.loadLists();
    return lists.get(id);
  }

  /**
   * List all lists with optional filtering.
   */
  listLists(filter: ListFilter = {}): List[] {
    const lists = this.loadLists();
    let results = Array.from(lists.values());

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
    const lists = this.loadLists();
    const list = lists.get(id);
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

    lists.set(id, updated);
    this.saveLists(lists);
    return updated;
  }

  /**
   * Delete a list.
   */
  deleteList(id: string): boolean {
    const lists = this.loadLists();
    const existed = lists.delete(id);
    if (existed) {
      this.saveLists(lists);
    }
    return existed;
  }

  /**
   * Get count of lists.
   */
  countLists(): number {
    return this.loadLists().size;
  }

  /**
   * Clear all lists (for testing).
   */
  clearLists(): void {
    this.saveLists(new Map());
  }
}
