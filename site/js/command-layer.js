// The command layer: a dock that shows every command the page runs, a log of
// their CommandResults, and a ⌘K palette. It also routes the page's ordinary
// clicks (nav links, install copy, agent view) through real commands.

import { escape, jsonHtml } from './cli-format.js';
import { call, listCommands, onCommand, provide, SECTIONS } from './runtime.js';
import { reducedMotion } from './util.js';

const SURFACE_NAME = { ui: 'Click', palette: 'Palette', cli: 'CLI', agent: 'Agent' };
const SECTION_LABEL = {
	top: 'Top',
	problem: 'The keyhole',
	honesty: 'The honesty check',
	inversion: 'The inversion',
	workflow: 'Define, validate, surface',
	result: 'CommandResult',
	'agent-ux': 'Agent UX',
	build: 'Built for coding agents',
	testing: 'Testing',
	toolkit: 'Toolkit',
	botcore: 'Botcore',
};
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const compact = (input) => (input && Object.keys(input).length ? JSON.stringify(input) : '');

/* ── Dock + log ────────────────────────────────────────────────────────── */

function initDock() {
	const dock = document.querySelector('[data-dock]');
	const log = document.querySelector('[data-log]');
	if (!dock || !log) return;
	dock.hidden = false;
	document.body.classList.add('has-dock');

	const pulse = dock.querySelector('[data-dock-pulse]');
	const ticker = dock.querySelector('[data-dock-ticker]');
	const count = dock.querySelector('[data-log-count]');
	const toggle = dock.querySelector('[data-log-toggle]');
	const list = log.querySelector('[data-log-list]');
	const empty = log.querySelector('[data-log-empty]');
	let total = 0;

	const setOpen = (open) => {
		log.hidden = !open;
		toggle.setAttribute('aria-expanded', String(open));
	};
	toggle.addEventListener('click', () => setOpen(log.hidden));
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && !log.hidden) setOpen(false);
	});

	log.querySelector('[data-log-clear]').addEventListener('click', () =>
		call('log-clear', {}, { surface: 'ui' })
	);

	onCommand((entry) => {
		const ok = entry.result.success;
		if (entry.name === 'log-clear' && ok) {
			list.textContent = '';
			total = 0;
		}

		// Ticker + pulse along the dock's top edge, coloured by surface.
		ticker.innerHTML = `<span class="${ok ? 'tok-ok' : 'tok-err'}">${ok ? '✓' : '✗'}</span> ${escape(entry.name)} <span class="dock__meta">${SURFACE_NAME[entry.surface]} · ${entry.ms.toFixed(1)} ms</span>`;
		if (!reducedMotion.matches) {
			pulse.dataset.surface = entry.surface;
			pulse.classList.remove('is-firing');
			void pulse.offsetWidth;
			pulse.classList.add('is-firing');
		}

		if (entry.name === 'log-clear' && ok) {
			count.textContent = '0';
			empty.hidden = false;
			return;
		}
		total += 1;
		count.textContent = String(total);
		empty.hidden = true;
		const item = document.createElement('li');
		item.className = `log__item log__item--${entry.surface}${ok ? '' : ' is-failure'}`;
		item.innerHTML = `
			<details>
				<summary>
					<span class="log__surface">${SURFACE_NAME[entry.surface]}</span>
					<span class="log__call"><strong>${escape(entry.name)}</strong> <span class="log__input">${escape(compact(entry.input))}</span></span>
					<span class="log__status">${ok ? '✓' : '✗'} ${entry.ms.toFixed(1)} ms</span>
				</summary>
				<pre><code>${jsonHtml(entry.result)}</code></pre>
			</details>`;
		list.prepend(item);
	});
}

/* ── Palette ───────────────────────────────────────────────────────────── */

