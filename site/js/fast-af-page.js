// FAST-AF's page. FAST-AF is a component library and its runtime, and both run
// in a tab, so this page runs them: vendor/fast-af.js is every component in
// @lushly-dev/violet-elements on @lushly-dev/fast-element, bundled by
// scripts/build-site-fast-af.mjs. The facts beside each component come from
// fast-af/library.json, the component pack as Specimen wrote it. Every number
// on the page is counted here from those two, or from a test the page runs.

import { jsonHtml } from './cli-format.js';
import { example, fa, library, mount, stage, theme } from './fast-af-stage.js';
import { call, getTodos, onCommand } from './runtime.js';
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
const code = (text) => el('code', {}, text);
const mark = (kind, label) => el('span', { class: 'mark', 'data-mark': kind }, label);
const fmt = (number) => number.toLocaleString('en-US');
const count = (number, word, plural = `${word}s`) => `${fmt(number)} ${number === 1 ? word : plural}`;
const sum = (numbers) => numbers.reduce((total, number) => total + number, 0);
const day = (iso) =>
	new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

const records = library.records;
const ruleText = new Map(library.rules.map((rule) => [rule.id, rule]));

// ── Counts, from the pack and the tab ───────────────────────────────────

const defined = records.filter((record) => customElements.get(record.tag)).length;
const commands = sum(records.map((record) => record.api.commands.length));
const examples = sum(records.map((record) => record.examples.length));
for (const node of $$('[data-component-count]')) node.textContent = defined;
for (const node of $$('[data-command-count]')) node.textContent = commands;
for (const node of $$('[data-microsoft-version]')) node.textContent = library.microsoft.version;

// ── Hero: a few of them, live ───────────────────────────────────────────

const heroRoot = stage(
	$('[data-hero-stage]'),
	'.root { display: grid; gap: var(--space-4); align-content: start; } .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }'
);
mount(
	heroRoot,
	[
		example('violet-text-field'),
		example('violet-switch'),
		`<div class="row">${example('violet-button')}${example('violet-button', 'danger')}${example('violet-persona')}</div>`,
		example('violet-progress'),
	].join('')
);
$('[data-hero-answer]').textContent =
	`${count(defined, 'component')} are registered in this tab, and ${count(examples, 'example')} from their stories mount here. These are the components themselves: type in the field, flip the switch.`;

// ── Fig. 01: every component ────────────────────────────────────────────

const listNode = $('[data-component-list]');
const cardRoot = stage($('[data-stage]'));
const presets = fa.getVioletThemePresets();
let preset = presets[0];
let current;
let currentExample = 0;
let heard = [];
let stopListening = () => {};

const short = (tag) => tag.replace(/^violet-/, '');
const storyName = (from) => {
	const words = from.split('--')[1].replaceAll('-', ' ');
	return words[0].toUpperCase() + words.slice(1);
};
const BASIS = { verified: 'solid', observed: 'outline', declared: 'dashed', authored: 'plain' };
const basis = (name) => mark(BASIS[name], name);

/** Markup indented for reading; nothing but white space is changed. */
function pretty(html) {
	const template = document.createElement('template');
	template.innerHTML = html;
	const lines = [];
	const open = (node, pad) => {
		const attributes = [...node.attributes].map((a) => (a.value === '' ? a.name : `${a.name}="${a.value.replaceAll('"', '&quot;')}"`));
		const line = [node.localName, ...attributes].join(' ');
		// A long tag gets a line for each attribute.
		return `<${pad.length + line.length > 84 ? [node.localName, ...attributes].join(`
${pad}    `) : line}>`;
	};
	const walk = (node, depth) => {
		const pad = '  '.repeat(depth);
		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent.trim();
			if (text) lines.push(pad + text);
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return;
		const children = [...node.childNodes].filter((child) => child.nodeType !== Node.TEXT_NODE || child.textContent.trim());
		if (children.every((child) => child.nodeType === Node.TEXT_NODE)) {
			lines.push(`${pad}${open(node, pad)}${node.textContent.trim()}</${node.localName}>`);
			return;
		}
		lines.push(pad + open(node, pad));
		for (const child of children) walk(child, depth + 1);
		lines.push(`${pad}</${node.localName}>`);
	};
	for (const node of template.content.childNodes) walk(node, 0);
	return lines.join('\n');
}

