// Hero: one command, three live surfaces. The terminal, the (scripted) agent
// and the web form all call the same afd-core command; a pulse travels down the
// rail to the command layer, and the real CommandResult lands in the panel.

import { escape, formatResult, formatTools, jsonHtml } from './cli-format.js';
import { call, getTodos, listCommands, onCommand } from './runtime.js';
import { reducedMotion, whileVisible } from './util.js';

const SURFACE_INDEX = { cli: 0, agent: 1, ui: 2 };
const SURFACE_LABEL = { cli: 'via CLI', agent: 'via MCP agent', ui: 'via web UI', palette: 'via palette' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── Headline: typed by a cursor, then PRODUCT. is stamped ─────────────── */

function typeHeadline() {
	const title = document.querySelector('.hero-title');
	if (!title || reducedMotion.matches) return;
	title.setAttribute('aria-label', title.textContent.replace(/\s+/g, ' ').trim());
	const accent = title.querySelector('.accent-word');
	const chars = [];
	// Wrap every character outside the accent word; the accent word is stamped whole.
	const walk = (node) => {
		for (const child of [...node.childNodes]) {
			if (child === accent) continue;
			if (child.nodeType === Node.TEXT_NODE) {
				const frag = document.createDocumentFragment();
				for (const ch of child.textContent) {
					if (/\s/.test(ch)) {
						frag.append(ch);
						continue;
					}
					const s = document.createElement('span');
					s.className = 'type-char';
					s.textContent = ch;
					s.setAttribute('aria-hidden', 'true');
					frag.append(s);
					chars.push(s);
				}
				child.replaceWith(frag);
			} else walk(child);
		}
	};
	walk(title);
	const caret = document.createElement('span');
	caret.className = 'type-caret';
	caret.setAttribute('aria-hidden', 'true');
	title.classList.add('is-typing');
	accent.classList.add('is-waiting');

	chars.forEach((ch, i) => {
		setTimeout(() => {
			ch.classList.add('is-typed');
			ch.after(caret);
		}, 60 + i * 38);
	});
	setTimeout(
		() => {
			caret.remove();
			accent.classList.remove('is-waiting');
			accent.classList.add('is-stamped');
			title.classList.remove('is-typing');
		},
		60 + chars.length * 38 + 180
	);
}

/* ── Rails, result panel, stamp ────────────────────────────────────────── */

function makeResultPanel(figure) {
	const panel = figure.querySelector('[data-result]');
	const title = figure.querySelector('[data-result-title]');
	const via = figure.querySelector('[data-result-via]');
	const code = figure.querySelector('[data-result-code]');
	const stamp = figure.querySelector('[data-result-stamp]');
	const surfaces = [...figure.querySelectorAll('[data-surface]')];
	const layerPulse = figure.querySelector('[data-layer-pulse]');

	return async function show(entry) {
		const index = SURFACE_INDEX[entry.surface];
		surfaces.forEach((el, n) => {
			el.classList.toggle('is-active', n === index);
			// The window that fired comes to the front, like a real desktop.
			el.classList.toggle('is-front', n === index);
		});
		if (index !== undefined && !reducedMotion.matches) {
			// The call lands on the command layer right under the window it came from.
			const from = surfaces[index].getBoundingClientRect();
			const to = panel.getBoundingClientRect();
			const x = Math.min(Math.max(from.left + from.width / 2 - to.left, 0), to.width);
			layerPulse.style.setProperty('--x', `${x}px`);
			layerPulse.dataset.surface = entry.surface;
			layerPulse.classList.remove('is-firing');
			void layerPulse.offsetWidth;
			layerPulse.classList.add('is-firing');
			await wait(320);
		}
		title.textContent = `${entry.name} → CommandResult`;
		via.textContent = SURFACE_LABEL[entry.surface] ?? '';
		code.innerHTML = jsonHtml(entry.result);
		panel.classList.toggle('is-failure', !entry.result.success);
		stamp.textContent = entry.result.success ? '✓ Success' : '✗ Failed';
		stamp.classList.remove('is-stamped');
		void stamp.offsetWidth;
		stamp.classList.add('is-stamped');
	};
}

/* ── Terminal ──────────────────────────────────────────────────────────── */

// Shell-style tokenizer: whitespace-separated, with '…' and "…" quoting.
function tokenize(line) {
	const tokens = [];
	let current = '';
	let quote = null;
	let started = false;
	for (const ch of line) {
		if (quote) {
			if (ch === quote) quote = null;
			else current += ch;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
			started = true;
		} else if (/\s/.test(ch)) {
			if (started) tokens.push(current);
			current = '';
			started = false;
		} else {
			current += ch;
			started = true;
		}
	}
	if (quote) throw new Error('Unterminated quote');
	if (started) tokens.push(current);
	return tokens;
}

// afd-cli accepts JSON or key=value pairs.
function parseArgs(args) {
	if (!args.length) return {};
	if (args[0].trim().startsWith('{')) return JSON.parse(args.join(' '));
	const input = {};
	for (const arg of args) {
		const eq = arg.indexOf('=');
		if (eq < 1) throw new Error(`Expected JSON or key=value, got "${arg}"`);
		input[arg.slice(0, eq)] = arg.slice(eq + 1);
	}
	return input;
}

const HELP = [
	'<span class="tok-label">Commands in this terminal:</span>',
	'  afd call &lt;name&gt; [json | key=value …] [-v]',
	'  afd tools          list every command',
	'  clear              clear the screen',
	'',
	'Try: <span class="tok-key">afd call todo-create title="Buy milk" priority=high</span>',
	'Tip: <kbd>Tab</kbd> completes command names, <kbd>↑</kbd> recalls history.',
].join('\n');

function makeTerminal(root) {
	const out = root.querySelector('.term__out');
	const form = root.querySelector('.term__line');
	const input = root.querySelector('.term__input');
	const history = [];
	let cursor = -1;

	const print = (html) => {
		out.insertAdjacentHTML('beforeend', `${html}\n`);
		out.scrollTop = out.scrollHeight;
	};

	async function run(line) {
		const trimmed = line.trim();
		print(`<span class="tok-prompt">${escape(trimmed)}</span>`);
		if (!trimmed) return;
		history.unshift(trimmed);
		cursor = -1;

		let tokens;
		try {
			tokens = tokenize(trimmed);
		} catch (error) {
			print(`<span class="tok-err">Error:</span> ${escape(error.message)}`);
			return;
		}
		const [bin, sub, name, ...rest] = tokens;
		if (bin === 'clear') {
			out.textContent = '';
			return;
		}
		if (bin === 'help' || (bin === 'afd' && (!sub || sub === '--help' || sub === 'help'))) {
			print(HELP);
			return;
		}
		if (bin !== 'afd') {
			const hint = listCommands().some((c) => c.name === bin)
				? ` Did you mean <span class="tok-key">afd call ${escape(bin)}</span>?`
				: ' Type <span class="tok-key">help</span>.';
			print(`zsh: command not found: ${escape(bin)}.${hint}`);
			return;
		}
		if (sub === 'tools') {
			print(formatTools(listCommands().filter((c) => c.expose?.cli)));
			return;
		}
		if (sub !== 'call' || !name) {
			print(`<span class="tok-err">error:</span> unknown command '${escape(sub ?? '')}'. Try <span class="tok-key">afd call &lt;name&gt;</span> or <span class="tok-key">help</span>.`);
			return;
		}
		const verbose = rest.includes('-v') || rest.includes('--verbose');
		let args;
		try {
			args = parseArgs(rest.filter((a) => a !== '-v' && a !== '--verbose'));
		} catch (error) {
			print(`<span class="tok-err">Error:</span> Invalid arguments: ${escape(error.message)}`);
			return;
		}
		const result = await call(name, args, { surface: 'cli' });
		print(`${formatResult(result, { verbose })}\n`);
	}

	form.addEventListener('submit', (event) => {
		event.preventDefault();
		const line = input.value;
		input.value = '';
		run(line);
	});

	input.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowUp' && history.length) {
			event.preventDefault();
			cursor = Math.min(cursor + 1, history.length - 1);
			input.value = history[cursor];
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			cursor = Math.max(cursor - 1, -1);
			input.value = cursor < 0 ? '' : history[cursor];
		} else if (event.key === 'Tab') {
			const match = input.value.match(/^(\s*afd\s+call\s+)([\w-]*)$/);
			if (!match) return;
			event.preventDefault();
			const options = listCommands()
				.map((c) => c.name)
				.filter((n) => n.startsWith(match[2]));
			if (options.length === 1) input.value = `${match[1]}${options[0]} `;
			else if (options.length > 1) print(options.join('   '));
		}
	});

	print('<span class="tok-label">afd.dev · a real afd-core registry, in your browser. Type help.</span>');

	return {
		input,
		/** Type a command into the prompt, then run it. */
		async type(line, speed = 24) {
			for (const ch of line) {
				input.value += ch;
				await wait(speed);
			}
			await wait(260);
			input.value = '';
			await run(line);
		},
	};
}

