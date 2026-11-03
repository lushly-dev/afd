/**
 * @fileoverview `loam-tooltip`: the one tooltip of a rail or a tab bar (phase 2 specification, 7.2 and
 * 7.5), in a chunk of its own that the rail loads on its first hover, focus or press, and hands that event
 * to, so first paint holds only the boundary (2.4). `popover="manual"`, so it is in the top layer and no scrolling list clips it, and
 * placed by CSS anchor positioning on the entry it describes. Anchor names are tree-scoped, so there is one
 * in each of `loam-rail`'s and `loam-tabbar`'s shadow roots, and it serves the elements of that root with a
 * `tip` property. `anchor-name` and `position-anchor` are set through CSSOM, which `style-src 'self'`
 * allows, never through a `style` attribute.
 *
 * It shows on hover and on keyboard focus, stays while the pointer moves onto it, and Escape dismisses it
 * wherever focus is, until the pointer and focus have both left (WCAG 1.4.13). A press of a dimmed entry
 * shows it too. It is `aria-hidden`: an entry names itself, and a dimmed one describes itself.
 */

import { css, FASTElement, html } from '@lushly-dev/fast-element';

/** An element a tooltip serves: what the tooltip says, empty for none, and whether a press shows it. */
export interface TipTarget extends HTMLElement {
	tip: string;
	dimmed?: boolean;
}

const ANCHOR = '--loam-tip';

/**
 * What an element whose own popup opened sends, so its tooltip closes: focus moving inside that element's
 * shadow root never reaches this root (7.2).
 */
export const TIP_CLOSE_EVENT = 'loam-tip-close';

const styles = css`
	:host {
		position: fixed;
		inset: auto;
		margin: 0;
		position-area: inline-end;
		position-try-fallbacks: flip-inline, flip-block;
		max-inline-size: var(--shell-size-sidebar-default);
		padding-block: var(--size-space-sm);
		padding-inline: var(--size-space-md);
		border: 0;
		border-radius: var(--radius-md);
		background: var(--color-surface-floating);
		box-shadow: var(--shadow-floating);
		color: var(--color-text-primary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		overflow: visible;
	}
	:host([placement='above']) {
		position-area: block-start;
	}
	@media (forced-colors: active) {
		:host {
			border: 1px solid CanvasText;
			background: Canvas;
			color: CanvasText;
		}
	}
`;

const tipOf = (path: readonly EventTarget[], root: Node): TipTarget | undefined =>
	path.find(
		(node): node is TipTarget =>
			node instanceof HTMLElement && node.getRootNode() === root && 'tip' in node
	);

export class LoamTooltip extends FASTElement {
	#anchor: TipTarget | null = null;
	#dismissed = false;
	#root: Node | null = null;
	#off: Array<() => void> = [];

	/** The entry it describes now, or none. */
	get anchor(): TipTarget | null {
		return this.#anchor;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.popover = 'manual';
		this.setAttribute('aria-hidden', 'true');
		this.style.setProperty('position-anchor', ANCHOR);
		const root = this.getRootNode();
		this.#root = root;
		const on = (
			target: EventTarget,
			type: string,
			listener: (event: Event) => void,
			capture = false
		) => {
			target.addEventListener(type, listener, capture);
			this.#off.push(() => target.removeEventListener(type, listener, capture));
		};
		for (const type of [
			'pointerover',
			'pointerout',
			'focusin',
			'focusout',
			'click',
			TIP_CLOSE_EVENT,
		]) {
			on(root, type, (event) => this.handle(event.type, event.composedPath()));
		}
		on(this, 'pointerleave', () => this.#settle());
		on(this.ownerDocument, 'keydown', (event) => this.#escape(event as KeyboardEvent), true);
	}

	/**
	 * An event in its root, by type and path: its own, or, `replayed`, the one that loaded it, which counts
	 * only if it still holds: the pointer still over its target, focus still on it (7.5).
	 */
	handle(type: string, path: readonly EventTarget[], replayed = false): void {
		const first = path[0] as Element;
		if (replayed && type !== 'click' && !first.matches(type === 'focusin' ? ':focus' : ':hover')) {
			return;
		}
		const target = tipOf(path, this.#root as Node);
		if (type === 'pointerout' || type === 'focusout') this.#settle();
		else if (!target) return;
		// The switcher's list open over its button: no tooltip, and Escape is the list's (7.2).
		else if (type === TIP_CLOSE_EVENT || (target as { expanded?: boolean }).expanded) this.#close();
		else if (type === 'pointerover') this.#show(target);
		else if (type === 'click') {
			if (target.dimmed) this.#show(target, true);
		} else if ((path[0] as Element).matches(':focus-visible')) this.#show(target);
	}

	override disconnectedCallback(): void {
		for (const off of this.#off.splice(0)) off();
		this.#hide();
		super.disconnectedCallback();
	}

	#show(target: TipTarget, pressed = false): void {
		if (target !== this.#anchor) {
			this.#anchor?.style.removeProperty('anchor-name');
			this.#anchor = target;
			this.#dismissed = false;
			target.style.setProperty('anchor-name', ANCHOR);
		}
		if (pressed) this.#dismissed = false;
		if (!target.tip || this.#dismissed) {
			this.#close();
			return;
		}
		this.textContent = target.tip;
		if (!this.matches(':popover-open')) this.showPopover();
	}

	/** After the pointer or focus moved: hidden once neither is on the entry or on this. */
	#settle(): void {
		queueMicrotask(() => {
			const anchor = this.#anchor;
			if (!anchor) return;
			const focused = (this.#root as ShadowRoot | null)?.activeElement === anchor;
			if (anchor.matches(':hover') || this.matches(':hover') || (focused && this.#focusVisible())) {
				return;
			}
			this.#hide();
		});
	}

	#focusVisible(): boolean {
		const inner = this.#anchor?.shadowRoot?.activeElement;
		return inner?.matches(':focus-visible') === true;
	}

	#escape(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !this.matches(':popover-open')) return;
		this.#dismissed = true;
		this.#close();
		event.preventDefault();
		event.stopPropagation();
	}

	#close(): void {
		if (this.matches(':popover-open')) this.hidePopover();
	}

	#hide(): void {
		this.#close();
		this.#anchor?.style.removeProperty('anchor-name');
		this.#anchor = null;
		this.#dismissed = false;
	}
}

export const tooltipDefinition = {
	name: 'loam-tooltip',
	template: html<LoamTooltip>`<slot></slot>`,
	styles,
} as const;

/**
 * The tooltip of `nav`'s shadow root, defined and placed there once: the rail's boundary asks for it on its
 * first hover, focus or press. Above the tab bar, beside the rail.
 */
export async function attachTooltip(nav: HTMLElement & { variant: string }): Promise<LoamTooltip> {
	if (!customElements.get(tooltipDefinition.name)) await LoamTooltip.define(tooltipDefinition);
	const tip = nav.ownerDocument.createElement(tooltipDefinition.name) as LoamTooltip;
	if (nav.variant !== 'rail') tip.setAttribute('placement', 'above');
	nav.shadowRoot?.append(tip);
	return tip;
}