function table(headings, rows) {
	return el(
		'table',
		{ class: 'fa-facts' },
		el('thead', {}, el('tr', {}, ...headings.map((heading) => el('th', { scope: 'col' }, heading)))),
		el('tbody', {}, ...rows.map((cells) => el('tr', {}, ...cells.map((cell, index) => el('td', { 'data-label': headings[index] }, cell)))))
	);
}
const none = (text) => el('p', { class: 'fa-none' }, text);

const GAP_WORDS = {
	summary: () => 'a summary',
	usage: () => 'a statement on how to use it',
	'a11y-statement': () => 'a statement on accessibility',
	role: () => 'its role, observed or written',
	example: () => 'an example that mounts on its own',
	unobserved: (gap) => `a story that sets ${gap.name}`,
};

function showHeard() {
	const node = $('[data-heard]');
	if (!current.api.events.length) {
		node.textContent = 'The record names no events for this one.';
		return;
	}
	if (!heard.length) {
		node.replaceChildren('None yet. Use the component. It can emit ', ...current.api.events.flatMap((event, index) => [index ? ', ' : '', code(event.name)]), '.');
		return;
	}
	node.replaceChildren(...heard.slice(-3).flatMap((entry, index) => [index ? ' · ' : '', code(entry)]));
}

function showExample(index) {
	currentExample = index;
	for (const [position, button] of $$('button', $('[data-examples]')).entries()) {
		button.setAttribute('aria-pressed', String(position === index));
	}
	stopListening();
	heard = [];
	const item = current.examples[index];
	if (item) {
		mount(cardRoot, item.html);
		$('[data-markup]').textContent = pretty(item.html);
	} else {
		cardRoot.replaceChildren(el('p', {}, 'The pack has no example of this component that mounts on its own. It is drawn inside another component.'));
		$('[data-markup]').textContent = `<${current.tag}></${current.tag}>`;
	}
	// The component's own events, as the record names them.
	const listeners = current.api.events.map((event) => {
		const listener = (fired) => {
			if (!(fired instanceof CustomEvent)) return;
			const detail = fired.detail == null ? '' : ` ${JSON.stringify(fired.detail)}`;
			heard.push(`${event.name}${detail.length > 60 ? `${detail.slice(0, 60)}…` : detail}`);
			showHeard();
		};
		cardRoot.addEventListener(event.name, listener);
		return () => cardRoot.removeEventListener(event.name, listener);
	});
	stopListening = () => {
		for (const stop of listeners) stop();
	};
	showHeard();
}

