/**
 * @fileoverview What the parts ask the shell to do. Parts hold no kernel; they dispatch a
 * `loam-action` event, and `loam-shell` turns it into a command.
 */

export type ChromeAction =
	| { action: 'palette-open' }
	| { action: 'toggle'; part: 'sidebar' | 'inspector' | 'panel' }
	| { action: 'close'; part: 'sidebar' | 'inspector' | 'panel' }
	| { action: 'maximize'; maximized: boolean }
	| { action: 'sign-in' }
	| { action: 'sign-out' };

export const ACTION_EVENT = 'loam-action';

export function dispatchAction(target: EventTarget, detail: ChromeAction): void {
	target.dispatchEvent(new CustomEvent(ACTION_EVENT, { detail, bubbles: true, composed: true }));
}

/** The focused element, through open shadow roots. */
export function deepActiveElement(doc: Document = document): Element | null {
	let active = doc.activeElement;
	while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
	return active;
}
