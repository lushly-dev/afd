import { initAgentView } from './agent-view.js';
import { escape, jsonHtml } from './cli-format.js';
import { highlightAll } from './highlight.js';
import { call, getTodos, listCommands, onCommand, provide } from './runtime.js';
import { initTabs, reducedMotion } from './util.js';

const demo = document.querySelector('[data-live-demo]');
const status = document.querySelector('[data-demo-status]');
const resultDialog = document.querySelector('[data-result-dialog]');
const resultCode = document.querySelector('[data-raw-result]');
const createForm = document.querySelector('[data-create-form]');
const cliForm = document.querySelector('[data-cli-form]');
const agentButton = document.querySelector('[data-agent-run]');
const surfaceNames = { ui: 'Web app', agent: 'Agent', cli: 'CLI' };
let pulseTimer;

function renderTasks() {
	const todos = getTodos();
	document.querySelector('[data-task-count]').textContent =
		`${todos.length} task${todos.length === 1 ? '' : 's'}`;
	document.querySelector('[data-task-list]').innerHTML = todos.length
		? todos
				.map(
					(todo, index) =>
						`<li><span class="task-id">${String(index + 1).padStart(2, '0')}</span><strong>${escape(todo.title)}</strong><span class="priority priority--${todo.priority}">${todo.priority}</span></li>`
				)
				.join('')
		: '<li class="empty-tasks">Your next command starts here.</li>';
}

onCommand((entry) => {
	if (!entry.name.startsWith('todo-')) return;
	renderTasks();
	resultCode.innerHTML = jsonHtml(entry.result);
	status.dataset.state = entry.result.success ? 'success' : 'error';
	status.textContent = entry.result.success
		? `${surfaceNames[entry.surface] ?? entry.surface} / ${entry.name} / success`
		: (entry.result.error.suggestion ?? entry.result.error.message);
	createForm.elements.title.removeAttribute('aria-invalid');
	if (!entry.result.success && entry.surface === 'ui') {
		createForm.elements.title.setAttribute('aria-invalid', 'true');
	}
	if (!reducedMotion.matches) {
		demo.classList.remove('is-firing');
		void demo.offsetWidth;
		demo.classList.add('is-firing');
		clearTimeout(pulseTimer);
		pulseTimer = setTimeout(() => demo.classList.remove('is-firing'), 850);
	}
});

async function submitCommand(button, input, surface) {
	button.disabled = true;
	try {
		return await call('todo-create', input, { surface });
	} finally {
		button.disabled = false;
	}
}

createForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	const result = await submitCommand(
		createForm.querySelector('button'),
		{
			title: createForm.elements.title.value,
			priority: createForm.elements.priority.value,
		},
		'ui'
	);
	if (result.success) createForm.elements.title.value = '';
	else createForm.elements.title.focus();
});

agentButton.addEventListener('click', () =>
	submitCommand(
		agentButton,
		{
			title: 'Test the command',
			priority: 'high',
		},
		'agent'
	)
);

cliForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	const input = cliForm.querySelector('textarea');
	let args;
	try {
		args = JSON.parse(input.value);
		if (!args || typeof args !== 'object' || Array.isArray(args)) {
			throw new Error('Expected a JSON object');
		}
	} catch {
		input.setAttribute('aria-invalid', 'true');
		status.dataset.state = 'error';
		status.textContent = 'Enter a JSON object, for example {"title":"Ship the website"}.';
		input.focus();
		return;
	}
	input.removeAttribute('aria-invalid');
	await submitCommand(cliForm.querySelector('button'), args, 'cli');
});

document
	.querySelector('[data-result-open]')
	.addEventListener('click', () => resultDialog.showModal());
document.querySelector('[data-result-close]').addEventListener('click', () => resultDialog.close());
resultDialog.addEventListener('click', (event) => {
	const rect = resultDialog.getBoundingClientRect();
	if (
		event.target === resultDialog &&
		(event.clientX < rect.left ||
			event.clientX > rect.right ||
			event.clientY < rect.top ||
			event.clientY > rect.bottom)
	) {
		resultDialog.close();
	}
});

for (const tablist of document.querySelectorAll('[role="tablist"]')) {
	initTabs(tablist);
	// Add vertical navigation and endpoint keys to the shared horizontal tabs.
	tablist.addEventListener('keydown', (event) => {
		const tabs = [...tablist.querySelectorAll('[role="tab"]')];
		const index = tabs.indexOf(document.activeElement);
		if (index < 0) return;
		const vertical = tablist.getAttribute('aria-orientation') === 'vertical';
		let next;
		if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = tabs.length - 1;
		else if (vertical && event.key === 'ArrowDown') next = (index + 1) % tabs.length;
		else if (vertical && event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
		else return;
		event.preventDefault();
		tabs[next].click();
		tabs[next].focus();
	});
}

const compactLayout = matchMedia('(max-width: 560px)');
const setWorkflowOrientation = () =>
	document
		.querySelector('.workflow-tabs')
		.setAttribute('aria-orientation', compactLayout.matches ? 'horizontal' : 'vertical');
compactLayout.addEventListener('change', setWorkflowOrientation);
setWorkflowOrientation();

document.querySelector('[data-copy-install]').addEventListener('click', async () => {
	const selected = document.querySelector('.install-tabs [aria-selected="true"]');
	const result = await call('install-copy', { language: selected.dataset.language });
	document.querySelector('[data-copy-status]').textContent = result.success
		? 'Copied to clipboard.'
		: 'Clipboard unavailable. Select the command above to copy it.';
});

const sectionAliases = {
	honesty: 'problem',
	inversion: 'problem',
	'agent-ux': 'result',
	build: 'workflow',
	botcore: 'testing',
};
provide('scrollTo', (section) => {
	const target = document.getElementById(sectionAliases[section] ?? section);
	if (!target) return;
	target.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });
	history.replaceState(null, '', `#${target.id}`);
});
document.addEventListener('click', async (event) => {
	const link = event.target.closest('a[href^="#"]');
	if (
		!link ||
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.altKey ||
		event.button !== 0
	)
		return;
	const section = link.getAttribute('href').slice(1);
	if (section === 'main') return;
	if (!document.getElementById(section)) return;
	event.preventDefault();
	if (document.body.dataset.view === 'agent') await call('view-set', { view: 'human' });
	await call('section-go', { section });
});

window.afd = { call: (name, input) => call(name, input, { surface: 'cli' }), tools: listCommands };
highlightAll();
initAgentView();
await call('todo-create', { title: 'Define the command', priority: 'medium' }, { surface: 'cli' });
status.textContent = 'Ready / 1 task in shared state';
demo.classList.remove('is-firing');