function show(record) {
	current = record;
	for (const button of $$('button', listNode)) button.setAttribute('aria-pressed', String(button.dataset.tag === record.tag));
	$('[data-card-tag]').textContent = `<${record.tag}>`;
	const summary = $('[data-card-summary]');
	summary.textContent = record.summary ?? 'No summary has been written for this one yet. The rest of its record comes from its stories and its manifest.';
	summary.toggleAttribute('data-missing', !record.summary);

	$('[data-examples]').replaceChildren(
		...record.examples.map((item, index) => {
			const button = el('button', { type: 'button', 'aria-pressed': 'false' }, storyName(item.from));
			button.addEventListener('click', () => showExample(index));
			return button;
		})
	);
	showExample(0);

	const attributes = record.api.attributes;
	$('#fa-tab-attributes').textContent = `Attributes (${attributes.length})`;
	$('[data-attributes]').replaceChildren(
		attributes.length
			? table(
					['Attribute', 'Type', 'Default', 'Known because'],
					attributes.map((attribute) => [
						code(attribute.name),
						el('span', { class: 'fa-type' }, attribute.type ?? ''),
						attribute.default === undefined ? '' : code(String(attribute.default)),
						basis(attribute.basis),
					])
				)
			: none('This component takes no attributes.')
	);

	const parts = [];
	parts.push(el('h4', {}, `Slots (${record.api.slots.length})`));
	parts.push(
		record.api.slots.length
			? table(
					['Slot', 'What goes in it', 'Known because'],
					record.api.slots.map((slot) => [code(slot.name || 'default'), slot.description ?? '', basis(slot.basis)])
				)
			: none('No slots.')
	);
	parts.push(el('h4', {}, `Events (${record.api.events.length})`));
	parts.push(
		record.api.events.length
			? table(
					['Event', 'When', 'Known because'],
					record.api.events.map((event) => [code(event.name), event.description ?? '', basis(event.basis)])
				)
			: none('No events of its own.')
	);
	$('[data-parts]').replaceChildren(...parts);

	const said = [...record.usage, ...record.a11y.statements];
	const shared = record.rules.filter((id) => !id.startsWith('taxonomy.')).map((id) => ruleText.get(id)).filter(Boolean);
	const guide = [];
	guide.push(el('h4', {}, `Written for this component (${said.length})`));
	guide.push(
		said.length
			? el('ul', { class: 'fa-said' }, ...said.map((statement) => el('li', {}, statement.text, ' ', basis(statement.basis))))
			: none('Nothing yet.')
	);
	guide.push(el('h4', {}, `Shared rules that apply (${shared.length})`));
	guide.push(el('ul', { class: 'fa-said' }, ...shared.map((rule) => el('li', {}, rule.text, ' ', basis(rule.basis)))));
	const axe = record.a11y.axe;
	guide.push(el('h4', {}, 'Accessibility check'));
	guide.push(el('p', { class: 'fa-none' }, `${count(axe.violations, 'violation')} across its stories. `, basis(axe.basis)));
	guide.push(el('h4', {}, `Missing from this record (${record.gaps.length})`));
	guide.push(
		record.gaps.length
			? el('ul', { class: 'fa-said' }, ...record.gaps.map((gap) => el('li', {}, GAP_WORDS[gap.kind]?.(gap) ?? gap.kind)))
			: none('Nothing. This record is complete.')
	);
	$('[data-guide]').replaceChildren(...guide);

	showSchema(record.tag);
}

listNode.replaceChildren(
	...records.map((record) => {
		const button = el('button', { type: 'button', 'aria-pressed': 'false', 'data-tag': record.tag }, short(record.tag));
		button.addEventListener('click', () => show(record));
		return button;
	})
);

const find = $('[data-find]');
function filter() {
	const words = find.value.trim().toLowerCase();
	let shown = 0;
	for (const button of $$('button', listNode)) {
		const record = records.find((candidate) => candidate.tag === button.dataset.tag);
		const match = !words || record.tag.includes(words) || (record.summary ?? '').toLowerCase().includes(words);
		button.hidden = !match;
		if (match) shown += 1;
	}
	$('[data-found]').textContent = words ? `${shown} of ${records.length}` : `${records.length} components`;
}
find.addEventListener('input', filter);
filter();

$('[data-themes]').replaceChildren(
	...presets.map((name) => {
		const button = el('button', { type: 'button', 'aria-pressed': String(name === preset) }, name);
		button.addEventListener('click', () => {
			preset = name;
			fa.applyVioletThemeRoot(cardRoot, name);
			for (const other of $$('button', $('[data-themes]'))) other.setAttribute('aria-pressed', String(other === button));
		});
		return button;
	})
);

initTabs($('[data-fact-tabs]'));

$('[data-library-foot]').replaceChildren(
	`${library.library.name} ${library.library.version} on ${library.runtime.name} ${library.runtime.version}, bundled on ${day(library.built)} from ${library.source.revision}${library.source.dirty ? ' with local changes' : ''}. `,
	el('a', { href: 'library.json' }, `Every record, as Specimen wrote it (${fmt(library.pack.bytes)} bytes)`),
	` Drawn in AFD's theme, Refined: ${count(Object.keys(theme.palette.site).length, 'colour')} from this site and ${fmt(Object.keys(theme.palette.added).length)} it lacked, with ${count(theme.contrast.length, 'colour pair')} measured for contrast. `,
	el('a', { href: 'afd-theme.json' }, 'The theme, as data')
);

// ── Fig. 03 (part): ask a running component what it is ──────────────────

