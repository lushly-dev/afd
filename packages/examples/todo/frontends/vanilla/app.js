/**
 * Todo App UI
 *
 * This UI demonstrates AFD principles by displaying UX-enabling metadata:
 * - confidence: Shows reliability indicators on operations
 * - reasoning: Explains what the command did
 * - warnings: Alerts users to important information
 * - suggestions: Shows recovery steps on errors
 * - alternatives: Offers other query options
 * - metadata.executionTimeMs: Shows performance data
 *
 * Same commands work via CLI, MCP clients, and this UI.
 */

// Configuration
const SERVER_URL = "http://localhost:3100";
let messageId = 0;
let currentFilter = "all";
let lastOperation = null; // Store last operation for retry

// DOM Elements
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const addForm = document.getElementById("addForm");
const newTodoTitle = document.getElementById("newTodoTitle");
const newTodoPriority = document.getElementById("newTodoPriority");
const todoList = document.getElementById("todoList");
const logPanel = document.getElementById("logPanel");
const clearCompletedBtn = document.getElementById("clearCompleted");
const filterBtns = document.querySelectorAll(".filter-btn[data-filter]");
const toastContainer = document.getElementById("toastContainer");
const confirmModal = document.getElementById("confirmModal");
const alternativesPanel = document.getElementById("alternativesPanel");
const alternativesList = document.getElementById("alternativesList");
const selectAllCheckbox = document.getElementById("selectAll");
const batchActions = document.getElementById("batchActions");
const deleteSelectedBtn = document.getElementById("deleteSelected");
const toggleSelectedBtn = document.getElementById("toggleSelected");

// Trust Panel Elements
const trustPanel = document.getElementById("trustPanel");
const trustCommand = document.getElementById("trustCommand");
const trustConfidence = document.getElementById("trustConfidence");
const trustConfidenceFill = document.getElementById("trustConfidenceFill");
const trustConfidenceValue = document.getElementById("trustConfidenceValue");
const trustConfidenceLabel = document.getElementById("trustConfidenceLabel");
const trustReasoning = document.getElementById("trustReasoning");
const trustReasoningText = document.getElementById("trustReasoningText");
const trustSources = document.getElementById("trustSources");
const trustSourcesList = document.getElementById("trustSourcesList");
const trustPlan = document.getElementById("trustPlan");
const trustPlanSteps = document.getElementById("trustPlanSteps");

// Error Recovery Elements
const errorRecovery = document.getElementById("errorRecovery");
const errorMessage = document.getElementById("errorMessage");
const errorSuggestion = document.getElementById("errorSuggestion");
const errorSuggestionText = document.getElementById("errorSuggestionText");

// Stats elements
const statTotal = document.getElementById("statTotal");
const statPending = document.getElementById("statPending");
const statCompleted = document.getElementById("statCompleted");
const statRate = document.getElementById("statRate");

let selectedIds = new Set();

// ═══════════════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Show a toast notification with full AFD metadata.
 */
