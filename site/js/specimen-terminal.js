// A Specimen prompt in the page. It takes the lines the real `specimen` CLI
// takes (endpoints/specimen-cli/src/cli.ts) and runs them through the same
// command definitions. Two of them need no browser, `list` and `diff`, and
// those run for real here on the captures in site/specimen/captures/. The
// rest render in Chromium through the native host, which a tab cannot start,
// so they come back as the failure a command reports, with what to do next.
//
// The CLI prints one CommandResult as a single line of JSON. The prompt
// prints the same value with indentation, so it can be read.

import { escape, jsonHtml } from './cli-format.js';

const USAGE = [
	'Usage:',
	'  specimen list                               the project’s specimens',
	'  specimen diff LEFT.json RIGHT.json          compare two captures',
	'    --allow-context theme,viewport            let a context axis differ',
	'    --require-visual                          insist on pixel evidence',
	'  specimen render ID, run, themes, a11y ...   need the native host',
	'  ls captures                                 the capture files on this page',
	'  clear                                       empty the screen',
	'',
	'This page runs the command layer in your browser. Rendering needs the',
	'host and Chromium, so here it reports that instead of pretending.',
].join('\n');

const span = (className, text) => `<span class="${className}">${escape(text)}</span>`;

/** The CLI's actions that take one positional id, and the command each runs. */
const WITH_ID = ['render', 'inspect', 'run', 'baseline'];
const PLAIN = ['validate', 'themes', 'a11y', 'profile', 'coverage', 'contract', 'migrate', 'pack', 'pack-check'];

/** `captures/bar.json` or `bar.json` → `bar`. */
const captureId = (path) => /^(?:\.\/)?(?:captures\/)?([a-z0-9-]+)\.json$/.exec(path)?.[1] ?? null;

/** Turn a typed line into something to do. */
function parse(line) {
	const words = line.trim().split(/\s+/);
	if (!words[0]) return null;
	if (words[0] === 'clear') return { kind: 'clear' };
	if (words[0] === 'help') return { kind: 'help' };
	if (words[0] === 'ls') return { kind: 'ls' };
	if (words[0] !== 'specimen') return { kind: 'unknown' };
	const [action, ...rest] = words.slice(1);
	if (!action || action === 'help' || action === '--help') return { kind: 'help' };
	if (action === 'list') return { kind: 'call', name: 'specimen-list', input: {} };
	if (action === 'diff') {
		const positionals = [];
		const input = {};
		for (let index = 0; index < rest.length; index++) {
			if (rest[index] === '--require-visual') input.requireVisual = true;
			else if (rest[index] === '--allow-context') input.allowContextDifferences = (rest[++index] ?? '').split(',');
			else if (rest[index].startsWith('--')) return { kind: 'badflag', flag: rest[index] };
			else positionals.push(rest[index]);
		}
		if (positionals.length !== 2) return { kind: 'difffiles' };
		const ids = positionals.map(captureId);
		const missing = positionals.find((_, index) => !ids[index]);
		if (missing) return { kind: 'nofile', file: missing };
		return { kind: 'diff', ids, input };
	}
	const id = rest.find((word) => !word.startsWith('--'));
	if (action === 'matrix') {
		// The axes are comma-separated context values, as the CLI takes them.
		const themes = rest[rest.indexOf('--theme') + 1];
		const axes = rest.includes('--theme') && themes ? { theme: themes.split(',') } : {};
		return { kind: 'call', name: 'specimen-matrix', input: { ...(id ? { id } : {}), axes } };
	}
	if (WITH_ID.includes(action)) return { kind: 'call', name: `specimen-${action}`, input: id ? { id } : {} };
	if (PLAIN.includes(action)) return { kind: 'call', name: `specimen-${action}`, input: {} };
	if (action === 'suggest') return { kind: 'call', name: 'specimen-suggest', input: { component: id ?? 'change-bar' } };
	if (action === 'build') return { kind: 'call', name: 'specimen-build', input: { outDir: id ?? './review' } };
	if (action === 'pack-export') return { kind: 'call', name: 'specimen-pack-export', input: { directory: id ?? './pack' } };
	return { kind: 'unknown' };
}

/**
 * @param {object} options
 * @param {HTMLFormElement} options.form The prompt line; its `command` input is the prompt.
 * @param {HTMLElement} options.screen Where output is printed.
 * @param {HTMLElement} options.tries Where the suggested lines go.
 * @param {(name: string, input: object) => Promise<object>} options.call Run a command by name.
 * @param {(leftId: string, rightId: string, input: object) => Promise<object>} options.diff Compare two captures.
 * @param {() => string[]} options.files The capture files on the page.
 * @param {[label: string, line: string][]} options.suggestions Lines to offer under the prompt.
 * @param {(ran: object) => void | Promise<void>} [options.onRan] Called with what ran and its result.
 */
export function initSpecimenTerminal({ form, screen, tries, call, diff, files, suggestions, onRan }) {
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

	const fail = (message, hint) => print(`${span('tok-err', `✗ ${message}`)}\n${span('tok-dim', `  💡 ${hint}`)}`);

	async function run(line) {
		const command = parse(line);
		if (!command) return;
		const echo = print(`<span class="tok-prompt">$</span> ${escape(line.trim())}`, 'terminal-echo');
		if (command.kind === 'clear') {
			screen.replaceChildren();
		} else if (command.kind === 'help') {
			print(escape(USAGE));
		} else if (command.kind === 'ls') {
			print(escape(files().join('\n')));
		} else if (command.kind === 'unknown') {
			fail('Not something this prompt runs.', 'help');
		} else if (command.kind === 'badflag') {
			fail(`Unknown option: ${command.flag}`, 'specimen diff takes --allow-context and --require-visual');
		} else if (command.kind === 'difffiles') {
			fail('diff takes two capture files.', 'specimen diff captures/bar.json captures/bar-unnamed.json');
		} else if (command.kind === 'nofile') {
			fail(`No such capture: ${command.file}`, 'ls captures');
		} else if (command.kind === 'diff' && command.ids.some((id) => !files().includes(`captures/${id}.json`))) {
			const missing = command.ids.find((id) => !files().includes(`captures/${id}.json`));
			fail(`No such capture: captures/${missing}.json`, 'ls captures');
		} else if (command.kind === 'diff') {
			try {
				const ran = await diff(command.ids[0], command.ids[1], command.input);
				print(jsonHtml(ran.result));
				await onRan?.({ kind: 'diff', ...ran, ids: command.ids });
			} catch (error) {
				fail(`Could not read a capture: ${error.message}`, 'ls captures');
			}
		} else {
			const result = await call(command.name, command.input);
			print(jsonHtml(result));
			await onRan?.({ kind: 'call', name: command.name, result });
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
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		if (!history.length) return;
		event.preventDefault();
		if (cursor === history.length) draft = prompt.value;
		cursor = Math.min(history.length, Math.max(0, cursor + (event.key === 'ArrowUp' ? -1 : 1)));
		prompt.value = cursor === history.length ? draft : history[cursor];
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
	};
}
