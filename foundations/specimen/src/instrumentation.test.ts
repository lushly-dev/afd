import { afterEach, describe, expect, it } from 'vitest';
import { installInstrumentation } from './browser/instrumentation.js';

interface FakeNode {
	parent?: FakeContainer | null;
	remove?(): void;
}

interface FakeStyleElement extends FakeNode {
	dataset: Record<string, string>;
	textContent: string;
	parent: FakeContainer | null;
	remove(): void;
}

interface FakeContainer {
	children: FakeNode[];
	append(node: FakeNode): void;
}

class FakeSheet {
	readonly ownerDocument: FakeDocument;
	cssText = '';
	constructor(ownerDocument: FakeDocument) {
		this.ownerDocument = ownerDocument;
	}
	replaceSync(text: string): void {
		this.cssText = text;
	}
}

function makeStyleSheetCtor(
	ownerDocument: FakeDocument,
	options: { throwOnConstruct?: boolean } = {}
): new () => FakeSheet {
	return class BoundCSSStyleSheet extends FakeSheet {
		constructor() {
			if (options.throwOnConstruct) throw new Error('CSSStyleSheet unavailable');
			super(ownerDocument);
		}
	};
}

class FakeShadowRoot implements FakeContainer {
	readonly nodeType = 11;
	ownerDocument: FakeDocument;
	children: FakeNode[] = [];
	throwOnAdopt = false;
	#adopted: FakeSheet[] | undefined;

	constructor(ownerDocument: FakeDocument, supportsAdopted = true) {
		this.ownerDocument = ownerDocument;
		this.#adopted = supportsAdopted ? [] : undefined;
	}

	get adoptedStyleSheets(): FakeSheet[] | undefined {
		return this.#adopted;
	}

	set adoptedStyleSheets(sheets: FakeSheet[] | undefined) {
		if (this.throwOnAdopt) {
			throw new DOMException('Cannot assign adoptedStyleSheets', 'NotAllowedError');
		}
		if (!Array.isArray(sheets)) {
			this.#adopted = sheets;
			return;
		}
		for (const sheet of sheets) {
			if (sheet.ownerDocument !== this.ownerDocument) {
				throw new DOMException(
					"Failed to set the 'adoptedStyleSheets' property on 'ShadowRoot': Sharing constructed stylesheets in multiple documents is not allowed",
					'NotAllowedError'
				);
			}
		}
		this.#adopted = [...sheets];
	}

	append(node: FakeNode): void {
		node.parent = this;
		this.children.push(node);
	}
}

class FakeDocument implements FakeContainer {
	readonly nodeType = 9;
	readonly ownerDocument = null;
	defaultView: { CSSStyleSheet?: new () => FakeSheet } | null;
	readonly head: FakeContainer;
	readonly children: FakeNode[] = [];
	#adopted: FakeSheet[] | undefined;

	constructor(
		options: {
			defaultView?: boolean;
			hasSheetCtor?: boolean;
			throwOnConstruct?: boolean;
			adopted?: boolean;
		} = {}
	) {
		const hasView = options.defaultView ?? true;
		const hasSheetCtor = options.hasSheetCtor ?? true;
		this.defaultView = hasView
			? {
					CSSStyleSheet: hasSheetCtor
						? makeStyleSheetCtor(this, { throwOnConstruct: options.throwOnConstruct })
						: undefined,
				}
			: null;
		this.#adopted = (options.adopted ?? true) ? [] : undefined;
		this.head = {
			children: [],
			append(node) {
				node.parent = this;
				this.children.push(node);
			},
		};
	}

	append(node: FakeNode): void {
		node.parent = this;
		this.children.push(node);
	}

	get adoptedStyleSheets(): FakeSheet[] | undefined {
		return this.#adopted;
	}

	set adoptedStyleSheets(sheets: FakeSheet[] | undefined) {
		if (!Array.isArray(sheets)) {
			this.#adopted = sheets;
			return;
		}
		for (const sheet of sheets) {
			if (sheet.ownerDocument !== this) {
				throw new DOMException(
					"Failed to set the 'adoptedStyleSheets' property on 'Document': Sharing constructed stylesheets in multiple documents is not allowed",
					'NotAllowedError'
				);
			}
		}
		this.#adopted = [...sheets];
	}