function showToast(result, commandName) {
  const toast = document.createElement("div");
  const type = result.success ? "success" : "error";
  toast.className = `toast ${type}`;

  // Build confidence display
  let confidenceHtml = "";
  if (result.confidence !== undefined) {
    const confidencePercent = Math.round(result.confidence * 100);
    const confidenceClass =
      result.confidence >= 0.9
        ? ""
        : result.confidence >= 0.7
        ? "medium"
        : "low";
    confidenceHtml = `
      <span class="toast-confidence">
        <span class="confidence-bar">
          <span class="confidence-fill ${confidenceClass}" style="width: ${confidencePercent}%"></span>
        </span>
        ${confidencePercent}%
      </span>
    `;
  }

  // Build execution time display
  let timeHtml = "";
  if (result.metadata?.executionTimeMs !== undefined) {
    timeHtml = `<span>⚡ ${result.metadata.executionTimeMs}ms</span>`;
  }

  // Build suggestion display (for errors)
  let suggestionHtml = "";
  if (!result.success && result.error?.suggestion) {
    suggestionHtml = `
      <div class="toast-suggestion">
        <strong>💡 Suggestion:</strong> ${escapeHtml(result.error.suggestion)}
      </div>
    `;
  }

  // Build retry button for retryable errors
  let actionsHtml = "";
  if (!result.success && result.error?.retryable !== false) {
    actionsHtml = `
      <div class="toast-actions">
        <button class="toast-retry" onclick="retryLastOperation(); this.closest('.toast').remove();">🔄 Retry</button>
        <button class="toast-dismiss" onclick="this.closest('.toast').remove();">Dismiss</button>
      </div>
    `;
  }

  // Main message
  const message = result.success
    ? result.reasoning || `${commandName} completed`
    : result.error?.message || "Operation failed";

  toast.innerHTML = `
    <span class="toast-icon">${result.success ? "✓" : "✗"}</span>
    <div class="toast-content">
      <div class="toast-message">${escapeHtml(message)}</div>
      <div class="toast-meta">
        ${confidenceHtml}
        ${timeHtml}
      </div>
      ${suggestionHtml}
      ${actionsHtml}
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;

  toastContainer.appendChild(toast);

  // Auto-remove after 5 seconds (longer for errors with actions)
  const duration = !result.success && actionsHtml ? 10000 : 5000;
  setTimeout(() => {
    toast.style.animation = "slideIn 0.3s ease reverse";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Show warnings from a command result.
 */
function showWarnings(warnings) {
  if (!warnings || warnings.length === 0) return;

  for (const warning of warnings) {
    const toast = document.createElement("div");
    toast.className = "toast warning";
    toast.innerHTML = `
      <span class="toast-icon">⚠️</span>
      <div class="toast-content">
        <div class="toast-message">${escapeHtml(warning.message)}</div>
        <div class="toast-meta">
          <span>${warning.code}</span>
          ${
            warning.severity ? `<span>Severity: ${warning.severity}</span>` : ""
          }
        </div>
      </div>
      <button class="toast-close" onclick="this.parentElement.remove()">×</button>
    `;
    toastContainer.appendChild(toast);

    // Warnings stay longer
    setTimeout(() => {
      toast.style.animation = "slideIn 0.3s ease reverse";
      setTimeout(() => toast.remove(), 300);
    }, 8000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRUST PANEL - Display trust signals (confidence, sources, plan, reasoning)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Update the trust panel with data from a command result.
 * Shows confidence, reasoning, sources, and plan if available.
 */
function updateTrustPanel(result, commandName) {
  // Don't show trust panel for silent/query operations
  if (!result) return;

  const hasConfidence = result.confidence !== undefined;
  const hasReasoning = result.reasoning !== undefined;
  const hasSources = result.sources && result.sources.length > 0;
  const hasPlan = result.plan && result.plan.length > 0;

  // If no trust data, hide the panel
  if (!hasConfidence && !hasReasoning && !hasSources && !hasPlan) {
    trustPanel.classList.remove("visible");
    return;
  }

  // Show the panel
  trustPanel.classList.add("visible");
  trustCommand.textContent = `— ${commandName}`;

  // Update confidence section
  if (hasConfidence) {
    trustConfidence.style.display = "block";
    const percent = Math.round(result.confidence * 100);
    trustConfidenceValue.textContent = `${percent}%`;

    // Set color based on confidence level
    let colorClass = "";
    let label = "High confidence";
    if (result.confidence < 0.7) {
      colorClass = "low";
      label = "Low confidence - verify results";
    } else if (result.confidence < 0.9) {
      colorClass = "medium";
      label = "Moderate confidence";
    }

    trustConfidenceFill.className = `confidence-fill ${colorClass}`;
    trustConfidenceFill.style.width = `${percent}%`;
    trustConfidenceLabel.textContent = label;
  } else {
    trustConfidence.style.display = "none";
  }

  // Update reasoning section
  if (hasReasoning) {
    trustReasoning.style.display = "block";
    trustReasoningText.textContent = result.reasoning;
  } else {
    trustReasoning.style.display = "none";
  }

  // Update sources section
  if (hasSources) {
    trustSources.style.display = "block";
    trustSourcesList.innerHTML = result.sources
      .map((source) => {
        const icon = getSourceIcon(source.type);
        const relevancePercent = source.relevance
          ? `${Math.round(source.relevance * 100)}%`
          : "";
        const link = source.url
          ? `<a href="${escapeHtml(source.url)}" target="_blank" class="source-link">${escapeHtml(source.title || source.url)}</a>`
          : `<span>${escapeHtml(source.title || "Unknown source")}</span>`;

        return `
          <div class="source-item">
            <span class="source-icon">${icon}</span>
            ${link}
            ${relevancePercent ? `<span class="source-relevance">${relevancePercent} relevant</span>` : ""}
          </div>
        `;
      })
      .join("");
  } else {
    trustSources.style.display = "none";
  }

  // Update plan section
  if (hasPlan) {
    trustPlan.style.display = "block";
    trustPlanSteps.innerHTML = result.plan
      .map((step, idx) => {
        const icon = getPlanStepIcon(step.status);
        return `
          <div class="plan-step">
            <div class="plan-step-icon ${step.status || "pending"}">${icon}</div>
            <div class="plan-step-content">
              <div class="plan-step-name">${idx + 1}. ${escapeHtml(step.name || step.action)}</div>
              ${step.description ? `<div class="plan-step-desc">${escapeHtml(step.description)}</div>` : ""}
            </div>
          </div>
        `;
      })
      .join("");
  } else {
    trustPlan.style.display = "none";
  }
}

/**
 * Get icon for source type.
 */
function getSourceIcon(type) {
  const icons = {
    api: "🔌",
    database: "🗄️",
    file: "📄",
    url: "🔗",
    cache: "💾",
    user: "👤",
    system: "⚙️",
  };
  return icons[type] || "📚";
}

/**
 * Get icon for plan step status.
 */
function getPlanStepIcon(status) {
  const icons = {
    pending: "○",
    "in-progress": "◐",
    complete: "✓",
    failed: "✗",
  };
  return icons[status] || "○";
}

/**
 * Hide the trust panel.
 */
function hideTrustPanel() {
  trustPanel.classList.remove("visible");
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR RECOVERY - Enhanced error handling with retry
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Show error recovery panel with retry option.
 */
function showErrorRecovery(result, commandName, args) {
  // Store for retry
  lastOperation = { command: commandName, args };

  errorRecovery.classList.add("visible");
  errorMessage.textContent = `${commandName} failed: ${result.error?.message || "Unknown error"}`;

  if (result.error?.suggestion) {
    errorSuggestion.style.display = "block";
    errorSuggestionText.textContent = result.error.suggestion;
  } else {
    errorSuggestion.style.display = "none";
  }

  // Auto-hide after 30 seconds
  setTimeout(() => {
    hideErrorRecovery();
  }, 30000);
}

/**
 * Hide error recovery panel.
 */
function hideErrorRecovery() {
  errorRecovery.classList.remove("visible");
}

/**
 * Retry the last failed operation.
 */
async function retryLastOperation() {
  if (!lastOperation) return;

  hideErrorRecovery();
  log(`Retrying ${lastOperation.command}...`);

  const result = await callTool(lastOperation.command, lastOperation.args);

  if (result.success) {
    await Promise.all([loadTodos(), loadStats()]);
  }
}

// Make retry function available globally
window.retryLastOperation = retryLastOperation;
window.hideErrorRecovery = hideErrorRecovery;
window.hideTrustPanel = hideTrustPanel;

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIRMATION MODAL
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Show a confirmation dialog before destructive actions.
 * @param {string} title - Dialog title
 * @param {string} message - Dialog message
 * @param {string} [warning] - Optional warning message
 * @returns {Promise<boolean>} - Whether user confirmed
 */
function showConfirmation(title, message, warning = null) {
  return new Promise((resolve) => {
    const modalTitle = document.getElementById("modalTitle");
    const modalMessage = document.getElementById("modalMessage");
    const modalWarning = document.getElementById("modalWarning");
    const modalWarningText = document.getElementById("modalWarningText");
    const modalConfirm = document.getElementById("modalConfirm");
    const modalCancel = document.getElementById("modalCancel");

    modalTitle.textContent = title;
    modalMessage.textContent = message;

    if (warning) {
      modalWarning.style.display = "flex";
      modalWarningText.textContent = warning;
    } else {
      modalWarning.style.display = "none";
    }

    confirmModal.classList.add("visible");

    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    const handleKeydown = (e) => {
      if (e.key === "Escape") handleCancel();
      if (e.key === "Enter") handleConfirm();
    };

    const cleanup = () => {
      confirmModal.classList.remove("visible");
      modalConfirm.removeEventListener("click", handleConfirm);
      modalCancel.removeEventListener("click", handleCancel);
      document.removeEventListener("keydown", handleKeydown);
    };

    modalConfirm.addEventListener("click", handleConfirm);
    modalCancel.addEventListener("click", handleCancel);
    document.addEventListener("keydown", handleKeydown);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALTERNATIVES DISPLAY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Display alternatives from a command result.
 */
function showAlternatives(alternatives, applyCallback) {
  if (!alternatives || alternatives.length === 0) {
    alternativesPanel.style.display = "none";
    return;
  }

  alternativesPanel.style.display = "block";
  alternativesList.innerHTML = alternatives
    .map(
      (alt, idx) => `
      <div class="alternative-item">
        <span>${escapeHtml(alt.reason)}</span>
        <button onclick="window.applyAlternative(${idx})">Apply</button>
      </div>
    `
    )
    .join("");

  // Store alternatives and callback globally for onclick handlers
  window._alternatives = alternatives;
  window.applyAlternative = (idx) => {
    const alt = window._alternatives[idx];
    if (alt && applyCallback) {
      applyCallback(alt.data);
    }
  };
}

/**
 * Hide alternatives panel.
 */
function hideAlternatives() {
  alternativesPanel.style.display = "none";
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP COMMUNICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Call an MCP tool via HTTP.
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @param {object} options - Options
 * @param {boolean} options.silent - If true, don't show toasts or log
 * @param {boolean} options.showToast - If true, always show toast (for mutations)
 */
async function callTool(name, args = {}, options = {}) {
  const { silent = false, showToast: forceToast } = options;

  // Mutations should show toasts by default, queries should not
  const isMutation = [
    "todo-create",
    "todo-update",
    "todo-toggle",
    "todo-delete",
    "todo-clear",
  ].includes(name);
  const shouldShowToast = forceToast ?? (!silent && isMutation);
  const shouldLog = !silent;

  const id = ++messageId;

  if (shouldLog) {
    log(`Calling ${name}...`);
  }

  try {
    const response = await fetch(`${SERVER_URL}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    // Parse the result from the MCP response
    const content = data.result?.content?.[0]?.text;
    if (!content) {
      throw new Error("Invalid response format");
    }

    const result = JSON.parse(content);

    // Log with full metadata
    if (shouldLog) {
      if (result.success) {
        const reasoning = result.reasoning ? ` - ${result.reasoning}` : "";
        const time =
          result.metadata?.executionTimeMs !== undefined
            ? ` (${result.metadata.executionTimeMs}ms)`
            : "";
        const confidence =
          result.confidence !== undefined
            ? ` [${Math.round(result.confidence * 100)}% confident]`
            : "";
        log(`✓ ${name}${reasoning}${time}${confidence}`, "success");
      } else {
        const suggestion = result.error?.suggestion
          ? ` → ${result.error.suggestion}`
          : "";
        log(`✗ ${name}: ${result.error?.message}${suggestion}`, "error");
      }
    }

    // Show toast for mutations or errors (users need to see errors)
    if (shouldShowToast || !result.success) {
      showToast(result, name);

      // Show warnings separately
      if (result.warnings?.length > 0) {
        showWarnings(result.warnings);
      }
    }

    // Update trust panel for mutations (not silent queries)
    if (!silent && isMutation) {
      updateTrustPanel(result, name);
    }

    // Show error recovery for failed mutations
    if (!result.success && isMutation) {
      showErrorRecovery(result, name, args);
    } else {
      // Hide error recovery on success
      hideErrorRecovery();
    }

    return result;
  } catch (error) {
    const errorResult = {
      success: false,
      error: {
        message: error.message,
        suggestion: "Check that the server is running and try again.",
        retryable: true,
      },
    };
    if (shouldLog) {
      log(`✗ ${name}: ${error.message}`, "error");
    }
    // Always show error toasts
    showToast(errorResult, name);

    // Show error recovery for connection errors
    if (isMutation) {
      showErrorRecovery(errorResult, name, args);
    }

    return errorResult;
  }
}

