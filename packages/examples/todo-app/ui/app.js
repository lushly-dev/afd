/**
 * Todo App UI
 *
 * This is a simple vanilla JS implementation that communicates
 * with the MCP server using HTTP requests.
 *
 * In a real app, you'd use @afd/client, but this demonstrates
 * that the same commands work from any client.
 */

// Configuration
const SERVER_URL = 'http://localhost:3100';
let messageId = 0;
let currentFilter = 'all';

// DOM Elements
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const addForm = document.getElementById('addForm');
const newTodoTitle = document.getElementById('newTodoTitle');
const newTodoPriority = document.getElementById('newTodoPriority');
const todoList = document.getElementById('todoList');
const logPanel = document.getElementById('logPanel');
const clearCompletedBtn = document.getElementById('clearCompleted');
const filterBtns = document.querySelectorAll('.filter-btn[data-filter]');

// Stats elements
const statTotal = document.getElementById('statTotal');
const statPending = document.getElementById('statPending');
const statCompleted = document.getElementById('statCompleted');
const statRate = document.getElementById('statRate');

/**
 * Call an MCP tool via HTTP.
 */
async function callTool(name, args = {}) {
  const id = ++messageId;

  log(`Calling ${name}...`);

  try {
    const response = await fetch(`${SERVER_URL}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
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
      throw new Error('Invalid response format');
    }

    const result = JSON.parse(content);

    if (result.success) {
      const reasoning = result.reasoning ? ` - ${result.reasoning}` : '';
      log(`✓ ${name}${reasoning}`, 'success');
    } else {
      log(`✗ ${name}: ${result.error?.message}`, 'error');
    }

    return result;
  } catch (error) {
    log(`✗ ${name}: ${error.message}`, 'error');
    return { success: false, error: { message: error.message } };
  }
}

/**
 * Log a message to the log panel.
 */
function log(message, type = '') {
  const entry = document.createElement('div');
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

    if (data.status === 'ok') {
      statusDot.classList.add('connected');
      statusText.textContent = `Connected to ${data.name} v${data.version}`;
      return true;
    }
  } catch (error) {
    // Connection failed
  }

  statusDot.classList.remove('connected');
  statusText.textContent = 'Disconnected - Start the server first';
  return false;
}

/**
 * Load todos from server.
 */
async function loadTodos() {
  const filterParams = {};
  if (currentFilter === 'pending') filterParams.completed = false;
  if (currentFilter === 'completed') filterParams.completed = true;

  const result = await callTool('todo.list', { ...filterParams, limit: 100 });

  if (result.success) {
    renderTodos(result.data.todos);
  } else {
    todoList.innerHTML = '<li class="empty-state">Failed to load todos</li>';
  }
}

/**
 * Load stats from server.
 */
async function loadStats() {
  const result = await callTool('todo.stats', {});

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
    todoList.innerHTML = '<li class="empty-state">No todos yet. Add one above!</li>';
    return;
  }

  todoList.innerHTML = todos
    .map(
      (todo) => `
      <li class="todo-item ${todo.completed ? 'completed' : ''}" data-id="${todo.id}">
        <div class="todo-checkbox ${todo.completed ? 'checked' : ''}" onclick="toggleTodo('${todo.id}')"></div>
        <div class="todo-content">
          <div class="todo-title">${escapeHtml(todo.title)}</div>
          <div class="todo-meta">
            <span class="priority-badge priority-${todo.priority}">${todo.priority}</span>
            &nbsp;·&nbsp;
            ${formatDate(todo.createdAt)}
          </div>
        </div>
        <div class="todo-actions">
          <button onclick="deleteTodo('${todo.id}')">Delete</button>
        </div>
      </li>
    `
    )
    .join('');
}

/**
 * Add a new todo.
 */
async function addTodo(title, priority) {
  const result = await callTool('todo.create', { title, priority });

  if (result.success) {
    newTodoTitle.value = '';
    await Promise.all([loadTodos(), loadStats()]);
  }
}

/**
 * Toggle todo completion.
 */
async function toggleTodo(id) {
  const result = await callTool('todo.toggle', { id });

  if (result.success) {
    await Promise.all([loadTodos(), loadStats()]);
  }
}

/**
 * Delete a todo.
 */
async function deleteTodo(id) {
  const result = await callTool('todo.delete', { id });

  if (result.success) {
    await Promise.all([loadTodos(), loadStats()]);
  }
}

/**
 * Clear completed todos.
 */
async function clearCompleted() {
  const result = await callTool('todo.clear', {});

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
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });

  loadTodos();
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(text) {
  const div = document.createElement('div');
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

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

  return date.toLocaleDateString();
}

// Make functions available globally for onclick handlers
window.toggleTodo = toggleTodo;
window.deleteTodo = deleteTodo;

// Event listeners
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = newTodoTitle.value.trim();
  if (title) {
    await addTodo(title, newTodoPriority.value);
  }
});

clearCompletedBtn.addEventListener('click', clearCompleted);

filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => setFilter(btn.dataset.filter));
});

// Initialize
async function init() {
  log('Initializing...');

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

  // Poll for connection status and refresh data
  setInterval(async () => {
    const wasConnected = statusDot.classList.contains('connected');
    const isConnected = await checkConnection();

    if (isConnected) {
      // Always refresh when connected (catches external changes from CLI/MCP)
      await Promise.all([loadTodos(), loadStats()]);
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
