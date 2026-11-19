import { initAgentView } from './agent-view.js';
import { createAlfred } from './alfred.js';
import { initBoardDrag } from './board-drag.js';
import { jsonHtml } from './cli-format.js';
import { initTerminal } from './demo-terminal.js';
import { call, getTodos, listCommands, onCommand, provide } from './runtime.js';
import { initTabs, reducedMotion } from './util.js';
import './widows.js';

// Command Manifesto 3 (proposal). Same runtime and commands as the main page;
// this file changes what the page does with them.

// Results worded for the next operator: what happened, and what it means.
const tally = (all) =>
	['high', 'medium', 'low']
		.map((priority) => [all.filter((todo) => todo.priority === priority).length, priority])
		.filter(([count]) => count)
		.map(([count, priority]) => `${count} ${priority}`)
		.join(', ');
provide('voice', {
	titleMissing: () => 'Add a title, for example “Ship the docs”',
	created: (todo, all) =>
		`Created “${todo.title}” as ${todo.id} at ${todo.priority} priority. The list now holds ${all.length} task${all.length === 1 ? '' : 's'}.`,
	listed: (all) =>
		all.length
			? `Read ${all.length} task${all.length === 1 ? '' : 's'} straight from state: ${tally(all)}. Nothing filtered or truncated.`
			: 'The list is empty. Nothing was filtered.',
	toggled: (todo, all) => {
		const open = all.filter((candidate) => !candidate.completed).length;
		return `${todo.completed ? 'Completed' : 'Reopened'} “${todo.title}”. ${open} of ${all.length} task${all.length === 1 ? '' : 's'} still open.`;
	},
	updated: (todo, changes) => `Changed ${changes.join(' and ')} on “${todo.title}”.`,
});

const stage = document.querySelector('[data-stage]');
const tasks = document.querySelector('[data-tasks]');
const status = document.querySelector('[data-demo-status]');
const rail = document.querySelector('[data-command-rail]');
const dialog = document.querySelector('[data-result-dialog]');
const confirmDialog = document.querySelector('[data-confirm-dialog]');
const deleteRequest = document.querySelector('[data-delete-request]');
const deleteConfirm = document.querySelector('[data-delete-confirm]');
const controlStatus = document.querySelector('[data-control-status]');
const createForm = document.querySelector('[data-create-form]');
const agentForms = [...document.querySelectorAll('[data-agent-form]')];
const surfaceTabs = [...document.querySelectorAll('[data-surface]')];
const surfaceNames = { ui: 'Screen', cli: 'Terminal', agent: 'Agent' };
// Which surface created each task, so one list can show three operators.
const createdVia = new Map();
const taskNodes = new Map();
// Alfred appears wherever the page shows an agent: the demo's Agent tab, the
// handoff session and the proof card. Each one is live, keyed by data-alfred.
const alfreds = Object.fromEntries(
	[...document.querySelectorAll('[data-alfred]')].map((svg) => [svg.dataset.alfred, createAlfred(svg)])
);
let pulseTimer;
let agentBusy = false;

reducedMotion.addEventListener('change', () => {
	if (!reducedMotion.matches) return;
	for (const node of taskNodes.values()) {
		for (const animation of node.getAnimations()) animation.cancel();
	}
	clearTimeout(pulseTimer);
	rail.classList.remove('is-firing');
});