/**
 * Log a message to the log panel.
 */
function log(message, type = "") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logPanel.insertBefore(entry, logPanel.firstChild);

  // Keep only last 50 entries
  while (logPanel.children.length > 50) {
    logPanel.removeChild(logPanel.lastChild);
  }
}

/**
 * Check server connection.
 */
async function checkConnection() {
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    const data = await response.json();

    if (data.status === "ok") {
      statusDot.classList.add("connected");
      statusText.textContent = `Connected to ${data.name} v${data.version}`;
      return true;
    }
  } catch (error) {
    // Connection failed
  }

  statusDot.classList.remove("connected");
  statusText.textContent = "Disconnected - Start the server first";
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TODO OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load todos from server.
 * @param {object} options - Options
 * @param {boolean} options.silent - If true, don't show toasts
 */
async function loadTodos(options = {}) {
  const { silent = false } = options;
  const filterParams = {};
  if (currentFilter === "pending") filterParams.completed = false;
  if (currentFilter === "completed") filterParams.completed = true;

  const result = await callTool(
    "todo-list",
    { ...filterParams, limit: 100 },
    { silent }
  );

  if (result.success) {
    renderTodos(result.data.todos);

    // Show alternatives if filtering (only on non-silent calls)
    if (!silent && currentFilter !== "all" && result.alternatives?.length > 0) {
      showAlternatives(result.alternatives, (altData) => {
        renderTodos(altData.todos);
        hideAlternatives();
      });
    } else if (!silent) {
      hideAlternatives();
    }
  } else {
    todoList.innerHTML = '<li class="empty-state">Failed to load todos</li>';
    hideAlternatives();
  }
}