function showSchema(tag) {
	$('[data-schema-call]').textContent = `getSchema('${tag}')`;
	$('[data-schema]').innerHTML = jsonHtml(fa.getSchema(tag));
}

const names = (items, key) => items.map((item) => item[key]).sort().join(' ');
const schemas = fa.getAllSchemas();
const agreeing = records.filter((record) => {
	const schema = schemas.get(record.tag);
	return schema && names(schema.properties.filter((property) => property.attribute), 'attribute') === names(record.api.attributes, 'name');
}).length;
const schemaAttributes = sum([...schemas.values()].map((schema) => schema.properties.filter((property) => property.attribute).length));
$('[data-schema-agree]').textContent =
	`Checked in this tab: the runtime names ${count(schemaAttributes, 'attribute')} across ${count(schemas.size, 'component')}. The pack, which a different tool built from the stories and the manifest, names the same attributes for ${agreeing} of ${records.length}. The schema follows whichever component you picked in Fig. 01.`;

show(records.find((record) => record.tag === 'violet-slider') ?? records[0]);

// ── Fig. 02: events in, commands out ────────────────────────────────────

const appRoot = stage(
	$('[data-app-stage]'),
	'.add { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--space-3); } [data-list] { display: grid; gap: var(--space-2); margin-top: var(--space-5); } .empty { margin: 0; color: var(--violet-color-text-secondary); }'
);
mount(
	appRoot,
	'<div class="add"><violet-text-field label="Task" name="title" placeholder="Water the seedlings"></violet-text-field><violet-button appearance="primary" type="button">Add</violet-button></div><div data-list></div>'
);

const flowLog = $('[data-flow-log]');
const tally = { events: 0, commands: 0 };

function log(layer, ...content) {
	$('.fa-log-empty', flowLog)?.remove();
	flowLog.append(el('li', { 'data-layer': layer }, el('span', { class: 'mono' }, layer), el('span', {}, ...content)));
	while (flowLog.children.length > 8) flowLog.firstElementChild.remove();
	flowLog.scrollTop = flowLog.scrollHeight;
	$('[data-flow-verdict]').textContent =
		`So far: ${count(tally.events, 'event')} from components, ${count(tally.commands, 'command call')}. No component made a call. In all ${records.length} records, the list of commands a component runs is empty.`;
}

function draw() {
	const list = $('[data-list]', appRoot);
	const todos = getTodos();
	if (!todos.length) {
		list.replaceChildren(el('p', { class: 'empty' }, 'No tasks yet.'));
		return;
	}
	const html = todos
		.map((todo) => `<violet-checkbox data-id="${todo.id}"${todo.completed ? ' checked' : ''}></violet-checkbox>`)
		.join('');
	mount(list, html);
	for (const [index, box] of $$('violet-checkbox', list).entries()) box.textContent = todos[index].title;
}

/** The whole link between the components and the commands. Shown on the page as it is. */
function wire(app, call, draw) {
	const field = app.querySelector('violet-text-field');
	const add = app.querySelector('violet-button');
	const list = app.querySelector('[data-list]');

	// A press on Add means "make this a task". The app names the command.
	add.addEventListener('click', async () => {
		const result = await call('todo-create', { title: field.value });
		if (result.success) field.value = '';
		draw();
	});
	field.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') add.click();
	});

	// A tick means "this one is done". The checkbox says which; the app decides what that does.
	list.addEventListener('change', async (event) => {
		await call('todo-toggle', { id: event.target.dataset.id });
		draw();
	});
}

// What the components said, heard before the wiring acts on it.
appRoot.addEventListener(
	'click',
	(event) => {
		if (!event.target.closest('violet-button')) return;
		tally.events += 1;
		log('component', code('<violet-button>'), ' was pressed');
	},
	true
);
appRoot.addEventListener(
	'change',
	(event) => {
		if (!(event instanceof CustomEvent)) return;
		const tag = event.target.localName;
		tally.events += 1;
		log('component', code(`<${tag}>`), ' emitted ', code(`change ${JSON.stringify(event.detail)}`));
	},
	true
);
onCommand((entry) => {
	tally.commands += 1;
	const { result } = entry;
	log(
		'command',
		code(`${entry.name} ${JSON.stringify(entry.input)}`),
		result.success ? ` succeeded: ${result.reasoning}` : ` failed with ${result.error.code}: ${result.error.suggestion ?? result.error.message}`
	);
});

