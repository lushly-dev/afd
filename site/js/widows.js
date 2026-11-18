// No widows: a last line of one word reads as a mistake.
//
// The stylesheet asks for `text-wrap: pretty` on running text (manifesto-3.css),
// and a browser that has it breaks each paragraph so the last line is not a
// single word. This module is for a browser that does not: it ties the last two
// words of the same elements together with a no-break space, so they move to
// the last line as a pair. Importing it is enough; it runs once.

/** The running text the stylesheet's rule covers. */
const RUNNING_TEXT = 'p, li, dd, figcaption, blockquote';
const NO_BREAK_SPACE = ' ';
/** Two long words tied together can be wider than a phone, so a long pair is left alone. */
const LONGEST_PAIR = 24;

/** Tie the last two words of an element's text together. */
export function tieLastWords(element) {
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
	let last = null;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data.trim()) last = node;
	// Code wraps where it wraps, and a lit statement is split into words by statements.js.
	if (!last || last.parentElement.closest('pre, code, [data-lit]')) return;
	const match = /^([\s\S]*\S)[ \t\n]+(\S+)(\s*)$/.exec(last.data);
	if (!match) return;
	const [, before, word, after] = match;
	const previous = before.split(/\s+/).at(-1);
	if (previous.length + word.length + 1 > LONGEST_PAIR) return;
	last.data = `${before}${NO_BREAK_SPACE}${word}${after}`;
}

if (!CSS.supports('text-wrap', 'pretty')) {
	for (const element of document.querySelectorAll(RUNNING_TEXT)) tieLastWords(element);
}