/* ── Agent (scripted) ──────────────────────────────────────────────────── */

const AGENT_SCRIPT = [
	{
		prompt: '“Add groceries to my list. It’s urgent.”',
		command: 'todo-create',
		params: { title: 'Buy groceries', priority: 'high' },
	},
	{ prompt: '“What’s on my list?”', command: 'todo-list', params: {} },
	{ prompt: '“Add ‘call the plumber’, no rush.”', command: 'todo-create', params: { title: 'Call the plumber', priority: 'low' } },
	{ prompt: '“Clear my list.”', command: 'todo-clear', params: {} },
];

function makeAgent(root) {
	const prompt = root.querySelector('[data-agent-prompt]');
	const callEl = root.querySelector('[data-agent-call] code');
	const confirm = root.querySelector('[data-agent-confirm]');
	const runBtn = root.querySelector('[data-agent-run]');
	let step = 0;
	let busy = false;

	const toolCall = ({ command, params }) => {
		const action = command.replace(/^todo-/, '');
		return `<span class="tok-label">tool_use:</span> <span class="tok-str">"todo"</span>\n${jsonHtml({ action, params }, 'inline')}`;
	};

	const askConfirm = () =>
		new Promise((resolve) => {
			confirm.hidden = false;
			runBtn.hidden = true;
			const done = (ok) => {
				confirm.hidden = true;
				runBtn.hidden = false;
				resolve(ok);
			};
			confirm.querySelector('[data-agent-allow]').onclick = () => done(true);
			confirm.querySelector('[data-agent-deny]').onclick = () => done(false);
			confirm.querySelector('[data-agent-allow]').focus();
		});

	async function next() {
		if (busy) return;
		busy = true;
		runBtn.disabled = true;
		const turn = AGENT_SCRIPT[step % AGENT_SCRIPT.length];
		step += 1;
		prompt.textContent = turn.prompt;
		prompt.classList.remove('is-new');
		void prompt.offsetWidth;
		prompt.classList.add('is-new');
		callEl.innerHTML = '<span class="tok-label">thinking…</span>';
		await wait(reducedMotion.matches ? 0 : 650);
		callEl.innerHTML = toolCall(turn);

		const definition = listCommands().find((c) => c.name === turn.command);
		// Trust config in action: destructive commands wait for a person.
		if (definition?.destructive && !(await askConfirm())) {
			callEl.innerHTML = `${toolCall(turn)}\n<span class="tok-err">✗ Denied by you.</span> <span class="tok-label">The agent did not run it.</span>`;
		} else {
			await call(turn.command, turn.params, { surface: 'agent' });
		}
		runBtn.disabled = false;
		runBtn.textContent = step % AGENT_SCRIPT.length === 0 ? 'Run again ▸' : 'Next turn ▸';
		busy = false;
	}

	runBtn.addEventListener('click', next);
	return { next };
}

