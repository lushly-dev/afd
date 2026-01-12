/**
 * @fileoverview Todo CRUD operations hook
 *
 * Extracts todo operations from App.tsx to reduce god component size.
 * Provides all handlers for creating, reading, updating, and deleting todos.
 */

import { useCallback } from "react";
import type { Todo, CommandResult } from "../types";
import { callTool } from "../api";

interface UseTodoOperationsProps {
  /** Callback to log operations */
  log: (message: string, status?: "success" | "error") => void;
  /** Callback to track the last operation for recovery */
  trackOperation: (
    commandName: string,
    args: Record<string, unknown>,
    result: CommandResult<unknown>
  ) => void;
  /** Callback to show result toast */
  showResultToast: (result: CommandResult<unknown>, commandName: string) => void;
  /** Callback to refresh data after mutation */
  fetchData: () => Promise<void>;
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
  trackOperation,
  showResultToast,
  fetchData,
  confirm,
  todos,
}: UseTodoOperationsProps): TodoOperations {
  const handleAddTodo = useCallback(
    async (title: string, priority: string = "medium", description?: string) => {
      // Convert priority string to number (0=none, 1=low, 2=medium, 3=high)
      const priorityMap: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };
      const priorityNum = priorityMap[priority.toLowerCase()] ?? 2;

      log(`Calling todo-create...`);
      const args = { title, priority: priorityNum, description };
      const res = await callTool<Todo>("todo-create", args);
      trackOperation("todo-create", args, res as CommandResult<unknown>);
      if (res.success) {
        const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : "";
        log(`✓ todo-create - ${res.reasoning || "Todo created"}${time}`, "success");
        fetchData();
      } else {
        log(`✗ todo-create: ${res.error?.message}`, "error");
      }
      showResultToast(res, "todo-create");
    },
    [log, trackOperation, showResultToast, fetchData]
  );

  const handleToggleTodo = useCallback(
    async (id: string) => {
      log(`Calling todo-toggle...`);
      const args = { id };
      const res = await callTool<Todo>("todo-toggle", args);
      trackOperation("todo-toggle", args, res as CommandResult<unknown>);
      if (res.success) {
        const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : "";
        log(`✓ todo-toggle - ${res.reasoning || "Todo toggled"}${time}`, "success");
        fetchData();
      } else {
        log(`✗ todo-toggle: ${res.error?.message}`, "error");
      }
      showResultToast(res, "todo-toggle");
    },
    [log, trackOperation, showResultToast, fetchData]
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

      log(`Calling todo-delete...`);
      const args = { id };
      const res = await callTool<{ id: string }>("todo-delete", args);
      trackOperation("todo-delete", args, res as CommandResult<unknown>);
      if (res.success) {
        const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : "";
        log(`✓ todo-delete - ${res.reasoning || "Todo deleted"}${time}`, "success");
        fetchData();
      } else {
        log(`✗ todo-delete: ${res.error?.message}`, "error");
      }
      showResultToast(res, "todo-delete");
    },
    [todos, log, trackOperation, showResultToast, fetchData, confirm]
  );

  const handleEditTodo = useCallback(
    async (id: string) => {
      const todo = todos.find((t) => t.id === id);
      if (!todo) return;

      const newTitle = window.prompt("Edit todo title:", todo.title);
      if (!newTitle || newTitle === todo.title) return;

      log(`Calling todo-update...`);
      const args = { id, title: newTitle };
      const res = await callTool<Todo>("todo-update", args);
      trackOperation("todo-update", args, res as CommandResult<unknown>);
      if (res.success) {
        const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : "";
        log(`✓ todo-update - ${res.reasoning || "Todo updated"}${time}`, "success");
        fetchData();
      } else {
        log(`✗ todo-update: ${res.error?.message}`, "error");
      }
      showResultToast(res, "todo-update");
    },
    [todos, log, trackOperation, showResultToast, fetchData]
  );

  const handleSaveDetail = useCallback(
    async (
      id: string,
      updates: { title?: string; description?: string; priority?: Todo["priority"] }
    ) => {
      log(`Calling todo-update...`);
      const args = { id, ...updates };
      const res = await callTool<Todo>("todo-update", args);
      trackOperation("todo-update", args, res as CommandResult<unknown>);
      if (res.success) {
        const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : "";
        log(`✓ todo-update - ${res.reasoning || "Todo updated"}${time}`, "success");
        fetchData();
      } else {
        log(`✗ todo-update: ${res.error?.message}`, "error");
      }
      showResultToast(res, "todo-update");
      return res.data; // Return updated todo for modal
    },
    [log, trackOperation, showResultToast, fetchData]
  );

  const handleClearCompleted = useCallback(
    async (completedCount: number) => {
      const confirmed = await confirm(
        "Clear Completed",
        `Are you sure you want to clear all ${completedCount} completed todos?`,
        "This action cannot be undone."
      );

      if (!confirmed) return;

      log(`Calling todo-clear...`);
      const args = {};
      const res = await callTool<{ count: number }>("todo-clear", args);
      trackOperation("todo-clear", args, res as CommandResult<unknown>);
      if (res.success) {
        const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : "";
        log(`✓ todo-clear - ${res.reasoning || "Cleared completed"}${time}`, "success");
        fetchData();
      } else {
        log(`✗ todo-clear: ${res.error?.message}`, "error");
      }
      showResultToast(res, "todo-clear");
    },
    [log, trackOperation, showResultToast, fetchData, confirm]
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
