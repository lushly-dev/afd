// The honesty check: the quote lights up word by word as it scrolls through
// the viewport, then "CLI" is stamped. Without JS, or with reduced motion,
// the quote is simply fully lit.

import { reducedMotion } from './util.js';

export function initHonesty() {
	const quote = document.querySelector('[data-honesty]');
	if (!quote || reducedMotion.matches) return;
	const p = quote.querySelector('p');
	const mark = p.querySelector('mark');

	// Split text nodes into word spans; keep <mark> as one unit.
	const words = [];
	for (const node of [...p.childNodes]) {
		if (node === mark) {
			words.push(mark);
			continue;
		}
		const frag = document.createDocumentFragment();
		for (const part of node.textContent.split(/(\s+)/)) {
			if (!part) continue;
			if (/^\s+$/.test(part)) {
				frag.append(part);
				continue;
			}
			const span = document.createElement('span');
			span.className = 'lit-word';
			span.textContent = part;
			frag.append(span);
			words.push(span);
		}
		node.replaceWith(frag);
	}
	quote.classList.add('is-armed');

	let frame = 0;
	const update = () => {
		frame = 0;
		const rect = quote.getBoundingClientRect();
		const vh = window.innerHeight;
		// 0 when the quote's top reaches 85% of the viewport, 1 when it reaches 30%.
		const progress = Math.min(1, Math.max(0, (vh * 0.85 - rect.top) / (vh * 0.55)));
		const lit = Math.round(progress * words.length);
		words.forEach((word, i) => {
			word.classList.toggle('is-lit', i < lit);
		});
		mark.classList.toggle('is-stamped', lit >= words.length);
	};
	const onScroll = () => {
		if (!frame) frame = requestAnimationFrame(update);
	};

	const observer = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (entry.isIntersecting) window.addEventListener('scroll', onScroll, { passive: true });
			else window.removeEventListener('scroll', onScroll);
		}
		update();
	});
	observer.observe(quote);
}
