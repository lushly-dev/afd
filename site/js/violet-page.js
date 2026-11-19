// Violet, on the design side. The tree on this page is a real Violet store:
// picking a colour runs token.override, Alfred's theme is node.create plus a
// handful of overrides, and the rules, exports and comparison further down
// read the same tree.

import { createAlfred } from './alfred.js';
import { initStatements } from './statements.js';
import { reducedMotion } from './util.js';
import { call, onCommand, read, snapshot, start } from './violet-runtime.js';
import { LEDGER_DARK } from './violet-seed.js';
import { createTree, el, isHex, label, makeTile, ownCount, paintTile, plural } from './violet-tree.js';
import './widows.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── State ────────────────────────────────────────────────────────────

let snap = { nodes: [], byId: {} };
let selected = 'atlas';
let openToken = null;
let preview = null; // { effects: { nodeId: effect }, apply: [steps] } while Alfred waits for a yes
let exportNode = 'atlas-dark';
let exportFormat = 'css';
let compareA = 'atlas';
let compareB = 'atlas-dark';
let refreshRun = 0;

/** Read the tree again and redraw everything that shows it. */
async function refresh() {
	const run = ++refreshRun;
	const next = await snapshot();
	if (run !== refreshRun) return;
	snap = next;
	if (!snap.byId[selected]) selected = snap.nodes[0]?.id;
	renderTree();
	renderInspector();
	renderRules();
	await Promise.all([renderExport(), renderCompare()]);
}

function select(nodeId, tokenId = null) {
	selected = nodeId;
	openToken = tokenId;
	exportNode = nodeId;
	renderTree();
	renderInspector();
	renderExport();
}

// ── The tree: one tile per node, drawn with that node's resolved tokens ──

const tree = $('[data-vtree]');
const treeView = createTree(tree, { onSelect: (nodeId) => select(nodeId) });

function renderTree() {
	treeView.render(snap, { selected, effects: preview?.effects });
	$('.vkey').toggleAttribute('data-on', Boolean(preview));
	$('.vstage-bar .mono').textContent = `${plural(snap.nodes.length, 'node')}, one source`;
}

// ── The inspector: the selected node's tokens, and where each came from ──

const tokenList = $('[data-token-list]');
let inspectorKey = '';

// The head names the node and, where the tree has scrolled away (the stage
// stacks on small screens), keeps a tile of it in view while you edit.
const headType = el('span', { class: 'mono' });
const headName = el('h3', {});
const headNote = el('p', {});
const headTile = makeTile();
$('[data-inspector-head]').append(el('div', {}, headType, headName), headNote, headTile);

/** Steppers for the sizes: [step, least, most], in px. */
const STEPS = {
	'shape.radius': [2, 0, 24],
	'space.pad': [2, 8, 32],
	'control.height': [4, 28, 64],
	'font.size': [1, 12, 20],
};

function tokenRows(node) {
	const order = snap.nodes[0].tokens.map((token) => token.id);
	const position = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
	const aliased = new Set(node.tokens.map((token) => token.aliasOf).filter(Boolean));
	const rows = node.tokens.map((token) => ({
		id: token.id,
		kind: token.aliasOf ? 'alias' : isHex(token.resolvedValue) ? 'color' : 'size',
		value: token.resolvedValue,
		aliasOf: token.aliasOf,
		here: token.resolvedAt === node.id,
		from: token.resolvedAt,
		problem:
			token.referenceError?.message ??
			node.failures
				.filter((failure) => failure.tokenId === token.id)
				.map((failure) => `${failure.constraintName}: ${failure.message}`)
				.join('. '),
		canRemove: Boolean(node.parentId) && !aliased.has(token.id),
	}));
	for (const id of node.removed) rows.push({ id, kind: 'removed' });
	return rows.sort((a, b) => position(a.id) - position(b.id));
}