function paletteActions(query) {
	const actions = [
		...SECTIONS.map((section) => ({
			label: `Go to ${SECTION_LABEL[section] ?? section}`,
			name: 'section-go',
			input: { section },
		})),
		{ label: 'Copy install line · TypeScript', name: 'install-copy', input: { language: 'typescript' } },
		{ label: 'Copy install line · Python', name: 'install-copy', input: { language: 'python' } },
		{ label: 'Copy install line · Rust', name: 'install-copy', input: { language: 'rust' } },
		{ label: 'Show the page as an agent reads it', name: 'view-set', input: { view: 'agent' } },
		{ label: 'Show the page for people', name: 'view-set', input: { view: 'human' } },
		{ label: 'List todos', name: 'todo-list', input: {} },
		{ label: 'Clear todos', name: 'todo-clear', input: {}, danger: true },
		{ label: 'Clear the command log', name: 'log-clear', input: {} },
	];
	const q = query.trim().toLowerCase();
	const score = (text) => {
		const hay = text.toLowerCase();
		if (!q) return 1;
		if (hay.includes(q)) return 3 - hay.indexOf(q) / 100;
		let i = 0;
		for (const ch of hay) if (ch === q[i]) i += 1;
		return i === q.length ? 1 : 0;
	};
	const ranked = actions
		.map((a) => ({ ...a, score: Math.max(score(a.label), score(a.name), score(compact(a.input)) * 0.9) }))
		.filter((a) => a.score > 0)
		.sort((a, b) => b.score - a.score);
	if (q) {
		ranked.push({
			label: `Create todo “${query.trim()}”`,
			name: 'todo-create',
			input: { title: query.trim() },
		});
	}
	return ranked.slice(0, 9);
}

function initPalette() {
	const dialog = document.querySelector('[data-palette]');
	if (!dialog || typeof dialog.showModal !== 'function') return;
	const input = dialog.querySelector('#palette-input');
	const list = dialog.querySelector('[data-palette-list]');
	for (const key of document.querySelectorAll('[data-palette-key]')) {
		key.textContent = isMac ? '⌘K' : 'Ctrl K';
	}
	let actions = [];
	let active = 0;
	let opener = null;

	const render = () => {
		actions = paletteActions(input.value);
		active = Math.min(active, Math.max(actions.length - 1, 0));
		list.innerHTML = actions
			.map(
				(a, i) => `
				<li role="option" id="palette-opt-${i}" aria-selected="${i === active}" data-index="${i}" class="palette__opt${a.danger ? ' is-danger' : ''}">
					<span class="palette__label">${escape(a.label)}</span>
					<code class="palette__call">${escape(a.name)} ${escape(compact(a.input))}</code>
				</li>`
			)
			.join('');
		input.setAttribute('aria-activedescendant', actions.length ? `palette-opt-${active}` : '');
		list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
	};

	const open = () => {
		opener = document.activeElement;
		input.value = '';
		active = 0;
		render();
		dialog.showModal();
		input.focus();
	};
	const close = () => {
		dialog.close();
		opener?.focus?.({ preventScroll: true });
	};
	const run = async (action) => {
		if (!action) return;
		close();
		await call(action.name, action.input, { surface: 'palette' });
	};

	input.addEventListener('input', () => {
		active = 0;
		render();
	});
	input.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			active = (active + step + actions.length) % Math.max(actions.length, 1);
			render();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			run(actions[active]);
		}
	});
	list.addEventListener('click', (event) => {
		const option = event.target.closest('[data-index]');
		if (option) run(actions[Number(option.dataset.index)]);
	});
	dialog.addEventListener('click', (event) => {
		if (event.target === dialog) close();
	});

	for (const button of document.querySelectorAll('[data-palette-open]')) {
		button.addEventListener('click', open);
	}
	document.addEventListener('keydown', (event) => {
		const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');
		if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
			event.preventDefault();
			if (dialog.open) close();
			else open();
		}
	});
}

/* ── Route the page's ordinary clicks through commands ─────────────────── */

function initRouting() {
	provide('scrollTo', (section) => {
		const target = document.getElementById(section);
		if (!target) return;
		target.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
		history.replaceState(null, '', `#${section}`);
	});

	document.addEventListener('click', (event) => {
		const link = event.target.closest('a[href^="#"]');
		if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
		const section = link.getAttribute('href').slice(1);
		if (!SECTIONS.includes(section)) return;
		event.preventDefault();
		call('section-go', { section }, { surface: 'ui' });
	});
}

export function initCommandLayer() {
	initRouting();
	initDock();
	initPalette();
	// Make the registry reachable from the console, for the curious.
	window.afd = { call: (name, input) => call(name, input, { surface: 'cli' }), tools: listCommands };
}
