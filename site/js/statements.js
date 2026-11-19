// Statements that light up word by word as they scroll into view. A <mark>
// inside one is stamped when the whole statement is lit. Used sparingly: at
// most three on a page.

import { reducedMotion } from './util.js';

function initLit(el) {
	const words = [];
	const walk = (node) => {
		for (const child of [...node.childNodes]) {
			if (child.nodeName === 'MARK') {
				words.push(child);
			} else if (child.nodeType === Node.TEXT_NODE) {
				const frag = document.createDocumentFragment();
				for (const part of child.textContent.split(/(\s+)/)) {
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
				child.replaceWith(frag);
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				walk(child);
			}
		}
	};
	walk(el);
	el.classList.add('is-armed');
	let frame = 0;
	const update = () => {
		frame = 0;
		const top = el.getBoundingClientRect().top;
		const vh = window.innerHeight;
		const progress = Math.min(1, Math.max(0, (vh * 0.85 - top) / (vh * 0.5)));
		const lit = Math.round(progress * words.length);
		words.forEach((word, i) => {
			word.classList.toggle('is-lit', i < lit);
		});
		el.classList.toggle('is-complete', lit >= words.length);
	};
	const onScroll = () => {
		if (!frame) frame = requestAnimationFrame(update);
	};
	new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (entry.isIntersecting) window.addEventListener('scroll', onScroll, { passive: true });
			else window.removeEventListener('scroll', onScroll);
		}
		update();
	}).observe(el);
}

/** Arm every `[data-lit]` statement on the page, unless motion is reduced. */
export function initStatements() {
	const arm = () => {
		if (reducedMotion.matches) return;
		for (const el of document.querySelectorAll('[data-lit]:not(.is-armed)')) initLit(el);
	};
	arm();
	reducedMotion.addEventListener('change', arm);
}
