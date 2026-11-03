/** @fileoverview What the app surfaces keep of a parked sidebar or panel (phase 1 specification, 4.2). */

/** What an element keeps of its scrollers while it is parked, through open shadow roots. */
export type ScrollOffsets = Array<[Element, number, number]>;

export function scrollOffsets(root: Element, found: ScrollOffsets = []): ScrollOffsets {
	if (root.scrollTop !== 0 || root.scrollLeft !== 0) {
		found.push([root, root.scrollTop, root.scrollLeft]);
	}
	for (const child of root.children) scrollOffsets(child, found);
	if (root.shadowRoot) for (const child of root.shadowRoot.children) scrollOffsets(child, found);
	return found;
}

/** A parked sidebar or panel: its elements, kept, and where they were scrolled to. */
export interface Parked {
	elements: HTMLElement[];
	scroll: ScrollOffsets;
	body: number;
}