function renderTasks() {
	const todos = getTodos();
	const rows = { high: 0, medium: 0, low: 0 };
	const columns = { high: 1, medium: 2, low: 3 };
	const currentIds = new Set(todos.map((todo) => todo.id));
	for (const [id, node] of taskNodes) {
		if (!currentIds.has(id)) {
			node.remove();
			taskNodes.delete(id);
		}
	}
	tasks.querySelector('.empty-tasks')?.remove();
	for (const [index, todo] of todos.entries()) {
		let node = taskNodes.get(todo.id);
		if (!node) {
			node = document.createElement('li');
			node.className = 'task';
			node.dataset.taskId = todo.id;
			const check = document.createElement('button');
			check.type = 'button';
			check.className = 'task-check';
			check.setAttribute('role', 'checkbox');
			const title = document.createElement('strong');
			const via = document.createElement('span');
			via.className = 'task-via';
			const priority = document.createElement('button');
			priority.type = 'button';
			priority.className = 'task-priority';
			priority.title = 'Change priority';
			node.append(check, title, via, priority);
			taskNodes.set(todo.id, node);
		}
		node.dataset.priority = todo.priority;
		node.dataset.done = String(todo.completed);
		node.style.setProperty('--task-column', columns[todo.priority]);
		node.style.setProperty('--task-row', ++rows[todo.priority]);
		const check = node.querySelector('.task-check');
		check.setAttribute('aria-checked', String(todo.completed));
		check.setAttribute('aria-label', `${todo.completed ? 'Reopen' : 'Complete'} “${todo.title}”`);
		node.querySelector('strong').textContent = todo.title;
		const priority = node.querySelector('.task-priority');
		priority.textContent = todo.priority;
		priority.setAttribute('aria-label', `Priority ${todo.priority}. Change the priority of “${todo.title}”`);
		const surface = createdVia.get(todo.id) ?? 'ui';
		const via = node.querySelector('.task-via');
		via.dataset.surface = surface;
		via.textContent = surfaceNames[surface] ?? surface;
		via.title = `Created from the ${(surfaceNames[surface] ?? surface).toLowerCase()}`;
		// Only move a node that is out of place, so a focused control keeps its focus.
		if (tasks.children[index] !== node) tasks.insertBefore(node, tasks.children[index] ?? null);
	}
	if (!todos.length) {
		const empty = document.createElement('li');
		empty.className = 'empty-tasks';
		empty.textContent = 'A capability is waiting for its first call.';
		tasks.append(empty);
	}
	const done = todos.filter((todo) => todo.completed).length;
	document.querySelector('[data-task-count]').textContent = todos.length
		? `${done} of ${todos.length} done`
		: 'Empty';
	deleteRequest.disabled = agentBusy || todos.length === 0;
	deleteConfirm.disabled = todos.length === 0;
	document.querySelector('[data-confirm-description]').textContent =
		`This will permanently delete all ${todos.length} tasks from the shared demo list.`;
}

// Render, and slide every card from where it was to where it now is.
function renderTasksInMotion() {
	const before = new Map();
	if (!reducedMotion.matches) {
		for (const node of taskNodes.values()) {
			for (const animation of node.getAnimations()) animation.cancel();
			before.set(node, node.getBoundingClientRect());
		}
	}
	renderTasks();
	for (const [node, old] of before) {
		if (!node.isConnected) continue;
		const now = node.getBoundingClientRect();
		const dx = old.x - now.x;
		const dy = old.y - now.y;
		if (!now.width || (!dx && !dy)) continue;
		node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
			duration: 360,
			easing: 'cubic-bezier(.2,.8,.2,1)',
		});
	}
}

// The last few commands, newest first: the mix of surfaces is the point.
const trail = document.querySelector('[data-command-trail]');
let booted = false;
function trailCommand(entry) {
	const item = document.createElement('li');
	if (!entry.result.success) item.dataset.failed = 'true';
	const source = document.createElement('span');
	source.textContent = surfaceNames[entry.surface] ?? entry.surface;
	item.append(source, entry.name);
	trail.prepend(item);
	while (trail.children.length > 4) trail.lastElementChild.remove();
}

