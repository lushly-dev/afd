// Umbel, on the dev side. Umbel is a native program and cannot run in a tab,
// so this page shows one real run of it in this repository, recorded in
// site/umbel/runs.json by scripts/build-site-umbel.mjs: each line as typed,
// its exit code, and exactly what Umbel printed, with the plugin manifest and
// the workspace configuration as they were used. Every number on the page is
// read from that run.

import { escape, jsonHtml, jsonTextHtml } from './cli-format.js';
import { initStatements } from './statements.js';
import { day, loadRuns } from './umbel-runtime.js';
import './widows.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function el(tag, attributes = {}, ...children) {
	const node = document.createElement(tag);
	for (const [name, value] of Object.entries(attributes)) if (value !== undefined) node.setAttribute(name, value);
	node.append(...children);
	return node;
}

const recorded = await loadRuns();
const result = (id) => recorded.run(id).result;
const request = (method) => recorded.mcp.requests.find((item) => item.method === method);
const response = (method) => recorded.mcp.responses.find((item) => item.id === request(method).id);

// ── Counts, read from the run ───────────────────────────────────────────

const total = result('help').data.total;
const plugins = result('plugin-list').data.plugins;
const shownFirst = response('tools/list').result.tools;
// Some of the tools shown first are AFD's own ways to find and run the others, not commands.
const commandNames = new Set(result('help').data.commands.map((command) => command.name));
const listedCommands = shownFirst.filter((tool) => commandNames.has(tool.name)).length;
for (const node of $$('[data-command-count]')) node.textContent = String(total);
for (const node of $$('[data-first-count]')) node.textContent = String(shownFirst.length);

// ── Hero: one command, two ways in, one answer ──────────────────────────

const call = request('tools/call');
$('[data-hero-cli]').textContent = recorded.run('brief').line;
$('[data-hero-mcp]').textContent = `tools/call ${JSON.stringify(call.params).replace(/([,:])/g, '$1 ').replace(/\{/g, '{ ').replace(/\}/g, ' }')}`;
// Over MCP the CommandResult arrives as JSON text. Both ways in give the same reasoning.
const overMcp = JSON.parse(response('tools/call').result.content[0].text);
$('[data-hero-answer]').textContent =
	overMcp.reasoning === result('brief').reasoning ? overMcp.reasoning : 'The two answers differ: the recorded run is out of date.';

// ── Fig. 01: the recorded run ───────────────────────────────────────────

const count = (items, word) => `${items.length} ${word}${items.length === 1 ? '' : 's'}`;

/** What to notice in each result. The words are ours; every figure in them is read from the result. */
const READINGS = {
	scaffold: (r) => `Umbel wrote ${count(r.data.files, 'file')} into ${r.data.dir} and said what to do next: ${r.data.next[0]}.`,
	check: (r) => {
		const tally = (status) => r.data.checks.filter((item) => item.status === status).length;
		return `${tally('pass')} checks passed and ${tally('skip')} were skipped. A mount's server is started only when you ask, since that runs the plugin's own program.`;
	},
	help: (r) =>
		`${r.data.total} commands on this one server: ${plugins.map((plugin) => `${plugin.commands} from ${plugin.id}`).join(', ')}, and the rest from the host.`,
	'plugin-list': (r) =>
		`${count(r.data.plugins, 'plugin')} loaded: ${r.data.plugins.map((plugin) => `${plugin.id} (${plugin.kind})`).join(' and ')}. The compiled one reads “${r.data.plugins[0].trust}”.`,
	'plugin-show': (r) =>
		`It asks for ${count(r.data.grants.items, 'host service')} and gives a reason for each. A deployer reads these before turning it on.`,
	'app-show': (r) =>
		`The server listed its tools, and Umbel turned ${count(r.data.mount.tools, 'of them')} into commands under the prefix “${r.data.mount.prefix}”. It asks for no host service at all.`,
	'skill-list': (r) => `${count(r.data.skills, 'skill')} ships with the bundled plugin, served to a harness as ${r.data.skills[0].uri}.`,
	brief: (r) => `${r.reasoning} The text is one block to put into a session, with every line of library text quoted.`,
	'brief-source': (r) => `${r.reasoning} The agent passed the page it was writing, and Umbel found the tags in it.`,
	list: (r) =>
		`${count(r.data.content.components, 'component')} in ${count(r.data.content.libraries, 'library').replace('librarys', 'libraries')}. The part read from the pack is marked trust: "${r.data.content.trust}".`,
	open: () => 'One component, whole: every section, including the ones a brief leaves out.',
	refused: (r) => `${r.error.code}. ${r.error.suggestion}`,
	'app-create': (r) =>
		`The repo's own command, run through Umbel. Its answer is untouched (“${r.reasoning}”), and Umbel adds where it came from: plugin ${r.metadata['dev.umbel/plugin'].id}, trust "${r.metadata['dev.umbel/trust']}".`,
	'app-list': (r) => `${r.data.total} todo, the one just created. The server was started again for this call, and its file kept the list.`,
	events: (r) =>
		`${count(r.data.events, 'event')} in the journal, one for each call to the mounted server. A mounted tool counts as a change until its manifest says it only reads.`,
};

