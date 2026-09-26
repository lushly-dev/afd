// Testing: play the scenario runner and fill the conformance matrix once
// they scroll into view. Without JS (or with reduced motion) both render complete.

import { reducedMotion } from './util.js';

const CASES = 34;

function once(el, callback) {
	const observer = new IntersectionObserver(
		(entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			observer.disconnect();
			callback();
		},
		{ threshold: 0.35 },
	);
	observer.observe(el);
}

export function initRunner() {
	const matrix = document.querySelector('[data-matrix]');
	if (matrix) {
		matrix.querySelectorAll('.matrix__cells').forEach((cells, row) => {
			for (let i = 0; i < CASES; i++) {
				const cell = document.createElement('i');
				cell.style.setProperty('--i', String(i));
				cell.style.setProperty('--row', String(row));
				cells.append(cell);
			}
		});
		if (!reducedMotion.matches) {
			matrix.classList.add('is-armed');
			once(matrix, () => matrix.classList.add('is-running'));
		}
	}

	const runner = document.querySelector('[data-runner]');
	if (!runner || reducedMotion.matches) return;
	const lines = [...runner.querySelectorAll('.runner__line')];
	runner.classList.add('is-armed');
	once(runner, () => {
		lines.forEach((line, i) => {
			setTimeout(() => line.classList.add('is-shown'), 350 + i * 190);
		});
	});
}