onCommand((entry) => {
	if (!entry.name.startsWith('todo-')) return;
	if (entry.name === 'todo-create' && entry.result.success)
		createdVia.set(entry.result.data.id, entry.surface);
	if (entry.name === 'todo-clear' && entry.result.success) createdVia.clear();
	renderTasksInMotion();
	if (booted) trailCommand(entry);
	document.querySelector('[data-raw-result]').innerHTML = jsonHtml(entry.result);
	document.querySelector('[data-contract-result]').innerHTML = jsonHtml(entry.result);
	document.querySelector('[data-contract-result-name]').textContent = entry.name;
	document.querySelector('[data-contract-outcome]').textContent = entry.result.success
		? 'Success'
		: entry.result.error.message;
	document.querySelector('[data-contract-reasoning]').textContent =
		entry.result.reasoning ?? 'Not supplied by this command.';
	document.querySelector('[data-contract-confidence]').textContent =
		entry.result.confidence == null
			? 'Not supplied'
			: `${Number(entry.result.confidence).toFixed(1)} of 1.0`;
	// The drawn toast says, in a person's terms, what the live result just said.
	document.querySelector('[data-toast-text]').textContent = !entry.result.success
		? 'Couldn’t do that'
		: entry.name === 'todo-create'
			? `Task added · ${entry.result.data.priority} priority`
			: entry.name === 'todo-clear'
				? `${entry.result.data.deleted} tasks deleted`
				: entry.name === 'todo-toggle'
					? `Task ${entry.result.data.completed ? 'completed' : 'reopened'}`
					: entry.name === 'todo-update'
						? 'Task updated'
						: `${entry.result.data.total} tasks loaded`;
	const recovery = entry.result.error?.suggestion ?? entry.result.suggestions?.join(' ');
	document.querySelector('[data-contract-recovery-row]').hidden = !recovery;
	document.querySelector('[data-contract-recovery]').textContent = recovery ?? '';
	document.querySelector('[data-command-source]').textContent =
		surfaceNames[entry.surface] ?? entry.surface;
	document.querySelector('[data-command-name]').textContent = entry.name;
	document.querySelector('[data-command-state]').textContent = entry.result.success
		? 'success'
		: 'error';
	status.dataset.state = entry.result.success ? 'success' : 'error';
	status.textContent = entry.result.success
		? (entry.result.reasoning ?? `${entry.name} succeeded`)
		: entry.result.error.suggestion;
	if (!reducedMotion.matches) {
		rail.classList.remove('is-firing');
		void rail.offsetWidth;
		rail.classList.add('is-firing');
		clearTimeout(pulseTimer);
		pulseTimer = setTimeout(() => rail.classList.remove('is-firing'), 550);
	}
});

function setSurface(tab) {
	const previous = stage.dataset.mode;
	const next = tab.dataset.surface;
	const transforming = ['list', 'board'].includes(previous) && ['list', 'board'].includes(next);
	const before = new Map();
	for (const node of taskNodes.values()) {
		for (const animation of node.getAnimations()) animation.cancel();
		if (transforming && !reducedMotion.matches) before.set(node, node.getBoundingClientRect());
	}
	for (const candidate of surfaceTabs) {
		candidate.setAttribute('aria-selected', String(candidate === tab));
		candidate.tabIndex = candidate === tab ? 0 : -1;
	}
	stage.dataset.mode = next;
	const taskPanel = document.getElementById('task-panel');
	taskPanel.hidden = next !== 'list' && next !== 'board';
	taskPanel.setAttribute('aria-labelledby', tab.id);
	document.getElementById('terminal-panel').hidden = next !== 'terminal';
	document.getElementById('agent-panel').hidden = next !== 'agent';
	// Keep the real task nodes while animating their change in position.
	for (const [node, old] of before) {
		const current = node.getBoundingClientRect();
		node.animate(
			[
				{ transform: `translate(${old.x - current.x}px, ${old.y - current.y}px)` },
				{ transform: 'translate(0, 0)' },
			],
			{ duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' }
		);
	}
	surfaceHint.textContent = surfaceHints[next];
	if (next === 'terminal') terminal.show();
	// Choosing the agent is engaging with it.
	if (next === 'agent') alfreds.demo.wake();
}

// Each surface says what to try, and where to look next.
const surfaceHint = document.querySelector('[data-surface-hint]');
const surfaceHints = {
	list: 'Check a task off, or add one. Then open the Board.',
	board: 'Drag a card to another priority. Then open the Terminal.',
	terminal: 'Type a command, or pick one below, then press Enter. Then open the Agent.',
	agent: 'Ask Alfred. He runs the same commands. Then go back to the List.',
};

// Checking a task off and changing its priority work the same in the list and on the board.
tasks.addEventListener('click', (event) => {
	const node = event.target.closest('.task');
	if (!node?.dataset.taskId) return;
	const id = node.dataset.taskId;
	if (event.target.closest('.task-check')) {
		call('todo-toggle', { id });
	} else if (event.target.closest('.task-priority')) {
		const order = ['high', 'medium', 'low'];
		const priority = order[(order.indexOf(node.dataset.priority) + 1) % order.length];
		call('todo-update', { id, priority });
	}
});
initBoardDrag({
	list: tasks,
	isBoard: () => stage.dataset.mode === 'board',
	onDrop: (id, priority) => call('todo-update', { id, priority }),
});

const terminal = initTerminal({
	form: document.querySelector('[data-terminal-form]'),
	screen: document.querySelector('[data-terminal-screen]'),
	tries: document.querySelector('[data-terminal-tries]'),
	call,
	listCommands,
	getTodos,
});

function tabEndpoints(tablist) {
	tablist.addEventListener('keydown', (event) => {
		if (event.key !== 'Home' && event.key !== 'End') return;
		const tabs = [...tablist.querySelectorAll('[role="tab"]')];
		const tab = event.key === 'Home' ? tabs[0] : tabs.at(-1);
		event.preventDefault();
		tab.click();
		tab.focus();
	});
}

const surfaceTablist = document.querySelector('.surface-tabs');
surfaceTablist.addEventListener('click', (event) => {
	const tab = event.target.closest('[role="tab"]');
	if (tab) setSurface(tab);
});
surfaceTablist.addEventListener('keydown', (event) => {
	if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
	event.preventDefault();
	const index = surfaceTabs.indexOf(document.activeElement);
	const next =
		(index + (event.key === 'ArrowRight' ? 1 : -1) + surfaceTabs.length) % surfaceTabs.length;
	setSurface(surfaceTabs[next]);
	surfaceTabs[next].focus();
});
tabEndpoints(surfaceTablist);

createForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	const button = createForm.querySelector('button');
	button.disabled = true;
	try {
		const result = await call('todo-create', {
			title: createForm.elements.title.value,
			priority: createForm.elements.priority.value,
		});
		createForm.elements.title.setAttribute('aria-invalid', String(!result.success));
		if (result.success) createForm.elements.title.value = '';
		createForm.elements.title.focus();
	} finally {
		button.disabled = false;
	}
});

