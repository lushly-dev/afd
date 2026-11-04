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

/** Take a part's app elements out, keeping where they were scrolled to; `parked` stays when it has none. */
export function park(part: HTMLElement, parked: Parked | undefined): Parked | undefined {
	const body = part.shadowRoot?.querySelector('.body');
	const elements = [...part.children].filter(
		(child) => child.getAttribute('slot') !== 'handle' && child.localName !== 'loam-empty-state'
	) as HTMLElement[];
	if (elements.length === 0) return parked;
	const scroll = elements.flatMap((element) => scrollOffsets(element));
	const offset = body?.scrollTop ?? 0;
	for (const element of elements) element.remove();
	return { elements, scroll, body: offset };
}

/** Put a parked part back where it was, once it renders, unless what asked has gone stale. */
export async function restore(
	part: HTMLElement,
	parked: Parked,
	next: () => Promise<unknown>,
	stale: () => boolean
): Promise<void> {
	part.prepend(...parked.elements);
	await next();
	if (stale()) return;
	const body = part.shadowRoot?.querySelector('.body');
	if (body) body.scrollTop = parked.body;
	for (const [element, top, left] of parked.scroll) {
		element.scrollTop = top;
		element.scrollLeft = left;
	}
}
