import { observeHtmlConstruction } from './html-observation.js';

/** Early shadow-root instrumentation, installed before any specimen module loads. */
export interface CaptureInstrumentation {
	closedHosts: WeakSet<Element>;
	limitations: readonly string[];
	setMotionMode(mode: 'natural' | 'settled'): void;
}

// Violet's motion tokens (violet-elements' token interface 4 names them `--violet-duration-*`),
// and the unprefixed names components before that interface read.
const motionRules = `*, *::before, *::after {
	animation-duration: 0s !important;
	animation-delay: 0s !important;
	transition-duration: 0s !important;
	transition-delay: 0s !important;
	scroll-behavior: auto !important;
	--violet-duration-fast: 0ms !important;
	--violet-duration-base: 0ms !important;
	--violet-duration-slow: 0ms !important;
	--duration-fast: 0ms !important;
	--duration-base: 0ms !important;
	--duration-slow: 0ms !important;
}`;

export function installInstrumentation(): CaptureInstrumentation {
	const closedHosts = new WeakSet<Element>();
	const limitations = observeHtmlConstruction();
	const trackedRoots = new WeakSet<ShadowRoot>();
	const shadowRoots = new Set<WeakRef<ShadowRoot>>();
	const fallbackStyles = new WeakMap<Document | ShadowRoot, HTMLStyleElement>();
	const motionSheets = new WeakMap<Document, CSSStyleSheet>();
	const managedSheets = new WeakSet<CSSStyleSheet>();
	let mode: 'natural' | 'settled' = 'natural';

	function trackShadowRoot(root: ShadowRoot): void {
		if (trackedRoots.has(root)) return;
		trackedRoots.add(root);
		shadowRoots.add(new WeakRef(root));
	}

	function discoverOpenShadowRoots(start: Document | Element | ShadowRoot): void {
		const stack: (Document | Element | ShadowRoot)[] = [start];
		while (stack.length > 0) {
			const current = stack.pop();
			if (!current) continue;
			const shadow = 'shadowRoot' in current ? current.shadowRoot : null;
			if (shadow) {
				trackShadowRoot(shadow);
				stack.push(shadow);
			}
			const children = current.children;
			if (children) {
				for (let index = children.length - 1; index >= 0; index--) {
					const child = children[index];
					if (child) stack.push(child);
				}
			}
		}
	}

	function ownerDocumentOf(root: Document | ShadowRoot): Document | null {
		return root.ownerDocument ?? (root.nodeType === 9 ? (root as Document) : null);
	}

	function motionSheetFor(ownerDocument: Document | null): CSSStyleSheet | null {
		if (!ownerDocument) return null;
		const view = ownerDocument.defaultView;
		const SheetCtor =
			view?.CSSStyleSheet ?? (ownerDocument === document ? globalThis.CSSStyleSheet : undefined);
		if (typeof SheetCtor !== 'function') return null;
		const cached = motionSheets.get(ownerDocument);
		if (cached) return cached;
		try {
			const sheet = new SheetCtor();
			sheet.replaceSync(motionRules);
			motionSheets.set(ownerDocument, sheet);
			managedSheets.add(sheet);
			return sheet;
		} catch {
			return null;
		}
	}

	function removeFallback(root: Document | ShadowRoot): void {
		const old = fallbackStyles.get(root);
		if (!old) return;
		old.remove();
		fallbackStyles.delete(root);
	}

	function removeManagedSheets(root: Document | ShadowRoot, current: CSSStyleSheet[]): void {
		const existing = current.filter((sheet) => !managedSheets.has(sheet));
		if (existing.length === current.length) return;
		try {
			root.adoptedStyleSheets = existing;
			return;
		} catch {
			// Fall back to removing managed entries in place when reassignment is rejected.
		}
		try {
			for (let index = current.length - 1; index >= 0; index--) {
				const sheet = current[index];
				if (sheet && managedSheets.has(sheet)) current.splice(index, 1);
			}
		} catch {
			// Detached or read-only adoptedStyleSheets list.
		}
	}

	function apply(root: Document | ShadowRoot): void {
		removeFallback(root);
		const ownerDocument = ownerDocumentOf(root);

		if (Array.isArray(root.adoptedStyleSheets)) {
			const current = root.adoptedStyleSheets;
			const existing = current.filter((sheet) => !managedSheets.has(sheet));
			if (mode === 'natural') {
				removeManagedSheets(root, current);
				return;
			}
			const sheet = motionSheetFor(ownerDocument);
			if (sheet) {
				try {
					root.adoptedStyleSheets = [...existing, sheet];
					return;
				} catch {
					// Cross-document or non-adoptable stylesheet; strip any stale managed sheet and fall back.
				}
			}
			removeManagedSheets(root, current);
		}

		if (mode !== 'settled') return;
		// Documents without a browsing context (such as document.implementation.createHTMLDocument(''))
		// do not render or animate; skip mutating their DOM until a host is adopted into a live document.
		if (!ownerDocument || (!ownerDocument.defaultView && ownerDocument !== document)) return;

		const style = ownerDocument.createElement('style');
		style.dataset.specimenMotion = 'settled';
		style.textContent = motionRules;
		if (root.nodeType === 9) {
			((root as Document).head ?? (root as Document).documentElement)?.append(style);
		} else {
			root.append(style);
		}
		fallbackStyles.set(root, style);
	}

	const original = Element.prototype.attachShadow;
	Element.prototype.attachShadow = function (options: ShadowRootInit): ShadowRoot {
		const root = original.call(this, options);
		trackShadowRoot(root);
		if (options.mode === 'closed') closedHosts.add(this);
		apply(root);
		return root;
	};

	return {
		closedHosts,
		limitations,
		setMotionMode(next) {
			mode = next;
			discoverOpenShadowRoots(document);
			apply(document);
			for (const ref of shadowRoots) {
				const root = ref.deref();
				if (!root) {
					shadowRoots.delete(ref);
					continue;
				}
				apply(root);
			}
		},
	};
}