	createElement(tag: string): FakeStyleElement {
		if (tag !== 'style') throw new Error(`Unexpected tag: ${tag}`);
		return {
			dataset: {},
			textContent: '',
			parent: null,
			remove() {
				if (!this.parent) return;
				const index = this.parent.children.indexOf(this);
				if (index >= 0) this.parent.children.splice(index, 1);
				this.parent = null;
			},
		};
	}
}

interface FakeElementInstance extends FakeContainer, FakeNode {
	ownerDocument: FakeDocument;
	readonly supportsAdopted: boolean;
	shadowRoot: FakeShadowRoot | null;
	attachShadow(options: ShadowRootInit): FakeShadowRoot;
}

function createElementClass(): new (
	ownerDocument: FakeDocument,
	supportsAdopted?: boolean
) => FakeElementInstance {
	return class RealmElement implements FakeElementInstance {
		ownerDocument: FakeDocument;
		readonly supportsAdopted: boolean;
		shadowRoot: FakeShadowRoot | null = null;
		children: FakeNode[] = [];
		parent: FakeContainer | null = null;

		constructor(ownerDocument: FakeDocument, supportsAdopted = true) {
			this.ownerDocument = ownerDocument;
			this.supportsAdopted = supportsAdopted;
		}

		attachShadow(options: ShadowRootInit): FakeShadowRoot {
			const root = new FakeShadowRoot(this.ownerDocument, this.supportsAdopted);
			this.shadowRoot = options.mode === 'open' ? root : null;
			return root;
		}

		append(node: FakeNode): void {
			node.parent = this;
			this.children.push(node);
		}
	};
}

const GLOBAL_KEYS = [
	'Element',
	'ShadowRoot',
	'Document',
	'DOMParser',
	'Range',
	'CSSStyleSheet',
	'document',
] as const;

const savedDescriptors = new Map<string, PropertyDescriptor | undefined>();

function installFakeDom(
	primary: FakeDocument
): new (
	ownerDocument: FakeDocument,
	supportsAdopted?: boolean
) => FakeElementInstance {
	for (const key of GLOBAL_KEYS) {
		if (!savedDescriptors.has(key)) {
			savedDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		}
	}
	const PrimaryElement = createElementClass();
	class FakeDOMParser {}
	class FakeRange {}
	Object.assign(globalThis, {
		Element: PrimaryElement,
		ShadowRoot: FakeShadowRoot,
		Document: FakeDocument,
		DOMParser: FakeDOMParser,
		Range: FakeRange,
		CSSStyleSheet: primary.defaultView?.CSSStyleSheet,
		document: primary,
	});
	return PrimaryElement;
}

afterEach(() => {
	for (const [key, descriptor] of savedDescriptors.entries()) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else Reflect.deleteProperty(globalThis, key);
	}
	savedDescriptors.clear();
});

