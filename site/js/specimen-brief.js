// The component pack, drawn as the brief an agent gets.
//
// site/specimen/pack/ holds the pack Specimen built for <change-bar>
// (`specimen pack`, run by scripts/build-site-specimen.mjs): one record for
// the component and the library's shared rules. Every fact in it carries one
// of four words saying where it came from. This module reads those two files
// and draws them; it adds no fact and changes no basis.

import { el } from './specimen-view.js';

const PACK = new URL('../specimen/pack/', import.meta.url);
export const recordUrl = (tag) => new URL(`data/bench/components/${tag}.json`, PACK).href;

/** The four words, strongest first, with what each means (docs/pack-format.md). */
export const BASES = [
	['verified', 'Verified', 'A check ran against this fact, and held.'],
	['observed', 'Observed', 'Specimen saw it in a case that passed.'],
	['declared', 'Declared', 'The component’s manifest says so. Nothing ran it.'],
	['authored', 'Authored', 'A person wrote it. Nothing checks it.'],
];

async function json(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: ${response.status}`);
	return response.json();
}

/** The record for one component, and the shared rules that apply to it. */
export async function loadBrief(tag) {
	const [record, shared] = await Promise.all([json(recordUrl(tag)), json(new URL('rules/bench.json', PACK))]);
	return { record, rules: shared.rules.filter((rule) => record.rules.includes(rule.id)) };
}

/** Every fact in a record that carries a basis, in the order the brief shows them. */
export function facts({ record, rules }) {
	const { api, a11y } = record;
	return [
		...record.usage,
		...a11y.role,
		...(a11y.axe ? [a11y.axe] : []),
		...a11y.statements,
		...api.attributes,
		...api.slots,
		...api.events,
		...api.commands,
		...api.cssProperties,
		...(api.form ? [api.form] : []),
		...record.examples,
		...rules,
	];
}

/** How many facts carry each word. */
export function basisCounts(brief) {
	const counts = Object.fromEntries(BASES.map(([basis]) => [basis, 0]));
	for (const fact of facts(brief)) counts[fact.basis]++;
	return counts;
}

/** Which mark each word wears: the further from a check, the lighter (area-kit.css). */
const MARK = { verified: 'solid', observed: 'outline', declared: 'dashed', authored: 'plain' };
const tag = (basis) => el('span', { class: 'mark', 'data-mark': MARK[basis], 'data-basis': basis }, basis);

/** One fact: what it says, and its word. */
function fact(basis, ...content) {
	return el('li', { 'data-basis': basis }, el('div', {}, ...content), tag(basis));
}

const named = (name, ...rest) => [el('code', {}, name), ...rest.filter(Boolean).flatMap((part) => [' ', part])];
const note = (text) => (text ? el('span', {}, text) : null);
const part = (title, ...items) => el('section', {}, el('h4', {}, title), el('ul', {}, ...items));

/** Draw the brief into `container`. */
export function renderBrief(container, { record, rules }) {
	const { api, a11y } = record;
	container.replaceChildren(
		el(
			'header',
			{},
			el('p', { class: 'brief-tag' }, el('code', {}, `<${record.tag}>`), el('span', {}, record.status)),
			el('p', { class: 'brief-summary' }, record.summary),
			el('p', { class: 'brief-import' }, 'import ', el('code', {}, `'${record.import}'`))
		),
		part('When and how to use it', ...record.usage.map((item) => fact(item.basis, item.text))),
		part(
			'Accessibility',
			...a11y.role.map((item) => fact(item.basis, ...named(`role ${item.role}`, note(`in its ${item.state} state`)))),
			...(a11y.axe
				? [fact(a11y.axe.basis, ...named(`axe ${a11y.axe.violations}`, note(a11y.axe.violations === 1 ? 'rule failed' : 'rules failed')))]
				: []),
			...a11y.statements.map((item) => fact(item.basis, item.text))
		),
		part(
			'What it takes',
			...api.attributes.map((item) =>
				fact(item.basis, ...named(item.name, note(`${item.type}, default ${JSON.stringify(item.default)}.`), note(item.description)))
			),
			...api.slots.map((item) => fact(item.basis, ...named(item.name ? `slot ${item.name}` : 'default slot', note(item.description)))),
			...api.events.map((item) => fact(item.basis, ...named(`event ${item.name}`, note(item.description)))),
			...api.cssProperties.map((item) =>
				fact(item.basis, ...named(item.name, note(`default ${item.default}.`), note(item.description)))
			)
		),
		part('Markup that rendered', ...record.examples.map((item) => fact(item.basis, el('code', {}, item.html)))),
		rules.length ? part('Rules it shares', ...rules.map((item) => fact(item.basis, item.text))) : null
	);
}