function buildRow(row) {
	const value = el('span', { class: 'vtoken-value' });
	if (row.kind === 'color') {
		value.append(
			el('input', { type: 'color', 'aria-label': `${row.id} value` }),
			el('code', {})
		);
	} else if (row.kind === 'size') {
		value.append(
			el('button', { type: 'button', 'data-step': '-1', 'aria-label': `Decrease ${row.id}` }, '−'),
			el('code', {}),
			el('button', { type: 'button', 'data-step': '1', 'aria-label': `Increase ${row.id}` }, '+')
		);
	} else if (row.kind === 'alias') {
		value.append(el('i', { class: 'vswatch', 'aria-hidden': 'true' }), el('code', {}));
	} else {
		value.append(el('code', {}));
	}
	return el(
		'li',
		{ class: 'vtoken', 'data-token': row.id, 'data-kind': row.kind },
		el('button', { type: 'button', class: 'vtoken-name', 'aria-expanded': 'false' }, row.id),
		value,
		el('span', { class: 'vtoken-origin' }),
		el('p', { class: 'vtoken-problem', hidden: true }),
		el('div', { class: 'vtoken-detail', hidden: true })
	);
}

function patchRow(item, row, node) {
	const code = $('code', item);
	item.dataset.state = row.kind === 'removed' ? 'removed' : row.here ? 'here' : 'inherited';
	if (row.kind === 'color') {
		const input = $('input', item);
		if (document.activeElement !== input) input.value = row.value.toLowerCase();
		code.textContent = row.value.toUpperCase();
	} else if (row.kind === 'size') {
		const [, least, most] = STEPS[row.id] ?? [1, 0, 999];
		const number = Number.parseInt(row.value, 10);
		code.textContent = row.value;
		$('[data-step="-1"]', item).disabled = number <= least;
		$('[data-step="1"]', item).disabled = number >= most;
	} else if (row.kind === 'alias') {
		$('.vswatch', item).style.backgroundColor = isHex(row.value) ? row.value : 'transparent';
		code.textContent = `= ${row.aliasOf}`;
	} else {
		code.textContent = 'none';
	}
	$('.vtoken-origin', item).textContent =
		row.kind === 'removed'
			? 'Removed here'
			: row.here
				? node.parentId
					? 'Changed here'
					: 'Set here'
				: `From ${label(row.from)}`;
	const problem = $('.vtoken-problem', item);
	problem.hidden = !row.problem;
	problem.textContent = row.problem ?? '';
	const open = openToken === row.id;
	$('.vtoken-name', item).setAttribute('aria-expanded', String(open));
	const detail = $('.vtoken-detail', item);
	detail.hidden = !open;
	if (open) fillDetail(detail, row, node);
}

const LINEAGE = {
	add: (step) => `${label(step.nodeId)} added it as ${step.value}`,
	override: (step) => `${label(step.nodeId)} changed it to ${step.value}`,
	inherit: (step) => `${label(step.nodeId)} inherits it`,
	reset: (step) => `${label(step.nodeId)} follows ${label(step.fromNode)} again`,
	copy: (step) => `${label(step.nodeId)} copies it from ${label(step.fromNode)}`,
	include: (step) => `${label(step.nodeId)} mixes it in from ${label(step.fromNode)}`,
};

/** The open row: the token's history down the tree, and what can be done with it here. */
async function fillDetail(detail, row, node) {
	const steps = [];
	if (row.kind === 'removed') {
		steps.push(`${label(node.id)} removed it, so nothing below gets it either.`);
		steps.push('To bring it back, start the tree over.');
	} else {
		const lineage = await read('token.lineage', { nodeId: node.id, tokenId: row.id });
		if (openToken !== row.id || selected !== node.id) return;
		for (const step of lineage.data?.chain ?? []) {
			if (!step.superseded) steps.push(LINEAGE[step.operation]?.(step) ?? step.operation);
		}
	}
	const actions = el('div', { class: 'vtoken-actions' });
	if (row.here && node.parentId) {
		actions.append(
			el('button', { type: 'button', 'data-act': 'reset' }, `Follow ${label(node.parentId)} again`)
		);
	}
	if (row.canRemove) {
		actions.append(el('button', { type: 'button', 'data-act': 'subtract' }, 'Remove here'));
	}
	// Redrawing replaces the buttons; keep the keyboard where it was.
	const held = detail.contains(document.activeElement);
	detail.replaceChildren(
		el('ol', { class: 'vlineage', 'aria-label': `Where ${row.id} comes from` }, ...steps.map((text) => el('li', {}, text))),
		actions
	);
	if (held) $('.vtoken-name', detail.parentElement).focus();
}