wire(appRoot, call, draw);
draw();
$('[data-wiring]').textContent = wire.toString().replaceAll('\t', '  ');

// ── Fig. 03: what FAST gives a component ────────────────────────────────

/**
 * A component in plain FAST: a class, its attributes and a template. Shown on
 * the page as it is. `count` is read from its attribute and not written back,
 * so a change to it shows up only where the template uses it.
 */
async function defineTally({ FASTElement, html }, name, styles) {
	class Tally extends FASTElement {
		add() {
			this.count = Number(this.count) + 1;
		}
	}

	await FASTElement.define(Tally, {
		name,
		attributes: ['label', { property: 'count', mode: 'fromView' }],
		styles,
		template: html`
			<p>${(x) => x.label}</p>
			<output>${(x) => x.count}</output>
			<button @click=${(x) => x.add()}>Add one</button>
		`,
	});
}

// The site's tokens reach into a shadow root, so the component is styled with them.
const TALLY_CSS = `
	:host {
		display: grid;
		gap: var(--space-3);
		justify-items: start;
		color: var(--color-on-dark);
	}
	p {
		margin: 0;
		color: var(--color-on-dark-muted);
		font: var(--t-label) / 1.5 var(--font-mono);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
	}
	output {
		font: var(--weight-strong) var(--t-statement) / 1 var(--font-display);
	}
	/* A Refined key (refined.css): a tint on the dark field, no outline. */
	button {
		min-height: var(--control);
		padding: 0 var(--space-4);
		border: var(--rule-thin) solid transparent;
		border-radius: var(--radius-control);
		background: var(--key-on-dark);
		color: inherit;
		font: var(--weight-medium) var(--t-small) / 1 var(--font-ui);
		cursor: pointer;
	}
	button:hover {
		background: var(--key-on-dark-hover);
	}
	button:active {
		transform: translateY(1px);
		box-shadow: var(--shadow-key-pressed);
	}
	@media (forced-colors: active) {
		button {
			border-color: ButtonText;
		}
	}
	button:focus-visible {
		outline: var(--rule-heavy) solid var(--accent-agent);
		outline-offset: var(--space-1);
	}
`;

await defineTally(fa, 'page-tally', TALLY_CSS);
const tallyHost = $('[data-fast-live]');
const tallyElement = el('page-tally', { label: 'Tasks done', count: '2' });
tallyHost.replaceChildren(tallyElement);
await frame();
$('[data-fast-live-source]').textContent = defineTally.toString().replaceAll('\t', '  ');

// What FAST wrote to the page, as the browser reports it.
const changes = $('[data-fast-changes]');
let presses = 0;
const watcher = new MutationObserver((list) => {
	presses += 1;
	const text = list.filter((record) => record.type === 'characterData').length;
	const attributes = list.filter((record) => record.type === 'attributes').length;
	const added = sum(list.map((record) => record.addedNodes.length));
	const removed = sum(list.map((record) => record.removedNodes.length));
	const parts = [
		text && `changed the text of ${count(text, 'node')}`,
		attributes && `set ${count(attributes, 'attribute')}`,
		added && `added ${count(added, 'node')}`,
		removed && `removed ${count(removed, 'node')}`,
	].filter(Boolean);
	const only = text === 1 && parts.length === 1;
	changes.textContent = only
		? `Press ${fmt(presses)}: FAST changed the text of one node, and nothing else. No element was created, removed or rendered again.`
		: `Press ${fmt(presses)}: FAST ${parts.join(', ')}.`;
	changes.dataset.text = String(text);
	changes.dataset.other = String(attributes + added + removed);
	changes.dataset.presses = String(presses);
});
watcher.observe(tallyElement.shadowRoot, { attributes: true, characterData: true, childList: true, subtree: true });
watcher.observe(tallyElement, { attributes: true });

$('[data-fast-tags]').textContent =
	`This page has no framework: its ${count(defined, 'component tag')} are defined with the browser's own customElements.`;
