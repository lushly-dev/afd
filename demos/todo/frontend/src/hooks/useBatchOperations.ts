/**
 * @fileoverview Batch operations hook for todo selection and bulk actions
 *
 * Extracts batch operations from App.tsx to reduce god component size.
 * Now uses LocalStore for instant local updates, synced to Convex in background.
 */

import { useState, useCallback } from "react";
import type { Todo } from "../types";
import type { LocalStore } from "./useLocalStore";

interface UseBatchOperationsProps {
  /** LocalStore instance for local-first operations */
  localStore: LocalStore;
  /** Filtered todos to operate on */
  filteredTodos: Todo[];
  /** Callback to log operations */
  log: (message: string, status?: "success" | "error") => void;
  /** Confirm dialog hook */
  confirm: (title: string, message: string, warning: string) => Promise<boolean>;
}

interface BatchOperations {
  selectedIds: Set<string>;
  toggleSelection: (id: string) => void;
  toggleSelectAll: () => void;
  clearSelection: () => void;
  handleToggleSelected: () => void;
  handleDeleteSelected: () => Promise<void>;
}

export function useBatchOperations({
  localStore,
  filteredTodos,
  log,
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

  const handleToggleSelected = useCallback(() => {
    if (selectedIds.size === 0) return;

    log(`Toggling ${selectedIds.size} selected todos...`);
    const ids = Array.from(selectedIds);

    // Determine what to set completed to based on majority state
    const selectedTodos = filteredTodos.filter(t => selectedIds.has(t.id));
    const completedCount = selectedTodos.filter(t => t.completed).length;
    const shouldComplete = completedCount < selectedTodos.length / 2;

    localStore.batchToggle(ids, shouldComplete);
    log(`✓ Toggled ${ids.length} todos successfully`, "success");
  }, [selectedIds, filteredTodos, localStore, log]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;

    const confirmed = await confirm(
      "Delete Selected",
      `Are you sure you want to delete ${selectedIds.size} selected todo(s)?`,
      "This action cannot be undone."
    );

    if (!confirmed) return;

    log(`Deleting ${selectedIds.size} selected todos...`);
    const ids = Array.from(selectedIds);

    localStore.batchDelete(ids);
    setSelectedIds(new Set());
    log(`✓ Deleted ${ids.length} todos successfully`, "success");
  }, [selectedIds, localStore, log, confirm]);

  return {
    selectedIds,
    toggleSelection,
    toggleSelectAll,
    clearSelection,
    handleToggleSelected,
    handleDeleteSelected,
  };
}
