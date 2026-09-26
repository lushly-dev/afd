// Section behaviours for the field-manual pass: the keyhole spotlight, the
// inversion flip, the pinned workflow window, the confidence dial, the agent
// session playback and the get-started finale. Each is optional: without JS,
// or with reduced motion, every section still reads as a static page.

import { escape, formatTools, jsonHtml } from './cli-format.js';
import { call, listCommands } from './runtime.js';
import { reducedMotion } from './util.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── 01 · Keyhole: the spotlight follows the pointer; commands open it up ── */

function initKeyhole() {
	const hole = document.querySelector('[data-keyhole]');
	const toggle = document.querySelector('[data-keyhole-toggle]');
	const verdict = document.querySelector('[data-keyhole-verdict]');
	if (!hole || !toggle) return;
	const code = hole.querySelector('code');
	const soup = code.innerHTML;
	const originalVerdict = verdict.textContent;

	// --kx/--ky are registered, non-inherited properties, so set them on the <pre>.
	const pre = hole.querySelector('pre');
	hole.addEventListener('pointermove', (event) => {
		const box = hole.getBoundingClientRect();
		hole.classList.add('is-manual');
		pre.style.setProperty('--kx', `${((event.clientX - box.left) / box.width) * 100}%`);
		pre.style.setProperty('--ky', `${((event.clientY - box.top) / box.height) * 100}%`);
	});

	toggle.addEventListener('click', () => {
		const open = toggle.getAttribute('aria-pressed') !== 'true';
		toggle.setAttribute('aria-pressed', String(open));
		hole.classList.toggle('is-open', open);
		verdict.classList.toggle('is-good', open);
		if (open) {
			const todo = listCommands().filter((c) => c.category === 'todo');
			code.innerHTML = `<span class="tok-prompt">afd tools</span>\n${formatTools(todo)}`;
			verdict.textContent = 'Named capabilities. Typed inputs. Errors it can recover from.';
			toggle.textContent = '◂ Back to the markup';
		} else {
			code.innerHTML = soup;
			verdict.textContent = originalVerdict;
			toggle.textContent = 'Give it commands ▸';
		}
	});
}

/* ── 02 · The inversion: the UI-first stack turns upside down as you pass ── */

function initInversion() {
	const card = document.querySelector('.inversion__card--before');
	if (!card || reducedMotion.matches) return;
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) card.classList.toggle('is-inverted', entry.isIntersecting);
		},
		// Only the top 30% of the viewport counts, so it flips after you've read it.
		{ rootMargin: '0px 0px -70% 0px' }
	);
	observer.observe(card);
}

/* ── 03 · Workflow: one pinned window, content follows the step in view ── */

function initWorkflow() {
	const panels = [...document.querySelectorAll('.step-panel')];
	if (!panels.length) return;
	const setCurrent = (index) => {
		panels.forEach((panel, i) => {
			panel.classList.toggle('is-current', i === index);
		});
	};
	setCurrent(0);
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) setCurrent(panels.indexOf(entry.target.closest('.step-panel')));
			}
		},
		{ rootMargin: '-45% 0px -45% 0px' }
	);
	for (const panel of panels) observer.observe(panel.querySelector('.step-panel__text'));

	// The rendered preview under the surface code calls the real command.
	const form = document.querySelector('[data-preview-form]');
	const out = document.querySelector('[data-preview-result]');
	form?.addEventListener('submit', async (event) => {
		event.preventDefault();
		const result = await call('todo-create', { title: form.elements.title.value }, { surface: 'ui' });
		out.classList.toggle('is-error', !result.success);
		out.textContent = result.success
			? `✓ ${result.data.id} created`
			: `✗ ${result.error.suggestion ?? result.error.message}`;
		if (result.success) form.elements.title.value = '';
	});
}

/* ── 04 · The confidence dial ────────────────────────────────────────── */

const DECISIONS = [
	{
		min: 0.9,
		level: 'act',
		html: '<strong>Act.</strong> Confident enough to proceed without asking, and say what it did.',
	},
	{
		min: 0.6,
		level: 'verify',
		html: '<strong>Verify first.</strong> The match is probably right. Confirm it with user-get by id before changing anything.',
	},
	{
		min: 0,
		level: 'ask',
		html: '<strong>Ask the person.</strong> Too uncertain to act. Show the candidate accounts and let a human pick.',
	},
];

function initDial() {
	const dial = document.querySelector('[data-dial]');
	if (!dial) return;
	const input = dial.querySelector('input');
	const value = dial.querySelector('[data-dial-value]');
	const decision = dial.querySelector('[data-dial-decision]');
	const json = document.querySelector('[data-dial-json]');
	const update = () => {
		const v = Number(input.value);
		const text = v.toFixed(2);
		value.textContent = text;
		if (json) json.textContent = text;
		const d = DECISIONS.find((x) => v >= x.min);
		dial.dataset.level = d.level;
		decision.innerHTML = d.html;
		input.style.setProperty('--fill', `${v * 100}%`);
	};
	input.addEventListener('input', update);
	update();
}

/* ── 06 · Agent session: plays back block by block when it scrolls in ── */

function initPlayback() {
	const code = document.querySelector('.transcript pre code');
	if (!code || reducedMotion.matches) return;
	const blocks = code.innerHTML.split('\n\n');
	code.innerHTML = blocks
		.map((block, i) => `<span class="play-block">${i ? '\n\n' : ''}${block}</span>`)
		.join('');
	const spans = [...code.querySelectorAll('.play-block')];
	const wrap = code.closest('.transcript');
	wrap.classList.add('is-armed');
	const observer = new IntersectionObserver(
		async (entries) => {
			if (!entries.some((e) => e.isIntersecting)) return;
			observer.disconnect();
			for (const span of spans) {
				span.classList.add('is-shown');
				await wait(span.textContent.includes('Run') ? 900 : 550);
			}
		},
		{ threshold: 0.4 }
	);
	observer.observe(wrap);
}

/* ── 10 · Finale: afd call get-started ───────────────────────────────── */

function linkify(html) {
	return html.replace(
		/(https:\/\/[^\s"<]+)/g,
		'<a href="$1" class="finale__link">$1</a>'
	);
}

function initFinale() {
	const form = document.querySelector('[data-finale]');
	const out = document.querySelector('[data-finale-out]');
	if (!form || !out) return;
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const result = await call('get-started', {}, { surface: 'cli' });
		const lines = [
			result.success ? '<span class="tok-ok">✓ Success</span>' : '<span class="tok-err">✗ Failed</span>',
			'',
			'<span class="tok-label">Data:</span>',
			linkify(jsonHtml(result.data ?? result.error)),
			'',
			`<span class="tok-label">Reasoning:</span> ${escape(result.reasoning ?? '')}`,
		];
		out.innerHTML = '';
		out.classList.add('is-run');
		if (reducedMotion.matches) {
			out.innerHTML = lines.join('\n');
			return;
		}
		for (const line of lines) {
			out.insertAdjacentHTML('beforeend', `${line}\n`);
			await wait(90);
		}
	});
}

export function initSections() {
	for (const init of [initKeyhole, initInversion, initWorkflow, initDial, initPlayback, initFinale]) {
		try {
			init();
		} catch (error) {
			console.error(`[afd.dev] ${init.name} failed`, error);
		}
	}
}