function renderInspector() {
	const node = snap.byId[selected];
	if (!node) return;
	const own = ownCount(node);
	const total = node.tokens.length;
	headType.textContent = node.type;
	headName.textContent = label(node.id);
	headNote.textContent = node.parentId
		? `Starts from ${node.chain.map(label).join(' → ')}. ${own} of its ${total} values are its own.`
		: 'The root. Every node starts from these values.';
	paintTile(headTile, node);
	const rows = tokenRows(node);
	const key = `${node.id}:${rows.map((row) => `${row.id}/${row.kind}`).join(',')}`;
	if (key !== inspectorKey) {
		inspectorKey = key;
		tokenList.replaceChildren(...rows.map(buildRow));
	}
	for (const row of rows) patchRow($(`[data-token="${CSS.escape(row.id)}"]`, tokenList), row, node);
}

// Colour pickers fire many times a second. Run one command at a time and
// keep only the newest value waiting.
let waiting = null;
let writing = false;
async function write(name, input) {
	waiting = { name, input };
	if (writing) return;
	writing = true;
	while (waiting) {
		const next = waiting;
		waiting = null;
		await call(next.name, next.input);
		await refresh();
	}
	writing = false;
}

tokenList.addEventListener('input', (event) => {
	const item = event.target.closest('[data-token]');
	if (!item || event.target.type !== 'color') return;
	write('token.override', {
		nodeId: selected,
		tokenId: item.dataset.token,
		value: event.target.value.toUpperCase(),
	});
});

tokenList.addEventListener('click', (event) => {
	const item = event.target.closest('[data-token]');
	if (!item) return;
	const tokenId = item.dataset.token;
	if (event.target.closest('.vtoken-name')) {
		openToken = openToken === tokenId ? null : tokenId;
		renderInspector();
		return;
	}
	const stepper = event.target.closest('[data-step]');
	if (stepper) {
		const [step, least, most] = STEPS[tokenId] ?? [1, 0, 999];
		const now = Number.parseInt($('code', item).textContent, 10);
		const next = Math.min(most, Math.max(least, now + step * Number(stepper.dataset.step)));
		if (next !== now) write('token.override', { nodeId: selected, tokenId, value: `${next}px` });
		return;
	}
	const action = event.target.closest('[data-act]');
	if (action) {
		openToken = action.dataset.act === 'subtract' ? null : tokenId;
		write(`token.${action.dataset.act}`, { nodeId: selected, tokenId });
	}
});

// ── The trail: what just ran, and who asked ─────────────────────────────

const trail = $('[data-violet-trail]');
let trailKey = '';

function resetTrail() {
	trailKey = '';
	trail.replaceChildren(el('li', {}, 'Nothing yet'));
}

function trailCommand({ name, input, result, actor }) {
	const about = input.tokenId ?? input.name ?? '';
	const where = input.nodeId && input.tokenId ? ` on ${input.nodeId}` : '';
	const key = `${actor}|${name}|${about}|${where}`;
	if (key === trailKey) return;
	if (!trailKey) trail.replaceChildren();
	trailKey = key;
	const item = el('li', { 'data-actor': actor }, el('span', {}, actor === 'alfred' ? 'Alfred' : 'You'));
	if (!result.success) item.dataset.failed = 'true';
	item.append(`${name} ${about}${where}`.trim());
	trail.prepend(item);
	while (trail.children.length > 4) trail.lastElementChild.remove();
}

// ── Alfred: an agent on the same tree, through the same commands ────────

const alfreds = Object.fromEntries(
	$$('[data-alfred]').map((svg) => [svg.dataset.alfred, createAlfred(svg)])
);
const alfred = alfreds.violet;
const agentLog = $('[data-agent-log]');
const agentEmpty = agentLog.firstElementChild;
const intentButtons = $$('[data-intent]');
const confirmBox = $('[data-agent-confirm]');
let working = false;

function agentLine(kind, who, text) {
	const item = el('li', { class: `agent-log__${kind}` }, el('b', {}, who), el('span', {}, text));
	agentLog.append(item);
	agentLog.scrollTop = agentLog.scrollHeight;
	return item;
}

/** One command from Alfred, shown as he makes it. The tree redraws after each. */
async function tool(name, input = {}) {
	// A brief presentation beat, not simulated model or network activity.
	if (!reducedMotion.matches) await pause(240);
	const result = await call(name, input, { actor: 'alfred' });
	const item = el(
		'li',
		{ class: 'agent-log__call', 'data-state': result.success ? 'done' : 'error' },
		el('code', {}, Object.keys(input).length ? `${name} ${JSON.stringify(input)}` : name),
		el('span', {}, result.success ? result.reasoning : result.error.suggestion)
	);
	agentLog.append(item);
	agentLog.scrollTop = agentLog.scrollHeight;
	await refresh();
	return result;
}

