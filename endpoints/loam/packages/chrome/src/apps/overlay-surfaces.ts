/**
 * @fileoverview Rendering the kernel's overlays (phase 1 specification, section 8): one `loam-toast` per
 * toast, with its timer, and the one `loam-modal`. The kernel holds the state, so a press and a timer are
 * `overlay-dismiss`, and what closes on screen is what `overlay-list` no longer lists.
 *
 * A modal makes everything outside it inert, the top layer too, so a toast could neither be read out nor
 * dismissed behind one: while any modal is open, a new toast waits and a shown one's timer stops.
 *
 * Phase 4 (its 6.1 to 6.7): a toast shows the owner line the kernel set, its link, and never times out when sticky;
 * the region is an F6 stop while it holds a toast; and popovers render from the `overlays` chunk, loaded with the
 * first. The page's anchors answer the kernel's `overlayAnchors` once this attaches.
 *
 * Step 4: the slot's modal or prompt and each open dialog are a `loam-modal`, the slot's `showModal()`, a dialog's
 * `show()`, with the owner line and an app's own element; a parked dialog is not shown; the global strips are one
 * `loam-global` under the title bar. An answer the kernel refuses shows in the question, which stays open.
 */

import { Updates } from '@lushly-dev/fast-element';
import type { LoamKernelV5 } from '@lushly-dev/loam-kernel';
import type {
	GlobalInputV1,
	OverlayAnchorV1,
	OverlayFromV1,
	OverlayV1,
	ToastInputV1,
} from '@lushly-dev/loam-sdk';
import { deepActiveElement } from '../elements/events.js';
import type { LoamGlobal } from '../elements/global-strip.js';
import { type LoamModal, MODAL_RESULT_EVENT, type QuestionInput } from '../elements/modal.js';
import type { LoamShell } from '../elements/shell.js';
import {
	type LoamToast,
	type LoamToastRegion,
	TOAST_DISMISS_EVENT,
	type ToastTone,
} from '../elements/toast.js';
import { type AnchorOwner, anchorOwnerOf } from './anchors.js';
import { focusFallback } from './focus-fallback.js';
import type { PopoverLayer } from './overlays.js';

/** Finds a popover's anchor on the page, or null (6.3). */
export type AnchorFinder = (owner: AnchorOwner, anchor: OverlayAnchorV1) => HTMLElement | null;

/** An app's own element for a question (6.4), mounted in its registry; null when it has none here. */
export type OverlayMounter = (instance: string, element: string) => HTMLElement | null;

/** What the `overlays` chunk takes from this one, passed rather than imported, so neither parts a chunk of its own. */
export interface LayerHelpers {
	ownerLine: typeof ownerLine;
	focusFallback: typeof focusFallback;
	anchorOwnerOf: typeof anchorOwnerOf;
}

/** The owner line the shell shows (6.6): none for the shell's own. */
export function ownerLine(from: OverlayFromV1 | undefined): string {
	if (!from) return '';
	return from.kind === 'app'
		? `From ${from.title}`
		: `From ${from.agent}, for ${from.person ?? 'you'}`;
}

