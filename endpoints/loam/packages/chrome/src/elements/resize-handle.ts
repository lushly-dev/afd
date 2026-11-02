/**
 * @fileoverview `loam-resize-handle`: the `separator` between a resizable part and main (section
 * 7, design.md "Handles"). A pointer drag previews by asking the shell to set the state property
 * and commits one clamped value on release; arrow keys step 16px and commit each step, Home and
 * End go to the minimum and maximum. A click without dragging steps through the minimum, default
 * and maximum sizes: the single-pointer alternative to dragging (WCAG 2.5.7, decided by step 7).
 */

import { attr, css, FASTElement, html } from '@lushly-dev/fast-element';
import {
	clampSize,
	DRAG_THRESHOLD,
	HANDLE_STEP,
	type HandleGrowth,
	nextPreset,
	type ResizeDetail,
} from '../resize.js';

const template = html<LoamResizeHandle>`<span class="bar" part="bar"></span>`;

const styles = css`
	:host {
		position: relative;
		z-index: var(--z-index-raised);
		display: block;
		background: var(--shell-color-handle-rest);
		touch-action: none;
		outline: none;
	}
	:host([hidden]) {
		display: none;
	}
	:host([aria-orientation='vertical']) {
		inline-size: 1px;
		cursor: col-resize;
	}
	:host([aria-orientation='horizontal']) {
		block-size: 1px;
		cursor: row-resize;
	}
	.bar {
		position: absolute;
		background: var(--shell-color-handle-rest);
		transition: background-color var(--duration-fast) var(--easing-standard);
	}
	:host([aria-orientation='vertical']) .bar {
		inset-block: 0;
		inset-inline-start: calc(var(--shell-size-handle) / -2 + 1px / 2);
		inline-size: var(--shell-size-handle);
	}
	:host([aria-orientation='horizontal']) .bar {
		inset-inline: 0;
		inset-block-start: calc(var(--shell-size-handle) / -2 + 1px / 2);
		block-size: var(--shell-size-handle);
	}
	:host::after {
		content: '';
		position: absolute;
	}
	:host([aria-orientation='vertical'])::after {
		inset-block: 0;
		inset-inline-start: calc(var(--size-target-compact) / -2 + 1px / 2);
		inline-size: var(--size-target-compact);
	}
	:host([aria-orientation='horizontal'])::after {
		inset-inline: 0;
		inset-block-start: calc(var(--size-target-compact) / -2 + 1px / 2);
		block-size: var(--size-target-compact);
	}
	:host(:hover) .bar {
		background: var(--shell-color-handle-hover);
	}
	:host([data-dragging]) .bar,
	:host(:focus-visible) .bar {
		background: var(--shell-color-handle-active);
	}
	:host(:focus-visible) .bar {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: var(--size-space-xs);
	}
	@media (forced-colors: active) {
		:host,
		.bar {
			background: CanvasText;
		}
		:host(:hover) .bar,
		:host([data-dragging]) .bar,
		:host(:focus-visible) .bar {
			background: Highlight;
		}
		:host(:focus-visible) .bar {
			outline-color: Highlight;
		}
	}
`;

interface Drag {
	pointerId: number;
	start: number;
	from: number;
	value: number;
	moved: boolean;
}

export class LoamResizeHandle extends FASTElement {
	declare value: number;
	declare min: number;
	declare max: number;
	declare preset: number;
	declare label: string;
	declare growth: HandleGrowth;
	#drag: Drag | null = null;

