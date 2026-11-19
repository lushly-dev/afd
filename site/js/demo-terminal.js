// The demo's terminal: a real prompt. Type `afd call <command> '<json>'` and it
// runs through the same registry as the screen and the agent, printing the
// result the way afd-cli does.

import { escape, formatResult, formatTools } from './cli-format.js';

const USAGE = [
	'Usage:',
	'  afd tools                      list every command',
	"  afd call <command> '<json>'    run one",
	'  clear                          empty the screen',
].join('\n');

/** Turn a typed line into something to do. */
function parse(line) {
	const text = line.trim();
	if (!text) return null;
	if (text === 'clear') return { kind: 'clear' };
	if (/^(help|afd|afd\s+(help|--help|-h))$/.test(text)) return { kind: 'help' };
	if (/^afd\s+tools$/.test(text)) return { kind: 'tools' };
	const match = /^afd\s+call\s+(\S+)(?:\s+([\s\S]+))?$/.exec(text);
	if (!match) return { kind: 'unknown' };
	let raw = match[2]?.trim() ?? '';
	// Shell quoting: '{"title":"x"}' or "{...}" around the JSON.
	if (raw.length > 1 && /^['"]/.test(raw) && raw.at(-1) === raw[0] && raw[1] === '{') {
		raw = raw.slice(1, -1);
	}
	let input = {};
	if (raw) {
		try {
			input = JSON.parse(raw);
		} catch {
			return { kind: 'badjson' };
		}
		if (!input || typeof input !== 'object' || Array.isArray(input)) return { kind: 'badjson' };
	}
	return { kind: 'call', name: match[1], input };
}

/**
 * @param {object} options
 * @param {HTMLFormElement} options.form The prompt line; its `command` input is the prompt.
 * @param {HTMLElement} options.screen Where output is printed.
 * @param {HTMLElement} options.tries Where the suggested commands go.
 * @param {(name: string, input: object, options: object) => Promise<object>} options.call
 * @param {() => object[]} options.listCommands
 * @param {() => object[]} options.getTodos
 */
export function initTerminal({ form, screen, tries, call, listCommands, getTodos }) {
	const prompt = form.elements.command;
	const history = [];
	let cursor = 0;
	let draft = '';

	function print(html, className = '') {
		const block = document.createElement('pre');
		block.className = className;
		block.innerHTML = html;
		screen.append(block);
		while (screen.children.length > 40) screen.firstElementChild.remove();
		screen.scrollTop = screen.scrollHeight;
	}

	async function run(line) {
		const command = parse(line);
		if (!command) return;
		print(`<span class="tok-prompt">$</span> ${escape(line.trim())}`, 'terminal-echo');
		if (command.kind === 'clear') {
			screen.replaceChildren();
		} else if (command.kind === 'help') {
			print(escape(USAGE));
		} else if (command.kind === 'tools') {
			print(formatTools(listCommands()));
		} else if (command.kind === 'badjson') {
			print(
				`<span class="tok-err">✗ Input is not a JSON object.</span>\n\n<span class="tok-label">Suggestion:</span> ${escape(`afd call todo-create '{"title":"Ship it"}'`)}`
			);
		} else if (command.kind === 'unknown') {
			print(
				`<span class="tok-err">✗ Not an afd command.</span>\n\n<span class="tok-label">Suggestion:</span> afd tools`
			);
		} else {
			const result = await call(command.name, command.input, { surface: 'cli' });
			print(formatResult(result, { verbose: true }));
		}
		renderTries();
	}

	// A few real commands to start from, using ids that exist right now.
	function renderTries() {
		const todos = getTodos();
		const open = todos.find((todo) => !todo.completed) ?? todos[0];
		const lines = ['afd tools', 'afd call todo-list', `afd call todo-create '{"title":"Ship it"}'`];
		if (open) {
			lines.push(`afd call todo-toggle '{"id":"${open.id}"}'`);
			const priority = open.priority === 'high' ? 'low' : 'high';
			lines.push(`afd call todo-update '{"id":"${open.id}","priority":"${priority}"}'`);
		}
		tries.replaceChildren(
			...lines.map((line) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.textContent = line;
				button.addEventListener('click', () => {
					// Put it on the prompt rather than running it: the line is yours to edit.
					prompt.value = line;
					prompt.focus();
				});
				return button;
			})
		);
	}

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const line = prompt.value;
		if (!line.trim()) return;
		history.push(line);
		cursor = history.length;
		prompt.value = '';
		await run(line);
	});

	prompt.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			if (!history.length) return;
			event.preventDefault();
			if (cursor === history.length) draft = prompt.value;
			cursor = Math.min(history.length, Math.max(0, cursor + (event.key === 'ArrowUp' ? -1 : 1)));
			prompt.value = cursor === history.length ? draft : history[cursor];
		} else if (event.key === 'Tab' && !event.shiftKey) {
			// Complete a command name after `afd call `.
			const match = /^(afd\s+call\s+)(\S*)$/.exec(prompt.value);
			if (!match) return;
			const names = listCommands()
				.map((command) => command.name)
				.filter((name) => name.startsWith(match[2]));
			if (!names.length) return;
			event.preventDefault();
			if (names.length === 1) {
				prompt.value = `${match[1]}${names[0]} `;
			} else {
				print(escape(names.join('   ')));
			}
		}
	});

	// Clicking the screen is clicking the terminal: focus the prompt.
	screen.addEventListener('click', () => {
		if (!String(getSelection())) prompt.focus();
	});

	renderTries();
	return {
		/** Called when the tab is shown. The first time, it runs one command so the screen is not blank. */
		async show() {
			renderTries();
			if (!screen.children.length) await run('afd call todo-list');
		},
		run,
	};
}
