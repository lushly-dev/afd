// Violet, on the dev side. The prompt on this page runs real commands on a
// real in-memory Violet store (the same starting tree as the design side),
// the two results in Fig. 02 are produced by that store when the page loads,
// and the validators in Fig. 05 are the ones from @lushly-dev/violet-core/css.

import { escape, jsonHtml } from './cli-format.js';
import { initStatements } from './statements.js';
import { initTabs } from './util.js';
import * as violet from './vendor/violet.js';
import { call, commandCount, inputSchema, listCommands, read, snapshot, start } from './violet-runtime.js';
import { initVioletTerminal } from './violet-terminal.js';
import { createTree, el } from './violet-tree.js';
import './widows.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

for (const node of $$('[data-command-count]')) node.textContent = String(commandCount);

// ── Fig. 01: a prompt, and the store it talks to ────────────────────────

const tree = $('[data-vtree]');
const treeView = createTree(tree, {
	onSelect: (nodeId) => terminal.offer(`violet call tokens.resolve -i '{"nodeId":"${nodeId}"}'`),
});

async function refresh() {
	treeView.render(await snapshot());
}

const terminal = initVioletTerminal({
	form: $('[data-terminal-form]'),
	screen: $('[data-terminal-screen]'),
	tries: $('[data-terminal-tries]'),
	call,
	listCommands,
	inputSchema,
	onRan: refresh,
	// A short name on the chip; the whole line goes on the prompt.
	suggestions: [
		['List the commands', 'violet commands'],
		[
			'Change a colour',
			`violet call token.override -i '{"nodeId":"atlas","tokenId":"color.brand","value":"#1144CC"}'`,
		],
		['Trace a value', `violet call token.lineage -i '{"nodeId":"atlas-touch","tokenId":"color.brand"}'`],
		[
			'Preview a change',
			`violet call changes.impact -i '{"nodeId":"base","changes":[{"type":"override","tokenId":"font.size","value":"17px"}]}'`,
		],
		['Check the rules', 'violet call analyze.violations'],
		['Export a theme', `violet call export -i '{"nodeId":"atlas-dark","format":"css"}'`],
		['Read a schema', 'violet call token.override --schema'],
		[
			'Fail on purpose',
			`violet --json call token.override -i '{"nodeId":"atlas-dark","tokenId":"color.accent","value":"#000000"}'`,
		],
	],
});

// ── Fig. 02: one result that worked and one that did not ────────────────

const RESULTS = {
	ok: ['token.lineage', { nodeId: 'atlas', tokenId: 'font.size' }],
	// There is no color.accent, so this writes nothing and says what to do.
	fail: ['token.override', { nodeId: 'atlas-dark', tokenId: 'color.accent', value: '#000000' }],
};

async function renderResults() {
	for (const [key, [name, input]] of Object.entries(RESULTS)) {
		const result = await read(name, input);
		$(`[data-result="${key}"]`).innerHTML = jsonHtml(result);
		$(`[data-result-line="${key}"]`).textContent = `violet --json call ${name}`;
	}
}

// ── Fig. 04: the code samples ───────────────────────────────────────────

/** Enough highlighting for the samples: comments, strings and a few keywords. */
function highlight(code) {
	return escape(code).replace(
		/(^#[^\n]*|(?<=^|\s)\/\/[^\n]*)|('[^'\n]*'|"[^"\n]*")|\b(import|from|const|await|new)\b/gm,
		(match, comment, string, keyword) => {
			if (comment) return `<span class="tok-dim">${comment}</span>`;
			if (string) return `<span class="tok-str">${string}</span>`;
			if (keyword) return `<span class="tok-kw">${keyword}</span>`;
			return match;
		}
	);
}

for (const code of $$('[data-code]')) code.innerHTML = highlight(code.textContent);
initTabs($('.code-tabs [role="tablist"]'));

// ── Fig. 05: the validators ─────────────────────────────────────────────

const safeForm = $('[data-safe-form]');
const safeOut = $('[data-safe-out]');
const SAFE_TRIES = [
	['safeCssColor', '#0B6E4F'],
	['safeCssColor', 'rgb(10 20 30 / 50%)'],
	['safeCssColor', 'red; } body { display: none'],
	['safeCssColor', 'url(https://example.com/x.png)'],
	['safeCssLength', '1.5rem'],
	['safeCssLength', '12px; color: red'],
	['safeFontFamily', 'Inter, "Helvetica Neue", sans-serif'],
	['safeEasing', 'cubic-bezier(.2,0,0,1)'],
];

function renderSafe() {
	const kind = safeForm.elements.kind.value;
	const value = safeForm.elements.value.value;
	const result = violet[kind](value);
	const safe = result !== null;
	const swatch = el('i', { class: 'vswatch', 'aria-hidden': 'true' });
	// Only a value the validator rebuilt is ever drawn.
	if (safe && kind === 'safeCssColor') swatch.style.backgroundColor = result;
	safeOut.dataset.safe = String(safe);
	safeOut.replaceChildren(
		el('code', {}, `${kind}(${JSON.stringify(value)})`),
		el('span', { class: 'vsafe-verdict' }, safe ? 'Safe to draw' : 'Refused'),
		el('code', { class: 'vsafe-result' }, safe && kind === 'safeCssColor' ? swatch : '', JSON.stringify(result))
	);
}

$('[data-safe-tries]').append(
	...SAFE_TRIES.map(([kind, value]) => {
		const button = el('button', { type: 'button' }, value);
		button.addEventListener('click', () => {
			safeForm.elements.kind.value = kind;
			safeForm.elements.value.value = value;
			renderSafe();
		});
		return button;
	})
);
safeForm.addEventListener('input', renderSafe);
safeForm.addEventListener('submit', (event) => event.preventDefault());
renderSafe();

// ── Hero: the answer the three callers get, and the install line ────────

async function renderHero() {
	const result = await read('tokens.resolve', { nodeId: 'atlas-dark' });
	if (result.success) $('[data-hero-answer]').textContent = result.reasoning;
}

for (const button of $$('[data-copy-inline]')) {
	button.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText($('code', button.parentElement).textContent);
			button.textContent = 'Copied';
		} catch {
			button.textContent = 'Select to copy';
		}
		setTimeout(() => {
			button.textContent = 'Copy';
		}, 2000);
	});
}

// ── Fig. 07: copy an install line ───────────────────────────────────────

for (const button of $$('[data-copy]')) {
	button.addEventListener('click', async () => {
		const status = $('[data-copy-status]');
		try {
			await navigator.clipboard.writeText($('code', button.parentElement).textContent);
			status.textContent = 'Copied to clipboard.';
		} catch {
			status.textContent = 'Clipboard unavailable. Select the command to copy it.';
		}
	});
}

// ── Start, and start over ───────────────────────────────────────────────

async function boot() {
	const seeded = await start();
	if (!seeded.success) {
		tree.replaceChildren(el('li', { class: 'vtree-wait' }, `The tree did not load: ${seeded.error.message}`));
		return;
	}
	terminal.clear();
	await refresh();
	// One command, so the screen is not blank: the tree starts with a rule failing.
	await terminal.run('violet call analyze.violations');
}

$('[data-reset-tree]').addEventListener('click', boot);

initStatements();
await boot();
await renderHero();
await renderResults();
