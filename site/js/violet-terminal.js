// A Violet prompt in the page. It takes the part of the real `violet` CLI
// that runs commands by name (`violet call`, `violet commands`, `--schema`,
// `--json`) and prints results the way the CLI's text output does
// (endpoints/violet-cli/src/output.ts). The rest of the CLI writes files,
// starts servers or sets up CI, so it has nothing to do in a browser.

import { escape } from './cli-format.js';

const USAGE = [
	'Usage:',
	'  violet commands                      list every command',
	"  violet call <command> -i '<json>'    run one",
	'  violet call <command> --schema       show the input it takes',
	'  violet --json call <command> ...     print the whole result as JSON',
	'  clear                                empty the screen',
	'',
	'This page runs the command layer in your browser. The rest of the CLI',
	'(writing export files, the MCP server, CI setup) needs a machine.',
].join('\n');

const span = (className, text) => `<span class="${className}">${escape(text)}</span>`;

function simple(value) {
	if (value === null || value === undefined) return span('tok-dim', 'null');
	if (typeof value === 'string') return span('tok-str', `"${value}"`);
	if (typeof value === 'number' || typeof value === 'boolean') return span('tok-num', String(value));
	return escape(String(value));
}

/** violet-cli `formatData`: nested keys and values, not JSON. */
function formatData(data, indent = 0) {
	const padding = '  '.repeat(indent);
	if (data === null || typeof data !== 'object') return `${padding}${simple(data)}`;
	if (Array.isArray(data)) {
		if (data.length === 0) return `${padding}[]`;
		if (data.every((item) => typeof item !== 'object' || item === null)) {
			return `${padding}[${data.map(simple).join(', ')}]`;
		}
		return [`${padding}[`, ...data.map((item) => `${formatData(item, indent + 1)},`), `${padding}]`].join('\n');
	}
	const entries = Object.entries(data);
	if (entries.length === 0) return `${padding}{}`;
	const lines = [`${padding}{`];
	for (const [key, value] of entries) {
		const text = formatData(value, 0).trim();
		if (text.includes('\n')) {
			lines.push(`${padding}  ${span('tok-key', key)}:`, formatData(value, indent + 2));
		} else {
			lines.push(`${padding}  ${span('tok-key', key)}: ${text}`);
		}
	}
	lines.push(`${padding}}`);
	return lines.join('\n');
}

/** violet-cli `formatOutput`. */
function formatOutput(result) {
	const lines = [];
	if (result.success) {
		if (result.data) lines.push(formatData(result.data));
		if (result.reasoning) lines.push('', span('tok-dim', `ℹ ${result.reasoning}`));
		if (result.warnings?.length) {
			lines.push('');
			for (const warning of result.warnings) lines.push(span('tok-warn', `⚠ ${warning.message}`));
		}
	} else {
		lines.push(span('tok-err', `✗ ${result.error?.message || 'Unknown error'}`));
		if (result.error?.suggestion) lines.push(span('tok-dim', `  💡 ${result.error.suggestion}`));
	}
	if (result.metadata?.executionTimeMs) {
		lines.push('', span('tok-dim', `[${result.metadata.executionTimeMs}ms]`));
	}
	return lines.join('\n');
}

