/**
 * Todo UI and AI sidebar. Served by the chat server (`npx tsx src/chat-server.ts`,
 * then open http://localhost:3201), so every call below is same-origin.
 *
 * Rendering goes through `render.js`, which never parses strings as HTML.
 */

import { renderChatMessage, renderEmpty, renderLogEntry, renderTodoItem } from './render.js';

const EXECUTE_URL = '/execute';
const CHAT_URL = '/chat';
const MCP_HEALTH_URL = 'http://localhost:3200/health';

const byId = (id) => document.getElementById(id);

// ═══════════════════════════════════════════════════════════════
// Commands via DirectClient (same registry as AI sidebar)
// ═══════════════════════════════════════════════════════════════

async function callCommand(name, args = {}) {
	const start = performance.now();

	try {
		const response = await fetch(EXECUTE_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, args }),
		});

		const result = await response.json();
		const elapsed = result.latencyMs?.toFixed(3) ?? (performance.now() - start).toFixed(2);

		addLog(name, elapsed, result?.success ?? false);
		return result;
	} catch (err) {
		const elapsed = (performance.now() - start).toFixed(2);
		addLog(name, elapsed, false);
		return { success: false, error: { message: err.message } };
	}
}

function addLog(command, latency, success) {
	const log = byId('log');
	if (log.querySelector('.empty')) log.replaceChildren();

	const time = new Date().toLocaleTimeString();
	log.prepend(renderLogEntry(document, { time, command, latency, success }));
}

// ═══════════════════════════════════════════════════════════════
// Todo UI Functions
// ═══════════════════════════════════════════════════════════════

async function createTodo() {
	const titleInput = byId('todoTitle');
	const title = titleInput.value.trim();
	if (!title) return;
	const priority = byId('todoPriority').value;

	const result = await callCommand('todo-create', { title, priority });
	if (result?.success) {
		titleInput.value = '';
		await refreshTodos();
	}
}

async function toggleTodo(id) {
	await callCommand('todo-toggle', { id });
	await refreshTodos();
}

async function clearTodos() {
	await callCommand('todo-clear', {});
	await refreshTodos();
}

async function refreshTodos() {
	const [listResult, statsResult] = await Promise.all([
		callCommand('todo-list', {}),
		callCommand('todo-stats', {}),
	]);

	const list = byId('todosList');
	const todos = listResult?.data?.todos ?? [];

	if (todos.length === 0) {
		list.replaceChildren(renderEmpty(document, 'No todos yet. Create one above!'));
	} else {
		list.replaceChildren(...todos.map((todo) => renderTodoItem(document, todo, toggleTodo)));
	}

	const stats = statsResult?.data;
	if (stats) {
		byId('statTotal').textContent = String(stats.total);
		byId('statCompleted').textContent = String(stats.completed);
		byId('statPending').textContent = String(stats.pending);
	}
}

// ═══════════════════════════════════════════════════════════════
// AI Chat (uses DirectClient on backend - zero overhead!)
// ═══════════════════════════════════════════════════════════════

function addChatMessage(message) {
	const container = byId('chatMessages');
	container.append(renderChatMessage(document, message));
	container.scrollTop = container.scrollHeight;
}

async function sendChat() {
	const input = byId('chatInput');
	const message = input.value.trim();
	if (!message) return;

	input.value = '';
	addChatMessage({ role: 'user', text: message });

	const typing = byId('typingIndicator');
	typing.classList.add('visible');

	try {
		const response = await fetch(CHAT_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message }),
		});

		const data = await response.json();
		typing.classList.remove('visible');

		if (data.error) {
			addChatMessage({ role: 'system', text: `Error: ${data.error}` });
		} else {
			addChatMessage({
				role: 'assistant',
				text: data.message,
				tools: data.toolExecutions ?? [],
				toolLatency: data.totalToolLatencyMs,
				modelLatency: data.modelLatencyMs,
			});
			// Refresh the todo list since AI may have changed things
			await refreshTodos();
		}
	} catch (err) {
		typing.classList.remove('visible');
		addChatMessage({ role: 'system', text: `Connection error: ${err.message}` });
	}
}

// ═══════════════════════════════════════════════════════════════
// Status Checks
// ═══════════════════════════════════════════════════════════════

async function checkServers() {
	// The MCP server is optional (CLI access); its origin list includes this page.
	try {
		const r = await fetch(MCP_HEALTH_URL);
		byId('serverStatus').classList.toggle('connected', r.ok);
	} catch {
		byId('serverStatus').classList.remove('connected');
	}

	try {
		const r = await fetch('/health');
		const data = await r.json();
		const connected = r.ok && data.geminiConfigured;
		byId('chatStatus').classList.toggle('connected', connected);
		byId('aiStatus').textContent = connected ? 'Ready' : 'No API Key';
	} catch {
		byId('chatStatus').classList.remove('connected');
		byId('aiStatus').textContent = 'Offline';
	}
}

// ═══════════════════════════════════════════════════════════════
// Wiring (no inline handlers: the Content-Security-Policy forbids them)
// ═══════════════════════════════════════════════════════════════

byId('addTodo').addEventListener('click', createTodo);
byId('refreshTodos').addEventListener('click', refreshTodos);
byId('clearTodos').addEventListener('click', clearTodos);
byId('sendChat').addEventListener('click', sendChat);

byId('todoTitle').addEventListener('keydown', (e) => {
	if (e.key === 'Enter') createTodo();
});

byId('chatInput').addEventListener('keydown', (e) => {
	if (e.key === 'Enter') sendChat();
});

checkServers();
refreshTodos();
setInterval(checkServers, 5000);