function agentStep(name, state, message) {
	const step = document.querySelector(`[data-agent-step="${name}"]`);
	step.dataset.state = state;
	step.querySelector('[data-step-state]').textContent = {
		active: 'calling',
		done: 'success',
		error: 'error',
		waiting: 'waiting',
	}[state];
	if (message) document.querySelector(`[data-step-${name}]`).textContent = message;
}

async function agentCall(step, name, input) {
	agentStep(step, 'active');
	// A brief presentation beat, not simulated model or network activity.
	if (!reducedMotion.matches) await new Promise((resolve) => setTimeout(resolve, 280));
	const result = await call(name, input, { surface: 'agent' });
	agentStep(
		step,
		result.success ? 'done' : 'error',
		result.success ? result.reasoning : result.error.suggestion
	);
	return result;
}

for (const form of agentForms) {
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (agentBusy) return;
		agentBusy = true;
		deleteRequest.disabled = true;
		for (const candidate of agentForms) candidate.querySelector('button').disabled = true;
		const title = form.elements.title.value;
		const priority = form.elements.priority.value;
		const agentStatus = document.querySelector('[data-agent-status]');
		const sessionState = document.querySelector('[data-session-state]');
		document.querySelector('[data-agent-quote]').textContent = `“${title}”`;
		for (const [step, message] of Object.entries({
			read: 'Read the shared state.',
			create: 'Create the requested task.',
			verify: 'Verify the result.',
		}))
			agentStep(step, 'waiting', message);
		sessionState.textContent = 'RUNNING';
		agentStatus.textContent = 'Reading, creating, then verifying.';
		// Alfred looks up, works while the real commands run, then shows how it went.
		// The wait is capped so a hidden tab can never hold the commands back.
		const alfred = alfreds.handoff;
		await Promise.race([alfred.wake(), new Promise((resolve) => setTimeout(resolve, 1600))]);
		const stopWorking = alfred.work();
		let mood = 'warn';
		try {
			await agentCall('read', 'todo-list', {});
			const created = await agentCall('create', 'todo-create', {
				title,
				priority,
			});
			form.elements.title.setAttribute('aria-invalid', String(!created.success));
			if (!created.success) {
				sessionState.textContent = 'NEEDS INPUT';
				agentStatus.textContent = created.error.suggestion;
				form.elements.title.focus();
				return;
			}
			const verified = await agentCall('verify', 'todo-list', {});
			const found =
				verified.success && verified.data.todos.some((todo) => todo.id === created.data.id);
			sessionState.textContent = found ? 'COMPLETE' : 'UNVERIFIED';
			if (found) mood = 'pass';
			const summary = found
				? `Task created and verified. ${verified.data.total} tasks in shared state.`
				: 'Task created; verification did not confirm it.';
			agentStatus.textContent = summary;
		} finally {
			stopWorking().then(() => alfred.express(mood));
			agentBusy = false;
			deleteRequest.disabled = getTodos().length === 0;
			for (const candidate of agentForms) candidate.querySelector('button').disabled = false;
		}
	});
}

