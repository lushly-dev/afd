/**
 * @fileoverview Finding a popover's anchor (phase 4 specification, 6.3): an element with `data-loam-anchor` inside the
 * owner's own surface, through open shadow roots. What another app, a view's frame or the shell's chrome holds is never
 * an app's anchor, so nothing an app shows can sit on what the shell drew, and a hidden element anchors nothing.
 */

/** Whose a popover is, by kind, as the kernel's `overlayAnchors` asks: an instance id never passes for the shell. */
export interface AnchorOwner {
	kind: 'shell' | 'app';
	id: string;
}

/**
 * A popover's owner as the chrome reads it from the kernel's record: an app's always carries its owner line, which
 * the kernel sets and never sets on the shell's own (6.6), so the line, not the id, says which it is.
 */
export const anchorOwnerOf = (overlay: { owner: string; from?: { kind: string } }): AnchorOwner =>
	overlay.from?.kind === 'app'
		? { kind: 'app', id: overlay.owner }
		: { kind: 'shell', id: overlay.owner };

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
