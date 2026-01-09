const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'packages/examples/todo/backends/typescript/src/store/memory.ts');

const content = `/**
 * @fileoverview In-memory todo store
 *
 * Simple in-memory storage for todos. In a real app, this would be
 * replaced with a database adapter.
 */

import type { Todo, TodoFilter, TodoStats, Priority, List, ListFilter, Note, NoteFolder, NoteFilter, NoteFolderFilter } from "../types.js";

/**
 * Generate a unique ID.
 */
function generateId(prefix: string = 'todo'): string {
  return \`\${prefix}-\${Date.now()}-\${Math.random().toString(36).slice(2, 9)}\`;
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
  private notes: Map<string, Note> = new Map();
  private noteFolders: Map<string, NoteFolder> = new Map();

  /**
   * Create a new todo.
   */
  create(data: {
    title: string;
    description?: string;
    priority?: Priority;
    dueDate?: string;
    parentId?: string;
  }): Todo {
    const todo: Todo = {
      id: generateId(),
      title: data.title,
      description: data.description,
      priority: data.priority ?? 2,
      completed: false,
      dueDate: data.dueDate,
      parentId: data.parentId,
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

    // Filter by parent ID
    if (filter.parentId !== undefined) {
      if (filter.parentId === null) {
        // Root-level todos only (no parent)
        results = results.filter((t) => !t.parentId);
      } else {
        // Subtasks of a specific parent
        results = results.filter((t) => t.parentId === filter.parentId);
      }
    }

    // Sort
    const sortBy = filter.sortBy ?? "createdAt";
    const sortOrder = filter.sortOrder ?? "desc";

    results.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "priority":
          comparison = a.priority - b.priority;
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
    data: Partial<Pick<Todo, "title" | "description" | "priority" | "completed">> & { dueDate?: string | null; parentId?: string | null }
  ): Todo | undefined {
    const todo = this.todos.get(id);
    if (!todo) {
      return undefined;
    }

    // Filter out undefined values to avoid overwriting existing properties
    const filteredData: Partial<Pick<Todo, "title" | "description" | "priority" | "completed" | "dueDate" | "parentId">> = {};
    if (data.title !== undefined) filteredData.title = data.title;
    if (data.description !== undefined) filteredData.description = data.description;
    if (data.priority !== undefined) filteredData.priority = data.priority;
    if (data.completed !== undefined) filteredData.completed = data.completed;
    // Handle dueDate: null clears it, undefined leaves it unchanged
    if (data.dueDate !== undefined) {
      filteredData.dueDate = data.dueDate === null ? undefined : data.dueDate;
    }
    // Handle parentId: null promotes to root level, undefined leaves it unchanged
    if (data.parentId !== undefined) {
      filteredData.parentId = data.parentId === null ? undefined : data.parentId;
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
        0: todos.filter((t) => t.priority === 0).length,
        1: todos.filter((t) => t.priority === 1).length,
        2: todos.filter((t) => t.priority === 2).length,
        3: todos.filter((t) => t.priority === 3).length,
      },
      completionRate: todos.length > 0 ? completed / todos.length : 0,
    };
  }

  /**
   * Clear all todos, lists, notes, and note folders (for testing).
   */
  clear(): void {
    this.todos.clear();
    this.lists.clear();
    this.notes.clear();
    this.noteFolders.clear();
  }

  /**
   * Get count of todos.
   */
  count(): number {
    return this.todos.size;
  }

  /**
   * Get all subtasks of a todo (direct children only).
   */
  getSubtasks(parentId: string): Todo[] {
    return Array.from(this.todos.values()).filter((t) => t.parentId === parentId);
  }

  /**
   * Get all descendants of a todo (subtasks, their subtasks, etc.).
   */
  getDescendants(parentId: string): Todo[] {
    const descendants: Todo[] = [];
    const stack = [parentId];

    while (stack.length > 0) {
      const currentId = stack.pop()!;
      const children = this.getSubtasks(currentId);
      for (const child of children) {
        descendants.push(child);
        stack.push(child.id);
      }
    }

    return descendants;
  }

  /**
   * Check if moving a todo to a new parent would create a circular reference.
   */
  wouldCreateCycle(todoId: string, newParentId: string): boolean {
    // Check if the new parent is the todo itself
    if (todoId === newParentId) {
      return true;
    }

    // Check if the new parent is a descendant of the todo
    const descendants = this.getDescendants(todoId);
    return descendants.some((d) => d.id === newParentId);
  }

  /**
   * Delete a todo and optionally its subtasks.
   * @param id Todo ID to delete
   * @param cascade If true, delete all subtasks recursively
   * @returns Object with deleted count and IDs
   */
  deleteWithSubtasks(id: string, cascade: boolean = false): { deleted: number; ids: string[] } {
    const todo = this.todos.get(id);
    if (!todo) {
      return { deleted: 0, ids: [] };
    }

    const deletedIds: string[] = [id];

    if (cascade) {
      // Get all descendants and delete them
      const descendants = this.getDescendants(id);
      for (const descendant of descendants) {
        this.todos.delete(descendant.id);
        deletedIds.push(descendant.id);
      }
    } else {
      // Promote subtasks to root level (or to the deleted todo's parent)
      const subtasks = this.getSubtasks(id);
      for (const subtask of subtasks) {
        this.update(subtask.id, { parentId: todo.parentId ?? null });
      }
    }

    this.todos.delete(id);
    return { deleted: deletedIds.length, ids: deletedIds };
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

  // ==================== Note Methods ====================

  createNote(data: { title: string; content: string; folderId?: string }): Note {
    const note: Note = {
      id: generateId('note'),
      title: data.title,
      content: data.content,
      folderId: data.folderId,
      createdAt: now(),
      updatedAt: now(),
    };
    this.notes.set(note.id, note);
    return note;
  }

  getNote(id: string): Note | undefined {
    return this.notes.get(id);
  }

  listNotes(filter: NoteFilter = {}): Note[] {
    let results = Array.from(this.notes.values());
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter((n) => n.title.toLowerCase().includes(search) || n.content.toLowerCase().includes(search));
    }
    if (filter.folderId !== undefined) {
      if (filter.folderId === null) { results = results.filter((n) => !n.folderId); }
      else { results = results.filter((n) => n.folderId === filter.folderId); }
    }
    const sortBy = filter.sortBy ?? 'createdAt';
    const sortOrder = filter.sortOrder ?? 'desc';
    results.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'title': cmp = a.title.localeCompare(b.title); break;
        case 'updatedAt': cmp = a.updatedAt.localeCompare(b.updatedAt); break;
        default: cmp = a.createdAt.localeCompare(b.createdAt);
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    return results.slice(offset, offset + limit);
  }

  updateNote(id: string, data: Partial<Pick<Note, 'title' | 'content'>> & { folderId?: string | null }): Note | undefined {
    const note = this.notes.get(id);
    if (!note) return undefined;
    const filtered: Partial<Pick<Note, 'title' | 'content' | 'folderId'>> = {};
    if (data.title !== undefined) filtered.title = data.title;
    if (data.content !== undefined) filtered.content = data.content;
    if (data.folderId !== undefined) filtered.folderId = data.folderId === null ? undefined : data.folderId;
    const updated: Note = { ...note, ...filtered, updatedAt: now() };
    this.notes.set(id, updated);
    return updated;
  }

  deleteNote(id: string): boolean { return this.notes.delete(id); }
  countNotes(): number { return this.notes.size; }
  clearNotes(): void { this.notes.clear(); }
  getNotesInFolder(folderId: string): Note[] {
    return Array.from(this.notes.values()).filter((n) => n.folderId === folderId);
  }

  // ==================== NoteFolder Methods ====================

  createNoteFolder(data: { name: string; description?: string }): NoteFolder {
    const folder: NoteFolder = {
      id: generateId('folder'),
      name: data.name,
      description: data.description,
      createdAt: now(),
      updatedAt: now(),
    };
    this.noteFolders.set(folder.id, folder);
    return folder;
  }

  getNoteFolder(id: string): NoteFolder | undefined { return this.noteFolders.get(id); }

  listNoteFolders(filter: NoteFolderFilter = {}): NoteFolder[] {
    let results = Array.from(this.noteFolders.values());
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter((f) => f.name.toLowerCase().includes(search) || f.description?.toLowerCase().includes(search));
    }
    const sortBy = filter.sortBy ?? 'createdAt';
    const sortOrder = filter.sortOrder ?? 'desc';
    results.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'updatedAt': cmp = a.updatedAt.localeCompare(b.updatedAt); break;
        default: cmp = a.createdAt.localeCompare(b.createdAt);
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    return results.slice(offset, offset + limit);
  }

  updateNoteFolder(id: string, data: Partial<Pick<NoteFolder, 'name' | 'description'>>): NoteFolder | undefined {
    const folder = this.noteFolders.get(id);
    if (!folder) return undefined;
    const filtered: Partial<Pick<NoteFolder, 'name' | 'description'>> = {};
    if (data.name !== undefined) filtered.name = data.name;
    if (data.description !== undefined) filtered.description = data.description;
    const updated: NoteFolder = { ...folder, ...filtered, updatedAt: now() };
    this.noteFolders.set(id, updated);
    return updated;
  }

  deleteNoteFolder(id: string): boolean { return this.noteFolders.delete(id); }
  countNoteFolders(): number { return this.noteFolders.size; }
  clearNoteFolders(): void { this.noteFolders.clear(); }
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
`;

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Written complete memory.ts');
