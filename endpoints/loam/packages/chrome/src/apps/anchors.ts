/**
 * @fileoverview Finding a popover's anchor (phase 4 specification, 6.3): an element with `data-loam-anchor` inside the
 * owner's own surface, through open shadow roots. What another app, a view's frame or the shell's chrome holds is never
 * an app's anchor, so nothing an app shows can sit on what the shell drew, and a hidden element anchors nothing.
 */

/** Whether `value` names an anchor the kernel took: the pattern `popover-open` validates, so a selector needs no escape. */
const ANCHOR = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * The first shown element under `root` with `data-loam-anchor="<value>"`, searching open shadow roots, and never
 * inside an element `skip` refuses (an app's mount, from the shell's own surface). Null when there is none.
 */
export function findAnchor(
	root: ParentNode,
	value: string,
	skip: (element: Element) => boolean = () => false
): HTMLElement | null {
	if (!ANCHOR.test(value)) return null;
	const selector = `[data-loam-anchor="${value}"]`;
	// By children, so a skipped element's whole subtree, its light DOM and its shadow root, is left out.
	const visit = (node: ParentNode): HTMLElement | null => {
		for (const element of node.children) {
			if (skip(element)) continue;
			if (element.matches(selector) && shown(element)) return element as HTMLElement;
			const inner = (element.shadowRoot && visit(element.shadowRoot)) || visit(element);
			if (inner) return inner;
		}
		return null;
	};
	return visit(root);
}

/** Whether a person could see it: connected, laid out, not hidden or inert. */
function shown(element: Element): boolean {
	if (!element.isConnected || (element as HTMLElement).closest?.('[inert]')) return false;
	const check = (element as { checkVisibility?: () => boolean }).checkVisibility;
	return check ? check.call(element) : true;
}