// Reaching for the handoff form is engaging with him too.
const handoffForm = document.querySelector('.handoff-form');
handoffForm.addEventListener('focusin', () => {
	alfreds.handoff.engaged = true;
	alfreds.handoff.wake();
});
handoffForm.addEventListener('focusout', () => {
	alfreds.handoff.engaged = false;
});

const breakButton = document.querySelector('[data-break]');
const fixButton = document.querySelector('[data-fix]');
async function recoveryCall(fix) {
	breakButton.disabled = true;
	fixButton.disabled = true;
	const input = { title: fix ? 'Give the agent a way forward' : '', priority: 'high' };
	document.querySelector('[data-recovery-input]').textContent = JSON.stringify(input, null, 2);
	try {
		const result = await call('todo-create', input, { surface: 'cli' });
		document.querySelector('[data-recovery-output]').innerHTML = jsonHtml(result);
		document.querySelector('[data-recovery-state]').textContent = result.success
			? 'REQUEST / CORRECTED'
			: 'REQUEST / REJECTED';
		document.querySelector('[data-recovery-label]').textContent = result.success
			? 'SUCCESS / the next step worked.'
			: 'VALIDATION_ERROR / not a dead end.';
		document.querySelector('[data-recovery-marker]').textContent = result.success ? '+' : '!';
		document.querySelector('[data-recovery-note-label]').textContent = result.success
			? 'RECOVERED'
			: 'SUGGESTION';
		document.querySelector('[data-recovery-note]').textContent = result.success
			? 'A title supplied. A task created. The same shared list, one step further.'
			: result.error.suggestion;
		fixButton.disabled = result.success;
	} finally {
		breakButton.disabled = false;
	}
}
breakButton.addEventListener('click', () => recoveryCall(false));
fixButton.addEventListener('click', () => recoveryCall(true));

// The three agent-UX panels sit side by side, so there are no tabs to wire.
const contractCommand = document.querySelector('[data-contract-command]');
function renderContract() {
	const command = listCommands().find((candidate) => candidate.name === contractCommand.value);
	const { name, description, parameters, mutation, destructive } = command;
	document.querySelector('[data-contract-purpose]').textContent = description;
	document.querySelector('[data-contract-inputs]').textContent = parameters.length
		? parameters
				.map((parameter) => `${parameter.name} (${parameter.required ? 'required' : 'optional'})`)
				.join(', ')
		: 'None';
	document.querySelector('[data-contract-effects]').textContent = destructive
		? 'Destructive / changes shared state'
		: mutation
			? 'Changes shared state'
			: 'Read only';
	document.querySelector('[data-contract-metadata]').innerHTML = jsonHtml({
		name,
		description,
		mutation: Boolean(mutation),
		destructive: Boolean(destructive),
		parameters,
	});
}
contractCommand.addEventListener('change', renderContract);
renderContract();