/**
 * Load stats from server.
 * @param {object} options - Options
 * @param {boolean} options.silent - If true, don't show toasts
 */
async function loadStats(options = {}) {
  const { silent = false } = options;
  const result = await callTool("todo-stats", {}, { silent });

  if (result.success) {
    const stats = result.data;
    statTotal.textContent = stats.total;
    statPending.textContent = stats.pending;
    statCompleted.textContent = stats.completed;
    statRate.textContent = `${Math.round(stats.completionRate * 100)}%`;
  }
}

/**
 * Render todos to the list.
 */
function renderTodos(todos) {
  if (todos.length === 0) {
    todoList.innerHTML =
      '<li class="empty-state">No todos yet. Add one above!</li>';
    updateBatchUI();
    return;
  }

  todoList.innerHTML = todos
    .map(
      (todo) => `
      <li class="todo-item ${todo.completed ? "completed" : ""}" data-id="${
        todo.id
      }">
        <input type="checkbox" class="todo-select" ${
          selectedIds.has(todo.id) ? "checked" : ""
        } onchange="toggleSelection('${todo.id}')">
        <div class="todo-checkbox ${
          todo.completed ? "checked" : ""
        }" onclick="toggleTodo('${todo.id}')"></div>
        <div class="todo-content">
          <div class="todo-title" id="title-${todo.id}">${escapeHtml(
        todo.title
      )}</div>
          <div class="todo-meta">
            <span class="priority-badge priority-${todo.priority}">${
        todo.priority
      }</span>
            &nbsp;·&nbsp;
            ${formatDate(todo-createdAt)}
          </div>
        </div>
        <div class="todo-actions">
          <button onclick="editTodo('${todo.id}')">Edit</button>
          <button onclick="deleteTodo('${todo.id}')">Delete</button>
        </div>
      </li>
    `
    )
    .join("");

  updateBatchUI();
}

