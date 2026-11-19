// Botcore's page. Botcore is a Python package and cannot run in a tab, so this
// page shows one real run of it, recorded in site/botcore/runs.json by
// scripts/build-site-botcore.mjs: an agent's session over MCP in a small Python
// project, the skills drifting and being put right, a plugin, and the same
// commands registered one tool each for comparison. Every number on the page is
// read from that run. One thing is worked out here: the page adds up, in bytes,
// what each kind of server makes an agent read.

import { escape, jsonHtml, jsonTextHtml } from './cli-format.js';
import { initStatements } from './statements.js';
import { initTabs } from './util.js';
import './widows.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function el(tag, attributes = {}, ...children) {
	const node = document.createElement(tag);
	for (const [name, value] of Object.entries(attributes)) if (value !== undefined) node.setAttribute(name, value);
	node.append(...children);
	return node;
}

const response = await fetch(new URL('../botcore/runs.json', import.meta.url));
if (!response.ok) throw new Error(`runs.json: ${response.status}`);
const recorded = await response.json();

const encoder = new TextEncoder();
/** UTF-8 bytes: what a model is sent, before it is cut into tokens. */
const bytes = (text) => encoder.encode(text).length;
/** A tool as a harness passes it on: its name, description and input schema. */
const toolBytes = (tool) => bytes(JSON.stringify(tool));
const sum = (numbers) => numbers.reduce((total, number) => total + number, 0);
const fmt = (number) => number.toLocaleString('en-US');
const count = (number, word) => `${number} ${word}${number === 1 ? '' : 's'}`;
/** Windows wrote some of this; the page shows the same lines without the carriage returns. */
const lines = (text) => text.replaceAll('\r\n', '\n');
const day = (iso) =>
	new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const session = recorded.session;
const answer = (id, from = session) => from.calls.find((item) => item.id === id);
const start = JSON.parse(answer('start').text);
const version = recorded.botcore.version;
const listBytes = sum(session.tools.map(toolBytes));

for (const node of $$('[data-tool-count]')) node.textContent = String(session.tools.length);
for (const node of $$('[data-command-count]')) node.textContent = String(start.available_functions.length);
for (const node of $$('[data-skill-count]')) node.textContent = String(recorded.skills.seeded.length);
for (const node of $$('[data-version]')) node.textContent = version;

// ── Hero: the whole tool list ───────────────────────────────────────────

$('[data-hero-tools]').replaceChildren(
	...session.tools.map((tool) => el('div', {}, el('dt', {}, el('code', {}, tool.name)), el('dd', {}, tool.description)))
);
$('[data-hero-answer]').textContent =
	`${count(start.available_functions.length, 'command')} and ${count(start.topics.length, 'page')} of reference, each asked for by name. The whole list above is ${fmt(listBytes)} bytes.`;

// ── Fig. 01: the recorded session ───────────────────────────────────────

const LABELS = {
	list: 'What the agent is shown',
	start: 'Ask what there is',
	topics: 'The reference, by topic',
	'docs-dev': 'Read one page',
	lint: 'Lint the project',
	fix: 'Let it fix that',
	test: 'Run the tests',
	'no-topic': 'Ask for a page that isn’t there',
};

