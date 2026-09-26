// Two loops: the UI loop and the command loop run side by side on the same
// clock, and each counts its laps. The fast loop laps the slow one ~6×.

import { reducedMotion, whileVisible } from './util.js';

function makeLoop(el) {
	const steps = [...el.querySelectorAll('.loop__track li')];
	const count = el.querySelector('[data-loop-count]');
	const unit = count.nextSibling;
	const stepMs = Number(el.dataset.stepMs);
	let step = -1;
	let laps = 0;
	let timer = null;

	const tick = () => {
		step = (step + 1) % steps.length;
		if (step === 0) {
			laps += 1;
			count.textContent = String(laps);
			unit.textContent = laps === 1 ? ' loop' : ' loops';
		}
		steps.forEach((li, i) => {
			li.classList.toggle('is-active', i === step);
		});
	};

	return {
		start() {
			if (timer) return;
			step = -1;
			laps = 0;
			tick();
			timer = setInterval(tick, stepMs);
		},
		stop() {
			clearInterval(timer);
			timer = null;
		},
	};
}

export function initLoops() {
	const root = document.querySelector('[data-loops]');
	if (!root || reducedMotion.matches) return;
	const loops = [...root.querySelectorAll('[data-loop]')].map(makeLoop);
	whileVisible(
		root,
		() => {
			for (const loop of loops) loop.start();
		},
		() => {
			for (const loop of loops) loop.stop();
		},
	);
}
