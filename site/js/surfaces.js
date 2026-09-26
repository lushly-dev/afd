// Hero: the same command fired from the terminal, an agent and a button.
// Cycles the active surface; with reduced motion all three stay equal.

import { reducedMotion, whileVisible } from './util.js';

const LABELS = ['via CLI', 'via MCP', 'via web UI'];
const INTERVAL = 2600;

export function initSurfaces() {
	const figure = document.querySelector('.surfaces');
	if (!figure || reducedMotion.matches) return;

	const surfaces = [...figure.querySelectorAll('[data-surface]')];
	const rails = [...figure.querySelectorAll('[data-rail]')];
	const result = figure.querySelector('.surfaces__result .code');
	const via = figure.querySelector('.surfaces__via');
	let index = 0;
	let timer = null;

	const show = (i) => {
		surfaces.forEach((el, n) => {
			el.classList.toggle('is-active', n === i);
		});
		rails.forEach((el, n) => {
			el.classList.toggle('is-active', n === i);
		});
		via.textContent = LABELS[i];
		result.classList.remove('is-flash');
		void result.offsetWidth; // restart the flash animation
		result.classList.add('is-flash');
	};

	const tick = () => {
		show(index);
		index = (index + 1) % surfaces.length;
	};

	whileVisible(
		figure,
		() => {
			if (timer) return;
			tick();
			timer = setInterval(tick, INTERVAL);
		},
		() => {
			clearInterval(timer);
			timer = null;
		},
		0.3,
	);
}