/** What to notice at each step. The words are ours; every figure in them is read from the answer. */
const READINGS = {
	start: (text) => {
		const data = JSON.parse(text);
		return `${count(data.available_functions.length, 'function')} and ${count(data.topics.length, 'topic')}, by name. No arguments yet: those are in the reference.`;
	},
	topics: () => `${count(start.topics.length, 'topic')}, one line each. The agent asks for a page when it needs one.`,
	'docs-dev': (text) =>
		`${count(text.split('\n').filter((line) => line.startsWith('## ')).length, 'command')} with their arguments, in ${fmt(bytes(text))} bytes. The agent now knows that dev_lint takes fix.`,
	lint: (text) => {
		const result = JSON.parse(text);
		return `${result.error.code}. The project is Python, so Botcore ran ruff. The result carries the way out: “${result.error.suggestion}”.`;
	},
	fix: (text) => {
		const output = JSON.parse(text).data.output.trim();
		const gone = !recorded.project.fixed.text.includes('import os');
		return `${output} ${gone ? `The unused import is gone from ${recorded.project.fixed.path}.` : 'The file on disk did not change.'}`;
	},
	test: (text) => {
		const result = JSON.parse(text);
		const passed = result.data.output.match(/(\d+) passed/)?.[1];
		return `${result.reasoning.replace(/^\[\w+\]\s*/, '')}: ${passed} passed. Botcore ran pytest for the same reason it ran ruff.`;
	},
	'no-topic': () => 'A miss the agent does not have to guess at: the answer names every page there is.',
};

/** The tool's own output inside a result, where there is one worth reading as text. */
const INNER = {
	lint: (text) => ['error.message, as text', JSON.parse(text).error.message],
	fix: (text) => ['data.output, as text', JSON.parse(text).data.output],
	test: (text) => ['data.output, as text', JSON.parse(text).data.output],
};

const isJson = (text) => text.trimStart().startsWith('{');

const STEPS = [
	{
		id: 'list',
		line: 'tools/list',
		sent: '',
		got: jsonHtml(session.tools),
		reading: `${count(session.tools.length, 'tool')} and ${fmt(listBytes)} bytes: everything an agent is told before it asks. The run tool takes Python, so one tool reaches every command.`,
	},
	...session.calls.map((item) => ({
		id: item.id,
		line: `tools/call ${item.tool}`,
		// The run tool is sent Python; the other two are sent a topic, or nothing.
		sent: item.arguments.code ?? (Object.keys(item.arguments).length ? JSON.stringify(item.arguments) : ''),
		got: isJson(item.text) ? jsonTextHtml(item.text.trimEnd()) : escape(lines(item.text).trimEnd()),
		inner: INNER[item.id]?.(item.text),
		failed: isJson(item.text) && JSON.parse(item.text).success === false,
		reading: READINGS[item.id]?.(item.text) ?? '',
	})),
];

function show(step) {
	for (const button of $$('[data-step-list] button')) button.setAttribute('aria-pressed', String(button.dataset.step === step.id));
	$('[data-step-line]').textContent = step.line;
	const side = $('[data-step-side]');
	side.textContent = step.failed ? 'success: false' : session.line;
	side.toggleAttribute('data-failed', Boolean(step.failed));
	const sent = $('[data-step-sent]');
	sent.textContent = step.sent;
	sent.parentElement.hidden = !step.sent;
	const got = $('[data-step-got]');
	got.innerHTML = step.got;
	got.parentElement.scrollTop = 0;
	const inner = $('[data-step-inner]');
	inner.hidden = !step.inner;
	if (step.inner) {
		$('[data-step-inner-label]').textContent = step.inner[0];
		$('[data-step-inner-text]').textContent = lines(step.inner[1]).trimEnd();
	}
	$('[data-step-reading]').textContent = step.reading;
}

$('[data-step-list]').append(
	...STEPS.map((step) => {
		const button = el('button', { type: 'button', 'data-step': step.id, 'aria-pressed': 'false' }, LABELS[step.id] ?? step.id);
		button.addEventListener('click', () => show(step));
		return button;
	})
);
show(STEPS.find((step) => step.id === 'lint'));

const PLATFORMS = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
$('[data-session-foot]').replaceChildren(
	`Recorded on ${day(recorded.recorded)} from botcore ${version} on ${PLATFORMS[recorded.botcore.platform] ?? recorded.botcore.platform}, at revision ${recorded.source.revision.slice(0, 7)}${recorded.source.dirty ? ' with uncommitted changes' : ''}. The project's own path is written <workspace>; nothing else is changed. `,
	el('a', { href: new URL('../botcore/runs.json', import.meta.url).href }, 'The whole recorded run')
);

