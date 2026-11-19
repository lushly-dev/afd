// Specimen, on the dev side. The prompt on this page runs the real Specimen
// command definitions. The captures it compares are files the real host wrote
// (scripts/build-site-specimen.mjs), and everything the page says about a
// capture or a result is read from that file or that result.

import { escape, jsonHtml } from './cli-format.js';
import { BASES, basisCounts, loadBrief } from './specimen-brief.js';
import { CHANNELS, SCENARIOS, call, commands, diff, observation, reading, start, tally } from './specimen-runtime.js';
import { initSpecimenTerminal } from './specimen-terminal.js';
import { browserName, el, renderTally, stateName } from './specimen-view.js';
import { initStatements } from './statements.js';
import { initTabs } from './util.js';
import './widows.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

for (const node of $$('[data-command-count]')) node.textContent = String(commands.length);

const entries = await start();
const CAPTURE_IDS = [...entries.filter((entry) => entry.id.startsWith('bar')).map((entry) => entry.id), 'bar-again'];
const file = (id) => `captures/${id}.json`;

// ── Fig. 01: the prompt, and the last result read out ───────────────────

const STATUS = {
	changed: 'Changed',
	'no-change-observed': 'No change observed',
	'insufficient-evidence': 'Not enough evidence',
};

const readout = $('[data-read]');
const heading = (text) => el('h3', {}, text);

function readDiff({ result, ids, ms }) {
	if (!result.success) return readFailure(result);
	const { data } = result;
	const tallyList = el('dl', { class: 'stally' });
	renderTally(tallyList, data, 'keys');
	const first = data.differences.find((item) => item.target);
	readout.replaceChildren(
		el('p', { class: 'sread-files' }, `${ids[0]}.json → ${ids[1]}.json`),
		el('p', { class: 'sverdict-status' }, el('span', { class: 'mono' }, 'status'), el('b', { 'data-status': data.status }, STATUS[data.status])),
		tallyList,
		el('p', { class: 'sread-reading' }, reading(data)),
		first
			? el(
					'p',
					{ class: 'sread-first' },
					el('span', { class: 'mono' }, `The first of ${data.differences.length}`),
					el('code', {}, `${first.channel} · ${first.target.split('/').at(-1)} · ${first.property}`)
				)
			: null,
		heading('What it will not vouch for'),
		el('ul', { class: 'sread-limits' }, ...data.limitations.map((item) => el('li', {}, item))),
		el('p', { class: 'sread-ran' }, `Compared here in ${ms < 1 ? 'under 1' : Math.round(ms)} ms.`)
	);
}

function readList(result) {
	readout.replaceChildren(
		heading(`${result.data.specimens.length} entries in the project`),
		el(
			'ul',
			{ class: 'sread-entries' },
			...result.data.specimens.map((entry) => {
				const captured = CAPTURE_IDS.includes(entry.id);
				const button = el('button', { type: 'button', disabled: !captured || entry.id === 'bar' }, entry.id);
				button.addEventListener('click', () => terminal.offer(`specimen diff ${file('bar')} ${file(entry.id)}`));
				return el(
					'li',
					{},
					button,
					el('span', {}, entry.title),
					entry.themes ? el('span', { class: 'sread-tag' }, `${entry.themes.supported.join(', ')} only`) : null
				);
			})
		),
		el('p', { class: 'sread-ran' }, 'Listing reads the configuration. It runs no module and starts no browser. Pick an entry to compare it with bar.')
	);
}

function readFailure(result) {
	readout.replaceChildren(
		el('p', { class: 'sverdict-status' }, el('span', { class: 'mono' }, 'error.code'), el('b', { 'data-status': 'failed' }, result.error.code)),
		el('p', { class: 'sread-reading' }, result.error.message),
		heading('What to do next'),
		el('p', { class: 'sread-next' }, result.error.suggestion ?? 'Nothing suggested.')
	);
}