deleteRequest.addEventListener('click', () => {
	if (agentBusy || !getTodos().length) return;
	confirmDialog.returnValue = '';
	confirmDialog.showModal();
	document.querySelector('[data-delete-cancel]').focus();
});
document.querySelector('[data-delete-cancel]').addEventListener('click', () => {
	confirmDialog.close('cancel');
});
confirmDialog.addEventListener('close', () => {
	if (confirmDialog.returnValue !== 'confirmed') {
		controlStatus.textContent = 'Cancelled. No deletion command was sent.';
	}
});
deleteConfirm.addEventListener('click', async () => {
	if (!confirmDialog.open || deleteConfirm.disabled) return;
	deleteConfirm.disabled = true;
	// This caller gates execution; destructive metadata alone is not a permission check.
	try {
		const result = await call('todo-clear');
		controlStatus.textContent = result.success
			? `Deleted ${result.data.deleted} demo tasks after confirmation.`
			: result.error.suggestion;
	} finally {
		confirmDialog.close('confirmed');
		if (deleteRequest.disabled) document.getElementById('contract-control').focus();
		else deleteRequest.focus();
	}
});

document.querySelector('[data-result-open]').addEventListener('click', () => dialog.showModal());
document.querySelector('[data-result-close]').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
	const rect = dialog.getBoundingClientRect();
	if (
		event.target === dialog &&
		(event.clientX < rect.left ||
			event.clientX > rect.right ||
			event.clientY < rect.top ||
			event.clientY > rect.bottom)
	)
		dialog.close();
});

const installTabs = document.querySelector('.install-tabs');
initTabs(installTabs, () => {
	document.querySelector('[data-copy-status]').textContent = '';
});
tabEndpoints(installTabs);
document.querySelector('[data-copy-install]').addEventListener('click', async () => {
	const language = installTabs.querySelector('[aria-selected="true"]').dataset.language;
	const result = await call('install-copy', { language });
	document.querySelector('[data-copy-status]').textContent = result.success
		? 'Copied to clipboard.'
		: 'Clipboard unavailable. Select the command to copy it.';
});
// The install line in the hero runs the same command as the one at the foot.
const heroCopy = document.querySelector('[data-copy-hero]');
heroCopy.addEventListener('click', async () => {
	const result = await call('install-copy', { language: 'typescript' });
	heroCopy.textContent = result.success ? 'Copied' : 'Select to copy';
	setTimeout(() => {
		heroCopy.textContent = 'Copy';
	}, 2000);
});
document.querySelector('[data-copy-skill]').addEventListener('click', async () => {
	const copyStatus = document.querySelector('[data-skill-copy-status]');
	try {
		const result = await call('get-started');
		if (!result.success) throw new Error('Skill command unavailable');
		await navigator.clipboard.writeText(result.data.forYourAgent);
		copyStatus.textContent = 'Copied to clipboard.';
	} catch {
		copyStatus.textContent = 'Clipboard unavailable. Select the command to copy it.';
	}
});

const sectionAliases = {
	toolkit: 'start',
	botcore: 'workflow',
};
function focusSection(target) {
	const heading = target.querySelector('h1, h2, h3') ?? target;
	if (!heading.hasAttribute('tabindex')) {
		heading.tabIndex = -1;
		heading.addEventListener('blur', () => heading.removeAttribute('tabindex'), { once: true });
	}
	heading.focus({ preventScroll: true });
}
provide('scrollTo', (section) => {
	const target = document.getElementById(sectionAliases[section] ?? section);
	if (!target) return;
	if (location.hash !== `#${target.id}`) history.pushState(null, '', `#${target.id}`);
	focusSection(target);
	target.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });
});
window.addEventListener('hashchange', () => {
	const target = document.getElementById(location.hash.slice(1) || 'top');
	if (target && document.body.dataset.view !== 'agent') focusSection(target);
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
	if (section === 'main' || !document.getElementById(section)) return;
	event.preventDefault();
	if (document.body.dataset.view === 'agent') await call('view-set', { view: 'human' });
	await call('section-go', { section });
});

// The Agent tab: ask Alfred, and watch him call the same commands. The asks are
// scripted, so they are buttons, not a text box that pretends to understand.
const agentLog = document.querySelector('[data-agent-log]');
const intentButtons = [...document.querySelectorAll('[data-intent]')];