// ── Fig. 02: what each kind of server makes an agent read ───────────────

const flat = recorded.flat.tools.map((tool) => ({ domain: tool.name.split('_')[0], size: toolBytes(tool) }));
const flatTotal = sum(flat.map((tool) => tool.size));
const domains = [...new Set(flat.map((tool) => tool.domain))]
	.map((domain) => {
		const tools = flat.filter((tool) => tool.domain === domain);
		return { domain, tools: tools.length, size: sum(tools.map((tool) => tool.size)) };
	})
	.sort((a, b) => b.size - a.size);

/** What an agent may read from Botcore after the tool list: the start answer, and each page. */
const READS = [
	{ id: 'start', label: 'start', size: bytes(answer('start').text) },
	...recorded.reference.map((page) => ({ id: page.topic, label: page.topic, size: bytes(page.text) })),
];
// The recorded session read the start answer and one page. The reader can change that.
const read = new Set(['start', 'dev']);
const everything = listBytes + sum(READS.map((item) => item.size));
const scale = Math.max(flatTotal, everything);
const width = (size) => `${((size / scale) * 100).toFixed(3)}%`;

const segment = (label, size, kind) =>
	el(
		'span',
		{ class: 'bc-seg', 'data-kind': kind, 'data-size': String(size), style: `width: ${width(size)}`, title: `${label}: ${fmt(size)} bytes` },
		el('b', {}, label)
	);

/** A label shows only in a segment wide enough to hold it. The key under the bar names every part. */
function fitLabels() {
	for (const bar of $$('.bc-bar')) {
		for (const part of $$('.bc-seg', bar)) {
			const label = part.firstElementChild;
			const room = (Number(part.dataset.size) / scale) * bar.clientWidth - 18;
			// Measured while shown: a hidden label has no width.
			label.hidden = false;
			label.hidden = label.getBoundingClientRect().width > room;
		}
	}
}

const key = (parts) => parts.map(([label, size]) => `${label} ${fmt(size)}`).join(' + ');

$('[data-flat-bar]').replaceChildren(...domains.map((item) => segment(item.domain, item.size, 'flat')));
$('[data-flat-bar]').setAttribute(
	'aria-label',
	`One tool for each command: ${fmt(flatTotal)} bytes. ${domains.map((item) => `${item.domain}, ${count(item.tools, 'tool')}, ${fmt(item.size)} bytes`).join('; ')}.`
);
$('[data-flat-total]').textContent = `${fmt(flatTotal)} bytes`;
$('[data-flat-key]').textContent = key(domains.map((item) => [item.domain, item.size]));
$('[data-flat-note]').textContent =
	`${count(flat.length, 'tool')}, all listed before the agent has done anything.`;

function renderCost() {
	const chosen = READS.filter((item) => read.has(item.id));
	const total = listBytes + sum(chosen.map((item) => item.size));
	$('[data-meta-bar]').replaceChildren(
		segment('tools', listBytes, 'list'),
		...chosen.map((item) => segment(item.label, item.size, 'read'))
	);
	$('[data-meta-bar]').setAttribute(
		'aria-label',
		`Botcore: ${fmt(total)} bytes. The tool list, ${fmt(listBytes)} bytes${chosen.map((item) => `; ${item.label}, ${fmt(item.size)} bytes`).join('')}.`
	);
	$('[data-meta-total]').textContent = `${fmt(total)} bytes`;
	$('[data-meta-key]').textContent = key([['the tool list', listBytes], ...chosen.map((item) => [item.label, item.size])]);
	fitLabels();
	for (const button of $$('[data-read-chips] button')) button.setAttribute('aria-pressed', String(read.has(button.dataset.read)));

	const all = chosen.length === READS.length;
	const opening = all
		? `With the start answer and every page read, this agent has taken in ${fmt(total)} bytes.`
		: chosen.length
			? `This agent has read ${fmt(total)} bytes: the tool list${read.has('start') ? ', the start answer' : ''}${chosen.filter((item) => item.id !== 'start').length ? ` and ${count(chosen.filter((item) => item.id !== 'start').length, 'page')}` : ''}.`
			: `This agent has read ${fmt(total)} bytes: the tool list, and nothing else yet.`;
	const comparison =
		total < flatTotal
			? `The other server hands over ${fmt(flatTotal)} bytes before any work begins, ${(flatTotal / total).toFixed(1)} times as much.`
			: `The other server hands over ${fmt(flatTotal)} bytes before any work begins, which is less.`;
	$('[data-cost-verdict]').textContent = `${opening} ${comparison}`;
}

