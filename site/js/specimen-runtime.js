// Specimen, on the page.
//
// Specimen renders components in Chromium through a native host, which a web
// page cannot start. Its other half needs neither: a capture is a JSON file,
// and comparing two is a plain function. So the pages work the way Specimen is
// used in a pull request. The captures in site/specimen/captures/ were written
// ahead of time by the real host (scripts/build-site-specimen.mjs), and the
// page compares them with the real specimen-diff command, from the bundle of
// @lushly-dev/specimen-afd in vendor/specimen.js. Nothing about a result is
// written by hand: the page reads it from the command.

import { createSpecimenCommands, executeSpecimenCommand, executeSpecimenDiff } from './vendor/specimen.js';

const CAPTURES = new URL('../specimen/captures/', import.meta.url);

/** What each pair on the pages changed. The cause is ours to state; what it did is read from the diff. */
export const SCENARIOS = [
	{
		id: 'token',
		label: 'A token changed',
		left: 'bar',
		right: 'bar-token-changed',
		cause: 'A spacing token went from 12px to 20px. No component file was touched.',
	},
	{
		id: 'label',
		label: 'A label changed',
		left: 'bar',
		right: 'bar-relabelled',
		cause: 'The main button now reads “Save changes”.',
	},
	{
		id: 'name',
		label: 'A name was lost',
		left: 'bar',
		right: 'bar-unnamed',
		cause: 'A refactor dropped the name of the icon button.',
	},
	{
		id: 'disabled',
		label: 'The bar was disabled',
		left: 'bar',
		right: 'bar-disabled',
		cause: 'The bar was given a disabled attribute, meant to switch off Save.',
	},
	{
		id: 'fixed',
		label: 'The fix',
		left: 'bar-disabled',
		right: 'bar-disabled-fixed',
		cause: 'The attribute was renamed, so the bar itself no longer carries disabled.',
	},
	{
		id: 'same',
		label: 'Nothing changed',
		left: 'bar',
		right: 'bar-again',
		cause: 'The same state, rendered a second time in a new browser.',
	},
];

/** The channels a comparison reports, in the order the pages show them. */
export const CHANNELS = [
	['dom', 'Markup'],
	['layout', 'Layout'],
	['styles', 'Styles'],
	['state', 'State'],
	['a11y', 'Accessibility'],
];

const files = new Map();

async function file(name) {
	if (!files.has(name)) {
		files.set(
			name,
			fetch(new URL(name, CAPTURES)).then((response) => {
				if (!response.ok) throw new Error(`${name}: ${response.status}`);
				return response.json();
			})
		);
	}
	return files.get(name);
}

/** A capture as the CLI wrote it: a CommandResult whose data is the observation. */
export const capture = (id) => file(`${id}.json`);

/** The observation inside a capture. */
export const observation = async (id) => (await capture(id)).data;

/** The theme audit, as `specimen themes` reported it. */
export const themes = () => file('themes.json');

export const screenshot = (id) => new URL(`${id}.png`, CAPTURES).href;
export const themeShot = (id, theme) => new URL(`themes/${id}-${theme}.png`, CAPTURES).href;
export const captureUrl = (id) => new URL(`${id}.json`, CAPTURES).href;

let entries = [];

/** A tab cannot start the host, and says so the way a command reports any failure. */
function needsHost(operation) {
	return () => {
		throw Object.assign(
			new Error(
				`${operation} renders in Chromium through Specimen's native host, and a browser tab cannot start one. This page holds captures the host wrote earlier; list and diff work on those.`
			),
			{ code: 'SPECIMEN_HOST_REQUIRED' }
		);
	};
}

/** The bench the commands are given: the project's list, and nothing that needs a browser. */
const bench = {
	list: () => entries,
	validate: needsHost('validate'),
	render: needsHost('render'),
	run: needsHost('run'),
	runSuite: needsHost('run'),
	a11y: needsHost('a11y'),
	themes: needsHost('themes'),
	profile: needsHost('profile'),
	contract: needsHost('contract'),
	suggest: needsHost('suggest'),
	coverage: needsHost('coverage'),
	matrix: needsHost('matrix'),
	recordBaseline: needsHost('baseline'),
	inspect: needsHost('inspect'),
	migrate: needsHost('migrate'),
	build: needsHost('build'),
	pack: needsHost('pack'),
	packCheck: needsHost('pack-check'),
	packExport: needsHost('pack-export'),
};

/** Every Specimen command, as defined: name, description and input schema. */
export const commands = createSpecimenCommands(bench);

/** Load the project's list. Call once before `call`. */
export async function start() {
	entries = (await file('list.json')).data.specimens;
	return entries;
}

/** Run a command by name through its schema, as the CLI and the MCP server do. */
export const call = (name, input = {}) => executeSpecimenCommand(bench, name, input);

/** Compare two captures with specimen-diff. Returns the command's result and how long it took. */
export async function diff(leftId, rightId, options = {}) {
	const [left, right] = await Promise.all([observation(leftId), observation(rightId)]);
	const started = performance.now();
	const result = await executeSpecimenDiff({ left, right, ...options });
	return { result, left, right, ms: performance.now() - started };
}

/** How many differences each channel holds. */
export function tally(differences) {
	const counts = Object.fromEntries(CHANNELS.map(([channel]) => [channel, 0]));
	for (const item of differences) counts[item.channel] = (counts[item.channel] ?? 0) + 1;
	return counts;
}

/** A short name for an element in a capture: its tag and class, as a designer would point at it. */
export function nameOf(observed, ref) {
	const element = observed.channels.elements.find((item) => item.ref === ref);
	if (!element) return ref;
	if (ref === 'root') return 'mount root';
	const className = element.attributes.class;
	return className ? `${element.tag}.${className.split(/\s+/)[0]}` : element.tag;
}

/** A difference's value, as text. */
export function show(value) {
	if (value && typeof value === 'object' && value.missing === true) return 'not set';
	if (value === '') return 'empty';
	if (value === null || value === undefined) return 'none';
	if (typeof value === 'number') return String(Math.round(value * 100) / 100);
	return typeof value === 'string' ? value : JSON.stringify(value);
}

/** What the counts add up to, in a sentence. Derived, so it cannot disagree with the result. */
export function reading(data) {
	const counts = tally(data.differences);
	if (data.status === 'no-change-observed') return 'Nothing differs in any channel.';
	if (data.status === 'insufficient-evidence')
		return 'Specimen will not call this one: part of the evidence is missing.';
	const notes = [];
	if (counts.dom === 0) notes.push('The markup is identical.');
	if (counts.layout === 0 && counts.styles === 0) notes.push('Nothing moved and no style changed, so the two look the same.');
	else if (counts.layout > 0 && counts.dom === 0) notes.push('It still moved.');
	if (counts.a11y > 0) notes.push('What a screen reader is told has changed.');
	return notes.join(' ');
}