const stopped = (result) => ({
	mood: 'fail',
	text: `That did not go through: ${result.error.message}. ${result.error.suggestion ?? ''}`.trim(),
});

function clearPreview() {
	if (!preview) return;
	preview = null;
	confirmBox.hidden = true;
	renderTree();
}

/** Values worth trying for a failed rule, most conservative first. */
function candidates(violation) {
	const number = Number.parseInt(violation.value, 10);
	if (violation.constraintId === 'spacing-grid') {
		return [...new Set([Math.round(number / 4) * 4, Math.ceil(number / 4) * 4])].map((n) => `${n}px`);
	}
	if (violation.constraintId === 'touch-target') return ['44px', '48px'];
	return ['#1A1612', '#FFFFFF'];
}

const intents = {
	dark: {
		ask: 'Add a dark theme for Ledger.',
		async run() {
			if (snap.byId['ledger-dark']) {
				select('ledger-dark');
				return { mood: 'surprise', text: 'Ledger already has a dark theme. I have selected it in the tree.' };
			}
			const created = await tool('node.create', { name: 'ledger-dark', type: 'theme', parentId: 'ledger' });
			if (!created.success) return stopped(created);
			for (const [tokenId, value] of LEDGER_DARK) {
				const changed = await tool('token.override', { nodeId: 'ledger-dark', tokenId, value });
				if (!changed.success) return stopped(changed);
			}
			const checked = await tool('constraints.validate', { nodeId: 'ledger-dark' });
			select('ledger-dark');
			const errors = checked.data?.summary.errors ?? 0;
			const made = `Added Ledger dark. It holds ${LEDGER_DARK.length} values of its own and takes the rest from Ledger.`;
			return errors
				? { mood: 'warn', text: `${made} ${plural(errors, 'rule fails', 'rules fail')} on it.` }
				: { mood: 'pass', text: `${made} Every rule passes on it.` };
		},
	},
	fix: {
		ask: 'Fix what breaks the rules.',
		async run() {
			const fixes = [];
			const stuck = new Set();
			for (let round = 0; round < 6; round++) {
				const found = await tool('analyze.violations');
				if (!found.success) return stopped(found);
				// Nearest the root first: a fix there often clears the nodes below.
				const violation = found.data.violations
					.filter((item) => !stuck.has(`${item.nodeId}/${item.tokenId}`))
					.sort((a, b) => snap.byId[a.nodeId].depth - snap.byId[b.nodeId].depth)[0];
				if (!violation) break;
				const { nodeId, tokenId } = violation;
				let fixed = false;
				for (const value of candidates(violation)) {
					const tried = await tool('changes.impact', {
						nodeId,
						changes: [{ type: 'override', tokenId, value }],
					});
					const summary = tried.data?.summary;
					if (!summary || summary.violationsIntroduced > 0 || summary.violationsResolved === 0) continue;
					const applied = await tool('token.override', { nodeId, tokenId, value });
					if (!applied.success) return stopped(applied);
					fixes.push(`${label(nodeId)} ${tokenId} is now ${value}`);
					fixed = true;
					break;
				}
				if (!fixed) stuck.add(`${nodeId}/${tokenId}`);
			}
			const left = (await read('analyze.violations')).data?.summary.total ?? 0;
			if (!fixes.length && !left) {
				return { mood: 'pass', text: `Nothing to fix. Every rule passes on all ${snap.nodes.length} nodes.` };
			}
			const did = fixes.length
				? `${fixes.join('. ')}. I previewed each change before writing it.`
				: 'I could not find a value that passes without breaking another rule.';
			return left
				? { mood: 'warn', text: `${did} ${plural(left, 'check still fails', 'checks still fail')}.` }
				: { mood: 'pass', text: `${did} Every rule passes now.` };
		},
	},
	larger: {
		ask: 'Preview larger text everywhere.',
		async run() {
			const now = snap.byId.base.tokens.find((token) => token.id === 'font.size')?.resolvedValue;
			const value = now === '17px' ? '15px' : '17px';
			const looked = await tool('changes.impact', {
				nodeId: 'base',
				changes: [{ type: 'override', tokenId: 'font.size', value }],
			});
			if (!looked.success) return stopped(looked);
			const { nodes, apply, summary } = looked.data;
			preview = { effects: Object.fromEntries(nodes.map((node) => [node.id, node.effect])), apply };
			confirmBox.hidden = false;
			renderTree();
			const changing = nodes.filter((node) => node.effect === 'changes').length;
			const keeping = nodes.filter((node) => node.effect === 'shielded').map((node) => label(node.id));
			const kept = keeping.length
				? ` ${keeping.join(' and ')} ${keeping.length === 1 ? 'keeps its' : 'keep their'} own size.`
				: '';
			const rules = summary.violationsIntroduced
				? `${plural(summary.violationsIntroduced, 'rule')} would break.`
				: 'No rule would break.';
			const first = now === '17px' ? 'Text is already 17px at Base, so this looks at 15px. ' : '';
			return {
				mood: summary.violationsIntroduced ? 'warn' : null,
				text: `${first}${value} text at Base would change ${changing} of ${nodes.length} nodes.${kept} ${rules} Nothing is written yet. Apply it?`,
			};
		},
	},
};