function toggleSelection(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }
  updateBatchUI();
}

function updateBatchUI() {
  if (!batchActions) return;
  const hasSelection = selectedIds.size > 0;
  batchActions.style.display = hasSelection ? "flex" : "none";
  if (selectAllCheckbox) {
    const allCheckboxes = document.querySelectorAll(".todo-select");
    selectAllCheckbox.checked =
      allCheckboxes.length > 0 &&
      Array.from(allCheckboxes).every((cb) => cb.checked);
  }
}

async function editTodo(id) {
  const titleEl = document.getElementById(`title-${id}`);
  const currentTitle = titleEl.textContent;
  const newTitle = prompt("Edit todo title:", currentTitle);

  if (
    newTitle !== null &&
    newTitle.trim() !== "" &&
    newTitle !== currentTitle
  ) {
    const result = await callTool("todo-update", {
      id,
      title: newTitle.trim(),
    });
    if (result.success) {
      await Promise.all([loadTodos(), loadStats()]);
    }
  }
}

async function deleteSelected() {
  if (selectedIds.size === 0) return;

  const confirmed = await showConfirmation(
    "Delete Selected",
    `Delete ${selectedIds.size} selected todos?`,
    "This action cannot be undone."
  );

  if (!confirmed) return;

  const result = await callTool("todo-deleteBatch", {
    ids: Array.from(selectedIds),
  });
  if (result.success) {
    selectedIds.clear();
    await Promise.all([loadTodos(), loadStats()]);
  }
}