	constructor() {
		super();
		this.value = 0;
		this.min = 0;
		this.max = 0;
		this.preset = 0;
		this.label = '';
		this.growth = 'end';
		this.addEventListener('pointerdown', (event) => this.#pointerDown(event));
		this.addEventListener('pointermove', (event) => this.#pointerMove(event));
		this.addEventListener('pointerup', (event) => this.#pointerUp(event));
		this.addEventListener('pointercancel', () => this.#cancel());
		this.addEventListener('keydown', (event) => this.#keydown(event));
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute('role', 'separator');
		this.setAttribute('tabindex', '0');
		this.#syncAria();
	}

	valueChanged(): void {
		this.#syncAria();
	}
	minChanged(): void {
		this.#syncAria();
	}
	maxChanged(): void {
		this.#syncAria();
	}
	labelChanged(): void {
		this.#syncAria();
	}
	growthChanged(): void {
		this.#syncAria();
	}

	get orientation(): 'vertical' | 'horizontal' {
		return this.growth === 'up' ? 'horizontal' : 'vertical';
	}

	#syncAria(): void {
		if (!this.$fastController?.isConnected) return;
		this.setAttribute('aria-orientation', this.orientation);
		this.setAttribute('aria-valuenow', String(this.value));
		this.setAttribute('aria-valuetext', `${this.value} pixels`);
		this.setAttribute('aria-valuemin', String(this.min));
		this.setAttribute('aria-valuemax', String(this.max));
		this.setAttribute('aria-label', this.label);
	}

	/** +1 when moving toward inline-end (or block-end) grows the part, -1 when it shrinks it. */
	#sign(): number {
		if (this.growth === 'up') return -1;
		const rtl = getComputedStyle(this).direction === 'rtl';
		const towardEnd = this.growth === 'end' ? 1 : -1;
		return rtl ? -towardEnd : towardEnd;
	}

	#emit(type: 'resize-preview' | 'resize-commit', value: number): void {
		this.dispatchEvent(
			new CustomEvent<ResizeDetail>(type, { detail: { value }, bubbles: true, composed: true })
		);
	}

	#pointerDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		this.focus({ preventScroll: true });
		this.setPointerCapture?.(event.pointerId);
		const start = this.growth === 'up' ? event.clientY : event.clientX;
		this.#drag = {
			pointerId: event.pointerId,
			start,
			from: this.value,
			value: this.value,
			moved: false,
		};
	}

	#pointerMove(event: PointerEvent): void {
		const drag = this.#drag;
		if (!drag || drag.pointerId !== event.pointerId) return;
		const at = this.growth === 'up' ? event.clientY : event.clientX;
		const delta = at - drag.start;
		if (!drag.moved && Math.abs(delta) < DRAG_THRESHOLD) return;
		if (!drag.moved) {
			drag.moved = true;
			this.dataset.dragging = '';
		}
		const sign = this.growth === 'up' ? -1 : this.#sign();
		drag.value = clampSize(drag.from + delta * sign, this.min, this.max);
		this.#emit('resize-preview', drag.value);
	}

	#pointerUp(event: PointerEvent): void {
		const drag = this.#drag;
		if (!drag || drag.pointerId !== event.pointerId) return;
		this.#drag = null;
		delete this.dataset.dragging;
		if (drag.moved) this.#emit('resize-commit', drag.value);
		else this.#emit('resize-commit', nextPreset(this.value, this.min, this.preset, this.max));
	}

	#cancel(): void {
		if (!this.#drag) return;
		this.#drag = null;
		delete this.dataset.dragging;
		this.#emit('resize-preview', this.value);
	}

	#keydown(event: KeyboardEvent): void {
		const sign = this.#sign();
		let next: number | undefined;
		switch (event.key) {
			case 'ArrowRight':
				if (this.orientation === 'vertical') next = this.value + HANDLE_STEP * sign;
				break;
			case 'ArrowLeft':
				if (this.orientation === 'vertical') next = this.value - HANDLE_STEP * sign;
				break;
			case 'ArrowUp':
				if (this.orientation === 'horizontal') next = this.value + HANDLE_STEP;
				break;
			case 'ArrowDown':
				if (this.orientation === 'horizontal') next = this.value - HANDLE_STEP;
				break;
			case 'Home':
				next = this.min;
				break;
			case 'End':
				next = this.max;
				break;
		}
		if (next === undefined) return;
		event.preventDefault();
		const value = clampSize(next, this.min, this.max);
		if (value !== this.value) this.#emit('resize-commit', value);
	}
}

// FAST's attr() records the property on its configuration, so each attribute needs its own.
const numberAttribute = () => ({
	converter: { toView: String, fromView: (v: unknown) => Number(v) || 0 },
});
attr(numberAttribute())(LoamResizeHandle.prototype, 'value');
attr(numberAttribute())(LoamResizeHandle.prototype, 'min');
attr(numberAttribute())(LoamResizeHandle.prototype, 'max');
attr(numberAttribute())(LoamResizeHandle.prototype, 'preset');
attr(LoamResizeHandle.prototype, 'label');
attr(LoamResizeHandle.prototype, 'growth');

export const resizeHandleDefinition = { name: 'loam-resize-handle', template, styles } as const;