async function ask(key, run = intents[key].run) {
	if (working) return;
	working = true;
	for (const button of intentButtons) button.disabled = true;
	clearPreview();
	// A new request starts a new log; answering his question carries on in it.
	if (intents[key]) agentLog.replaceChildren();
	agentLine('you', 'You', intents[key]?.ask ?? key);
	// Alfred looks up, works while the real commands run, then shows how it went.
	await Promise.race([alfred.wake(), pause(1600)]);
	const stopWorking = alfred.work();
	let outcome = { mood: 'fail', text: 'Something went wrong on the way. Start the tree over and try again.' };
	try {
		outcome = await run();
	} finally {
		agentLine('alfred', 'Alfred', outcome.text);
		stopWorking().then(() => outcome.mood && alfred.express(outcome.mood));
		working = false;
		for (const button of intentButtons) button.disabled = false;
	}
}

for (const button of intentButtons) {
	button.addEventListener('click', () => ask(button.dataset.intent));
}

confirmBox.addEventListener('click', (event) => {
	const choice = event.target.closest('[data-confirm]')?.dataset.confirm;
	if (!choice || !preview) return;
	const steps = preview.apply;
	clearPreview();
	if (choice === 'leave') {
		agentLine('you', 'You', 'Leave it.');
		agentLine('alfred', 'Alfred', 'Left as it was. Nothing was written.');
		return;
	}
	ask('Apply it.', async () => {
		for (const step of steps) {
			const applied = await tool(step.command, step.input);
			if (!applied.success) return stopped(applied);
		}
		return { mood: 'pass', text: 'Applied. Every node that inherits the size now has it.' };
	});
});

// Reaching for his buttons is engaging with him too.
const agentArea = $('.vagent');
agentArea.addEventListener('focusin', () => {
	alfred.engaged = true;
	alfred.wake();
});
agentArea.addEventListener('focusout', () => {
	alfred.engaged = false;
});

// ── Fig. 04: the rules, checked against every node ──────────────────────

const ruleMatrix = $('[data-rule-matrix]');
const ruleSummary = $('[data-rule-summary]');
const ruleFailures = $('[data-rule-failures]');

