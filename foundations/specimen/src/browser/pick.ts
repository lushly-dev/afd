import { formatPointer, type PointerPin } from '../pointer.js';
import type { SpecimenContext } from '../types.js';
import {
	climbElement,
	domAccessibleNameOf,
	domRoleOf,
	elementRef,
	isDescendantOf,
	isElementNode,
	parentOrHost,
} from './climb-dom.js';

export interface PickControllerOptions {
	specimenId: string;
	context: SpecimenContext;
	defaults: SpecimenContext;
	checkpoint?: string | null;
	frame: HTMLIFrameElement;
	viewport: HTMLElement;
	currentViewport: () => { width: number; height: number };
}

function clampUnit(value: number): number {
	return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function truncate(text: string, limit: number): string {
	const chars = Array.from(text);
	return chars.length <= limit ? text : `${chars.slice(0, limit - 1).join('')}…`;
}

function elementTextHint(element: Element): string {
	const parts: string[] = [];
	const visit = (node: Node): void => {
		if (node.nodeType === 3) {
			parts.push(node.textContent ?? '');
			return;
		}
		if (!isElementNode(node)) return;
		if (node.getAttribute('aria-hidden') === 'true') return;
		if (node.localName === 'style' || node.localName === 'script') return;
		if (node.shadowRoot) {
			for (const child of node.shadowRoot.childNodes) visit(child);
		}
		for (const child of node.childNodes) visit(child);
	};
	visit(element);
	return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function labelFor(
	element: Element,
	root: Element,
	accessible?: { role?: string; name?: string }
): string {
	if (accessible?.name) return truncate(accessible.name, 28);
	const role = domRoleOf(element);
	const name = domAccessibleNameOf(element, role);
	if (name) return truncate(name, 28);
	if (role) return role;
	if (element.localName.includes('-')) {
		const climbed = climbElement(element, root);
		if (climbed.accessible?.name) return truncate(climbed.accessible.name, 28);
		if (climbed.accessible?.role) return climbed.accessible.role;
	}
	return element.localName;
}

function deepElementFromPoint(doc: Document, x: number, y: number, root: Element): Element | null {
	let hit = doc.elementFromPoint(x, y);
	if (!hit) return null;
	while (hit.shadowRoot) {
		const inner = hit.shadowRoot.elementFromPoint(x, y);
		if (!inner || inner === hit) break;
		hit = inner;
	}
	return hit !== root && isDescendantOf(hit, root) ? hit : null;
}

function hitFromEvent(event: MouseEvent, doc: Document, root: Element): Element | null {
	if (event.clientX !== 0 || event.clientY !== 0) {
		const pointed = deepElementFromPoint(doc, event.clientX, event.clientY, root);
		if (pointed) return pointed;
	}
	for (const target of event.composedPath()) {
		if (isElementNode(target) && target !== root && isDescendantOf(target, root)) {
			return target;
		}
	}
	return null;
}

function copyText(text: string): Promise<boolean> {
	if (navigator.clipboard?.writeText) {
		return navigator.clipboard.writeText(text).then(
			() => true,
			() => fallbackCopy(text)
		);
	}
	return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text: string): boolean {
	const area = document.createElement('textarea');
	area.value = text;
	area.setAttribute('readonly', '');
	area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
	document.body.append(area);
	area.select();
	try {
		return document.execCommand('copy');
	} finally {
		area.remove();
	}
}

/**
 * Install the static review page's Pick mode (Proposal §4.2):
 * click to climb, click inside to step deeper, click outside to start fresh, modifier-click for
 * deepest, Escape for parent, outline overlay, breadcrumb path and Copy pointer button.
 */
export function createPickMode(options: PickControllerOptions): {
	toggle: HTMLButtonElement;
	panel: HTMLElement;
	syncOverlay(): void;
} {
	const { specimenId, context, defaults, checkpoint, frame, viewport, currentViewport } = options;

	const toggle = document.createElement('button');
	toggle.type = 'button';
	toggle.id = 'specimen-pick-toggle';
	toggle.className = 'specimen-pick-toggle';
	toggle.setAttribute('aria-pressed', 'false');
	toggle.textContent = 'Pick';

	const pathNav = document.createElement('nav');
	pathNav.className = 'specimen-pick-path';
	pathNav.setAttribute('aria-label', 'Selection path');

	const pointerCode = document.createElement('code');
	pointerCode.id = 'specimen-pick-pointer';
	pointerCode.className = 'specimen-pick-pointer';

	const copyButton = document.createElement('button');
	copyButton.type = 'button';
	copyButton.id = 'specimen-pick-copy';
	copyButton.textContent = 'Copy pointer';
	copyButton.disabled = true;

	const status = document.createElement('span');
	status.className = 'specimen-pick-status';
	status.setAttribute('role', 'status');
	status.setAttribute('aria-live', 'polite');

	const actions = document.createElement('div');
	actions.className = 'specimen-pick-actions';
	actions.append(pointerCode, copyButton, status);

	const panel = document.createElement('div');
	panel.id = 'specimen-pick-panel';
	panel.className = 'specimen-pick';
	panel.hidden = true;
	panel.append(pathNav, actions);

	const outline = document.createElement('div');
	outline.id = 'specimen-pick-outline';
	outline.className = 'specimen-pick-outline';
	outline.hidden = true;
	outline.setAttribute('aria-hidden', 'true');
	viewport.append(outline);

	let active = false;
	let selected: Element | null = null;
	let selectedAccessible: { role?: string; name?: string } | undefined;
	let selectedDepth: 'deepest' | undefined;
	let selectedPin: PointerPin | undefined;
	let currentPointer = '';
	let detachFrame: (() => void) | undefined;

	const frameRoot = (): Element | null =>
		frame.contentDocument?.querySelector('#specimen-root') ?? null;

	const buildContextParams = (): Record<string, string> => {
		const size = currentViewport();
		const params: Record<string, string> = {
			theme: context.theme,
			viewport: `${size.width}x${size.height}`,
		};
		if (context.locale !== defaults.locale) params.locale = context.locale;
		if (context.reducedMotion !== defaults.reducedMotion)
			params.reducedMotion = context.reducedMotion;
		if (context.motion !== defaults.motion) params.motion = context.motion;
		if (context.container) {
			params.container =
				context.container.height === undefined
					? String(context.container.width)
					: `${context.container.width}x${context.container.height}`;
		}
		return params;
	};

	const syncOverlay = (): void => {
		if (!active || !selected?.isConnected) {
			outline.hidden = true;
			return;
		}
		const rect = selected.getBoundingClientRect();
		outline.style.left = `${rect.left}px`;
		outline.style.top = `${rect.top}px`;
		outline.style.width = `${rect.width}px`;
		outline.style.height = `${rect.height}px`;
		outline.hidden = false;
	};

	const renderPanel = (focusCurrentCrumb = false): void => {
		const root = frameRoot();
		status.textContent = '';
		if (!active || !selected || !root || !selected.isConnected) {
			pathNav.textContent =
				'Click an element in the preview to select it. Alt-click for deepest; Escape for parent.';
			pointerCode.textContent = '';
			currentPointer = '';
			copyButton.disabled = true;
			outline.hidden = true;
			return;
		}

		// Build ancestor breadcrumb from top-level specimen element down to `selected`.
		const chain: Element[] = [];
		for (let cur: Element | null = selected; cur && cur !== root; cur = parentOrHost(cur)) {
			chain.push(cur);
		}
		chain.reverse();

		pathNav.replaceChildren();
		let currentCrumb: HTMLButtonElement | undefined;
		chain.forEach((el, index) => {
			if (index > 0) {
				const sep = document.createElement('span');
				sep.setAttribute('aria-hidden', 'true');
				sep.textContent = ' › ';
				pathNav.append(sep);
			}
			const crumb = document.createElement('button');
			crumb.type = 'button';
			crumb.className = 'specimen-pick-crumb';
			crumb.textContent = labelFor(el, root, el === selected ? selectedAccessible : undefined);
			if (el === selected) {
				crumb.setAttribute('aria-current', 'location');
				currentCrumb = crumb;
			}
			crumb.addEventListener('click', () => {
				selectElement(el, root, { forceDeepest: false, focusCrumb: true });
			});
			pathNav.append(crumb);
		});
		if (focusCurrentCrumb) currentCrumb?.focus();

		const ref = elementRef(selected, root);
		if (!ref) {
			pointerCode.textContent = '';
			currentPointer = '';
			copyButton.disabled = true;
			syncOverlay();
			return;
		}

		const role = domRoleOf(selected);
		const text =
			selectedAccessible?.name ??
			domAccessibleNameOf(selected, role) ??
			(selectedDepth === 'deepest' ? '' : elementTextHint(selected));

		currentPointer = formatPointer({
			specimen: specimenId,
			context: buildContextParams(),
			...(checkpoint ? { checkpoint } : {}),
			ref,
			...(text ? { text } : {}),
			...(selectedDepth ? { depth: selectedDepth } : {}),
			...(selectedPin ? { pin: selectedPin } : {}),
		});
		pointerCode.textContent = currentPointer;
		copyButton.disabled = false;
		syncOverlay();
	};

	const selectElement = (
		element: Element,
		root: Element,
		opts: {
			forceDeepest: boolean;
			accessible?: { role?: string; name?: string };
			pin?: PointerPin;
			focusCrumb?: boolean;
		}
	): void => {
		selected = element;
		const normal = climbElement(element, root);
		const needsDeepest = opts.forceDeepest || normal.element !== element;
		selectedDepth = needsDeepest ? 'deepest' : undefined;
		if (opts.accessible) {
			selectedAccessible = opts.accessible;
		} else if (!needsDeepest && normal.accessible) {
			selectedAccessible = normal.accessible;
		} else {
			const role = domRoleOf(element);
			const name = domAccessibleNameOf(element, role);
			selectedAccessible = role || name ? { role, name } : undefined;
		}
		selectedPin = opts.pin;
		renderPanel(opts.focusCrumb);
	};

	const suppressInteraction = (event: Event): void => {
		if (!active) return;
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
	};

	const onFramePointerDown = (event: PointerEvent): void => {
		if (!active || event.button !== 0) return;
		const doc = frame.contentDocument;
		const root = frameRoot();
		if (!doc || !root) return;
		const hit = hitFromEvent(event, doc, root);
		if (!hit) return;

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();

		const modifier = event.altKey || event.metaKey || event.ctrlKey || event.shiftKey;
		let target: Element;
		let forceDeepest = false;
		let accessible: { role?: string; name?: string } | undefined;

		if (modifier) {
			target = hit;
			forceDeepest = true;
		} else if (selected?.isConnected && isDescendantOf(hit, selected)) {
			// Click inside the current selection: step one tree level deeper toward the hit.
			let step = hit;
			for (;;) {
				const parent = parentOrHost(step);
				if (!parent || parent === selected) break;
				step = parent;
			}
			target = step;
		} else if (selected && hit === selected) {
			target = selected;
			forceDeepest = selectedDepth === 'deepest';
			accessible = selectedAccessible;
		} else {
			const climbed = climbElement(hit, root);
			target = climbed.element;
			accessible = climbed.accessible;
		}

		const rect = target.getBoundingClientRect();
		const pin: PointerPin | undefined =
			rect.width > 0 && rect.height > 0
				? {
						x: clampUnit((event.clientX - rect.left) / rect.width),
						y: clampUnit((event.clientY - rect.top) / rect.height),
					}
				: undefined;

		selectElement(target, root, { forceDeepest, accessible, pin });
	};

	const onKeyDown = (event: KeyboardEvent): void => {
		if (!active || !selected || event.key !== 'Escape') return;
		const root = frameRoot();
		if (!root) return;
		const parent = parentOrHost(selected);
		if (parent && parent !== root) {
			event.preventDefault();
			event.stopPropagation();
			selectElement(parent, root, {
				forceDeepest: false,
				focusCrumb: pathNav.contains(document.activeElement),
			});
		}
	};

	const attachFrame = (): void => {
		detachFrame?.();
		detachFrame = undefined;
		const doc = frame.contentDocument;
		const win = frame.contentWindow;
		if (!doc || !win) return;
		doc.addEventListener('pointerdown', onFramePointerDown, true);
		doc.addEventListener('mousedown', suppressInteraction, true);
		doc.addEventListener('mouseup', suppressInteraction, true);
		doc.addEventListener('click', suppressInteraction, true);
		win.addEventListener('keydown', onKeyDown, true);
		win.addEventListener('scroll', syncOverlay, { capture: true, passive: true });
		detachFrame = () => {
			doc.removeEventListener('pointerdown', onFramePointerDown, true);
			doc.removeEventListener('mousedown', suppressInteraction, true);
			doc.removeEventListener('mouseup', suppressInteraction, true);
			doc.removeEventListener('click', suppressInteraction, true);
			win.removeEventListener('keydown', onKeyDown, true);
			win.removeEventListener('scroll', syncOverlay, true);
		};
	};

	frame.addEventListener('load', () => {
		selected = null;
		selectedAccessible = undefined;
		selectedDepth = undefined;
		selectedPin = undefined;
		attachFrame();
		renderPanel();
	});
	if (frame.contentDocument?.readyState === 'complete') attachFrame();

	window.addEventListener('keydown', onKeyDown, true);

	toggle.addEventListener('click', () => {
		active = !active;
		toggle.setAttribute('aria-pressed', String(active));
		panel.hidden = !active;
		if (active) {
			attachFrame();
			renderPanel();
		} else {
			selected = null;
			selectedAccessible = undefined;
			selectedDepth = undefined;
			selectedPin = undefined;
			outline.hidden = true;
			renderPanel();
		}
	});

	copyButton.addEventListener('click', () => {
		if (!currentPointer) return;
		void copyText(currentPointer).then((ok) => {
			status.textContent = ok ? 'Pointer copied' : 'Copy failed';
		});
	});

	return {
		toggle,
		panel,
		syncOverlay() {
			if (active && selected) renderPanel();
			else syncOverlay();
		},
	};
}
