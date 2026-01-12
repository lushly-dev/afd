/**
 * @fileoverview Batch operations hook for todo selection and bulk actions
 *
 * Extracts batch operations from App.tsx to reduce god component size.
 */

import { useState, useCallback } from "react";
import type { Todo, CommandResult } from "../types";
import { callTool } from "../api";

interface UseBatchOperationsProps {
  /** Filtered todos to operate on */
  filteredTodos: Todo[];
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
}

interface BatchOperations {
  selectedIds: Set<string>;
  toggleSelection: (id: string) => void;
  toggleSelectAll: () => void;
  clearSelection: () => void;
  handleToggleSelected: () => Promise<void>;
  handleDeleteSelected: () => Promise<void>;
}

export function useBatchOperations({
  filteredTodos,
  log,
  trackOperation,
  showResultToast,
  fetchData,
  confirm,
}: UseBatchOperationsProps): BatchOperations {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredTodos.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTodos.map((t) => t.id)));
    }
  }, [selectedIds.size, filteredTodos]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleToggleSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;

    log(`Calling todo-toggleBatch (${selectedIds.size} todos)...`);
    const ids = Array.from(selectedIds);
    const args = { ids };
    const res = await callTool<{ results: unknown[] }>("todo-toggleBatch", args);
    trackOperation("todo-toggleBatch", args, res as CommandResult<unknown>);
    if (res.success) {
      const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : "";
      log(`✓ todo-toggleBatch - ${res.reasoning || `Toggled ${ids.length} todos`}${time}`, "success");
      fetchData();
    } else {
      log(`✗ todo-toggleBatch: ${res.error?.message}`, "error");
    }
    showResultToast(res, "todo-toggleBatch");
  }, [selectedIds, log, trackOperation, showResultToast, fetchData]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;

    const confirmed = await confirm(
      "Delete Selected",
      `Are you sure you want to delete ${selectedIds.size} selected todo(s)?`,
      "This action cannot be undone."
    );

    if (!confirmed) return;

    log(`Calling todo-deleteBatch (${selectedIds.size} todos)...`);
    const ids = Array.from(selectedIds);
    const args = { ids };
    const res = await callTool<{ results: unknown[] }>("todo-deleteBatch", args);
    trackOperation("todo-deleteBatch", args, res as CommandResult<unknown>);
    if (res.success) {
      const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : "";
      log(`✓ todo-deleteBatch - ${res.reasoning || `Deleted ${ids.length} todos`}${time}`, "success");
      setSelectedIds(new Set());
      fetchData();
    } else {
      log(`✗ todo-deleteBatch: ${res.error?.message}`, "error");
    }
    showResultToast(res, "todo-deleteBatch");
  }, [selectedIds, log, trackOperation, showResultToast, fetchData, confirm]);

  return {
    selectedIds,
    toggleSelection,
    toggleSelectAll,
    clearSelection,
    handleToggleSelected,
    handleDeleteSelected,
  };
}
