import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Todo, TodoStats as ITodoStats, CommandResult, List } from "./types";
import { callTool } from "./api";
import { TodoItem } from "./components/TodoItem";
import { TodoForm } from "./components/TodoForm";
import { TodoStats } from "./components/TodoStats";
import { ToastContainer, useToast } from "./components/Toast";
import { CommandLog, useCommandLog } from "./components/CommandLog";
import { ConfirmModal } from "./components/ConfirmModal";
import { TodoDetailModal } from "./components/TodoDetailModal";
import { TrustPanel } from "./components/TrustPanel";
import { ErrorRecovery } from "./components/ErrorRecovery";
import { Sidebar } from "./components/Sidebar";
import type { ViewType } from "./components/Sidebar";
import { KeyboardHelp } from "./components/KeyboardHelp";
import { useKeyboard } from "./hooks/useKeyboard";
import type { KeyboardShortcut } from "./hooks/useKeyboard";
import { DevModeDrawer } from "./components/DevModeDrawer";
import { ChatSidebar } from "./components/ChatSidebar";
import { useConfirm } from "./hooks/useConfirm";
import { useTheme } from "./hooks/useTheme";
import type { RemoteChanges } from "./components/Toast";
import "./App.css";

const POLL_INTERVAL = 3000; // 3 seconds

type FilterType = "all" | "pending" | "completed";

interface LastOperation {
  command: string;
  args: Record<string, unknown>;
}

