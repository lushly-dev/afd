import { initAgentView } from './agent-view.js';
import { jsonHtml } from './cli-format.js';
import { call, getTodos, listCommands, onCommand, provide } from './runtime.js';
import { initTabs, reducedMotion } from './util.js';

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
const cliForm = document.querySelector('[data-cli-form]');
const agentForms = [...document.querySelectorAll('[data-agent-form]')];
const surfaceTabs = [...document.querySelectorAll('[data-surface]')];
const surfaceNames = { ui: 'Human', cli: 'Terminal', agent: 'Agent' };
const taskNodes = new Map();
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
			const sequence = document.createElement('span');
			sequence.className = 'task-sequence';
			sequence.setAttribute('aria-hidden', 'true');
			const title = document.createElement('strong');
			const priority = document.createElement('span');
			priority.className = 'task-priority';
			node.append(sequence, title, priority);
			taskNodes.set(todo.id, node);
		}
		node.dataset.priority = todo.priority;
		node.style.setProperty('--task-column', columns[todo.priority]);
		node.style.setProperty('--task-row', ++rows[todo.priority]);
		node.querySelector('.task-sequence').textContent = String(index + 1).padStart(2, '0');
		node.querySelector('strong').textContent = todo.title;
		node.querySelector('.task-priority').textContent = todo.priority;
		tasks.append(node);
	}
	if (!todos.length) {
		const empty = document.createElement('li');
		empty.className = 'empty-tasks';
		empty.textContent = 'A capability is waiting for its first call.';
		tasks.append(empty);
	}
	document.querySelector('[data-task-count]').textContent = String(todos.length).padStart(2, '0');
	deleteRequest.disabled = agentBusy || todos.length === 0;
	deleteConfirm.disabled = todos.length === 0;
	document.querySelector('[data-confirm-description]').textContent =
		`This will permanently delete all ${todos.length} tasks from the shared demo list.`;
}

onCommand((entry) => {
	if (!entry.name.startsWith('todo-')) return;
	renderTasks();
	document.querySelector('[data-raw-result]').innerHTML = jsonHtml(entry.result);
	document.querySelector('[data-cli-output]').innerHTML = jsonHtml(entry.result);
	document.querySelector('[data-contract-result]').innerHTML = jsonHtml(entry.result);
	document.querySelector('[data-contract-result-name]').textContent = entry.name;
	document.querySelector('[data-contract-outcome]').textContent = entry.result.success
		? 'Success'
		: entry.result.error.message;
	document.querySelector('[data-contract-reasoning]').textContent =
		entry.result.reasoning ?? 'Not supplied by this command.';
	document.querySelector('[data-contract-confidence]').textContent =
		entry.result.confidence == null ? 'Not supplied' : String(entry.result.confidence);
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
		? `${entry.name} / ${getTodos().length} tasks in shared state`
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
	if (next === 'terminal') call('todo-list', {}, { surface: 'cli' });
}

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

cliForm.elements.command.addEventListener('change', () => {
	cliForm.elements.input.value =
		cliForm.elements.command.value === 'todo-list'
			? '{}'
			: '{"title":"Build beyond the screen","priority":"high"}';
	cliForm.elements.input.removeAttribute('aria-invalid');
});
cliForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	const input = cliForm.elements.input;
	let args;
	try {
		args = JSON.parse(input.value);
		if (!args || typeof args !== 'object' || Array.isArray(args))
			throw new Error('Expected an object');
	} catch {
		input.setAttribute('aria-invalid', 'true');
		status.dataset.state = 'error';
		status.textContent = 'Enter a JSON object, for example {"title":"Ship it"}.';
		input.focus();
		return;
	}
	const button = cliForm.querySelector('button');
	button.disabled = true;
	try {
		const result = await call(cliForm.elements.command.value, args, { surface: 'cli' });
		input.setAttribute('aria-invalid', String(!result.success));
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
		document.querySelector('[data-agent-quote]').textContent = `"${title}"`;
		for (const [step, message] of Object.entries({
			read: 'Read the shared state.',
			create: 'Create the requested task.',
			verify: 'Verify the result.',
		}))
			agentStep(step, 'waiting', message);
		sessionState.textContent = 'RUNNING';
		agentStatus.textContent = 'Reading, creating, then verifying.';
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
				document.querySelector('[data-agent-summary]').textContent = created.error.suggestion;
				form.elements.title.focus();
				return;
			}
			const verified = await agentCall('verify', 'todo-list', {});
			const found =
				verified.success && verified.data.todos.some((todo) => todo.id === created.data.id);
			sessionState.textContent = found ? 'COMPLETE' : 'UNVERIFIED';
			const summary = found
				? `Task created and verified. ${verified.data.total} tasks in shared state.`
				: 'Task created; verification did not confirm it.';
			agentStatus.textContent = summary;
			document.querySelector('[data-agent-summary]').textContent = summary;
		} finally {
			agentBusy = false;
			deleteRequest.disabled = getTodos().length === 0;
			for (const candidate of agentForms) candidate.querySelector('button').disabled = false;
		}
	});
}

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

const contractTabs = document.querySelector('.contract-tabs');
initTabs(contractTabs);
tabEndpoints(contractTabs);
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
		if (deleteRequest.disabled) document.getElementById('contract-control-tab').focus();
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

window.afd = { call: (name, input) => call(name, input, { surface: 'cli' }), tools: listCommands };
initAgentView();
for (const [title, priority] of [
	['Build the human interface', 'low'],
	['Prove it in the terminal', 'medium'],
	['Define the capability', 'high'],
]) {
	await call('todo-create', { title, priority }, { surface: 'cli' });
}
await call('todo-list', {}, { surface: 'cli' });
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
