/**
 * @fileoverview Local-first storage hook using session storage
 * 
 * This is the source of truth for todos. Both UI and Chat write here.
 * Changes are synced to Convex in the background by useConvexSync.
 * 
 * Future: Swap session storage for IndexedDB for offline support.
 */

import { useSyncExternalStore, useCallback } from 'react';
import type { Todo, TodoStats, Priority } from '../types';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface LocalStore {
  /** Current todos list */
  todos: Todo[];
  /** Create a new todo */
  createTodo: (title: string, options?: { description?: string; priority?: Priority }) => void;
  /** Update an existing todo */
  updateTodo: (id: string, updates: Partial<Pick<Todo, 'title' | 'description' | 'priority' | 'completed'>>) => void;
  /** Toggle todo completion */
  toggleTodo: (id: string) => void;
  /** Delete a todo */
  deleteTodo: (id: string) => void;
  /** Clear all completed todos */
  clearCompleted: () => void;
  /** Batch toggle multiple todos */
  batchToggle: (ids: string[], completed: boolean) => void;
  /** Batch delete multiple todos */
  batchDelete: (ids: string[]) => void;
  /** Hydrate store from Convex data */
  hydrate: (todos: Todo[]) => void;
  /** Get pending operations for sync */
  getPendingOperations: () => PendingOperation[];
  /** Mark operations as synced */
  markSynced: (operationIds: string[]) => void;
  /** Update a todo's ID (used after syncing to Convex to use Convex ID) */
  updateTodoId: (oldId: string, newId: string) => void;
}