const App: React.FC = () => {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [stats, setStats] = useState<ITodoStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState<FilterType>("all");

  // Sidebar and view state
  const [activeView, setActiveView] = useState<ViewType>("inbox");
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Selection state for batch operations
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Dev mode drawer state
  const [devDrawerOpen, setDevDrawerOpen] = useState(false);

  // Chat sidebar state
  const [chatSidebarOpen, setChatSidebarOpen] = useState(true);

  // Detail modal state
  const [detailTodo, setDetailTodo] = useState<Todo | null>(null);

  // Trust panel state
  const [lastResult, setLastResult] = useState<CommandResult<unknown> | null>(null);
  const [lastCommandName, setLastCommandName] = useState("");
  const [showTrustPanel, setShowTrustPanel] = useState(false);

  // Error recovery state
  const [lastOperation, setLastOperation] = useState<LastOperation | null>(null);
  const [errorState, setErrorState] = useState<{
    isVisible: boolean;
    commandName: string;
    message: string;
    suggestion?: string;
  }>({ isVisible: false, commandName: "", message: "" });

  // Keyboard navigation state
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const { toasts, removeToast, showResultToast, showRemoteChanges } = useToast();
  const { entries: logEntries, log } = useCommandLog();
  const { state: confirmState, confirm, handleConfirm, handleCancel } = useConfirm();
  const { theme, toggleTheme } = useTheme();

  // Track previous todos for remote change detection
  const previousTodosRef = useRef<Map<string, Todo>>(new Map());
  // Track whether we've established a baseline (to avoid false positives on first load)
  const hasBaselineRef = useRef(false);

  // Detect changes between previous and current todos
  const detectRemoteChanges = useCallback((currentTodos: Todo[]): RemoteChanges => {
    const changes: RemoteChanges = {
      added: [],
      deleted: [],
      completed: [],
      uncompleted: [],
      updated: [],
    };

    const currentMap = new Map(currentTodos.map(t => [t.id, t]));
    const previousMap = previousTodosRef.current;

    // Find deleted and modified todos
    for (const [id, prevTodo] of previousMap) {
      const currentTodo = currentMap.get(id);
      if (!currentTodo) {
        changes.deleted.push({ id: prevTodo.id, title: prevTodo.title });
      } else {
        if (!prevTodo.completed && currentTodo.completed) {
          changes.completed.push({ id: currentTodo.id, title: currentTodo.title });
        } else if (prevTodo.completed && !currentTodo.completed) {
          changes.uncompleted.push({ id: currentTodo.id, title: currentTodo.title });
        } else if (prevTodo.title !== currentTodo.title || prevTodo.priority !== currentTodo.priority) {
          changes.updated.push({ id: currentTodo.id, title: currentTodo.title });
        }
      }
    }

    // Find added todos
    for (const todo of currentTodos) {
      if (!previousMap.has(todo.id)) {
        changes.added.push({ id: todo.id, title: todo.title });
      }
    }

    return changes;
  }, []);

  // Update the previous todos map
  const updatePreviousTodos = useCallback((todos: Todo[]) => {
    previousTodosRef.current = new Map(todos.map(t => [t.id, { ...t }]));
    hasBaselineRef.current = true;
  }, []);

  // Check connection health
  const checkConnection = useCallback(async () => {
    try {
      const response = await fetch("http://localhost:3100/health");
      const data = await response.json();
      setConnected(data.status === "ok");
      return data.status === "ok";
    } catch {
      setConnected(false);
      return false;
    }
  }, []);

  // Fetch lists
  const fetchLists = useCallback(async () => {
    try {
      const res = await callTool<{ lists: List[] }>("list-list", {});
      if (res.success && res.data) {
        setLists(res.data.lists);
      }
    } catch (err) {
      console.error("Failed to fetch lists:", err);
    }
  }, []);

  // Fetch data (silent mode for polling)
  const fetchData = useCallback(async (options: { silent?: boolean; detectChanges?: boolean } = {}) => {
    const { silent = false, detectChanges = false } = options;

    try {
      if (!silent) setLoading(true);

      const [todosRes, statsRes] = await Promise.all([
        callTool<{ todos: Todo[] }>("todo-list", { limit: 100 }),
        callTool<ITodoStats>("todo-stats", {}),
      ]);

      if (todosRes.success && todosRes.data) {
        const newTodos = todosRes.data.todos;

        // Detect and notify remote changes
        // Only detect if we have established a baseline (prevents false positives on first load)
        if (detectChanges && hasBaselineRef.current) {
          const changes = detectRemoteChanges(newTodos);
          const hasChanges =
            changes.added.length > 0 ||
            changes.deleted.length > 0 ||
            changes.completed.length > 0 ||
            changes.uncompleted.length > 0 ||
            changes.updated.length > 0;

          if (hasChanges) {
            showRemoteChanges(changes);
          }
        }

        updatePreviousTodos(newTodos);
        setTodos(newTodos);
      }

      if (statsRes.success && statsRes.data) {
        setStats(statsRes.data);
      }

      setError(null);
    } catch (err) {
      if (!silent) {
        setError("Failed to fetch data from MCP server");
      }
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [detectRemoteChanges, updatePreviousTodos, showRemoteChanges]);

  // Initial load
  useEffect(() => {
    const init = async () => {
      const isConnected = await checkConnection();
      if (isConnected) {
        await Promise.all([fetchData(), fetchLists()]);
      }
    };
    init();
  }, [checkConnection, fetchData, fetchLists]);

  // Polling for external changes
  useEffect(() => {
    const interval = setInterval(async () => {
      const isConnected = await checkConnection();
      if (isConnected) {
        await fetchData({ silent: true, detectChanges: true });
      }
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [checkConnection, fetchData]);

  // Helper to track operation and show trust panel
  const trackOperation = (commandName: string, args: Record<string, unknown>, result: CommandResult<unknown>) => {
    setLastOperation({ command: commandName, args });
    setLastResult(result);
    setLastCommandName(commandName);

    // Show trust panel if result has confidence/reasoning/sources
    if (result.confidence !== undefined || result.reasoning || result.sources?.length || result.plan?.length) {
      setShowTrustPanel(true);
    }

    // Handle errors with recovery
    if (!result.success && result.error) {
      setErrorState({
        isVisible: true,
        commandName,
        message: result.error.message,
        suggestion: result.error.suggestion,
      });
    }
  };

  // View change handler
  const handleViewChange = (view: ViewType, listId?: string) => {
    setActiveView(view);
    setActiveListId(listId || null);
    setSidebarOpen(false);
  };

  // Create list handler
  const handleCreateList = async () => {
    const name = window.prompt("Enter list name:");
    if (!name) return;

    log(`Calling list-create...`);
    const args = { name };
    const res = await callTool<List>("list-create", args);
    trackOperation("list-create", args, res as CommandResult<unknown>);
    if (res.success) {
      const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : "";
      log(`✓ list-create - ${res.reasoning || "List created"}${time}`, "success");
      fetchLists();
    } else {
      log(`✗ list-create: ${res.error?.message}`, "error");
    }
    showResultToast(res, "list-create");
  };

  const handleAddTodo = async (title: string, priority: string = "medium", description?: string) => {
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
  };

  const handleToggleTodo = async (id: string) => {
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
  };

  const handleDeleteTodo = async (id: string) => {
    const todo = todos.find(t => t.id === id);
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
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      fetchData();
    } else {
      log(`✗ todo-delete: ${res.error?.message}`, "error");
    }
    showResultToast(res, "todo-delete");
  };

  const handleEditTodo = async (id: string) => {
    const todo = todos.find(t => t.id === id);
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
  };

  // View detail handler - opens modal with full todo details
  const handleViewDetail = (id: string) => {
    const todo = todos.find(t => t.id === id);
    if (todo) {
      setDetailTodo(todo);
    }
  };

  // Save detail handler - updates todo with description/notes
  const handleSaveDetail = async (id: string, updates: { title?: string; description?: string; priority?: Todo['priority'] }) => {
    log(`Calling todo-update...`);
    const args = { id, ...updates };
    const res = await callTool<Todo>("todo-update", args);
    trackOperation("todo-update", args, res as CommandResult<unknown>);
    if (res.success) {
      const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : "";
      log(`✓ todo-update - ${res.reasoning || "Todo updated"}${time}`, "success");
      // Update the detail modal with fresh data
      if (res.data) {
        setDetailTodo(res.data);
      }
      fetchData();
    } else {
      log(`✗ todo-update: ${res.error?.message}`, "error");
    }
    showResultToast(res, "todo-update");
  };

  const handleClearCompleted = async () => {
    const confirmed = await confirm(
      "Clear Completed",
      `Are you sure you want to clear all ${stats?.completed || 0} completed todos?`,
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
  };

  // Batch operations
  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredTodos.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTodos.map(t => t.id)));
    }
  };

  const handleToggleSelected = async () => {
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
  };

  const handleDeleteSelected = async () => {
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
  };

  // Error recovery retry
  const handleRetry = async () => {
    if (!lastOperation) return;

    setErrorState({ ...errorState, isVisible: false });
    log(`Retrying ${lastOperation.command}...`);
    const res = await callTool<unknown>(lastOperation.command, lastOperation.args);
    trackOperation(lastOperation.command, lastOperation.args, res as CommandResult<unknown>);
    if (res.success) {
      const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : "";
      log(`✓ ${lastOperation.command} - Retry successful${time}`, "success");
      fetchData();
    } else {
      log(`✗ ${lastOperation.command}: Retry failed - ${res.error?.message}`, "error");
    }
    showResultToast(res, lastOperation.command);
  };

  const handleDismissError = () => {
    setErrorState({ ...errorState, isVisible: false });
  };

  // Get active list for filtering
  const activeList = activeListId ? lists.find(l => l.id === activeListId) : null;

  // Filter todos based on current view and filter
  const filteredTodos = todos.filter(todo => {
    // View-based filtering
    if (activeView === "list" && activeList) {
      if (!activeList.todoIds.includes(todo.id)) return false;
    }
    // Note: "today" view would filter by due date when implemented
    // For now, "inbox" and "today" show all todos

    // Status-based filtering
    if (filter === "pending") return !todo.completed;
    if (filter === "completed") return todo.completed;
    return true;
  });

  // Calculate counts for sidebar
  const inboxCount = todos.filter(t => !t.completed).length;
  const todayCount = todos.filter(t => !t.completed).length; // Same as inbox for now

  // Get view title
  const getViewTitle = () => {
    if (activeView === "list" && activeList) {
      return activeList.name;
    }
    if (activeView === "today") {
      return "Today";
    }
    return "Inbox";
  };

  // Keyboard shortcuts
  const shortcuts: KeyboardShortcut[] = useMemo(() => [
    { key: "n", description: "Add new todo", action: () => titleInputRef.current?.focus() },
    { key: "j", description: "Navigate to next todo", action: () => setFocusedIndex(i => Math.min(i + 1, filteredTodos.length - 1)) },
    { key: "k", description: "Navigate to previous todo", action: () => setFocusedIndex(i => Math.max(i - 1, 0)) },
    { key: " ", description: "Toggle focused todo", action: () => { if (focusedIndex >= 0 && filteredTodos[focusedIndex]) handleToggleTodo(filteredTodos[focusedIndex].id); }, when: () => focusedIndex >= 0 },
    { key: "Enter", description: "Toggle focused todo", action: () => { if (focusedIndex >= 0 && filteredTodos[focusedIndex]) handleToggleTodo(filteredTodos[focusedIndex].id); }, when: () => focusedIndex >= 0 },
    { key: "e", description: "Edit focused todo", action: () => { if (focusedIndex >= 0 && filteredTodos[focusedIndex]) handleEditTodo(filteredTodos[focusedIndex].id); }, when: () => focusedIndex >= 0 },
    { key: "Delete", description: "Delete focused todo", action: () => { if (focusedIndex >= 0 && filteredTodos[focusedIndex]) handleDeleteTodo(filteredTodos[focusedIndex].id); }, when: () => focusedIndex >= 0 },
    { key: "Backspace", description: "Delete focused todo", action: () => { if (focusedIndex >= 0 && filteredTodos[focusedIndex]) handleDeleteTodo(filteredTodos[focusedIndex].id); }, when: () => focusedIndex >= 0 },
    { key: "Escape", description: "Clear focus", action: () => setFocusedIndex(-1) },
    { key: "a", description: "Select all todos", action: () => toggleSelectAll() },
    { key: "c", description: "Clear completed", action: () => { if (stats && stats.completed > 0) handleClearCompleted(); }, when: () => !!(stats && stats.completed > 0) },
    { key: "?", description: "Show keyboard shortcuts", action: () => setShowKeyboardHelp(true) },
  ], [filteredTodos, focusedIndex, stats]);

  useKeyboard({ shortcuts });

  return (
    <div className="app-shell">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        warning={confirmState.warning}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
      <KeyboardHelp
        isOpen={showKeyboardHelp}
        onClose={() => setShowKeyboardHelp(false)}
        shortcuts={shortcuts}
      />
      <DevModeDrawer
        isOpen={devDrawerOpen}
        onClose={() => setDevDrawerOpen(false)}
        lastResult={lastResult}
        lastCommandName={lastCommandName}
        logEntries={logEntries}
      />
      <TodoDetailModal
        todo={detailTodo}
        onClose={() => setDetailTodo(null)}
        onSave={handleSaveDetail}
      />

      {/* Mobile sidebar overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? "visible" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      <Sidebar
        activeView={activeView}
        activeListId={activeListId}
        lists={lists}
        onViewChange={handleViewChange}
        onCreateList={handleCreateList}
        todayCount={todayCount}
        inboxCount={inboxCount}
        theme={theme}
        onThemeToggle={toggleTheme}
      />

      <div className="app-main">
        <header className="app-header">
          <div className="header-left">
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <div className="header-title">
              <h1>{getViewTitle()}</h1>
              <span className="badge">AFD</span>
            </div>
          </div>
          <div className="header-right">
            <button
              type="button"
              className="keyboard-help-btn"
              onClick={() => setShowKeyboardHelp(true)}
              title="Keyboard shortcuts (?)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
                <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8" />
              </svg>
            </button>
            <button
              type="button"
              className="dev-mode-btn"
              onClick={() => setDevDrawerOpen(true)}
              title="Open Dev Mode"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
            <button
              type="button"
              className="dev-mode-btn"
              onClick={() => setChatSidebarOpen(!chatSidebarOpen)}
              title={chatSidebarOpen ? "Hide AI Copilot" : "Show AI Copilot"}
            >
              <span style={{ fontSize: "14px" }}>🤖</span>
            </button>
            <div className="connection-status">
              <span className={`status-dot ${connected ? "connected" : ""}`}></span>
              <span>{connected ? "Connected" : "Disconnected"}</span>
            </div>
          </div>
        </header>

        <main className="app-content">
          <TodoStats stats={stats} />

          {showTrustPanel && lastResult && (
            <TrustPanel
              result={lastResult}
              commandName={lastCommandName}
              onClose={() => setShowTrustPanel(false)}
            />
          )}

          {errorState.isVisible && (
            <ErrorRecovery
              isVisible={errorState.isVisible}
              commandName={errorState.commandName}
              errorMessage={errorState.message}
              suggestion={errorState.suggestion}
              onRetry={handleRetry}
              onDismiss={handleDismissError}
            />
          )}

          <TodoForm onAdd={handleAddTodo} titleInputRef={titleInputRef} />

          <div className="todo-list-card">
            <div className="filters">
              <button
                className={`filter-btn ${filter === "all" ? "active" : ""}`}
                onClick={() => setFilter("all")}
              >
                All
              </button>
              <button
                className={`filter-btn ${filter === "pending" ? "active" : ""}`}
                onClick={() => setFilter("pending")}
              >
                Pending
              </button>
              <button
                className={`filter-btn ${filter === "completed" ? "active" : ""}`}
                onClick={() => setFilter("completed")}
              >
                Completed
              </button>
              {stats && stats.completed > 0 && (
                <button className="clear-btn" onClick={handleClearCompleted}>
                  Clear Completed
                </button>
              )}
            </div>

            {/* Batch controls */}
            {filteredTodos.length > 0 && (
              <div className="batch-controls">
                <label className="select-all-label">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filteredTodos.length && filteredTodos.length > 0}
                    onChange={toggleSelectAll}
                  />
                  <span>Select All ({selectedIds.size}/{filteredTodos.length})</span>
                </label>
                {selectedIds.size > 0 && (
                  <div className="batch-actions">
                    <button className="batch-btn toggle" onClick={handleToggleSelected}>
                      Toggle Selected
                    </button>
                    <button className="batch-btn delete" onClick={handleDeleteSelected}>
                      Delete Selected
                    </button>
                  </div>
                )}
              </div>
            )}

            {loading && <div className="loading">Loading todos...</div>}
            {error && <div className="error">{error}</div>}

            <div className="todo-list">
              {filteredTodos.length === 0 && !loading ? (
                <p className="empty-state">No todos yet. Add one above!</p>
              ) : (
                filteredTodos.map((todo, index) => (
                  <TodoItem
                    key={todo.id}
                    todo={todo}
                    onToggle={handleToggleTodo}
                    onDelete={handleDeleteTodo}
                    onEdit={handleEditTodo}
                    onViewDetail={handleViewDetail}
                    selected={selectedIds.has(todo.id)}
                    onSelect={toggleSelection}
                    showSelect={true}
                    focused={index === focusedIndex}
                  />
                ))
              )}
            </div>
          </div>

          <CommandLog entries={logEntries} />
        </main>

        <footer className="app-footer">
          <p>
            Built with{" "}
            <a href="https://github.com/Falkicon/afd" target="_blank" rel="noopener noreferrer">
              Agent-First Development
            </a>
            . Same commands work via CLI, MCP, and this UI. Press <kbd>?</kbd> for keyboard shortcuts.
          </p>
        </footer>
      </div>

      {/* AI Copilot Chat Sidebar */}
      <ChatSidebar
        isOpen={chatSidebarOpen}
        onToggle={() => setChatSidebarOpen(!chatSidebarOpen)}
        onTodosChanged={() => fetchData()}
      />
    </div>
  );
};

export default App;
