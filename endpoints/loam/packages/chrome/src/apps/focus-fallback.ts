/** @fileoverview Where focus goes when what held it has gone (design.md, "Focus"). */

import { focusPart } from '../elements/focus.js';
import type { LoamShell } from '../elements/shell.js';

/** Main, or the panel when a maximized panel has made main inert, and `focus()` would do nothing. */
export function focusFallback(shell: LoamShell): void {
	const main = shell.shadowRoot?.querySelector<HTMLElement>('loam-main');
	const target = main?.inert ? shell.shadowRoot?.querySelector<HTMLElement>('loam-panel') : main;
	if (target) focusPart(target);
}