const terminal = initSpecimenTerminal({
	form: $('[data-terminal-form]'),
	screen: $('[data-terminal-screen]'),
	tries: $('[data-terminal-tries]'),
	call,
	diff,
	files: () => CAPTURE_IDS.map(file),
	onRan(ran) {
		if (ran.kind === 'diff') readDiff(ran);
		else if (!ran.result.success) readFailure(ran.result);
		else if (ran.name === 'specimen-list') readList(ran.result);
	},
	// A short name on the chip; the whole line goes on the prompt.
	suggestions: [
		['List the project', 'specimen list'],
		...SCENARIOS.map(({ label, left, right }) => [label, `specimen diff ${file(left)} ${file(right)}`]),
		['Ask for pixels', `specimen diff ${file('bar')} ${file('bar-unnamed')} --require-visual`],
		['Render without a host', 'specimen render bar'],
	],
});

// ── Hero: the counts for one real comparison, and the install line ──────

async function renderHero() {
	const { result } = await diff('bar', 'bar-token-changed');
	if (!result.success) return;
	const counts = tally(result.data.differences);
	$('[data-hero-tally]').replaceChildren(
		el('div', {}, el('dt', {}, 'status'), el('dd', { 'data-on': 'true' }, result.data.status)),
		...CHANNELS.map(([channel]) =>
			el('div', {}, el('dt', {}, channel), el('dd', { 'data-on': counts[channel] > 0 ? 'true' : 'false' }, String(counts[channel])))
		)
	);
	$('[data-hero-answer]').textContent = reading(result.data);
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

// ── Fig. 02: one capture's manifest and completeness ────────────────────

const COMPLETENESS = ['dom', 'a11y', 'layout', 'styles', 'events', 'tokens', 'visual'];
/** Which mark each status wears (area-kit.css): complete is the one in ink. */
const STATUS_MARK = { complete: 'solid', partial: 'outline', unsupported: 'dashed', 'not-requested': 'dashed' };

async function renderCapture() {
	const { manifest, completeness } = await observation('bar');
	const { context, checkpoint, source, browser, bench } = manifest;
	const facts = [
		['Specimen', stateName(entries.find((entry) => entry.id === manifest.specimenId).title), manifest.specimenId],
		['Captured', new Date(manifest.capturedUtc).toISOString().slice(0, 16).replace('T', ' '), 'UTC'],
		['Bench', bench.version, bench.name],
		['Browser', `${browserName(browser)} (${browser.version})`, browser.platform],
		[
			'Source',
			source.revision ? source.revision.slice(0, 7) : 'no revision',
			source.dirty ? 'with uncommitted changes' : 'clean',
		],
		['Context', `${context.viewport.width} × ${context.viewport.height}, ${context.theme}, ${context.locale}`, `pixel ratio ${context.pixelRatio}`],
		['Checkpoint', checkpoint.name, `ready after ${checkpoint.ready.steps.join(', ')}`],
		['Baseline', `random ${checkpoint.baseline.random.source}, storage ${checkpoint.baseline.storage}`, `clock ${checkpoint.baseline.clock}`],
	];
	$('[data-manifest]').replaceChildren(
		...facts.map(([name, value, detail]) => el('div', {}, el('dt', {}, name), el('dd', {}, el('b', {}, value), ' ', el('span', {}, detail))))
	);
	$('[data-completeness] tbody').replaceChildren(
		...COMPLETENESS.map((channel) => {
			const { status, scope, reasons } = completeness[channel];
			return el(
				'tr',
				{ 'data-status': status },
				el('th', { scope: 'row' }, channel),
				el('td', {}, el('span', { class: 'mark', 'data-mark': STATUS_MARK[status], 'data-status': status }, status)),
				el('td', {}, scope, reasons.length ? el('code', {}, reasons.join(', ')) : null)
			);
		})
	);
}

// ── Fig. 04: the code samples ───────────────────────────────────────────

/** Enough highlighting for the samples: comments, strings and a few keywords. */
function highlight(code) {
	return escape(code).replace(
		/(^#[^\n]*|(?<=^|\s)\/\/[^\n]*|(?<=\s)#\s[^\n]*)|('[^'\n]*'|"[^"\n]*")|\b(import|from|const|await|export|type|try|finally)\b/gm,
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

// ── Fig. 06: the component record, as Specimen wrote it ─────────────────

async function renderPack() {
	const brief = await loadBrief('change-bar');
	const counts = basisCounts(brief);
	$('[data-pack-json]').innerHTML = jsonHtml(brief.record);
	$('[data-pack-counts]').textContent = BASES.map(([basis]) => `${counts[basis]} ${basis}`).join(' · ');
}

// ── Fig. 07: every command, from the definitions ────────────────────────

/** What each command is for, in a line. The names and the write flag come from the definitions. */
const GROUPS = [
	[
		'Look',
		{
			'specimen-list': 'List the project’s specimens and stories without running them.',
			'specimen-validate': 'Check story files without running them, with a suggestion for each problem.',
			'specimen-inspect': 'Resolve one entry’s args, context and component schema.',
		},
	],
	[
		'Capture',
		{
			'specimen-render': 'Capture one entry in a new browser context.',
			'specimen-matrix': 'Capture one entry across themes, sizes and locales, up to 64 cells.',
			'specimen-diff': 'Compare two captures. It needs no browser.',
		},
	],
	[
		'Judge',
		{
			'specimen-coverage': 'Grade each state of a component by what a run observed.',
			'specimen-contract': 'Check the story contract on evidence from a run.',
			'specimen-suggest': 'Propose specimens for the gaps, marked unverified.',
		},
	],
	[
		'Run',
		{
			'specimen-run': 'Run a story or a suite: render, play and accessibility, with a retry for flakes.',
			'specimen-a11y': 'Run axe at a checkpoint: violations, undecided checks and exceptions.',
			'specimen-themes': 'Find what does not follow the theme.',
			'specimen-profile': 'Measure paint, load, DOM size and heap over fresh runs.',
			'specimen-baseline': 'Record a profile as the baseline to compare with.',
		},
	],
	[
		'Ship',
		{
			'specimen-build': 'Build the static review page and check its size budget.',
			'specimen-migrate': 'Preview, or apply, the move off Storybook’s imports.',
			'specimen-pack': 'Build a component pack for agents from two passes over every case.',
			'specimen-pack-check': 'Report committed pack records that have drifted.',
			'specimen-pack-export': 'Write the exported pack from the committed records.',
		},
	],
];

function renderCommands() {
	const defined = new Map(commands.map((command) => [command.name, command]));
	const grouped = new Set(GROUPS.flatMap(([, lines]) => Object.keys(lines)));
	// A command added to Specimen later still appears, under its own description.
	const rest = commands.filter((command) => !grouped.has(command.name));
	const groups = rest.length
		? [...GROUPS, ['More', Object.fromEntries(rest.map((command) => [command.name, command.description]))]]
		: GROUPS;
	$('[data-command-groups]').replaceChildren(
		...groups.map(([title, lines]) =>
			el(
				'section',
				{},
				el('h3', {}, title),
				el(
					'dl',
					{},
					...Object.entries(lines)
						.filter(([name]) => defined.has(name))
						.map(([name, line]) =>
							el(
								'div',
								{},
								el('dt', {}, name, defined.get(name).mutation ? el('span', {}, 'writes') : null),
								el('dd', {}, line)
							)
						)
				)
			)
		)
	);
}

// ── Fig. 08: copy an install line ───────────────────────────────────────

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

// ── Start ───────────────────────────────────────────────────────────────

initStatements();
renderCommands();
await Promise.all([renderHero(), renderCapture(), renderPack()]);
// One command, so the screen is not blank: the pair where the markup did not change.
await terminal.run(`specimen diff ${file('bar')} ${file('bar-token-changed')}`);
document.documentElement.dataset.specimen = 'ready';
