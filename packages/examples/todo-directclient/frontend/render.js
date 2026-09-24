/**
 * DOM builders for the todo UI and the AI sidebar.
 *
 * Todo titles, command names, errors and model replies are untrusted: a
 * prompt injection can make the model create a todo titled
 * `<img src=x onerror=...>`. Every value is therefore written with
 * `textContent` or an attribute setter, never parsed as HTML, and event
 * handlers are attached with `addEventListener` rather than inline markup.
 *
 * Each builder takes the `document` to create nodes with, so the same code
 * runs in the browser and in the backend's unit tests.
 */

const PRIORITIES = new Set(['low', 'medium', 'high']);

/** Create an element with an optional class name and text content. */
function element(doc, tag, className, text) {
	const node = doc.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = String(text);
	return node;
}

/** A known priority, or `medium` for anything else (it is used in a class name). */
export function safePriority(priority) {
	return PRIORITIES.has(priority) ? priority : 'medium';
}

/**
 * One todo row. Activating it (click, Enter or Space) calls `onToggle(todo.id)`.
 */
export function renderTodoItem(doc, todo, onToggle) {
	const priority = safePriority(todo.priority);
	const item = element(doc, 'div', `todo-item${todo.completed ? ' completed' : ''}`);
	item.setAttribute('role', 'button');
	item.setAttribute('tabindex', '0');
	item.setAttribute('aria-pressed', todo.completed ? 'true' : 'false');

	item.append(
		element(doc, 'div', `todo-checkbox${todo.completed ? ' checked' : ''}`),
		element(doc, 'span', 'todo-title', todo.title ?? ''),
		element(doc, 'span', `priority-badge priority-${priority}`, priority)
	);

	const toggle = () => onToggle(String(todo.id));
	item.addEventListener('click', toggle);
	item.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			toggle();
		}
	});
	return item;
}

/** The empty-list placeholder. */
export function renderEmpty(doc, text) {
	return element(doc, 'div', 'empty', text);
}

/** One request-log line. */
export function renderLogEntry(doc, { time, command, latency, success }) {
	const entry = element(doc, 'div', 'log-entry');
	const status = element(doc, 'span', success ? 'log-ok' : 'log-fail', success ? '✓' : '✗');
	const latencyNode = element(doc, 'span', 'log-latency', `${latency}ms exec`);
	latencyNode.setAttribute('title', 'DirectClient execution time (in-process)');
	entry.append(
		element(doc, 'span', 'log-time', time),
		element(doc, 'span', 'log-cmd', command),
		latencyNode,
		status
	);
	return entry;
}

function formatMs(value, digits) {
	return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '?';
}

/**
 * A chat bubble. `text` is shown as plain text (line breaks kept by CSS), and
 * each tool execution lists its name and latency.
 */
export function renderChatMessage(doc, { role, text, tools = [], toolLatency, modelLatency }) {
	const kind = role === 'user' || role === 'assistant' ? role : 'system';
	const message = element(doc, 'div', `chat-message ${kind}`);
	message.append(element(doc, 'div', 'chat-text', text ?? ''));

	if (tools.length > 0) {
		const executions = element(doc, 'div', 'tool-executions');
		executions.append(element(doc, 'strong', undefined, 'Tools executed:'));
		for (const tool of tools) {
			const row = element(doc, 'div', 'tool-exec');
			row.append(
				element(doc, 'span', 'tool-name', tool.name ?? ''),
				element(doc, 'span', 'tool-latency', `${formatMs(tool.latencyMs, 3)}ms`)
			);
			executions.append(row);
		}

		const summary = element(doc, 'div', 'latency-summary');
		summary.setAttribute(
			'title',
			'Model = Gemini API time, Tools = DirectClient in-process execution'
		);
		summary.append(
			doc.createTextNode(`🧠 Gemini: ${formatMs(modelLatency, 0)}ms | ⚡ DirectClient: `),
			element(doc, 'span', 'highlight', `${formatMs(toolLatency, 3)}ms`)
		);
		executions.append(summary);
		message.append(executions);
	}
	return message;
}