function agentLine(kind, who, text) {
	const item = document.createElement('li');
	item.className = `agent-log__${kind}`;
	const speaker = document.createElement('b');
	speaker.textContent = who;
	const words = document.createElement('span');
	words.textContent = text;
	item.append(speaker, words);
	return item;
}
async function agentTool(name, input = {}) {
	// A brief presentation beat, not simulated model or network activity.
	if (!reducedMotion.matches) await new Promise((resolve) => setTimeout(resolve, 260));
	const result = await call(name, input, { surface: 'agent' });
	const item = document.createElement('li');
	item.className = 'agent-log__call';
	item.dataset.state = result.success ? 'done' : 'error';
	const command = document.createElement('code');
	command.textContent = Object.keys(input).length ? `${name} ${JSON.stringify(input)}` : name;
	const note = document.createElement('span');
	note.textContent = result.success ? result.reasoning : result.error.suggestion;
	item.append(command, note);
	agentLog.append(item);
	agentLog.scrollTop = agentLog.scrollHeight;
	return result;
}
const stopped = (result) => ({ mood: 'fail', say: result.error.suggestion });
const intents = {
	left: {
		ask: 'What’s left?',
		async run() {
			const listed = await agentTool('todo-list');
			if (!listed.success) return stopped(listed);
			const open = listed.data.todos.filter((todo) => !todo.completed);
			if (!open.length) return { mood: 'pass', say: 'Nothing. Every task is done.' };
			const first = open.find((todo) => todo.priority === 'high') ?? open[0];
			return {
				mood: 'pass',
				say: `${open.length} open. I would start with “${first.title}”.`,
			};
		},
	},
	finish: {
		ask: 'Finish the high-priority tasks',
		async run() {
			const listed = await agentTool('todo-list');
			if (!listed.success) return stopped(listed);
			const targets = listed.data.todos.filter((todo) => !todo.completed && todo.priority === 'high');
			if (!targets.length) {
				return {
					mood: 'warn',
					say: 'Nothing is open at high priority. Drag a card there on the Board, then ask again.',
				};
			}
			for (const todo of targets) {
				const toggled = await agentTool('todo-toggle', { id: todo.id });
				if (!toggled.success) return stopped(toggled);
			}
			const checked = await agentTool('todo-list');
			const missed = checked.success
				? checked.data.todos.filter((todo) => !todo.completed && todo.priority === 'high').length
				: targets.length;
			return missed
				? { mood: 'warn', say: `${missed} are still open. Have a look at the List.` }
				: { mood: 'pass', say: `Finished ${targets.length}, then read the list again to be sure.` };
		},
	},
	reopen: {
		ask: 'Reopen what’s done',
		async run() {
			const listed = await agentTool('todo-list');
			if (!listed.success) return stopped(listed);
			const targets = listed.data.todos.filter((todo) => todo.completed);
			if (!targets.length) {
				return { mood: 'warn', say: 'Nothing is done yet. Check a task off on the List first.' };
			}
			for (const todo of targets) {
				const toggled = await agentTool('todo-toggle', { id: todo.id });
				if (!toggled.success) return stopped(toggled);
			}
			return { mood: 'pass', say: `Reopened ${targets.length}.` };
		},
	},
};
for (const button of intentButtons) {
	button.addEventListener('click', async () => {
		if (agentBusy) return;
		agentBusy = true;
		deleteRequest.disabled = true;
		for (const candidate of intentButtons) candidate.disabled = true;
		const intent = intents[button.dataset.intent];
		agentLog.replaceChildren(agentLine('you', 'You', intent.ask));
		const alfred = alfreds.demo;
		await Promise.race([alfred.wake(), new Promise((resolve) => setTimeout(resolve, 1600))]);
		const stopWorking = alfred.work();
		let outcome = { mood: 'fail', say: 'Something stopped me. Ask again.' };
		try {
			outcome = await intent.run();
		} finally {
			agentLog.append(agentLine('alfred', 'Alfred', outcome.say));
			agentLog.scrollTop = agentLog.scrollHeight;
			stopWorking().then(() => alfred.express(outcome.mood));
			agentBusy = false;
			deleteRequest.disabled = getTodos().length === 0;
			for (const candidate of intentButtons) candidate.disabled = false;
		}
	});
}

