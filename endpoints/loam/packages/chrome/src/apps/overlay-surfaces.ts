/**
 * @fileoverview Rendering the kernel's overlays (phase 1 specification, section 8): one `loam-toast` per
 * toast, with its timer, and the one `loam-modal`. The kernel holds the state, so a press and a timer are
 * `overlay-dismiss`, and what closes on screen is what `overlay-list` no longer lists.
 *
 * A modal makes everything outside it inert, the top layer too, so a toast could neither be read out nor
 * dismissed behind one: while any modal is open, a new toast waits and a shown one's timer stops.
 */

import { Updates } from '@lushly-dev/fast-element';
import type { LoamKernelV3 } from '@lushly-dev/loam-kernel';
import type { ModalInputV1, OverlayV1, ToastInputV1 } from '@lushly-dev/loam-sdk';
import { deepActiveElement } from '../elements/events.js';
import { type LoamModal, MODAL_RESULT_EVENT } from '../elements/modal.js';
import type { LoamShell } from '../elements/shell.js';
import {
	type LoamToast,
	type LoamToastRegion,
	TOAST_DISMISS_EVENT,
	type ToastTone,
} from '../elements/toast.js';
import { focusFallback } from './focus-fallback.js';

export class OverlaySurfaces {
	readonly #shell: LoamShell;
	readonly #kernel: LoamKernelV3;
	readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
	readonly #durations = new Map<string, number>();
	#waiting = false;
	#region: LoamToastRegion | null = null;
	#modal: LoamModal | null = null;
	#reads = 0;