$('[data-fast-size]').textContent =
	`FAST Element ${library.microsoft.version} with its templates, as this page loads it for the test below, is ${(library.microsoftBundle.gzip / 1024).toFixed(1)} KB compressed.`;

// ── Fig. 03: one test, two runtimes ─────────────────────────────────────

/**
 * A host with a registry of its own renders a child only that registry
 * knows. Runs unchanged on either runtime; shown on the page as it is.
 */
async function scopedChild({ FASTElement, FASTElementDefinition, html }, name) {
	class Child extends FASTElement {}
	class Host extends FASTElement {}

	// The child is defined in a registry of its own, never on the page.
	const registry = new CustomElementRegistry();
	const child = await FASTElementDefinition.compose(Child, {
		name: `${name}-child`,
		template: html`rendered`,
	});
	child.define(registry);

	// The host's shadow root is given that registry, and its template uses the child.
	await FASTElement.define(Host, {
		name: `${name}-host`,
		template: html`${html.partial(`<${name}-child></${name}-child>`)}`,
		shadowOptions: { mode: 'open', customElementRegistry: registry },
	});

	const host = document.createElement(`${name}-host`);
	document.body.append(host);
	await new Promise((resolve) => requestAnimationFrame(resolve));
	const made = host.shadowRoot.querySelector(`${name}-child`);
	const result = {
		upgraded: made instanceof Child,
		rendered: made?.shadowRoot?.textContent ?? null,
		onThePage: customElements.get(`${name}-child`) !== undefined,
	};
	host.remove();
	return result;
}

const native = fa.supportsScopedRegistries();
await fa.ensureScopedRegistrySupport();
$('[data-native]').textContent = native
	? 'This browser has scoped registries built in.'
	: 'This browser has no scoped registries of its own, so FAST-AF loaded the polyfill.';

$('[data-compare-head="microsoft"]').textContent = `Microsoft FAST Element ${library.microsoft.version}`;
$('[data-compare-head="fast-af"]').textContent = `FAST-AF fast-element ${library.runtime.version}`;
$('[data-compare-source]').textContent = scopedChild.toString().replaceAll('\t', '  ');

let microsoft;
let runs = 0;
const yes = (value, good) => mark(value === good ? 'solid' : 'alert', value ? 'Yes' : 'No');

async function compare() {
	const body = $('[data-compare]');
	microsoft ??= await import('./vendor/ms-fast-element.js');
	runs += 1;
	const attempt = async (runtime, label) => {
		try {
			return await scopedChild(runtime, `scoped-${label}-${runs}`);
		} catch (error) {
			return { error: String(error) };
		}
	};
	const theirs = await attempt(microsoft, 'microsoft');
	const ours = await attempt(fa, 'fast-af');
	const row = (label, cell) => el('tr', {}, el('th', { scope: 'row' }, label), el('td', {}, cell(theirs)), el('td', {}, cell(ours)));
	body.replaceChildren(
		row('The child became a component', (result) => (result.error ? result.error : yes(result.upgraded, true))),
		row('What it rendered', (result) => (result.error ? '' : result.rendered === null ? 'Nothing' : code(result.rendered)))
	);
	// The control is the same for both runs, so it is a sentence, not a row.
	const leaked = [
		[theirs, 'Microsoft FAST Element'],
		[ours, 'FAST-AF'],
	].filter(([result]) => result.onThePage);
	$('[data-compare-note]').textContent = leaked.length
		? `On ${leaked.map(([, label]) => label).join(' and ')} the child was also defined for the whole page, so this run does not isolate the runtime.`
		: 'The setup is the same in both runs: the child is defined only in the host’s registry, never for the whole page. The runtime is the only thing that differs.';
	body.dataset.ran = String(runs);
	body.dataset.outcome = `${Boolean(theirs.upgraded)}/${Boolean(ours.upgraded)}`;
}
$('[data-compare-run]').addEventListener('click', compare);
await compare();

// ── Fig. 03: where it comes from, and how it keeps up ───────────────────

const ms = library.microsoft;
$('[data-fast-history]').textContent =
	`FAST-AF's runtime started from FAST Element ${ms.forkedFrom} and now carries ${ms.version}.`;
