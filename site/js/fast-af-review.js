// Review sheets for the components' theme: every component at once, and the
// components used together. They are working pages for a design pass, not
// part of the site's story, so nothing links to them.
//
//   fast-af/review/            every component, as its stories show it
//   fast-af/review/in-use.html six screens built from them
//
// `?theme=name` loads a candidate theme (afd-theme.name.json), `?preset=dark`
// picks a preset, `?preset=light,dark` puts two side by side, and
// `?examples=all` shows every example of every component.

import { screens } from './fast-af-in-use.js';
import { fa, library, mount, stage, theme, themeName } from './fast-af-stage.js';

const $ = (selector, root = document) => root.querySelector(selector);
const sheet = document.documentElement.dataset.sheet;
const query = new URLSearchParams(location.search);
const records = library.records;

const SHEET_CSS = `
	.root {
		display: grid;
		gap: var(--space-5);
		align-items: start;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
	}
	.root[data-sheet="in-use"] {
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr));
	}
	.cell {
		display: grid;
		gap: var(--space-3);
		min-width: 0;
		padding: var(--space-4);
		border: 1px solid var(--violet-color-border-subtle);
	}
	.cell.wide {
		grid-column: 1 / -1;
	}
	.cell > h2 {
		margin: 0;
		color: var(--violet-color-text-muted);
		font: 500 var(--t-label) / 1.4 var(--violet-font-family-mono);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
	}
	.cell > .note {
		margin: 0;
		color: var(--violet-color-text-secondary);
		font-size: var(--t-small);
	}
	.demo {
		display: grid;
		gap: var(--space-4);
		min-width: 0;
		justify-items: start;
	}
	.demo > * {
		max-width: 100%;
	}
	.none {
		margin: 0;
		color: var(--violet-color-text-muted);
		font-size: var(--t-small);
	}
	.stack {
		display: grid;
		gap: var(--space-4);
		width: 100%;
		min-width: 0;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.row.end {
		justify-content: flex-end;
	}
	.spread {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.grow {
		flex: 1 1 12rem;
	}
	.thread {
		display: block;
		max-block-size: 34rem;
	}
	.plain {
		margin: 0;
	}
`;

function everyComponent() {
	const all = query.get('examples') === 'all';
	return records
		.map((record) => {
			const shown = all ? record.examples : record.examples.slice(0, 1);
			const demos = shown.length
				? shown.map((item) => `<div class="demo" data-from="${item.from}">${item.html}</div>`).join('')
				: '<p class="none">No example mounts on its own. It is drawn inside another component.</p>';
			return `<section class="cell" data-tag="${record.tag}"><h2>${record.tag.replace('violet-', '')}</h2>${demos}</section>`;
		})
		.join('');
}

function inUse() {
	return screens
		.map(
			(screen) =>
				`<section class="cell" data-screen="${screen.title}"><h2>${screen.title}</h2><p class="note">${screen.note}</p><div class="demo">${screen.html}</div></section>`
		)
		.join('');
}

const markup = sheet === 'in-use' ? inUse() : everyComponent();
const available = fa.getVioletThemePresets();
const asked = (query.get('preset') ?? theme.set.defaultPreset).split(',').filter((name) => available.includes(name));
const shown = asked.length ? asked : [theme.set.defaultPreset];

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

async function draw() {
	const sheets = $('[data-sheets]');
	sheets.replaceChildren();
	sheets.dataset.count = String(shown.length);
	for (const preset of shown) {
		const host = document.createElement('div');
		host.className = 'fa-stage fr-stage';
		host.dataset.preset = preset;
		sheets.append(host);
		const root = stage(host, SHEET_CSS);
		root.dataset.sheet = sheet;
		fa.applyVioletThemeRoot(root, preset);
		mount(root, markup);
		// A dialog opens over the page, so the sheet wires its own button to it.
		for (const button of root.querySelectorAll('[data-opens]')) {
			const dialog = root.querySelector(`[data-dialog="${button.dataset.opens}"]`);
			button.addEventListener('click', () => dialog.setAttribute('open', ''));
			for (const close of dialog.querySelectorAll('[data-closes]')) {
				close.addEventListener('click', () => dialog.removeAttribute('open'));
			}
		}
		await frame();
		await frame();
		// A component too wide for its cell gets the whole row.
		for (const cell of root.querySelectorAll('.cell')) {
			if ([...cell.querySelectorAll('.demo')].some((demo) => demo.scrollWidth > demo.clientWidth + 1)) {
				cell.classList.add('wide');
			}
		}
	}
}

// ── The bar: which sheet, which preset, which candidate ─────────────────

function link(changes) {
	const next = new URLSearchParams(location.search);
	for (const [name, value] of Object.entries(changes)) {
		if (value === null) next.delete(name);
		else next.set(name, value);
	}
	const text = next.toString();
	return text ? `?${text}` : location.pathname;
}

function chips(node, options, current, param) {
	node.replaceChildren(
		...options.map(([value, label]) => {
			const a = document.createElement('a');
			a.href = link({ [param]: value });
			a.textContent = label;
			if (value === current) a.setAttribute('aria-current', 'true');
			return a;
		})
	);
}

chips(
	$('[data-presets]'),
	[...available.map((name) => [name, name]), ['light,dark', 'light and dark']],
	shown.join(','),
	'preset'
);
if (sheet !== 'in-use') {
	chips(
		$('[data-examples]'),
		[
			[null, 'one each'],
			['all', 'every example'],
		],
		query.get('examples') === 'all' ? 'all' : null,
		'examples'
	);
}
for (const a of document.querySelectorAll('[data-sheet-link]')) a.href = a.getAttribute('href') + location.search;

// Candidate themes, when the build has written a list of them.
const select = $('[data-candidates]');
let candidates = [{ name: null, title: 'AFD (draft)' }];
try {
	const response = await fetch(new URL('../fast-af/afd-themes.json', import.meta.url));
	if (response.ok) candidates = await response.json();
} catch {
	// No list: the one theme.
}
select.replaceChildren(
	...candidates.map((candidate) => {
		const option = document.createElement('option');
		option.value = candidate.name ?? '';
		option.textContent = candidate.title;
		option.selected = (candidate.name ?? null) === themeName;
		return option;
	})
);
select.addEventListener('change', () => {
	location.href = link({ theme: select.value || null });
});
$('[data-theme-note]').textContent = [theme.title ?? theme.name, theme.note, `built ${theme.built}`]
	.filter(Boolean)
	.join(' · ');

await draw();
document.documentElement.dataset.review = 'ready';