	#onDismiss = (event: Event) => {
		const { overlayId } = (event as CustomEvent<{ overlayId: string }>).detail;
		void this.#kernel.call('overlay-dismiss', { overlayId, reason: 'user' });
	};

	#onAnswer = (event: Event) => {
		const { overlayId, result } = (event as CustomEvent<{ overlayId: string; result: string }>)
			.detail;
		void this.#kernel.call('overlay-dismiss', { overlayId, result, reason: 'user' });
	};

	constructor(shell: LoamShell, kernel: LoamKernelV3) {
		this.#shell = shell;
		this.#kernel = kernel;
	}

	get modalOpen(): boolean {
		return this.#modal?.isOpen === true;
	}

	/** Whether a modal's closing should read again: a toast waits, or a shown one's timer stopped. */
	get waiting(): boolean {
		return this.#waiting || (this.#region?.childElementCount ?? 0) > 0;
	}

	/** Any modal: this one, the palette, or a compact drawer. */
	get #anyModal(): boolean {
		const shell = this.#shell;
		return (
			this.modalOpen ||
			(customElements.get('loam-palette') !== undefined && shell.palette?.isOpen === true) ||
			shell.presentation.sidebar === 'drawer' ||
			shell.presentation.inspector === 'drawer'
		);
	}

	announce(text: string): void {
		this.#region?.announce(text);
	}

	/** Once the shell has rendered: the region is a live region, so it must exist before its text. */
	attach(): void {
		const { ownerDocument: doc, shadowRoot } = this.#shell;
		this.#region = doc.createElement('loam-toast-region') as LoamToastRegion;
		this.#modal = doc.createElement('loam-modal') as LoamModal;
		shadowRoot?.append(this.#region, this.#modal);
		this.#shell.addEventListener(TOAST_DISMISS_EVENT, this.#onDismiss);
		this.#shell.addEventListener(MODAL_RESULT_EVENT, this.#onAnswer);
	}

	dispose(): void {
		for (const timer of this.#timers.values()) clearTimeout(timer);
		this.#timers.clear();
		this.#shell.removeEventListener(TOAST_DISMISS_EVENT, this.#onDismiss);
		this.#shell.removeEventListener(MODAL_RESULT_EVENT, this.#onAnswer);
		this.#region?.remove();
		this.#modal?.remove();
		this.#region = null;
		this.#modal = null;
	}

	async read(): Promise<void> {
		const read = ++this.#reads;
		const result = await this.#kernel.call<{ overlays: OverlayV1[] }>('overlay-list');
		if (read !== this.#reads || !result.success || !result.data) return;
		const { overlays } = result.data;
		await this.#renderModal(overlays.find(({ kind }) => kind === 'modal'));
		this.#renderToasts(overlays.filter(({ kind }) => kind === 'toast'));
	}

	#renderToasts(toasts: OverlayV1[]): void {
		const region = this.#region;
		if (!region) return;
		const shown = new Map(
			[...region.children].map((child) => [(child as LoamToast).overlayId, child as LoamToast])
		);
		for (const [id, toast] of shown) {
			if (toasts.some(({ overlayId }) => overlayId === id)) continue;
			this.#stopTimer(id);
			this.#durations.delete(id);
			const doc = this.#shell.ownerDocument;
			const hadFocus = deepActiveElement(doc)?.getRootNode() === toast.shadowRoot;
			toast.remove();
			if (hadFocus) focusFallback(this.#shell);
		}
		const held = this.#anyModal;
		this.#waiting = false;
		for (const { overlayId, input } of toasts) {
			if (shown.has(overlayId)) continue;
			if (held) {
				this.#waiting = true;
				continue;
			}
			const { message, tone, durationMs } = input as ToastInputV1;
			const toast = this.#shell.ownerDocument.createElement('loam-toast') as LoamToast;
			toast.overlayId = overlayId;
			toast.message = message;
			toast.tone = (tone ?? 'info') as ToastTone;
			region.append(toast);
			this.#durations.set(overlayId, durationMs ?? 5000);
			// A person reading or reaching for it keeps it there (WCAG 2.2.1).
			toast.addEventListener('mouseenter', () => this.#stopTimer(overlayId));
			toast.addEventListener('focusin', () => this.#stopTimer(overlayId));
			const resume = () => this.#resume(toast);
			toast.addEventListener('mouseleave', resume);
			toast.addEventListener('focusout', () => queueMicrotask(resume));
		}
		for (const child of region.children) {
			const toast = child as LoamToast;
			if (held) this.#stopTimer(toast.overlayId);
			else if (!this.#timers.has(toast.overlayId)) this.#resume(toast);
		}
	}

	#resume(toast: LoamToast): void {
		if (!toast.isConnected || toast.matches(':hover') || toast.matches(':focus-within')) return;
		const duration = this.#durations.get(toast.overlayId);
		if (duration !== undefined && !this.#anyModal) this.#startTimer(toast.overlayId, duration);
	}

	#startTimer(overlayId: string, duration: number): void {
		this.#stopTimer(overlayId);
		this.#timers.set(
			overlayId,
			setTimeout(() => {
				this.#timers.delete(overlayId);
				void this.#kernel.call('overlay-dismiss', { overlayId, reason: 'timeout' });
			}, duration)
		);
	}

	#stopTimer(overlayId: string): void {
		const timer = this.#timers.get(overlayId);
		if (timer !== undefined) clearTimeout(timer);
		this.#timers.delete(overlayId);
	}

	async #renderModal(overlay: OverlayV1 | undefined): Promise<void> {
		const modal = this.#modal;
		if (!modal) return;
		if (!overlay) {
			if (!modal.hide()) focusFallback(this.#shell);
			return;
		}
		if (modal.overlayId === overlay.overlayId) return;
		// At most one modal (section 8): the palette and a compact drawer close first.
		if (customElements.get('loam-palette') && this.#shell.palette?.isOpen) {
			await this.#kernel.call('palette-close');
		}
		if (this.#shell.layout.compact.drawer !== null) {
			await this.#kernel.call('layout-set', { compact: { drawer: null } });
			await this.#shell.readLayout();
			await Updates.next();
		}
		await modal.show(overlay.overlayId, overlay.input as ModalInputV1);
	}
}