const LABELS = {
	scaffold: 'Scaffold a plugin',
	check: 'Check it',
	help: 'Every command',
	'plugin-list': 'The plugins that are on',
	'plugin-show': 'The bundled plugin, in full',
	'app-show': 'Your plugin, in full',
	'skill-list': 'The skills on offer',
	brief: 'A brief, by tag',
	'brief-source': 'A brief, from a page',
	list: 'The library’s components',
	open: 'One component, whole',
	refused: 'A call it refuses',
	'app-create': 'Your command, through Umbel',
	'app-list': 'And read back',
	events: 'What changed, as events',
	'mcp-list': 'What an agent is shown',
	'mcp-call': 'The brief, over MCP',
};

const ENTRIES = [
	...recorded.runs
		.map(({ id }) => recorded.run(id))
		.map((run) => ({
			id: run.id,
			line: run.line,
			exit: `exit ${run.exit}`,
			failed: run.exit !== 0,
			// Exactly as Umbel printed it: the text is coloured, never parsed and written out again.
			html: jsonTextHtml(run.stdout.trimEnd()),
			reading: READINGS[run.id]?.(run.result) ?? '',
		})),
	{
		id: 'mcp-list',
		line: 'tools/list, over MCP',
		exit: 'umbel serve --stdio',
		html: jsonHtml({ request: request('tools/list'), response: response('tools/list') }),
		reading: `${shownFirst.length} tools are listed first: ${shownFirst.map((tool) => tool.name).join(', ')}. The other ${total - listedCommands} commands are found with afd-discover and run with afd-call.`,
	},
	{
		id: 'mcp-call',
		line: 'tools/call components-brief, over MCP',
		exit: 'umbel serve --stdio',
		html: jsonHtml({ request: call, response: response('tools/call') }),
		reading: 'The same command through the other way in. The result is the same CommandResult, carried as JSON text.',
	},
];

function show(entry) {
	for (const button of $$('[data-run-list] button')) button.setAttribute('aria-pressed', String(button.dataset.run === entry.id));
	$('[data-run-line]').textContent = entry.line.startsWith('umbel') ? `$ ${entry.line}` : entry.line;
	const exit = $('[data-run-exit]');
	exit.textContent = entry.exit;
	exit.toggleAttribute('data-failed', Boolean(entry.failed));
	const out = $('[data-run-out]');
	out.innerHTML = entry.html;
	out.parentElement.scrollTop = 0;
	$('[data-run-reading]').textContent = entry.reading;
}

$('[data-run-list]').append(
	...ENTRIES.map((entry) => {
		const button = el('button', { type: 'button', 'data-run': entry.id, 'aria-pressed': 'false' }, LABELS[entry.id] ?? entry.id);
		button.addEventListener('click', () => show(entry));
		return button;
	})
);
show(ENTRIES.find((entry) => entry.id === 'brief'));

$('[data-run-foot]').replaceChildren(
	`Recorded on ${day(recorded.recorded)} from ${recorded.host.name} ${recorded.host.version} (AFD contract ${recorded.host.afdContract}), at revision ${recorded.source.revision.slice(0, 7)}${recorded.source.dirty ? ' with uncommitted changes' : ''}. `,
	el('a', { href: new URL('../umbel/runs.json', import.meta.url).href }, 'The whole recorded run')
);

// ── Fig. 02: the repo's own commands, as a plugin ───────────────────────

function renderYours() {
	const scaffold = recorded.run('scaffold');
	$('[data-yours-scaffold]').textContent = `$ ${scaffold.line}`;
	$('[data-yours-files]').textContent = `Umbel writes ${count(scaffold.result.data.files, 'file')}: ${scaffold.result.data.files.join(' and ')}.`;

	// The manifest as used, with the lines that differ from what the scaffold wrote marked.
	const before = new Set(recorded.plugin.scaffolded.split('\n'));
	const lines = recorded.plugin.manifest.trimEnd().split('\n');
	const changed = lines.filter((line) => !before.has(line));
	$('[data-yours-manifest]').replaceChildren(
		...lines.flatMap((line) => [el('span', { 'data-changed': before.has(line) ? undefined : 'true' }, line), '\n'])
	);
	$('[data-yours-edit]').textContent = `${count(changed, 'line')} differ from the scaffold: where the server is, and what it needs in its environment. The rest is as Umbel wrote it.`;

	$('[data-yours-config]').textContent = recorded.workspace.config.trimEnd();

	$('[data-yours-plugins]').replaceChildren(
		...plugins.map((plugin) =>
			el(
				'li',
				{},
				el('code', {}, plugin.id),
				el('span', {}, `${plugin.kind}, ${count({ length: plugin.commands }, 'command')}`),
				el('span', { class: 'mark', 'data-mark': plugin.status === 'loaded' ? 'solid' : 'alert' }, plugin.status)
			)
		)
	);
	const created = result('app-create');
	$('[data-yours-note]').textContent =
		`${total} commands on one server. When the repo's command ran, its result came back unchanged, and Umbel marked it trust: "${created.metadata['dev.umbel/trust']}" and wrote it to the journal.`;
}

// ── Fig. 04: what the bundled plugin asked the host for ─────────────────

$('[data-grants]').replaceChildren(
	...result('plugin-show').data.grants.items.map((grant) =>
		el(
			'li',
			{},
			el('code', {}, grant.name),
			el('span', {}, grant.reason),
			el('span', { class: 'mark', 'data-mark': grant.status === 'granted' ? 'solid' : 'dashed' }, grant.status)
		)
	)
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
renderYours();
// `escape` keeps the revision safe if it is ever shown as markup.
document.documentElement.dataset.revision = escape(recorded.source.revision.slice(0, 7));
document.documentElement.dataset.umbel = 'ready';