export class OverlaySurfaces {
	readonly #shell: LoamShell;
	readonly #kernel: LoamKernelV5;
	readonly #find: AnchorFinder;
	readonly #mountOf: OverlayMounter;
	readonly #dialogs = new Map<string, LoamModal>();
	#global: LoamGlobal | null = null;
	#popovers: Promise<PopoverLayer> | undefined;
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
		const { overlayId, result, value } = (
			event as CustomEvent<{ overlayId: string; result: string; value?: unknown }>
		).detail;
		void (async () => {
			const answered = await this.#kernel.call('overlay-dismiss', {
				overlayId,
				result,
				reason: 'user',
				...(value !== undefined ? { value } : {}),
			});
			// What the kernel refused shows in the question, which stays open (6.4).
			if (answered.success || !answered.error) return;
			const question =
				this.#modal?.overlayId === overlayId ? this.#modal : this.#dialogs.get(overlayId);
			const { message, suggestion } = answered.error;
			question?.refuse(suggestion ? `${message}. ${suggestion}` : message);
		})();
	};

	constructor(
		shell: LoamShell,
		kernel: LoamKernelV5,
		find: AnchorFinder = () => null,
		mountOf: OverlayMounter = () => null
	) {
		this.#shell = shell;
		this.#kernel = kernel;
		this.#find = find;
		this.#mountOf = mountOf;
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
		this.#global = doc.createElement('loam-global') as LoamGlobal;
		this.#global.hidden = true;
		shadowRoot?.append(this.#global, this.#region, this.#modal);
		this.#shell.addEventListener(TOAST_DISMISS_EVENT, this.#onDismiss);
		this.#shell.addEventListener(MODAL_RESULT_EVENT, this.#onAnswer);
		const anchors = this.#shell.overlayAnchors;
		if (anchors) anchors.resolve = (owner, anchor) => this.#find(owner, anchor) !== null;
	}

	dispose(): void {
		for (const timer of this.#timers.values()) clearTimeout(timer);
		this.#timers.clear();
		this.#shell.removeEventListener(TOAST_DISMISS_EVENT, this.#onDismiss);
		this.#shell.removeEventListener(MODAL_RESULT_EVENT, this.#onAnswer);
		this.#region?.remove();
		this.#modal?.remove();
		this.#global?.remove();
		for (const dialog of this.#dialogs.values()) dialog.remove();
		this.#dialogs.clear();
		this.#region = null;
		this.#modal = null;
		this.#global = null;
		const anchors = this.#shell.overlayAnchors;
		if (anchors) delete anchors.resolve;
		void this.#popovers?.then((layer) => layer.dispose());
		this.#popovers = undefined;
	}

	async read(): Promise<void> {
		const read = ++this.#reads;
		const result = await this.#kernel.call<{ overlays: OverlayV1[] }>('overlay-list');
		if (read !== this.#reads || !result.success || !result.data) return;
		const { overlays } = result.data;
		await this.#renderModal(overlays.find(({ kind }) => kind === 'modal' || kind === 'prompt'));
		if (read !== this.#reads) return;
		await this.#renderDialogs(overlays.filter((each) => each.kind === 'dialog' && !each.state));
		this.#renderGlobals(overlays.filter(({ kind }) => kind === 'global'));
		this.#renderToasts(overlays.filter(({ kind }) => kind === 'toast'));
		const popovers = overlays.filter(({ kind }) => kind === 'popover');
		if (popovers.length === 0 && !this.#popovers) return;
		this.#popovers ??= import('./overlays.js').then(
			({ createPopoverLayer }) =>
				createPopoverLayer(this.#shell, this.#kernel, this.#find, {
					ownerLine,
					focusFallback,
					anchorOwnerOf,
				}),
			(cause) => {
				this.#popovers = undefined;
				throw cause;
			}
		);
		const layer = await this.#popovers;
		if (read === this.#reads) layer.render(popovers);
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
		for (const { overlayId, input, from } of toasts) {
			if (shown.has(overlayId)) continue;
			if (held) {
				this.#waiting = true;
				continue;
			}
			const { message, tone, durationMs, sticky, link } = input as ToastInputV1;
			const toast = this.#shell.ownerDocument.createElement('loam-toast') as LoamToast;
			toast.overlayId = overlayId;
			toast.message = message;
			toast.tone = (tone ?? 'info') as ToastTone;
			toast.from = ownerLine(from);
			if (link) void this.#linkOf(toast, link);
			region.append(toast);
			// A sticky toast has no timer: it stays until a person dismisses it (6.1).
			if (!sticky) this.#durations.set(overlayId, durationMs ?? 5000);
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
		// An F6 stop while it holds a toast (6.7).
		if (region.childElementCount > 0) region.dataset.part = 'toasts';
		else delete region.dataset.part;
	}

	/** A toast's link (6.4), formed in the `overlays` chunk, which holds the URL scheme's formatting. */
	async #linkOf(toast: LoamToast, link: NonNullable<ToastInputV1['link']>): Promise<void> {
		const { toastHref } = await import('./overlays.js');
		toast.href = await toastHref(this.#kernel, this.#shell.base, link);
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
		// Another question replaced the one shown: the old one closes first.
		if (modal.overlayId !== '') modal.hide();
		// At most one modal (section 8): the palette and a compact drawer close first.
		if (customElements.get('loam-palette') && this.#shell.palette?.isOpen) {
			await this.#kernel.call('palette-close');
		}
		if (this.#shell.layout.compact.drawer !== null) {
			await this.#kernel.call('layout-set', { compact: { drawer: null } });
			await this.#shell.readLayout();
			await Updates.next();
		}
		await modal.show(overlay.overlayId, overlay.input as QuestionInput, this.#optionsOf(overlay));
	}

	/** How a question shows: its kind, its owner line, and an app's own element, mounted for it (6.4, 6.6). */
	#optionsOf(overlay: OverlayV1) {
		const { element } = overlay.input as { element?: string };
		return {
			kind: overlay.kind as 'modal' | 'dialog' | 'prompt',
			from: ownerLine(overlay.from),
			element:
				element !== undefined && overlay.from?.kind === 'app'
					? this.#mountOf(overlay.owner, element)
					: null,
		};
	}

	/** Each open dialog, non-modal; a parked one is not shown, and comes back when the kernel restores it (6.1). */
	async #renderDialogs(dialogs: OverlayV1[]): Promise<void> {
		for (const [overlayId, shown] of [...this.#dialogs]) {
			if (dialogs.some((each) => each.overlayId === overlayId)) continue;
			this.#dialogs.delete(overlayId);
			const hadFocus = shown.shadowRoot?.activeElement != null;
			if (!shown.hide() && hadFocus) focusFallback(this.#shell);
			shown.remove();
		}
		for (const overlay of dialogs) {
			if (this.#dialogs.has(overlay.overlayId)) continue;
			const shown = this.#shell.ownerDocument.createElement('loam-modal') as LoamModal;
			this.#dialogs.set(overlay.overlayId, shown);
			// Its place in the stack, up to the fourth; any further one sits on the fourth.
			shown.dataset.stack = String(Math.min(this.#dialogs.size - 1, 3));
			this.#shell.shadowRoot?.append(shown);
			await shown.show(overlay.overlayId, overlay.input as QuestionInput, this.#optionsOf(overlay));
		}
	}

	/** The strips under the title bar, one per id (6.1), each a polite status. */
	#renderGlobals(strips: OverlayV1[]): void {
		const global = this.#global;
		if (!global) return;
		// Unchanged strips are left alone, so a status is not read out again on every read.
		const key = JSON.stringify(strips.map(({ input }) => input));
		if (global.dataset.shown === key) return;
		global.dataset.shown = key;
		global.replaceChildren(
			...strips.map(({ input }) => {
				const { message, tone } = input as GlobalInputV1;
				const line = this.#shell.ownerDocument.createElement('p');
				line.setAttribute('role', 'status');
				line.dataset.tone = tone ?? 'info';
				line.textContent = message;
				return line;
			})
		);
		global.hidden = strips.length === 0;
	}
}
