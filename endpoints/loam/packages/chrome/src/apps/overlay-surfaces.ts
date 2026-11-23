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
 * Step 4: the slot's modal or prompt is the one `loam-modal` here, `showModal()`; each open dialog, `show()`, a prompt's
 * fields and the global strips render from the `overlays` chunk (its review's R3). A question shows the owner line and
 * an app's own element, mounted in the scope the overlay was opened in (D83). A person's answer reaches the kernel
 * through the question's private callback, never an event; what the kernel accepted is told to `hearAnswers`, and
 * what it refused shows in the question, which stays open.
 */

import { Updates } from '@lushly-dev/fast-element';
import type { LoamKernel } from '@lushly-dev/loam-kernel';
import type {
	OverlayAnchorV1,
	OverlayFromV1,
	OverlayResultV1,
	OverlayV1,
	PromptInputV1,
	ScopeV1,
	ToastInputV1,
} from '@lushly-dev/loam-sdk';
import { deepActiveElement, tellAnswered } from '../elements/events.js';
import {
	type AnswerFn,
	bindAnswer,
	type LoamModal,
	type QuestionInput,
	type QuestionOptions,
} from '../elements/modal.js';
import type { LoamShell } from '../elements/shell.js';
import {
	type LoamToast,
	type LoamToastRegion,
	TOAST_DISMISS_EVENT,
	TOAST_INBOX_EVENT,
	type ToastTone,
} from '../elements/toast.js';
import { previewWords, slotWords } from '../preview-words.js';
import { type AnchorOwner, anchorOwnerOf } from './anchors.js';
import { focusFallback } from './focus-fallback.js';
import type { OverlayLayer } from './overlays.js';

/** Finds a popover's anchor on the page, or null (6.3). */
export type AnchorFinder = (owner: AnchorOwner, anchor: OverlayAnchorV1) => HTMLElement | null;

/**
 * An app's own element for a question (6.4), mounted in its registry with a surface port of `scope`, the scope the
 * overlay was opened in (D83); null when it has none here.
 */
export type OverlayMounter = (
	instance: string,
	element: string,
	scope: ScopeV1 | undefined
) => HTMLElement | null;

/** What the `overlays` chunk takes from this one, passed rather than imported, so neither parts a chunk of its own. */
export interface LayerHelpers {
	ownerLine: typeof ownerLine;
	focusFallback: typeof focusFallback;
	anchorOwnerOf: typeof anchorOwnerOf;
	/** How a question shows, and its private answer callback (step 4). */
	optionsOf(overlay: OverlayV1): QuestionOptions;
	/** Bind a question's private answer callback (step 4; the trust review's blocker 1). */
	bindAnswer(question: LoamModal): void;
}

/** A confirmation's input as it will run, one line per field, as text (phase 4 specification, 7.2, R15). */
export function inputWords(input: unknown): string {
	if (input === null || typeof input !== 'object' || Array.isArray(input))
		return JSON.stringify(input) ?? 'No input';
	const entries = Object.entries(input as Record<string, unknown>);
	return entries.length === 0
		? 'No input'
		: entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
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
	readonly #kernel: LoamKernel;
	readonly #find: AnchorFinder;
	readonly #mountOf: OverlayMounter;
	#layer: Promise<OverlayLayer> | undefined;
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

	/** A sticky toast's "Open inbox" (6.7): dismissed as the person's, with 6.2's `inbox`, then the inbox at its notice. */
	#onInbox = (event: Event) => {
		const { overlayId, notification } = (
			event as CustomEvent<{ overlayId: string; notification: string }>
		).detail;
		// Focus leaves the toast first, so its removal sends it nowhere: the inbox takes it, at the notice.
		(deepActiveElement(this.#shell.ownerDocument) as HTMLElement | null)?.blur();
		void this.#kernel
			.call('overlay-dismiss', { overlayId, reason: 'inbox' })
			.then(() => this.#kernel.call('section-open', { section: 'inbox', path: notification }));
	};

	/**
	 * A person's answer to `question`, as its private callback (the review's 2): its own id, then the kernel's word.
	 * What the kernel accepted is told to `hearAnswers`; what it refused shows in that question, which stays open.
	 */
	#answerFor(question: LoamModal): AnswerFn {
		return (overlayId, result, value, reason) =>
			void (async () => {
				const asked = this.#asks.get(overlayId);
				// The palette's input prompt runs its command with what it collected (phase 4 specification, 7.1); a confirm_prompt
				// command's confirmation replaces it in the slot, and this call waits for that answer too (R15).
				if (asked?.kind === 'input' && result !== 'cancel') {
					const ran = await this.#kernel.call('palette-run', {
						command: asked.command,
						prompt: overlayId,
						input: value ?? {},
					});
					if (ran.success) {
						tellAnswered(this.#shell, overlayId, 'confirm');
						return;
					}
					if (!ran.error) return;
					const { message, suggestion, code } = ran.error;
					const words = suggestion ? `${message}. ${suggestion}` : message;
					if (question.overlayId === overlayId) question.refuse(words);
					// The prompt has gone, so the run itself failed: said as long as a toast may last. A person's own
					// decline needs no word.
					else if (code !== 'CONFIRMATION_DECLINED')
						void this.#kernel.call('toast-show', {
							message: words.slice(0, 200),
							tone: 'danger',
							durationMs: 30_000,
						});
					return;
				}
				const answered = await this.#kernel.call<OverlayResultV1>('overlay-dismiss', {
					overlayId,
					result,
					// `withdrawn` for the shell's own questions alone (third round, F): an app's modal a script closed is an
					// ordinary cancel, as before, which the kernel takes, so the page and the kernel never disagree.
					reason: reason === 'withdrawn' && asked !== undefined ? 'withdrawn' : 'user',
					...(value !== undefined ? { value } : {}),
				});
				if (answered.success && answered.data) {
					// The close prompt names its tab, so its answer acts whichever close opened it (7.3).
					tellAnswered(
						this.#shell,
						overlayId,
						answered.data.result,
						asked?.kind === 'close' && asked.tab !== undefined
							? {
									tab: asked.tab,
									...(asked.scope ? { scope: asked.scope } : {}),
									...(asked.document ? { document: asked.document } : {}),
								}
							: undefined
					);
					return;
				}
				if (!answered.error || question.overlayId !== overlayId) return;
				const { message, suggestion } = answered.error;
				question.refuse(suggestion ? `${message}. ${suggestion}` : message);
			})();
	}

	/** The kernel's own prompts shown, by id: what each asks (7.1 to 7.3), for its answer's path. */
	readonly #asks = new Map<string, NonNullable<OverlayV1['for']>>();

	constructor(
		shell: LoamShell,
		kernel: LoamKernel,
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
		// A hidden toast's timer is a toast's too: held under a modal, and read again when one opens or closes (B1).
		return this.#waiting || (this.#region?.childElementCount ?? 0) > 0 || this.#hidden.size > 0;
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
		bindAnswer(this.#modal, this.#answerFor(this.#modal));
		shadowRoot?.append(this.#region, this.#modal);
		this.#shell.addEventListener(TOAST_DISMISS_EVENT, this.#onDismiss);
		this.#shell.addEventListener(TOAST_INBOX_EVENT, this.#onInbox);
		const anchors = this.#shell.overlayAnchors;
		if (anchors) anchors.resolve = (owner, anchor) => this.#find(owner, anchor) !== null;
	}

	dispose(): void {
		for (const timer of this.#timers.values()) clearTimeout(timer);
		this.#timers.clear();
		for (const timer of this.#hidden.values()) clearTimeout(timer);
		this.#hidden.clear();
		this.#shell.removeEventListener(TOAST_DISMISS_EVENT, this.#onDismiss);
		this.#shell.removeEventListener(TOAST_INBOX_EVENT, this.#onInbox);
		this.#region?.remove();
		this.#modal?.remove();
		this.#region = null;
		this.#modal = null;
		const anchors = this.#shell.overlayAnchors;
		if (anchors) delete anchors.resolve;
		void this.#layer?.then((layer) => layer.dispose());
		this.#layer = undefined;
	}

	/** The `overlays` chunk, loaded with the first popover, dialog, prompt or strip, and kept. */
	#loadLayer(): Promise<OverlayLayer> {
		this.#layer ??= import('./overlays.js').then(
			({ createPopoverLayer }) =>
				createPopoverLayer(this.#shell, this.#kernel, this.#find, {
					ownerLine,
					focusFallback,
					anchorOwnerOf,
					optionsOf: (overlay) => this.#optionsOf(overlay),
					bindAnswer: (question) => bindAnswer(question, this.#answerFor(question)),
				}),
			(cause) => {
				this.#layer = undefined;
				throw cause;
			}
		);
		return this.#layer;
	}

	async read(): Promise<void> {
		const read = ++this.#reads;
		const result = await this.#kernel.call<{ overlays: OverlayV1[] }>('overlay-list');
		if (read !== this.#reads || !result.success || !result.data) return;
		const { overlays } = result.data;
		const slot = overlays.find(({ kind }) => kind === 'modal' || kind === 'prompt');
		const dialogs = overlays.filter((each) => each.kind === 'dialog' && !each.state);
		const strips = overlays.filter(({ kind }) => kind === 'global');
		const popovers = overlays.filter(({ kind }) => kind === 'popover');
		const wanted = slot?.kind === 'prompt' || dialogs.length + strips.length + popovers.length > 0;
		const layer = wanted || this.#layer ? await this.#loadLayer() : undefined;
		if (read !== this.#reads) return;
		await this.#renderModal(slot, layer);
		if (read !== this.#reads) return;
		// Shown toasts, then a muted app's hidden ones, whose timers are held under the same modals (step 5's R2).
		const toasts = overlays.filter(({ kind }) => kind === 'toast');
		this.#renderToasts(toasts.filter(({ hidden }) => !hidden));
		this.#runHidden(toasts.filter(({ hidden }) => hidden));
		if (!layer) return;
		layer.render(popovers);
		await layer.renderDialogs(dialogs);
		layer.renderGlobals(strips);
	}

	/** The hidden toasts' timers, by id: a muted app's (3.7), never shown. */
	readonly #hidden = new Map<string, ReturnType<typeof setTimeout>>();

	/**
	 * A muted app's toasts (3.7; step 5's R2): never drawn, but a timed one times out as a shown one does, so the app
	 * reads the same course of its toast; a sticky one stays until a switch, a change of person or its own close. Under
	 * any modal its timer is held, as a shown toast's is, and starts again in full once the modal closes (the re-check's
	 * B1: else an app's own modal would tell it it is muted). Run after the shown toasts, whose pass resets `waiting`.
	 */
	#runHidden(toasts: OverlayV1[]): void {
		const held = this.#anyModal;
		for (const [id, timer] of this.#hidden) {
			if (!held && toasts.some(({ overlayId }) => overlayId === id)) continue;
			clearTimeout(timer);
			this.#hidden.delete(id);
		}
		if (held) {
			// A modal's close reads again, and the timers start then.
			if (toasts.some(({ input }) => !(input as ToastInputV1).sticky)) this.#waiting = true;
			return;
		}
		for (const { overlayId, input } of toasts) {
			const { sticky, durationMs } = input as ToastInputV1;
			if (sticky || this.#hidden.has(overlayId)) continue;
			this.#hidden.set(
				overlayId,
				setTimeout(() => {
					this.#hidden.delete(overlayId);
					void this.#kernel.call('overlay-dismiss', { overlayId, reason: 'timeout' });
				}, durationMs ?? 5000)
			);
		}
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
		for (const { overlayId, input, from, notification } of toasts) {
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
			// A toast that also landed in the inbox offers "Open inbox" (phase 4 specification, 6.7).
			toast.notification = notification ?? '';
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

	async #renderModal(overlay: OverlayV1 | undefined, layer?: OverlayLayer): Promise<void> {
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
		const options = this.#optionsOf(overlay);
		const asks = overlay.for?.kind;
		this.#asks.clear();
		if (overlay.for) this.#asks.set(overlay.overlayId, overlay.for);
		if (asks) options.asks = asks;
		// A confirmation and the close prompt ask for no value (7.2, 7.3): a confirmation shows its input as it will run.
		// A released mounted command's preview follows, as text, its server's words marked as such (phase 5's 7.2).
		if (asks === 'confirmation')
			options.details = slotWords(
				inputWords(overlay.for?.input),
				previewWords(overlay.for?.preview)
			);
		else if (overlay.kind === 'prompt' && asks !== 'close' && layer) {
			const prompt = overlay.input as PromptInputV1;
			options.fields = layer.promptFields(this.#shell.ownerDocument, prompt.schema, prompt.value);
		}
		await modal.show(overlay.overlayId, overlay.input as QuestionInput, options);
	}

	/** How a question shows: its kind, its owner line, and an app's own element, mounted for it (6.4, 6.6). */
	#optionsOf(overlay: OverlayV1): QuestionOptions {
		const { element } = overlay.input as { element?: string };
		return {
			kind: overlay.kind as 'modal' | 'dialog' | 'prompt',
			from: ownerLine(overlay.from),
			element:
				element !== undefined && overlay.from?.kind === 'app'
					? this.#mountOf(overlay.owner, element, overlay.scope)
					: null,
		};
	}
}
