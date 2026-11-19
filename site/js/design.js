// Agent-First Design: the design side of AFD. This page has no command
// runtime of its own; it shows the patterns and the character, and links to
// the dev side for the code.

import { createAlfred } from './alfred.js';
import { initStatements } from './statements.js';
import './widows.js';

const alfreds = Object.fromEntries(
	[...document.querySelectorAll('[data-alfred]')].map((svg) => [
		svg.dataset.alfred,
		createAlfred(svg),
	])
);

// The expression buttons under Alfred: each plays one face.
for (const button of document.querySelectorAll('[data-express]')) {
	button.addEventListener('click', () => {
		alfreds.hero.express(button.dataset.express);
	});
}

initStatements();
