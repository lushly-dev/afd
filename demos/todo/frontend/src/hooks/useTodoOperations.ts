/**
 * @fileoverview Todo CRUD operations hook
 *
 * Extracts todo operations from App.tsx to reduce god component size.
 * Provides all handlers for creating, reading, updating, and deleting todos.
 * Now uses LocalStore for instant local updates, synced to Convex in background.
 */

import { useCallback } from "react";
import type { Todo } from "../types";
import type { LocalStore } from "./useLocalStore";

interface UseTodoOperationsProps {
  /** LocalStore instance for local-first operations */
  localStore: LocalStore;
  /** Callback to log operations */
  log: (message: string, status?: "success" | "error") => void;
  /** Confirm dialog hook */
  confirm: (title: string, message: string, warning: string) => Promise<boolean>;
  /** Current todos list (from local store) */
  todos: Todo[];
}

interface TodoOperations {
  handleAddTodo: (
    title: string,
    priority?: string,
    description?: string
  ) => void;
  handleToggleTodo: (id: string) => void;
  handleDeleteTodo: (id: string) => Promise<void>;
  handleEditTodo: (id: string) => void;
  handleSaveDetail: (
    id: string,
    updates: { title?: string; description?: string; priority?: Todo["priority"] }
  ) => void;
  handleClearCompleted: (completedCount: number) => Promise<void>;
}

export function useTodoOperations({
  localStore,
  log,
  confirm,
  todos,
}: UseTodoOperationsProps): TodoOperations {

  const handleAddTodo = useCallback(
    (title: string, priority: string = "medium", description?: string) => {
      log(`Creating todo...`);
      let priorityValue: "low" | "medium" | "high" = "medium";
      const lowercasePriority = priority.toLowerCase();
      if (lowercasePriority === "low") priorityValue = "low";
      else if (lowercasePriority === "high") priorityValue = "high";
      else if (lowercasePriority === "none") priorityValue = "low";
      else priorityValue = "medium";

      localStore.createTodo(title, {
        description,
        priority: priorityValue
      });
      log(`✓ Todo created successfully`, "success");
    },
    [localStore, log]
  );

  const handleToggleTodo = useCallback(
    (id: string) => {
      log(`Toggling todo...`);
      localStore.toggleTodo(id);
      log(`✓ Todo toggled successfully`, "success");
    },
    [localStore, log]
  );

  const handleDeleteTodo = useCallback(
    async (id: string) => {
      const todo = todos.find((t) => t.id === id);
      const confirmed = await confirm(
        "Delete Todo",
        `Are you sure you want to delete "${todo?.title || "this todo"}"?`,
        "This action cannot be undone."
      );

      if (!confirmed) return;

      log(`Deleting todo...`);
      localStore.deleteTodo(id);
      log(`✓ Todo deleted successfully`, "success");
    },
    [todos, localStore, log, confirm]
  );

  const handleEditTodo = useCallback(
    (id: string) => {
      const todo = todos.find((t) => t.id === id);
      if (!todo) return;

      const newTitle = window.prompt("Edit todo title:", todo.title);
      if (!newTitle || newTitle === todo.title) return;

      log(`Updating todo...`);
      localStore.updateTodo(id, { title: newTitle });
      log(`✓ Todo updated successfully`, "success");
    },
    [todos, localStore, log]
  );

  const handleSaveDetail = useCallback(
    (
      id: string,
      updates: { title?: string; description?: string; priority?: Todo["priority"] }
    ) => {
      log(`Updating todo details...`);
      localStore.updateTodo(id, updates);
      log(`✓ Todo details updated successfully`, "success");
    },
    [localStore, log]
  );

  const handleClearCompleted = useCallback(
    async (completedCount: number) => {
      const confirmed = await confirm(
        "Clear Completed",
        `Are you sure you want to clear all ${completedCount} completed todos?`,
        "This action cannot be undone."
      );

      if (!confirmed) return;

      log(`Clearing completed todos...`);
      localStore.clearCompleted();
      log(`✓ Completed todos cleared successfully`, "success");
    },
    [localStore, log, confirm]
  );

  return {
    handleAddTodo,
    handleToggleTodo,
    handleDeleteTodo,
    handleEditTodo,
    handleSaveDetail,
    handleClearCompleted,
  };
}
