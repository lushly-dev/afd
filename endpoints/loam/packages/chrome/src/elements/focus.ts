/**
 * @fileoverview Keyboard focus inside a modal: the tabbable elements of a subtree through open
 * shadow roots and slots, in tree order, and wrapping Tab at either end. Chromium lets Tab leave a
 * modal `<dialog>` for the browser's own interface, so a drawer traps it itself (E5).
 */

const TABBABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

function visible(element: HTMLElement): boolean {
	return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
}

/** The tabbable elements under `root`, in tree order, entering open shadow roots and slots. */
export function tabbables(root: Node): HTMLElement[] {
	const found: HTMLElement[] = [];
	const visit = (node: Node) => {
		if (node instanceof HTMLElement) {
			if (node.hidden || node.inert) return;
			if (node.matches(TABBABLE) && node.tabIndex >= 0 && visible(node)) found.push(node);
			if (node instanceof HTMLSlotElement) {
				for (const assigned of node.assignedElements({ flatten: true })) visit(assigned);
				return;
			}
			if (node.shadowRoot) {
				for (const child of node.shadowRoot.children) visit(child);
				return;
			}
		}
		for (const child of node.childNodes) visit(child);
	};
	visit(root);
	return found;
}

/** The focused element, through open shadow roots. */
function active(doc: Document): Element | null {
	let element = doc.activeElement;
	while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
	return element;
}

/** Keep Tab and Shift+Tab inside `container`, wrapping at either end. */
export function trapTab(event: KeyboardEvent, container: Node): void {
	if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
	const list = tabbables(container);
	const first = list[0];
	const last = list.at(-1);
	if (!first || !last) {
		event.preventDefault();
		return;
	}
	const current = active(container.ownerDocument ?? document);
	if (event.shiftKey && (current === first || !list.includes(current as HTMLElement))) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && (current === last || !list.includes(current as HTMLElement))) {
		event.preventDefault();
		first.focus();
	}
}