window.afd = { call: (name, input) => call(name, input, { surface: 'cli' }), tools: listCommands };
initAgentView();
// The opening state: three tasks, each created through a different surface,
// with the first step of the method already checked off. The next step is the
// one open high-priority task, so every ask in the Agent tab has work to do.
let firstStep;
for (const [title, priority, surface] of [
	['Build the human interface', 'low', 'ui'],
	['Prove it in the terminal', 'high', 'cli'],
	['Define the capability', 'medium', 'agent'],
]) {
	firstStep = await call('todo-create', { title, priority }, { surface });
}
await call('todo-toggle', { id: firstStep.data.id }, { surface: 'agent' });
await call('todo-list', {}, { surface: 'ui' });
booted = true;
rail.classList.remove('is-firing');

/* ── Command Manifesto 2 additions ─────────────────────────── */

// A few statements light up word by word as they scroll into view; a <mark>
// inside one is stamped when the whole statement is lit. Used sparingly.
function initLit(el) {
	const words = [];
	const walk = (node) => {
		for (const child of [...node.childNodes]) {
			if (child.nodeName === 'MARK') {
				words.push(child);
			} else if (child.nodeType === Node.TEXT_NODE) {
				const frag = document.createDocumentFragment();
				for (const part of child.textContent.split(/(\s+)/)) {
					if (!part) continue;
					if (/^\s+$/.test(part)) {
						frag.append(part);
						continue;
					}
					const span = document.createElement('span');
					span.className = 'lit-word';
					span.textContent = part;
					frag.append(span);
					words.push(span);
				}
				child.replaceWith(frag);
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				walk(child);
			}
		}
	};
	walk(el);
	el.classList.add('is-armed');
	let frame = 0;
	const update = () => {
		frame = 0;
		const top = el.getBoundingClientRect().top;
		const vh = window.innerHeight;
		const progress = Math.min(1, Math.max(0, (vh * 0.85 - top) / (vh * 0.5)));
		const lit = Math.round(progress * words.length);
		words.forEach((word, i) => word.classList.toggle('is-lit', i < lit));
		el.classList.toggle('is-complete', lit >= words.length);
	};
	const onScroll = () => {
		if (!frame) frame = requestAnimationFrame(update);
	};
	new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (entry.isIntersecting) window.addEventListener('scroll', onScroll, { passive: true });
			else window.removeEventListener('scroll', onScroll);
		}
		update();
	}).observe(el);
}

function initStatements() {
	if (reducedMotion.matches) return;
	for (const el of document.querySelectorAll('[data-lit]:not(.is-armed)')) initLit(el);
}
initStatements();
reducedMotion.addEventListener('change', initStatements);

// Finale: run the real get-started command and show its CommandResult.
const finaleForm = document.querySelector('[data-finale]');
const finaleOut = document.querySelector('[data-finale-out]');
let finaleBusy = false;
finaleForm?.addEventListener('submit', async (event) => {
	event.preventDefault();
	if (finaleBusy) return;
	finaleBusy = true;
	const run = finaleForm.querySelector('button');
	const status = finaleOut.querySelector('[data-finale-status]');
	const resources = finaleOut.querySelector('[data-finale-resources]');
	const details = finaleOut.querySelector('[data-finale-details]');
	run.disabled = true;
	finaleForm.setAttribute('aria-busy', 'true');
	status.textContent = 'Running get-started...';
	resources.hidden = true;
	details.hidden = true;
	details.open = false;
	try {
		const result = await call('get-started', {}, { surface: 'cli' });
		finaleOut.querySelector('[data-finale-result]').innerHTML = jsonHtml(result);
		details.hidden = false;
		if (result.success) {
			status.textContent = result.suggestions?.[0] ?? result.reasoning ?? 'Ready to get started.';
			finaleOut.querySelector('[data-finale-quickstart]').href = result.data.quickstart;
			finaleOut.querySelector('[data-finale-source]').href = result.data.source;
			resources.hidden = false;
		} else {
			status.textContent = result.error.suggestion ?? result.error.message;
		}
	} catch {
		status.textContent = 'The command could not finish. Run it again.';
	} finally {
		finaleBusy = false;
		run.disabled = false;
		finaleForm.removeAttribute('aria-busy');
	}
});