/** Turn a typed line into something to do. */
function parse(line) {
	const text = line.trim();
	if (!text) return null;
	if (text === 'clear') return { kind: 'clear' };
	if (/^(help|violet|violet\s+(help|--help|-h))$/.test(text)) return { kind: 'help' };
	const words = /^violet\s+([\s\S]+)$/.exec(text);
	if (!words) return { kind: 'unknown' };
	let rest = words[1];
	let json = false;
	// --json is a global flag: before the subcommand, or at the very end.
	if (/^--json\s+/.test(rest)) {
		json = true;
		rest = rest.replace(/^--json\s+/, '');
	}
	if (/\s--json$/.test(rest)) {
		json = true;
		rest = rest.replace(/\s--json$/, '');
	}
	if (/^commands$/.test(rest)) return { kind: 'commands', json };
	const called = /^call\s+(\S+)(?:\s+([\s\S]+))?$/.exec(rest);
	if (!called) return { kind: 'unknown' };
	const name = called[1];
	const flags = called[2]?.trim() ?? '';
	if (flags === '--schema') return { kind: 'schema', name };
	if (!flags) return { kind: 'call', name, input: {}, json };
	const given = /^(?:-i|--input)\s+([\s\S]+)$/.exec(flags);
	if (!given) return { kind: 'noflag', name };
	let raw = given[1].trim();
	// Shell quoting: '{"nodeId":"x"}' or "{...}" around the JSON.
	if (raw.length > 1 && /^['"]/.test(raw) && raw.at(-1) === raw[0] && raw[1] === '{') {
		raw = raw.slice(1, -1);
	}
	try {
		const input = JSON.parse(raw);
		if (!input || typeof input !== 'object' || Array.isArray(input)) return { kind: 'badjson', name };
		return { kind: 'call', name, input, json };
	} catch {
		return { kind: 'badjson', name };
	}
}

/**
 * @param {object} options
 * @param {HTMLFormElement} options.form The prompt line; its `command` input is the prompt.
 * @param {HTMLElement} options.screen Where output is printed.
 * @param {HTMLElement} options.tries Where the suggested commands go.
 * @param {(name: string, input: object) => Promise<object>} options.call
 * @param {() => { name: string, description: string }[]} options.listCommands
 * @param {(name: string) => object | undefined} options.inputSchema
 * @param {[label: string, line: string][]} options.suggestions Lines to offer under the prompt.
 * @param {() => void | Promise<void>} [options.onRan] Called after a command has run.
 */
export function initVioletTerminal({ form, screen, tries, call, listCommands, inputSchema, suggestions, onRan }) {
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
		return block;
	}

	async function run(line) {
		const command = parse(line);
		if (!command) return;
		const echo = print(`<span class="tok-prompt">$</span> ${escape(line.trim())}`, 'terminal-echo');
		if (command.kind === 'clear') {
			screen.replaceChildren();
		} else if (command.kind === 'help') {
			print(escape(USAGE));
		} else if (command.kind === 'commands') {
			const commands = listCommands();
			print(
				command.json
					? escape(JSON.stringify({ success: true, data: { total: commands.length, commands } }, null, 2))
					: escape(
							[
								'',
								'All available commands:',
								'',
								...commands.map((item) => `  ${item.name.padEnd(20)} ${item.description}`),
								'',
							].join('\n')
						)
			);
		} else if (command.kind === 'schema') {
			const schema = inputSchema(command.name);
			print(
				schema
					? escape(JSON.stringify(schema, null, 2))
					: span('tok-err', `✗ Command '${command.name}' not found`)
			);
		} else if (command.kind === 'noflag') {
			print(
				`${span('tok-err', '✗ Pass the input as JSON after -i.')}\n${span('tok-dim', `  💡 violet call ${command.name} -i '{"nodeId":"atlas"}'`)}`
			);
		} else if (command.kind === 'badjson') {
			print(
				`${span('tok-err', '✗ The input after -i is not a JSON object.')}\n${span('tok-dim', `  💡 violet call ${command.name} --schema`)}`
			);
		} else if (command.kind === 'unknown') {
			print(`${span('tok-err', '✗ Not something this prompt runs.')}\n${span('tok-dim', '  💡 help')}`);
		} else {
			const result = await call(command.name, command.input);
			print(command.json ? escape(JSON.stringify(result, null, 2)) : formatOutput(result));
			await onRan?.();
		}
		// Long results start at their first line, not their last.
		if (echo.isConnected) screen.scrollTop = echo.offsetTop - screen.offsetTop;
	}

	tries.replaceChildren(
		...suggestions.map(([label, line]) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.textContent = label;
			button.title = line;
			button.addEventListener('click', () => {
				// Put it on the prompt rather than running it: the line is yours to edit.
				prompt.value = line;
				prompt.focus();
			});
			return button;
		})
	);

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
			// Complete a command name after `violet call `.
			const match = /^(violet\s+(?:--json\s+)?call\s+)(\S*)$/.exec(prompt.value);
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
				screen.scrollTop = screen.scrollHeight;
			}
		}
	});

	// Clicking the screen is clicking the terminal: focus the prompt.
	screen.addEventListener('click', () => {
		if (!String(getSelection())) prompt.focus();
	});

	return {
		run,
		/** Put a line on the prompt for the reader to edit or run. */
		offer(line) {
			prompt.value = line;
			prompt.focus();
		},
		clear() {
			screen.replaceChildren();
		},
	};
}