export interface PendingOperation {
  id: string;
  type: 'create' | 'update' | 'delete' | 'toggle' | 'clearCompleted' | 'batchToggle' | 'batchDelete';
  todoId?: string;
  todoIds?: string[];
  data?: Partial<Todo>;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE KEYS
// ═══════════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'myoso:todos';
const PENDING_OPS_KEY = 'myoso:pending-ops';

// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getTodos(): Todo[] {
  try {
    const data = sessionStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function setTodos(todos: Todo[]): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  notifyListeners();
}

function getPendingOps(): PendingOperation[] {
  try {
    const data = sessionStorage.getItem(PENDING_OPS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function setPendingOps(ops: PendingOperation[]): void {
  sessionStorage.setItem(PENDING_OPS_KEY, JSON.stringify(ops));
}

function addPendingOp(op: Omit<PendingOperation, 'id' | 'timestamp'>): void {
  const ops = getPendingOps();
  ops.push({
    ...op,
    id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    timestamp: Date.now(),
  });
  setPendingOps(ops);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

type Listener = () => void;
const listeners = new Set<Listener>();

// Cached snapshot to avoid infinite loops with useSyncExternalStore
let cachedTodos: Todo[] = getTodos();
let cachedStorageValue: string | null = sessionStorage.getItem(STORAGE_KEY);

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(): void {
  // Update cache before notifying
  cachedStorageValue = sessionStorage.getItem(STORAGE_KEY);
  cachedTodos = getTodos();
  listeners.forEach((listener) => listener());
}

function getSnapshot(): Todo[] {
  // Check if storage changed (e.g., from another tab)
  const currentValue = sessionStorage.getItem(STORAGE_KEY);
  if (currentValue !== cachedStorageValue) {
    cachedStorageValue = currentValue;
    cachedTodos = getTodos();
  }
  return cachedTodos;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GENERATE ID
// ═══════════════════════════════════════════════════════════════════════════════

function generateId(): string {
  // Use local- prefix + UUID for proper local-vs-synced detection
  // ConvexSync uses startsWith('local-') to identify local-only todos
  return `local-${crypto.randomUUID()}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATS COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════════

export function computeStats(todos: Todo[]): TodoStats {
  const completed = todos.filter((t) => t.completed).length;
  const pending = todos.length - completed;

  return {
    total: todos.length,
    completed,
    pending,
    completionRate: todos.length > 0 ? completed / todos.length : 0,
    byPriority: {
      high: todos.filter((t) => t.priority === 'high').length,
      medium: todos.filter((t) => t.priority === 'medium').length,
      low: todos.filter((t) => t.priority === 'low').length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════════

export function useLocalStore(): LocalStore {
  const todos = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const createTodo = useCallback((title: string, options?: { description?: string; priority?: Priority }) => {
    const newTodo: Todo = {
      id: generateId(),
      title,
      description: options?.description || '',
      priority: options?.priority || 'medium',
      completed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const current = getTodos();
    setTodos([newTodo, ...current]);
    addPendingOp({ type: 'create', todoId: newTodo.id, data: newTodo });
  }, []);

  const updateTodo = useCallback((id: string, updates: Partial<Pick<Todo, 'title' | 'description' | 'priority' | 'completed'>>) => {
    const current = getTodos();
    const updated = current.map((todo) =>
      todo.id === id ? { ...todo, ...updates, updatedAt: new Date().toISOString() } : todo
    );
    setTodos(updated);
    addPendingOp({ type: 'update', todoId: id, data: updates });
  }, []);

  const toggleTodo = useCallback((id: string) => {
    const current = getTodos();
    const updated = current.map((todo) =>
      todo.id === id ? { ...todo, completed: !todo.completed, updatedAt: new Date().toISOString() } : todo
    );
    setTodos(updated);
    addPendingOp({ type: 'toggle', todoId: id });
  }, []);

  const deleteTodo = useCallback((id: string) => {
    const current = getTodos();
    setTodos(current.filter((todo) => todo.id !== id));
    addPendingOp({ type: 'delete', todoId: id });
  }, []);

  const clearCompleted = useCallback(() => {
    const current = getTodos();
    setTodos(current.filter((todo) => !todo.completed));
    addPendingOp({ type: 'clearCompleted' });
  }, []);

  const batchToggle = useCallback((ids: string[], completed: boolean) => {
    const current = getTodos();
    const idSet = new Set(ids);
    const updated = current.map((todo) =>
      idSet.has(todo.id) ? { ...todo, completed, updatedAt: new Date().toISOString() } : todo
    );
    setTodos(updated);
    addPendingOp({ type: 'batchToggle', todoIds: ids, data: { completed } });
  }, []);

  const batchDelete = useCallback((ids: string[]) => {
    const current = getTodos();
    const idSet = new Set(ids);
    setTodos(current.filter((todo) => !idSet.has(todo.id)));
    addPendingOp({ type: 'batchDelete', todoIds: ids });
  }, []);

  const hydrate = useCallback((serverTodos: Todo[]) => {
    // Merge server data with local data, avoiding duplicates
    // Server data is source of truth for existing items
    // Local-only items (created offline) are preserved if not on server
    const current = getTodos();
    
    // Build a map of server todos by title for dedup
    const serverByTitle = new Map(serverTodos.map(t => [t.title.toLowerCase(), t]));
    const serverIds = new Set(serverTodos.map((t) => t.id));
    
    // Keep local items that aren't duplicates of server items
    const localOnly = current.filter((t) => {
      // Keep if local ID AND not a duplicate title on server
      if (t.id.startsWith('local-') && !serverIds.has(t.id)) {
        // Check if server has same title - if so, skip (server wins)
        return !serverByTitle.has(t.title.toLowerCase());
      }
      return false;
    });
    
    setTodos([...localOnly, ...serverTodos]);
  }, []);

  const getPendingOperations = useCallback(() => {
    return getPendingOps();
  }, []);

  const markSynced = useCallback((operationIds: string[]) => {
    const current = getPendingOps();
    const idsToRemove = new Set(operationIds);
    setPendingOps(current.filter((op) => !idsToRemove.has(op.id)));
  }, []);

  const updateTodoId = useCallback((oldId: string, newId: string) => {
    // Replace local temp ID with Convex ID after successful sync
    const current = getTodos();
    const updated = current.map((todo) =>
      todo.id === oldId ? { ...todo, id: newId } : todo
    );
    setTodos(updated);
    
    // Also update any pending operations that reference this ID
    const ops = getPendingOps();
    const updatedOps = ops.map((op) => ({
      ...op,
      todoId: op.todoId === oldId ? newId : op.todoId,
    }));
    setPendingOps(updatedOps);
  }, []);

  return {
    todos,
    createTodo,
    updateTodo,
    toggleTodo,
    deleteTodo,
    clearCompleted,
    batchToggle,
    batchDelete,
    hydrate,
    getPendingOperations,
    markSynced,
    updateTodoId,
  };
}