$('[data-read-chips]').append(
	...READS.map((item) => {
		const button = el('button', { type: 'button', 'data-read': item.id, 'aria-pressed': 'false' }, item.label);
		button.addEventListener('click', () => {
			if (read.has(item.id)) read.delete(item.id);
			else read.add(item.id);
			renderCost();
		});
		return button;
	})
);
renderCost();
addEventListener('resize', fitLabels);

const skipped = recorded.flat.skipped;
$('[data-cost-method]').textContent =
	`A tool is counted as its name, description and input schema in compact JSON, and an answer as its text, both in UTF-8 bytes. The first list is Botcore's own commands, registered one tool each with the same MCP library.${
		skipped.length
			? ` It has ${count(flat.length, 'tool')}, not ${start.available_functions.length}: ${skipped.join(', ')} is named in the start answer, but ${version} cannot call it by that name, so it could not be registered.`
			: ''
	}`;

// ── Fig. 03: the same line in three projects ────────────────────────────

/** `key = "value"` lines of the file Botcore wrote. */
const settings = (config) => Object.fromEntries([...config.matchAll(/^(\w+) = "([^"]*)"/gm)].map(([, key, value]) => [key, value]));

$('[data-languages]').replaceChildren(
	...recorded.languages.map((project) => {
		const tools = settings(project.config);
		return el(
			'tr',
			{},
			el('th', { scope: 'row' }, el('code', {}, project.marker)),
			// The labels are for a phone, where the table's head is hidden and each row stacks.
			el('td', { 'data-label': 'Project' }, project.init.language),
			el('td', { 'data-label': 'Lint' }, el('code', {}, tools.linter)),
			el('td', { 'data-label': 'Test' }, el('code', {}, tools.test_runner)),
			el('td', { 'data-label': 'Format' }, el('code', {}, tools.formatter))
		);
	})
);
$('[data-config]').textContent = lines(recorded.languages[0].config).trimEnd();

// ── Fig. 04: the project's own command, as a plugin ─────────────────────

const plugin = recorded.plugin;
const [entryPath, codePath] = Object.keys(plugin.files);
$('[data-plugin-path="code"]').textContent = `${plugin.dir}/${codePath}`;
$('[data-plugin-path="entry"]').textContent = `${plugin.dir}/${entryPath}`;
$('[data-plugin-code]').textContent = plugin.files[codePath].trimEnd();
$('[data-plugin-entry]').textContent = plugin.files[entryPath].trimEnd();
initTabs($('.code-tabs [role="tablist"]'));

for (const [slot, id] of [
	['ok', 'balance'],
	['fail', 'no-account'],
]) {
	const item = answer(id, plugin.session);
	$(`[data-plugin-line="${slot}"]`).textContent = item.arguments.code.split('\n')[0].replace('result = ', '');
	$(`[data-plugin-result="${slot}"]`).innerHTML = jsonTextHtml(item.text.trimEnd());
}

const withPlugin = JSON.parse(answer('start', plugin.session).text);
const pluginList = sum(plugin.session.tools.map(toolBytes));
// Which words did the tool list gain? Compare the two lists' descriptions.
const before = new Set(session.tools.flatMap((tool) => tool.description.split(/[\s,()]+/)));
const gained = plugin.session.tools.flatMap((tool) => tool.description.split(/[\s,()]+/)).filter((word) => !before.has(word));
$('[data-plugin-verdict]').textContent =
	`With the plugin installed, the start answer names ${withPlugin.available_functions.length} functions where it named ${start.available_functions.length}. The tool list is still ${count(plugin.session.tools.length, 'tool')}, and ${
		pluginList === listBytes
			? 'did not grow by a byte.'
			: `went from ${fmt(listBytes)} to ${fmt(pluginList)} bytes: ${gained.length === 1 ? `the word “${gained[0]}”` : `the words ${gained.join(', ')}`}, where the docs tool names its topics.`
	}`;

// ── Fig. 05: skills, before and after they drift ────────────────────────

const skillRun = (id) => JSON.parse(recorded.skills.runs.find((run) => run.id === id).stdout).data;
const stages = ['status-seeded', 'status-drifted', 'status-updated'].map((id) => skillRun(id));
const names = stages.at(-1).skills.map((skill) => skill.name);
const STAGE_LABELS = ['After init', 'Months later', 'After update'];
// The tool's word for each state, and how firmly the mark is drawn.
const MARKS = { ok: 'solid', stale: 'alert', unmanaged: 'outline' };

$('[data-skill-rows]').replaceChildren(
	...names.map((name) => {
		const cells = stages.map((stage) => stage.skills.find((skill) => skill.name === name));
		const changed = new Set(cells.map((cell) => cell?.status ?? 'absent')).size > 1;
		return el(
			'tr',
			{ 'data-changed': changed ? 'true' : undefined },
			el('th', { scope: 'row' }, el('code', {}, name)),
			...cells.map((cell, index) =>
				cell
					? el(
							'td',
							{ 'data-label': STAGE_LABELS[index] },
							el('span', { class: 'mark', 'data-mark': MARKS[cell.status] ?? 'dashed' }, cell.status),
							el('span', { class: 'bc-version' }, cell.source ? cell.local_version : 'the repo’s own')
						)
					: el('td', { class: 'bc-absent', 'data-label': STAGE_LABELS[index] }, 'not written yet')
			)
		);
	})
);

const { stale, local, skip } = recorded.skills;
const drift = stages[1].summary;
const code = (text) => el('code', {}, text);
$('[data-skill-drift]').replaceChildren(
	'One copy, ',
	code(stale.name),
	`, is back at ${stale.to} and has been edited by hand. The repo has also written a skill of its own, `,
	code(local.name),
	'. ',
	code('skill-status'),
	` reports ${drift.stale} stale and ${drift.unmanaged} unmanaged.`
);
const updated = skillRun('seed-update').updated;
$('[data-skill-update]').replaceChildren(
	code('skill-seed --update'),
	` rewrote ${count(updated.length, 'skill')} from the package${stale.restored ? ', the hand edit included,' : ''} and left `,
	code(local.name),
	` ${local.kept ? 'byte for byte as it was written' : 'changed'}.`,
	...(skip.kept
		? [' To keep your own edit of a Botcore skill, name it in ', code('botcore.toml'), ': with ', code(skip.line), ', the next update left that edit alone.']
		: [])
);
const lint = skillRun('skill-lint');
$('[data-skill-lint]').replaceChildren(
	code('skill-lint'),
	` read ${count(lint.total, 'skill')}: ${count(lint.errors, 'error')}, ${count(lint.warnings, 'warning')}. Together their descriptions take ${fmt(lint.listing.characters)} characters of a budget of ${fmt(lint.listing.budget)}, so the list of skills an agent carries stays short.`
);

// ── Copy a line ─────────────────────────────────────────────────────────

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

initStatements();
document.documentElement.dataset.botcore = 'ready';
