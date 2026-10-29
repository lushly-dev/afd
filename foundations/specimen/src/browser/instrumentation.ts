import { observeHtmlConstruction } from './html-observation.js';

/** Early shadow-root instrumentation, installed before any specimen module loads. */
export interface CaptureInstrumentation {
	closedHosts: WeakSet<Element>;
	limitations: readonly string[];
	setMotionMode(mode: 'natural' | 'settled'): void;
}

const motionRules = `*, *::before, *::after {
	animation-duration: 0s !important;
	animation-delay: 0s !important;
	transition-duration: 0s !important;
	transition-delay: 0s !important;
	scroll-behavior: auto !important;
	--duration-fast: 0ms !important;
	--duration-base: 0ms !important;
	--duration-slow: 0ms !important;
}`;

export function installInstrumentation(): CaptureInstrumentation {
	const closedHosts = new WeakSet<Element>();
	const limitations = observeHtmlConstruction();
	const shadowRoots = new Set<ShadowRoot>();
	const fallbackStyles = new Map<Document | ShadowRoot, HTMLStyleElement>();
	const motionSheet = new CSSStyleSheet();
	motionSheet.replaceSync(motionRules);
	let mode: 'natural' | 'settled' = 'natural';

	function apply(root: Document | ShadowRoot): void {
		if (Array.isArray(root.adoptedStyleSheets)) {
			const existing = root.adoptedStyleSheets.filter((sheet) => sheet !== motionSheet);
			root.adoptedStyleSheets = mode === 'settled' ? [...existing, motionSheet] : existing;
			return;
		}
		const old = fallbackStyles.get(root);
		old?.remove();
		fallbackStyles.delete(root);
		if (mode === 'settled') {
			const style = document.createElement('style');
			style.dataset.specimenMotion = 'settled';
			style.textContent = motionRules;
			if (root instanceof Document) root.head.append(style);
			else root.append(style);
			fallbackStyles.set(root, style);
		}
	}

	const original = Element.prototype.attachShadow;
	Element.prototype.attachShadow = function (options: ShadowRootInit): ShadowRoot {
		const root = original.call(this, options);
		shadowRoots.add(root);
		if (options.mode === 'closed') closedHosts.add(this);
		apply(root);
		return root;
	};

	return {
		closedHosts,
		limitations,
		setMotionMode(next) {
			mode = next;
			apply(document);
			for (const root of shadowRoots) apply(root);
		},
	};
}
