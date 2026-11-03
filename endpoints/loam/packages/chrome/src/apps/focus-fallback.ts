/** @fileoverview Where focus goes when what held it has gone (design.md, "Focus"). */

import { Updates } from '@lushly-dev/fast-element';
import { focusPart } from '../elements/focus.js';
import type { LoamShell } from '../elements/shell.js';

/**
 * Main's `h1`, wherever it is once the next update has rendered: the landing's, or what an app or a section
 * renders; main itself when it has none. Where a person's own choice left an app (phase 2 specification,
 * 7.8): the switcher's list, and the status bar's project item.
 */
export function focusMainHeading(shell: LoamShell | null): void {
	const main = shell?.shadowRoot?.querySelector<HTMLElement>('loam-main');
	void Updates.next().then(() => {
		const heading =
			main?.querySelector<HTMLElement>('h1') ?? main?.shadowRoot?.querySelector<HTMLElement>('h1');
		if (!heading) {
			main?.focus();
			return;
		}
		heading.tabIndex = -1;
		heading.focus();
	});
}

/** Main, or the panel when a maximized panel has made main inert, and `focus()` would do nothing. */
export function focusFallback(shell: LoamShell): void {
	const main = shell.shadowRoot?.querySelector<HTMLElement>('loam-main');
	const target = main?.inert ? shell.shadowRoot?.querySelector<HTMLElement>('loam-panel') : main;
	if (target) focusPart(target);
}