/* ── Web app ───────────────────────────────────────────────────────────── */

function makeApp(root) {
	const form = root.querySelector('[data-app-form]');
	const list = root.querySelector('[data-app-list]');
	const title = form.elements.title;
	const priority = form.elements.priority;
	const button = form.querySelector('button');

	const render = () => {
		const todos = getTodos();
		list.innerHTML = todos.length
			? todos
					.slice(0, 4)
					.map(
						(t) =>
							`<li><span class="app__check" aria-hidden="true"></span>${escape(t.title)}<span class="app__tag app__tag--${t.priority}">${t.priority}</span></li>`
					)
					.join('') + (todos.length > 4 ? `<li class="app__more">+ ${todos.length - 4} more</li>` : '')
			: '<li class="app__empty">No todos yet. Add one from any surface.</li>';
	};

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const result = await call(
			'todo-create',
			{ title: title.value, priority: priority.value },
			{ surface: 'ui' }
		);
		form.classList.toggle('is-invalid', !result.success);
		if (result.success) title.value = '';
		else title.focus();
	});

	onCommand((entry) => {
		if (entry.name.startsWith('todo-')) render();
	});
	render();

	return {
		async fill(text, level) {
			title.focus({ preventScroll: true });
			for (const ch of text) {
				title.value += ch;
				await wait(40);
			}
			priority.value = level;
			await wait(300);
			button.classList.add('is-pressed');
			await wait(160);
			button.classList.remove('is-pressed');
			form.requestSubmit();
			title.blur();
		},
	};
}

