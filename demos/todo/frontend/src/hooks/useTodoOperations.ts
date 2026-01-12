/**
 * @fileoverview Todo CRUD operations hook
 *
 * Extracts todo operations from App.tsx to reduce god component size.
 * Provides all handlers for creating, reading, updating, and deleting todos.
 * Now uses Convex for reactive data operations.
 */

import { useCallback } from "react";
import type { Todo } from "../types";
import { useConvexTodos } from "./useConvexTodos";

interface UseTodoOperationsProps {
  /** Callback to log operations */
  log: (message: string, status?: "success" | "error") => void;
  /** Confirm dialog hook */
  confirm: (title: string, message: string, warning: string) => Promise<boolean>;
  /** Current todos list */
  todos: Todo[];
}

interface TodoOperations {
  handleAddTodo: (
    title: string,
    priority?: string,
    description?: string
  ) => Promise<void>;
  handleToggleTodo: (id: string) => Promise<void>;
  handleDeleteTodo: (id: string) => Promise<void>;
  handleEditTodo: (id: string) => Promise<void>;
  handleSaveDetail: (
    id: string,
    updates: { title?: string; description?: string; priority?: Todo["priority"] }
  ) => Promise<void>;
  handleClearCompleted: (completedCount: number) => Promise<void>;
}

export function useTodoOperations({
  log,
  confirm,
  todos,
}: UseTodoOperationsProps): TodoOperations {
  const { create, update, toggle, remove, clearCompleted } = useConvexTodos();
  const handleAddTodo = useCallback(
    async (title: string, priority: string = "medium", description?: string) => {
      try {
        log(`Creating todo...`);
        let priorityValue: "low" | "medium" | "high" = "medium";
        const lowercasePriority = priority.toLowerCase();
        if (lowercasePriority === "low") priorityValue = "low";
        else if (lowercasePriority === "high") priorityValue = "high";
        else if (lowercasePriority === "none") priorityValue = "low";
        else priorityValue = "medium";

        await create(title, {
          description,
          priority: priorityValue
        });
        log(`✓ Todo created successfully`, "success");
      } catch (error) {
        log(`✗ Failed to create todo: ${error}`, "error");
      }
    },
    [create, log]
  );

  const handleToggleTodo = useCallback(
    async (id: string) => {
      try {
        log(`Toggling todo...`);
        await toggle(id);
        log(`✓ Todo toggled successfully`, "success");
      } catch (error) {
        log(`✗ Failed to toggle todo: ${error}`, "error");
      }
    },
    [toggle, log]
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

      try {
        log(`Deleting todo...`);
        await remove(id);
        log(`✓ Todo deleted successfully`, "success");
      } catch (error) {
        log(`✗ Failed to delete todo: ${error}`, "error");
      }
    },
    [todos, remove, log, confirm]
  );

  const handleEditTodo = useCallback(
    async (id: string) => {
      const todo = todos.find((t) => t.id === id);
      if (!todo) return;

      const newTitle = window.prompt("Edit todo title:", todo.title);
      if (!newTitle || newTitle === todo.title) return;

      try {
        log(`Updating todo...`);
        await update(id, { title: newTitle });
        log(`✓ Todo updated successfully`, "success");
      } catch (error) {
        log(`✗ Failed to update todo: ${error}`, "error");
      }
    },
    [todos, update, log]
  );

  const handleSaveDetail = useCallback(
    async (
      id: string,
      updates: { title?: string; description?: string; priority?: Todo["priority"] }
    ) => {
      try {
        log(`Updating todo details...`);
        // Pass updates directly to Convex (priorities are already strings)
        const convexUpdates: { title?: string; description?: string; priority?: "low" | "medium" | "high" } = {};
        if (updates.title !== undefined) convexUpdates.title = updates.title;
        if (updates.description !== undefined) convexUpdates.description = updates.description;
        if (updates.priority !== undefined) {
          convexUpdates.priority = updates.priority as "low" | "medium" | "high";
        }

        await update(id, convexUpdates);
        log(`✓ Todo details updated successfully`, "success");
      } catch (error) {
        log(`✗ Failed to update todo details: ${error}`, "error");
      }
    },
    [update, log]
  );

  const handleClearCompleted = useCallback(
    async (completedCount: number) => {
      const confirmed = await confirm(
        "Clear Completed",
        `Are you sure you want to clear all ${completedCount} completed todos?`,
        "This action cannot be undone."
      );

      if (!confirmed) return;

      try {
        log(`Clearing completed todos...`);
        await clearCompleted();
        log(`✓ Completed todos cleared successfully`, "success");
      } catch (error) {
        log(`✗ Failed to clear completed todos: ${error}`, "error");
      }
    },
    [clearCompleted, log, confirm]
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