const globMatches = (glob, id) =>
	new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`).test(id);

function renderRules() {
	const rules = [];
	for (const node of snap.nodes) {
		for (const rule of node.rules) if (!rules.some((known) => known.id === rule.id)) rules.push(rule);
	}
	const state = (node, rule) => {
		if (!node.rules.some((known) => known.id === rule.id)) return 'none';
		if (node.failures.some((failure) => failure.constraintId === rule.id)) return 'fail';
		return node.tokens.some((token) => globMatches(rule.applyTo, token.id)) ? 'pass' : 'none';
	};
	const WORDS = { pass: 'Pass', fail: 'Fail', none: '–' };
	ruleMatrix.replaceChildren(
		el('caption', {}, 'Live from the tree above'),
		el(
			'thead',
			{},
			el('tr', {}, el('th', { scope: 'col' }, 'Rule'), ...snap.nodes.map((node) => el('th', { scope: 'col' }, label(node.id))))
		),
		el(
			'tbody',
			{},
			...rules.map((rule) =>
				el(
					'tr',
					{},
					el('th', { scope: 'row' }, el('b', {}, rule.name), el('span', {}, rule.description ?? '')),
					...snap.nodes.map((node) => {
						const result = state(node, rule);
						return el(
							'td',
							{ 'data-state': result },
							result === 'none'
								? el('span', { 'aria-label': 'Does not apply' }, WORDS.none)
								: result === 'pass'
									? el('span', {}, WORDS.pass)
									: WORDS.fail
						);
					})
				)
			)
		)
	);
	const failing = snap.nodes.flatMap((node) => node.failures.map((failure) => ({ node, failure })));
	ruleSummary.textContent = failing.length
		? `${plural(failing.length, 'check fails', 'checks fail')}.`
		: 'Every rule passes.';
	ruleFailures.replaceChildren(
		...(failing.length
			? failing.map(({ node, failure }) =>
					el(
						'li',
						{},
						el('b', {}, `${label(node.id)} / ${failure.tokenId}`),
						el('span', {}, `${failure.constraintName}: ${failure.message}.`),
						el(
							'button',
							{ type: 'button', 'data-show-node': node.id, 'data-show-token': failure.tokenId },
							'Show in the tree'
						)
					)
				)
			: [
					el(
						'li',
						{},
						el(
							'span',
							{},
							`All ${snap.nodes.length} nodes pass every rule that applies to them. Change a colour or a size in the tree to see one fail.`
						)
					),
				])
	);
}

ruleFailures.addEventListener('click', (event) => {
	const button = event.target.closest('[data-show-node]');
	if (!button) return;
	select(button.dataset.showNode, button.dataset.showToken);
	$('.vstage').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
	$(`[data-node="${button.dataset.showNode}"]`, tree)?.focus({ preventScroll: true });
});

// ── Fig. 05: the same node, written nine ways ───────────────────────────

const FORMATS = [
	['css', 'CSS'],
	['scss', 'SCSS'],
	['typescript', 'TypeScript'],
	['json', 'JSON'],
	['tailwind', 'Tailwind'],
	['swift', 'Swift'],
	['kotlin', 'Kotlin'],
	['dart', 'Dart'],
	['lua', 'Lua'],
];
const exportNodes = $('[data-export-nodes]');
const exportFormats = $('[data-export-formats]');
const exportCode = $('[data-export-code]');
const exportNote = $('[data-export-note]');
let exportNodesKey = '';

exportFormats.append(
	...FORMATS.map(([id, name]) => el('button', { type: 'button', 'data-format': id }, name))
);

async function renderExport() {
	if (!snap.byId[exportNode]) exportNode = selected;
	const key = snap.nodes.map((node) => node.id).join('|');
	if (key !== exportNodesKey) {
		exportNodesKey = key;
		exportNodes.replaceChildren(
			...snap.nodes.map((node) => el('button', { type: 'button', 'data-export-node': node.id }, label(node.id)))
		);
	}
	for (const button of exportNodes.children) {
		button.setAttribute('aria-pressed', String(button.dataset.exportNode === exportNode));
	}
	for (const button of exportFormats.children) {
		button.setAttribute('aria-pressed', String(button.dataset.format === exportFormat));
	}
	const node = snap.byId[exportNode];
	const input = { nodeId: exportNode, format: exportFormat };
	// A theme below the root is scoped to an attribute, so two can share a page.
	if (exportFormat === 'css' && node.parentId) input.selector = `[data-theme="${exportNode}"]`;
	const result = await read('export', input);
	if (input.nodeId !== exportNode || input.format !== exportFormat) return;
	exportCode.textContent = result.success ? result.data.content : result.error.message;
	exportNote.textContent = result.success
		? `${plural(result.data.tokenCount, 'token')}, resolved through ${[...node.chain, node.id].map(label).join(' → ')}.`
		: (result.error.suggestion ?? '');
}

exportNodes.addEventListener('click', (event) => {
	const button = event.target.closest('[data-export-node]');
	if (!button) return;
	exportNode = button.dataset.exportNode;
	renderExport();
});

exportFormats.addEventListener('click', (event) => {
	const button = event.target.closest('[data-format]');
	if (!button) return;
	exportFormat = button.dataset.format;
	renderExport();
});

// ── Fig. 06: two nodes, and only what differs ───────────────────────────

const selectA = $('[data-compare-a]');
const selectB = $('[data-compare-b]');
const compareTable = $('[data-compare-table]');
const compareNote = $('[data-compare-note]');
let compareKey = '';

function compareCell(cell) {
	if (!cell || cell.state === 'subtracted') return el('td', { 'data-state': 'removed' }, 'Removed here');
	const value = String(cell.resolvedValue ?? cell.value ?? '');
	const from =
		cell.state === 'inherited' ? `from ${label(cell.source)}` : cell.state === 'add' ? 'set here' : 'changed here';
	const swatch = isHex(value) ? el('i', { class: 'vswatch', 'aria-hidden': 'true' }) : '';
	if (swatch) swatch.style.backgroundColor = value;
	return el('td', {}, swatch, el('code', {}, value), el('span', {}, from));
}

async function renderCompare() {
	const key = snap.nodes.map((node) => node.id).join('|');
	if (key !== compareKey) {
		compareKey = key;
		for (const [select, chosen] of [
			[selectA, compareA],
			[selectB, compareB],
		]) {
			select.replaceChildren(...snap.nodes.map((node) => el('option', { value: node.id }, label(node.id))));
			select.value = snap.byId[chosen] ? chosen : snap.nodes[0].id;
		}
		compareA = selectA.value;
		compareB = selectB.value;
	}
	if (compareA === compareB) {
		compareTable.replaceChildren();
		compareNote.textContent = 'Pick two different nodes.';
		return;
	}
	const [a, b] = [compareA, compareB];
	const result = await read('tokens.compare', { nodeIds: [a, b] });
	if (a !== compareA || b !== compareB) return;
	if (!result.success) {
		compareTable.replaceChildren();
		compareNote.textContent = result.error.message;
		return;
	}
	const { tokens, summary } = result.data;
	const alike = summary.pairs[0]?.similarity ?? 100;
	compareNote.textContent = tokens.length
		? `${summary.different} of ${plural(summary.compared, 'token')} differ. ${alike}% the same.`
		: `No differences. All ${plural(summary.compared, 'token')} match.`;
	compareTable.replaceChildren(
		el(
			'thead',
			{},
			el('tr', {}, el('th', { scope: 'col' }, 'Token'), el('th', { scope: 'col' }, label(a)), el('th', { scope: 'col' }, label(b)))
		),
		el(
			'tbody',
			{},
			...tokens.map((token) =>
				el('tr', {}, el('th', { scope: 'row' }, token.id), compareCell(token.cells[a]), compareCell(token.cells[b]))
			)
		)
	);
}

selectA.addEventListener('change', () => {
	compareA = selectA.value;
	renderCompare();
});
selectB.addEventListener('change', () => {
	compareB = selectB.value;
	renderCompare();
});

// ── Start, and start over ───────────────────────────────────────────────

$('[data-copy-install]').addEventListener('click', async () => {
	const status = $('[data-copy-status]');
	try {
		await navigator.clipboard.writeText($('[data-install]').textContent);
		status.textContent = 'Copied to clipboard.';
	} catch {
		status.textContent = 'Clipboard unavailable. Select the command to copy it.';
	}
});

async function boot() {
	const seeded = await start();
	if (!seeded.success) {
		tree.replaceChildren(el('li', { class: 'vtree-wait' }, `The tree did not load: ${seeded.error.message}`));
		return;
	}
	selected = 'atlas';
	openToken = null;
	exportNode = 'atlas-dark';
	preview = null;
	confirmBox.hidden = true;
	agentLog.replaceChildren(agentEmpty);
	resetTrail();
	await refresh();
}

$('[data-reset-tree]').addEventListener('click', () => {
	if (!working) boot();
});

onCommand((entry) => {
	trailCommand(entry);
	// A change of your own makes Alfred's preview out of date.
	if (entry.actor === 'you') clearPreview();
});

/**
 * The outline in the hero is the starting tree, read from the store once:
 * each node's colours and corner, how much it holds itself, and the sum.
 */
function renderHero(snap) {
	let written = 0;
	let used = 0;
	for (const node of snap.nodes) {
		const own = node.parentId ? ownCount(node) : node.tokens.length;
		written += own;
		used += node.tokens.length;
		const row = $(`[data-hero-node="${node.id}"]`);
		if (!row) continue;
		paintTile($('.hero-chip', row), node);
		$('[data-hero-count]', row).textContent = plural(own, node.parentId ? 'change' : 'token');
	}
	$('[data-hero-stored]').textContent = String(written);
	$('[data-hero-used]').textContent = String(used);
}

initStatements();
await boot();
renderHero(await snapshot());