describe('installInstrumentation multi-document motion settling', () => {
	it('does not throw on inert secondary-document shadow roots and settles them once adopted', () => {
		const primary = new FakeDocument();
		const inert = new FakeDocument({ defaultView: false });
		const FakeElement = installFakeDom(primary);

		const instrumentation = installInstrumentation();
		instrumentation.setMotionMode('settled');

		const primaryHost = new FakeElement(primary);
		const primaryRoot = primaryHost.attachShadow({ mode: 'open' });
		expect(primary.adoptedStyleSheets).toHaveLength(1);
		expect(primaryRoot.adoptedStyleSheets).toHaveLength(1);
		expect(primaryRoot.adoptedStyleSheets?.[0]).toBe(primary.adoptedStyleSheets?.[0]);

		// Secondary inert document (e.g. document.implementation.createHTMLDocument('')) has defaultView === null.
		const inertHost = new FakeElement(inert);
		const inertRoot = inertHost.attachShadow({ mode: 'open' });
		expect(inertRoot.adoptedStyleSheets).toEqual([]);
		expect(inertRoot.children).toEqual([]);

		// Re-applying settled while still inert must remain silent and clean.
		expect(() => instrumentation.setMotionMode('settled')).not.toThrow();
		expect(inertRoot.adoptedStyleSheets).toEqual([]);
		expect(inertRoot.children).toEqual([]);

		// Once adopted into the primary document, the next setMotionMode('settled') settles it.
		inertHost.ownerDocument = primary;
		inertRoot.ownerDocument = primary;
		instrumentation.setMotionMode('settled');
		expect(inertRoot.adoptedStyleSheets).toHaveLength(1);
		expect(inertRoot.adoptedStyleSheets?.[0]).toBe(primary.adoptedStyleSheets?.[0]);

		// Returning to natural cleans up primary and adopted shadow roots.
		instrumentation.setMotionMode('natural');
		expect(primary.adoptedStyleSheets).toEqual([]);
		expect(primaryRoot.adoptedStyleSheets).toEqual([]);
		expect(inertRoot.adoptedStyleSheets).toEqual([]);
	});

	it('creates per-document CSSStyleSheet instances for live secondary documents and cleans up on adoption and detach', () => {
		const primary = new FakeDocument();
		const iframeDoc = new FakeDocument({ defaultView: true });
		const FakeElement = installFakeDom(primary);

		const instrumentation = installInstrumentation();
		const IframeSheetCtor = iframeDoc.defaultView?.CSSStyleSheet;
		if (!IframeSheetCtor) throw new Error('Expected secondary document CSSStyleSheet constructor');
		const existingIframeSheet = new IframeSheetCtor();
		const host = new FakeElement(iframeDoc);
		const root = host.attachShadow({ mode: 'open' });
		root.adoptedStyleSheets = [existingIframeSheet];

		instrumentation.setMotionMode('settled');
		expect(root.adoptedStyleSheets).toHaveLength(2);
		expect(root.adoptedStyleSheets?.[0]).toBe(existingIframeSheet);
		const iframeMotionSheet = root.adoptedStyleSheets?.[1];
		expect(iframeMotionSheet?.ownerDocument).toBe(iframeDoc);
		expect(iframeMotionSheet).not.toBe(primary.adoptedStyleSheets?.[0]);

		// Second shadow root in the same secondary document reuses the cached per-document sheet.
		const secondHost = new FakeElement(iframeDoc);
		const secondRoot = secondHost.attachShadow({ mode: 'open' });
		expect(secondRoot.adoptedStyleSheets?.[0]).toBe(iframeMotionSheet);

		// Adopting a settled secondary-document shadow root into the primary document replaces its sheet cleanly.
		secondHost.ownerDocument = primary;
		secondRoot.ownerDocument = primary;
		instrumentation.setMotionMode('settled');
		expect(secondRoot.adoptedStyleSheets).toEqual([primary.adoptedStyleSheets?.[0]]);

		// Detaching the iframe (defaultView becomes null) still lets natural mode remove the managed sheet cleanly.
		iframeDoc.defaultView = null;
		expect(() => instrumentation.setMotionMode('natural')).not.toThrow();
		expect(root.adoptedStyleSheets).toEqual([existingIframeSheet]);
		expect(secondRoot.adoptedStyleSheets).toEqual([]);
	});

	it('discovers and settles open shadow roots created on an unpatched iframe Element prototype once adopted into document', () => {
		const primary = new FakeDocument();
		const iframeDoc = new FakeDocument({ defaultView: true });
		installFakeDom(primary);

		const instrumentation = installInstrumentation();
		// Separate realm prototype, never patched by installInstrumentation().
		const IframeElement = createElementClass();
		const iframeHost = new IframeElement(iframeDoc);
		const iframeRoot = iframeHost.attachShadow({ mode: 'open' });
		const nestedHost = new IframeElement(iframeDoc);
		const nestedRoot = nestedHost.attachShadow({ mode: 'open' });
		iframeRoot.append(nestedHost);

		// Adopt into primary document.
		iframeHost.ownerDocument = primary;
		iframeRoot.ownerDocument = primary;
		nestedHost.ownerDocument = primary;
		nestedRoot.ownerDocument = primary;
		primary.append(iframeHost);

		instrumentation.setMotionMode('settled');
		expect(iframeRoot.adoptedStyleSheets).toEqual([primary.adoptedStyleSheets?.[0]]);
		expect(nestedRoot.adoptedStyleSheets).toEqual([primary.adoptedStyleSheets?.[0]]);

		// Even after detaching from document (as dispose() does before setMotionMode('natural')),
		// previously discovered roots are still restored cleanly.
		primary.children.length = 0;
		instrumentation.setMotionMode('natural');
		expect(iframeRoot.adoptedStyleSheets).toEqual([]);
		expect(nestedRoot.adoptedStyleSheets).toEqual([]);
	});

	it('falls back to a removable style element when adoptedStyleSheets or CSSStyleSheet is unavailable in a live document', () => {
		const primary = new FakeDocument({ hasSheetCtor: false, adopted: false });
		const FakeElement = installFakeDom(primary);

		const instrumentation = installInstrumentation();
		const closedHost = new FakeElement(primary, false);
		const closedRoot = closedHost.attachShadow({ mode: 'closed' });
		expect(instrumentation.closedHosts.has(closedHost as unknown as Element)).toBe(true);

		instrumentation.setMotionMode('settled');
		expect(primary.head.children).toHaveLength(1);
		expect((primary.head.children[0] as FakeStyleElement).dataset.specimenMotion).toBe('settled');
		expect(closedRoot.children).toHaveLength(1);
		expect((closedRoot.children[0] as FakeStyleElement).dataset.specimenMotion).toBe('settled');

		instrumentation.setMotionMode('natural');
		expect(primary.head.children).toEqual([]);
		expect(closedRoot.children).toEqual([]);
	});

	it('falls back cleanly when CSSStyleSheet construction or adoption throws and still removes managed sheets on natural', () => {
		const primary = new FakeDocument({ throwOnConstruct: true, adopted: true });
		const FakeElement = installFakeDom(primary);

		const instrumentation = installInstrumentation();
		const host = new FakeElement(primary);
		const root = host.attachShadow({ mode: 'open' });

		instrumentation.setMotionMode('settled');
		expect(primary.head.children).toHaveLength(1);
		expect(root.children).toHaveLength(1);
		expect((root.children[0] as FakeStyleElement).dataset.specimenMotion).toBe('settled');

		// Once CSSStyleSheet works again on a live root, fallback <style> is removed before adopting.
		const PrimarySheetCtor = makeStyleSheetCtor(primary);
		primary.defaultView = { CSSStyleSheet: PrimarySheetCtor };
		const appSheet = new PrimarySheetCtor();
		root.adoptedStyleSheets = [appSheet];
		instrumentation.setMotionMode('settled');
		expect(primary.head.children).toEqual([]);
		expect(root.children).toEqual([]);
		expect(root.adoptedStyleSheets).toHaveLength(2);
		expect(root.adoptedStyleSheets?.[0]).toBe(appSheet);

		// If adoptedStyleSheets reassignment throws while a managed sheet is present,
		// direct natural restoration removes the managed sheet in place while keeping appSheet.
		root.throwOnAdopt = true;
		instrumentation.setMotionMode('natural');
		expect(root.children).toEqual([]);
		expect(root.adoptedStyleSheets).toEqual([appSheet]);

		// Re-settling while reassignment throws falls back to <style> and cleans up on natural.
		instrumentation.setMotionMode('settled');
		expect(root.adoptedStyleSheets).toEqual([appSheet]);
		expect(root.children).toHaveLength(1);
		instrumentation.setMotionMode('natural');
		expect(root.children).toEqual([]);
		expect(root.adoptedStyleSheets).toEqual([appSheet]);
	});
});

describe('installInstrumentation settled motion rules', () => {
	it("zeroes Violet's motion tokens under the violet- prefix and the unprefixed names (#1786)", () => {
		const primary = new FakeDocument({ defaultView: true });
		installFakeDom(primary);
		installInstrumentation().setMotionMode('settled');
		const sheet = primary.adoptedStyleSheets?.[0] as FakeSheet | undefined;
		for (const step of ['fast', 'base', 'slow']) {
			expect(sheet?.cssText).toContain(`--violet-duration-${step}: 0ms !important;`);
			expect(sheet?.cssText).toContain(`--duration-${step}: 0ms !important;`);
		}
	});
});