async function toggleSelected() {
  if (selectedIds.size === 0) return;

  const result = await callTool("todo-toggleBatch", {
    ids: Array.from(selectedIds),
  });
  if (result.success) {
    await Promise.all([loadTodos(), loadStats()]);
  }
}

function toggleSelectAll() {
  const allCheckboxes = document.querySelectorAll(".todo-select");
  const shouldSelect = selectAllCheckbox.checked;

  allCheckboxes.forEach((cb) => {
    const id = cb.closest(".todo-item").dataset.id;
    if (shouldSelect) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
    cb.checked = shouldSelect;
  });

  updateBatchUI();
}

/**
 * Add a new todo.
 */
async function addTodo(title, priority) {
  const result = await callTool("todo-create", { title, priority });

  if (result.success) {
    newTodoTitle.value = "";
    await Promise.all([loadTodos(), loadStats()]);
  }
}

/**
 * Toggle todo completion.
 */
async function toggleTodo(id) {
  const result = await callTool("todo-toggle", { id });

  if (result.success) {
    await Promise.all([loadTodos(), loadStats()]);
  }
}

/**
 * Delete a todo with confirmation.
 */
async function deleteTodo(id) {
  // Show confirmation with the AFD warning message
  const confirmed = await showConfirmation(
    "Delete Todo",
    "Are you sure you want to delete this todo?",
    "This action cannot be undone."
  );

  if (!confirmed) return;

  const result = await callTool("todo-delete", { id });

  if (result.success) {
    await Promise.all([loadTodos(), loadStats()]);
  }
}

/**
 * Clear completed todos with confirmation.
 */
async function clearCompleted() {
  const confirmed = await showConfirmation(
    "Clear Completed",
    "Delete all completed todos?",
    "This will permanently remove all completed items."
  );

  if (!confirmed) return;

  const result = await callTool("todo-clear", {});

  if (result.success) {
    await Promise.all([loadTodos(), loadStats()]);
  }
}

/**
 * Set the current filter.
 */
function setFilter(filter) {
  currentFilter = filter;

  filterBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });

  loadTodos();
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format a date for display.
 */
function formatDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

  return date.toLocaleDateString();
}

// Make functions available globally for onclick handlers
window.toggleTodo = toggleTodo;
window.deleteTodo = deleteTodo;

// Event listeners
addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = newTodoTitle.value.trim();
  if (title) {
    await addTodo(title, newTodoPriority.value);
  }
});

clearCompletedBtn.addEventListener("click", clearCompleted);

filterBtns.forEach((btn) => {
  btn.addEventListener("click", () => setFilter(btn.dataset.filter));
});

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

async function init() {
  log("Initializing...");

  const connected = await checkConnection();

  if (connected) {
    await Promise.all([loadTodos(), loadStats()]);
  } else {
    todoList.innerHTML = `
      <li class="empty-state">
        <p>Server not running.</p>
        <p style="margin-top: 0.5rem; font-size: 0.85rem;">
          Start the server with: <code>node dist/server.js</code>
        </p>
      </li>
    `;
  }

  // Poll for connection status and refresh data (silently - no toasts)
  setInterval(async () => {
    const wasConnected = statusDot.classList.contains("connected");
    const isConnected = await checkConnection();

    if (isConnected) {
      // Always refresh when connected (catches external changes from CLI/MCP)
      // Use silent mode to avoid toast spam
      await Promise.all([
        loadTodos({ silent: true }),
        loadStats({ silent: true }),
      ]);
    } else if (wasConnected && !isConnected) {
      // Just lost connection
      todoList.innerHTML = `
        <li class="empty-state">
          <p>Connection lost. Reconnecting...</p>
        </li>
      `;
    }
  }, 3000); // Poll every 3 seconds
}

init();