/* ── Wiring + first-visit demo ─────────────────────────────────────────── */

export function initHero() {
	typeHeadline();

	const figure = document.querySelector('[data-surfaces]');
	if (!figure) return;
	const show = makeResultPanel(figure);
	const terminal = makeTerminal(figure.querySelector('[data-terminal]'));
	const agent = makeAgent(figure.querySelector('[data-agent]'));
	const app = makeApp(figure.querySelector('.app'));

	onCommand((entry) => {
		if (entry.surface in SURFACE_INDEX) show(entry);
	});

	// Every command the page runs lights up in the drifting command layer behind the hero.
	const field = document.querySelector('[data-hero-field]');
	onCommand((entry) => {
		if (!field || !entry.result.success) return;
		const matches = [...field.querySelectorAll(`[data-cmd="${CSS.escape(entry.name)}"]`)];
		const visible = matches.filter((el) => {
			const r = el.getBoundingClientRect();
			return r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight;
		});
		for (const el of visible.slice(0, 3)) {
			el.classList.remove('is-fading');
			el.classList.add('is-lit');
			setTimeout(() => {
				el.classList.add('is-fading');
				el.classList.remove('is-lit');
			}, 900);
		}
	});

	// Windows drop onto the stage one by one after the headline is typed.
	if (!reducedMotion.matches) figure.querySelector('.stage')?.classList.add('is-entering');

	// Play one pass through all three surfaces the first time the figure is
	// seen, unless the visitor gets there first or prefers less motion.
	if (reducedMotion.matches) return;
	let touched = false;
	let played = false;
	figure.addEventListener('pointerdown', () => { touched = true; }, { once: true });
	figure.addEventListener('focusin', () => { touched = true; }, { once: true });
	whileVisible(
		figure,
		async () => {
			if (played || touched) return;
			played = true;
			await wait(2600);
			if (touched) return;
			await terminal.type('afd call todo-create \'{"title":"Ship the site","priority":"high"}\'');
			await wait(1500);
			if (touched) return;
			await agent.next();
			await wait(1500);
			if (touched) return;
			await app.fill('Write the changelog', 'medium');
		},
		() => {},
		0.2
	);
}
