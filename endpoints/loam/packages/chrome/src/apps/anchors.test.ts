/**
 * A popover's anchor search (phase 4 specification, 6.3; the step 3 re-check's B1): below the owner's own mount, never
 * inside another surface it holds, another app's embed or mount or a view's frame, and never on a hidden element.
 */
import { describe, expect, it } from 'vitest';
import { anchorOwnerOf, findAnchor, nestedSurface } from './anchors.js';

interface Fake {
	localName: string;
	children: Fake[];
	shadowRoot: { children: Fake[] } | null;
	isConnected: boolean;
	anchor?: string;
	hidden?: boolean;
	matches(selector: string): boolean;
	closest(): null;
	checkVisibility(): boolean;
}

/** An element: `name`, its `data-loam-anchor`, its children, and its open shadow root's. */
function el(
	name: string,
	options: { anchor?: string; children?: Fake[]; shadow?: Fake[]; hidden?: boolean } = {}
): Fake {
	return {
		localName: name,
		children: options.children ?? [],
		shadowRoot: options.shadow ? { children: options.shadow } : null,
		isConnected: true,
		...(options.anchor !== undefined ? { anchor: options.anchor } : {}),
		...(options.hidden ? { hidden: true } : {}),
		matches(selector) {
			return this.anchor !== undefined && selector === `[data-loam-anchor="${this.anchor}"]`;
		},
		closest: () => null,
		checkVisibility() {
			return this.hidden !== true;
		},
	};
}

const search = (root: Fake[], value: string, skip?: (element: Element) => boolean) =>
	findAnchor({ children: root } as unknown as ParentNode, value, skip) as unknown as Fake | null;

describe('findAnchor', () => {
	it('finds an anchor through open shadow roots, and in slotted light DOM', () => {
		const deep = el('button', { anchor: 'more' });
		const tree = [el('hello-main', { shadow: [el('div', { children: [deep] })] })];
		expect(search(tree, 'more')).toBe(deep);
		const slotted = el('span', { anchor: 'more' });
		expect(search([el('x-card', { children: [slotted], shadow: [] })], 'more')).toBe(slotted);
	});

	it("never reaches into another app's embed, mount or a view's frame below the owner's own", () => {
		for (const name of ['loam-embed', 'loam-mount', 'loam-view-frame']) {
			const foreign = el('button', { anchor: 'more' });
			const tree = [el('hello-main', { shadow: [el(name, { shadow: [foreign], children: [] })] })];
			expect(search(tree, 'more', nestedSurface), name).toBeNull();
			// Without the skip it would: what the search guards against.
			expect(search(tree, 'more'), name).toBe(foreign);
		}
	});

	it('takes a shown element only, and a value only of the pattern', () => {
		expect(search([el('button', { anchor: 'more', hidden: true })], 'more')).toBeNull();
		expect(search([el('button', { anchor: 'a b' })], 'a b')).toBeNull();
		expect(search([el('button', { anchor: 'more' })], 'less')).toBeNull();
	});
});

describe('anchorOwnerOf', () => {
	it("reads an app's popover by its owner line, which the shell's own never has", () => {
		expect(anchorOwnerOf({ owner: 'shell', from: { kind: 'app' } })).toEqual({
			kind: 'app',
			id: 'shell',
		});
		expect(anchorOwnerOf({ owner: 'shell' })).toEqual({ kind: 'shell', id: 'shell' });
	});
});
