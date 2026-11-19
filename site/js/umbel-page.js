// Umbel, on the design side. Every result on this page is from a real run of
// Umbel, recorded in site/umbel/runs.json and never edited. The one thing that
// runs here is the check on the brief's source: the page recomputes the pack's
// digest from the pack's files and compares it with the one Umbel printed.

import { initStatements } from './statements.js';
import { day, loadRuns, recomputeDigest } from './umbel-runtime.js';
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
const brief = recorded.run('brief').result.data;
const lines = brief.text.trimEnd().split('\n');

// ── Fig. 01: the brief, line by line ────────────────────────────────────

/** Which of the notes beside the brief a line belongs to. */
function noteOf(line, index) {
	if (index < 2) return 'what';
	if (line.startsWith('[library ')) return 'source';
	if (line.includes('change-bar.not-disabled')) return 'lesson';
	if (line.startsWith('[left out')) return 'left-out';
	if (/^\[[a-z0-9]+ (observed|verified|authored|declared)\]$/.test(line)) return 'basis';
	return undefined;
}

$('[data-brief-text]').replaceChildren(
	...lines.flatMap((line, index) => [el('span', { 'data-line': noteOf(line, index) }, line), '\n'])
);

// The question, as the agent's harness sent it over MCP.
const asked = recorded.mcp.requests.find((request) => request.method === 'tools/call').params;
$('[data-brief-asked]').textContent = `${asked.name} ${JSON.stringify(asked.arguments)}`;
$('[data-brief-foot]').replaceChildren(
	`Recorded on ${day(recorded.recorded)} from ${recorded.host.name} ${recorded.host.version}, at revision ${recorded.source.revision.slice(0, 7)}${recorded.source.dirty ? ' with uncommitted changes' : ''}. `,
	el('a', { href: new URL('../umbel/runs.json', import.meta.url).href }, 'The whole recorded run')
);

function point(note) {
	for (const line of $$('[data-brief-text] [data-line]')) line.toggleAttribute('data-on', line.dataset.line === note);
	$('[data-brief-text]').toggleAttribute('data-pointing', note !== null);
	for (const item of $$('[data-notes] li')) item.toggleAttribute('data-on', item.dataset.note === note);
}

for (const item of $$('[data-notes] li')) {
	item.tabIndex = 0;
	for (const type of ['pointerenter', 'focus']) item.addEventListener(type, () => point(item.dataset.note));
	for (const type of ['pointerleave', 'blur']) item.addEventListener(type, () => point(null));
}

// ── Hero and Fig. 01: is the digest Umbel printed the digest of these files? ──

$('[data-hero-brief]').textContent = lines.slice(0, 2).join('\n');

async function checkSource() {
	const library = brief.libraries[0];
	let message;
	let matches = false;
	try {
		const computed = await recomputeDigest(library.library);
		if (!computed.supported) {
			message = 'This browser cannot compute a digest here, so the page could not check it.';
		} else {
			matches = computed.digest === library.digest && computed.files.every((file) => file.matches);
			message = matches
				? `This page recomputed it from the ${computed.files.length} files Umbel read, and it matches.`
				: 'This page recomputed it from the files, and it does not match. The recorded run is out of date.';
		}
	} catch (error) {
		message = `The page could not read the files to check it (${error.message}).`;
	}
	$('[data-brief-check]').textContent = message;
	$('[data-brief-check]').dataset.matches = String(matches);
	$('[data-hero-check]').textContent = matches
		? `The digest Umbel printed, ${library.digest.slice(7, 15)}…, is the digest of the files on this site.`
		: message;
	document.documentElement.dataset.digest = matches ? 'matches' : 'unchecked';
}

// ── Fig. 03: the guessed tag ────────────────────────────────────────────

function renderGuess() {
	const run = recorded.run('brief-source');
	const source = /\{"source":"(.*)"\}'$/.exec(run.line)[1];
	// One element to a line, so the guessed tag is easy to find.
	$('[data-guess-source]').textContent = source.replace(/></g, '>\n<');
	const { data, reasoning } = run.result;
	$('[data-guess-answered]').replaceChildren(
		...data.content.components.flatMap((component) => [el('code', {}, `<${component.tag}>`), ' '])
	);
	$('[data-guess-unknown]').replaceChildren(
		...data.unknown.flatMap((unknown) => [
			el('code', {}, `<${unknown.tag}>`),
			unknown.nearest.length ? ` The nearest real name is ` : ' Nothing in the library is close.',
			...unknown.nearest.map((tag) => el('code', {}, `<${tag}>`)),
			unknown.nearest.length ? '.' : '',
		])
	);
	$('[data-guess-reasoning]').textContent = reasoning;
}

initStatements();
renderGuess();
await checkSource();
document.documentElement.dataset.umbel = 'ready';
