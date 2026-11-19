/**
 * @fileoverview What the parts ask the shell to do. Parts hold no kernel; they dispatch a
 * `loam-action` event, and `loam-shell` turns it into a command.
 */

export type ChromeAction =
	| { action: 'palette-open' }
	/**
	 * The New button: its menu, with focus on its first item, or with `key` ArrowUp on its last (documents
	 * specification, 7; APG's menu button).
	 */
	| { action: 'new'; key?: string }
	| { action: 'toggle'; part: 'sidebar' | 'inspector' | 'panel' }
	| { action: 'close'; part: 'sidebar' | 'inspector' | 'panel' }
	| { action: 'maximize'; maximized: boolean }
	| { action: 'sign-in' }
	| { action: 'sign-out' }
	| { action: 'invitations' }
	/** A `provider` deployment's account button: the account menu (phase 3 specification, 5.1). */
	| { action: 'account-menu' }
	/** The title bar's inbox button: the inbox section (phase 4 specification, 10.3). */
	| { action: 'inbox' };

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

/** An answer the kernel accepted: the overlay and the result it closed with. */
export type AnsweredListener = (overlayId: string, result: string) => void;

const answered = new WeakMap<object, Set<AnsweredListener>>();

/** Hear the answers the kernel accepted for the shell `host`'s questions, as the editor's discard waits for its own. In
 * first paint, so neither the `surfaces` nor the `editor` chunk imports the other's (phase 4's step 4 review). */
export function hearAnswers(host: object, listener: AnsweredListener): () => void {
	const held = answered.get(host) ?? new Set();
	answered.set(host, held);
	held.add(listener);
	return () => held.delete(listener);
}

/** Tell `host`'s listeners an answer the kernel accepted; only the renderer, from `overlay-dismiss`'s result, does. */
export function tellAnswered(host: object, overlayId: string, result: string): void {
	for (const listener of [...(answered.get(host) ?? [])]) listener(overlayId, result);
}