$('[data-fast-keeps]').textContent =
	`A fork that stops following its source goes stale. On ${day(ms.taken)} FAST-AF took every FAST Element release from ${ms.forkedFrom} to ${ms.version}, ${count(ms.commits, 'commit')}, as a three-way merge: FAST's fixes arrive, and what FAST-AF added stays. The next release is taken the same way.`;
$('[data-fast-numbers]').replaceChildren(
	...[
		[ms.version, "Microsoft's release it carries"],
		[fmt(ms.commits), 'commits taken in the last merge'],
		[fmt(library.runtime.exports), "import paths: FAST's, and FAST-AF's own"],
	].map(([number, label]) => el('div', {}, el('dt', {}, number), el('dd', {}, label)))
);

// ── Fig. 04: what an agent is told, and how it is known ─────────────────

const bases = { verified: 0, observed: 0, declared: 0, authored: 0 };
(function walk(value) {
	if (Array.isArray(value)) for (const item of value) walk(item);
	else if (value && typeof value === 'object') {
		if (typeof value.basis === 'string' && value.basis in bases) bases[value.basis] += 1;
		for (const item of Object.values(value)) walk(item);
	}
})(records);
const facts = sum(Object.values(bases));
const MEANING = {
	verified: 'A check ran against this fact, and held.',
	observed: 'A story showed it, in a run that passed.',
	declared: "The component's manifest says so. Nothing ran it.",
	authored: 'A person wrote it in a guide. Nothing checks it.',
};
$('[data-bases]').replaceChildren(
	el('p', { class: 'fa-bases-total' }, `${fmt(facts)} facts in ${count(records.length, 'record')}, each labelled one of four ways.`),
	el(
		'dl',
		{},
		...Object.entries(bases).map(([name, number]) =>
			el(
				'div',
				{ style: `--share: ${number / facts}` },
				el('dt', {}, el('b', {}, fmt(number)), mark(BASIS[name], name)),
				el('span', { class: 'fa-share', 'aria-hidden': 'true' }),
				el('dd', {}, MEANING[name])
			)
		)
	)
);

const lacking = (kind) => records.filter((record) => record.gaps.some((gap) => gap.kind === kind)).length;
const withSummary = records.filter((record) => record.summary).length;
$('[data-gaps-lead]').textContent =
	`${withSummary} of ${records.length} components have a written summary so far. The others still carry everything their stories and manifest show, and each record lists what it lacks. An agent is told what is not known, and the team has its backlog.`;
$('[data-gaps]').replaceChildren(
	...[
		['summary', 'have no summary'],
		['usage', 'have no statement on how to use them'],
		['a11y-statement', 'have no statement on accessibility'],
		['role', 'have no role, observed or written'],
		['unobserved', 'have an attribute no story set'],
		['example', 'have no example that mounts on its own'],
	].map(([kind, words]) => el('li', {}, el('b', {}, String(lacking(kind))), el('span', {}, words)))
);

// ── Fig. 05: status ─────────────────────────────────────────────────────

$('[data-preset-names]').textContent = presets.join(', ');
// The lead keeps the static label, whose word `pnpm check:maturity` checks against the inventory.
$('[data-status]').replaceChildren(
	$('[data-status] [data-maturity]'),
	' ',
	code(library.library.name),
	` ${library.library.version} and `,
	code(library.runtime.name),
	` ${library.runtime.version} publish under the `,
	code('preview'),
	' tag, never ',
	code('latest'),
	`. The runtime carries Microsoft FAST Element ${ms.version}. Despite the package's name, the components do not depend on Violet's token engine: they take a theme as data. This page gives them AFD's, Refined, built from this site's colours; it becomes the package's own default in the next preview, in place of the palette the components were first drawn in. ${records.length - withSummary} of ${records.length} components have no written guide yet. Not here yet: anything that turns a component's events into commands for you. Earlier previews let a component declare commands of its own. That has been removed in the source and leaves with the next preview, because commands belong to the application.`
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

initTabs($('.code-tabs [role="tablist"]'));
initStatements();
document.documentElement.dataset.fastAf = 'ready';
