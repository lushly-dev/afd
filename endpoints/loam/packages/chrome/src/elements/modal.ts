/**
 * @fileoverview `loam-modal`: an overlay's question (phase 1 specification, section 8; phase 4 specification, 6.3 to
 * 6.7), a native `<dialog>` holding an owner line, a title, a body, an app's own element or a prompt's fields, and its
 * answers, as text. In the slot (a modal or a prompt) it opens with `showModal()`, `aria-modal`, and Tab wraps; as a
 * dialog it opens with `show()`, non-modal. Focus starts on the default answer, on cancel when it is `danger`, or on a
 * prompt's first field, and returns to the invoker; a dialog takes no focus when it opens. Escape cancels. It closes
 * when the kernel's state says so. Only a person's press on a button it drew, or their Escape, answers it, through the
 * private callback its renderer bound (`bindAnswer`), with its own id: no event carries an answer, so nothing else on the page, an
 * app's element inside it included, answers as the person (step 4's review). What the kernel accepted is told to
 * `hearAnswers`' listeners, and what it refused shows in place.
 */

import { css, FASTElement, html, observable, ref, Updates } from '@lushly-dev/fast-element';
import type {
	DialogInputV1,
	ModalInputV1,
	OverlayActionV1,
	PromptInputV1,
} from '@lushly-dev/loam-sdk';
import { actionButton } from '../apps/action-styles.js';
import { deepActiveElement } from './events.js';
import { trapTab } from './focus.js';
import type { PromptFields } from './prompt-fields.js';

/** What the shell shows: a modal's, a dialog's or a prompt's input. */
export type QuestionInput = ModalInputV1 | DialogInputV1 | PromptInputV1;

/** How it shows: in the slot, or as a non-modal dialog. */
export interface QuestionOptions {
	kind: 'modal' | 'dialog' | 'prompt';
	/** The owner line (6.6), empty for the shell's own. */
	from?: string;
	/** An app's own element, mounted for it (6.4). */
	element?: HTMLElement | null;
	/** A prompt's fields, built by the `overlays` chunk. */
	fields?: PromptFields | null;
	/**
	 * Which of the kernel's own prompts it is (phase 4 specification, 7.1 to 7.3). A confirmation takes no field and
	 * focuses Decline, never Confirm, so a person typing elsewhere cannot confirm with Enter (step 4's record).
	 */
	asks?: 'input' | 'confirmation' | 'close';
	/** A confirmation's input as it will run, as text (7.2, R15). */
	details?: string;
}

const template = html<LoamModal>`
	<dialog
		${ref('dialog')}
		aria-labelledby="modal-title"
		aria-describedby="modal-body"
		@cancel="${(x, c) => x.handleCancel(c.event)}"
		@close="${(x) => x.handleClosed()}"
		@keydown="${(x, c) => x.handleKeydown(c.event as KeyboardEvent)}"
	>
		<p class="from" ?hidden="${(x) => !x.from}">${(x) => x.from}</p>
		<h2 id="modal-title">${(x) => x.input?.title ?? ''}</h2>
		<p id="modal-body" ?hidden="${(x) => !x.input?.body}">${(x) => x.input?.body ?? ''}</p>
		<div class="content" ${ref('content')}></div>
		<p class="error" role="alert" ?hidden="${(x) => !x.error}">${(x) => x.error}</p>
		<div class="buttons" ${ref('buttons')}></div>
	</dialog>
`;

const styles = [
	actionButton,
	css`
		:host {
			display: contents;
		}
		[hidden] {
			display: none;
		}
		dialog {
			box-sizing: border-box;
			inline-size: min(92vw, var(--violet-shell-size-main-min));
			max-block-size: 80dvh;
			padding: var(--violet-space-layout-md);
			border: 0;
			border-radius: var(--violet-radius-lg);
			background: var(--violet-color-surface-floating);
			box-shadow: var(--violet-shadow-floating);
			color: var(--violet-color-text-primary);
			font-family: var(--violet-font-family-body);
			opacity: 0;
			transition:
				opacity var(--violet-duration-fast) var(--violet-easing-standard),
				display var(--violet-duration-fast) var(--violet-easing-standard) allow-discrete,
				overlay var(--violet-duration-fast) var(--violet-easing-standard) allow-discrete;
		}
		/* A dialog sits at the inline end, above the parts; the next ones above it (data-stack, its place). */
		dialog:not(:modal) {
			position: fixed;
			inset: auto var(--violet-space-layout-md) var(--violet-space-layout-md) auto;
			z-index: var(--violet-z-index-popover);
			margin: 0;
			inline-size: min(92vw, var(--violet-shell-size-sidebar-max));
			border: 1px solid var(--violet-color-border-strong);
		}
		:host([data-stack='1']) dialog:not(:modal) {
			inset-block-end: calc(var(--violet-space-layout-md) + var(--violet-shell-size-titlebar) * 2);
		}
		:host([data-stack='2']) dialog:not(:modal) {
			inset-block-end: calc(var(--violet-space-layout-md) + var(--violet-shell-size-titlebar) * 4);
		}
		:host([data-stack='3']) dialog:not(:modal) {
			inset-block-end: calc(var(--violet-space-layout-md) + var(--violet-shell-size-titlebar) * 6);
		}
		dialog[open] {
			opacity: 1;
			transition:
				opacity var(--violet-duration-base) var(--violet-easing-emphasized),
				display var(--violet-duration-base) var(--violet-easing-emphasized) allow-discrete,
				overlay var(--violet-duration-base) var(--violet-easing-emphasized) allow-discrete;
		}
		@starting-style {
			dialog[open] {
				opacity: 0;
			}
		}
		dialog::backdrop {
			background: color-mix(in srgb, var(--violet-color-surface-page) 60%, transparent);
		}
		h2 {
			margin-block: 0 var(--violet-space-stack-sm);
			font-size: var(--violet-type-title-sm-size);
			line-height: var(--violet-type-title-sm-line);
			font-weight: var(--violet-type-title-sm-weight);
		}
		p {
			margin-block: 0 var(--violet-space-stack-md);
			color: var(--violet-color-text-secondary);
			font-size: var(--violet-type-body-md-size);
			line-height: var(--violet-type-body-md-line);
			overflow-wrap: anywhere;
		}
		.from {
			margin-block-end: var(--violet-space-stack-xs);
			font-size: var(--violet-type-label-sm-size);
			line-height: var(--violet-type-label-sm-line);
		}
		.error {
			color: var(--violet-color-state-danger-text);
		}
		.content:empty {
			display: none;
		}
		.content {
			margin-block-end: var(--violet-space-stack-md);
		}
		.details {
			margin: 0;
			padding: var(--violet-size-space-sm);
			border-radius: var(--violet-radius-md);
			background: var(--violet-color-surface-subtle);
			color: var(--violet-color-text-primary);
			font-family: var(--violet-font-family-mono);
			white-space: pre-wrap;
		}
		.field {
			display: flex;
			flex-direction: column;
			gap: var(--violet-space-stack-xs);
			margin-block-end: var(--violet-space-stack-sm);
			font-size: var(--violet-type-label-sm-size);
			line-height: var(--violet-type-label-sm-line);
			font-weight: var(--violet-type-label-sm-weight);
		}
		.field.check {
			flex-direction: row-reverse;
			justify-content: flex-end;
			align-items: center;
		}
		.field .hint {
			margin: 0;
			font-weight: var(--violet-type-body-md-weight);
		}
		input:not([type='checkbox']),
		select {
			box-sizing: border-box;
			min-block-size: var(--violet-size-target-natural);
			padding-inline: var(--violet-size-space-sm);
			border: 1px solid var(--violet-color-field-border);
			border-radius: var(--violet-radius-md);
			background: var(--violet-color-field-background);
			color: var(--violet-color-field-text);
			font: inherit;
			font-weight: var(--violet-type-body-md-weight);
		}
		input[type='checkbox'] {
			inline-size: var(--violet-size-target-compact);
			block-size: var(--violet-size-target-compact);
			margin: 0;
		}
		input:focus-visible,
		select:focus-visible {
			outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
			outline-offset: var(--violet-size-space-xs);
			border-color: var(--violet-color-field-border-focus);
		}
		input[aria-invalid='true'] {
			border-color: var(--violet-color-field-border-invalid);
		}
		.buttons {
			display: flex;
			flex-wrap: wrap;
			justify-content: flex-end;
			gap: var(--violet-space-inline-sm);
		}
		@media (prefers-reduced-motion: reduce) {
			dialog,
			dialog[open] {
				transition-duration: var(--violet-duration-fast);
			}
		}
		@media (forced-colors: active) {
			dialog {
				border: 1px solid CanvasText;
				background: Canvas;
				color: CanvasText;
			}
			p,
			.error {
				color: CanvasText;
			}
		}
	`,
];

/** The answers a question offers (6.4): its actions with cancel, or cancel and confirm. */
function answersOf(input: QuestionInput): OverlayActionV1[] {
	const given = input as {
		actions?: OverlayActionV1[];
		confirmLabel?: string;
		cancelLabel?: string;
		danger?: boolean;
	};
	const cancel: OverlayActionV1 = { id: 'cancel', label: given.cancelLabel ?? 'Cancel' };
	if (given.actions) {
		return given.actions.some((action) => action.id === 'cancel')
			? given.actions
			: [cancel, ...given.actions];
	}
	return [
		cancel,
		{ id: 'confirm', label: given.confirmLabel ?? 'OK', tone: given.danger ? 'danger' : 'primary' },
	];
}

/**
 * A person's answer to a question, with the id of the question shown when they gave it; `withdrawn` when the dialog
 * closed with no gesture of theirs before it (step 6's second round, 6).
 */
export type AnswerFn = (
	overlayId: string,
	result: string,
	value?: unknown,
	reason?: 'withdrawn'
) => void;

/**
 * Each question's answer callback, held here and never on the element (the trust review's blocker 1): nothing that
 * reaches the element, an app's own element inside it among them, can call or replace it.
 */
const ANSWERS = new WeakMap<object, AnswerFn>();

/** Bind a question's answer to its renderer's callback; only the renderer, which imports this, does. */
export function bindAnswer(question: LoamModal, answer: AnswerFn): void {
	ANSWERS.set(question, answer);
}

export class LoamModal extends FASTElement {
	declare input: QuestionInput | null;
	declare from: string;
	declare error: string;
	declare dialog: HTMLDialogElement;
	declare content: HTMLElement;
	declare buttons: HTMLElement;
	overlayId = '';
	kind: QuestionOptions['kind'] = 'modal';
	#fields: PromptFields | null = null;
	/** A `close` the shell's own `hide()` queued, which reports nothing whenever it arrives (the review's 6). */
	#closing = false;
	#opener: Element | null = null;

	constructor() {
		super();
		this.input = null;
		this.from = '';
		this.error = '';
	}

	get isOpen(): boolean {
		return this.dialog?.open === true;
	}

	/** Show it, once its text is in, with focus on its first answer or field. */
	async show(
		overlayId: string,
		input: QuestionInput,
		options: QuestionOptions = { kind: 'modal' }
	): Promise<void> {
		this.overlayId = overlayId;
		this.#escaped = false;
		this.kind = options.kind;
		this.input = input;
		this.from = options.from ?? '';
		this.error = '';
		await Updates.next();
		if (this.overlayId !== overlayId) return;
		const doc = this.ownerDocument;
		this.content.replaceChildren();
		this.#fields = null;
		if (options.kind === 'prompt' && options.fields) {
			this.#fields = options.fields;
			this.content.append(this.#fields.element);
		} else if (options.element) this.content.append(options.element);
		else if (options.details !== undefined) {
			const details = doc.createElement('p');
			details.className = 'details';
			details.textContent = options.details;
			this.content.append(details);
		}
		this.buttons.replaceChildren();
		const answers = answersOf(input);
		let first: HTMLElement | null = null;
		for (const answer of answers) {
			const button = doc.createElement('button');
			button.type = 'button';
			const tone =
				answer.tone === 'danger'
					? 'danger'
					: answer.tone === 'primary' || answer.default
						? 'primary'
						: '';
			// `cancel` and `confirm` keep phase 1's classes, which the shell's own tests press.
			const which = answer.id === 'cancel' || answer.id === 'confirm' ? answer.id : '';
			button.className = ['action', tone, which].filter(Boolean).join(' ');
			button.textContent = answer.label;
			button.dataset.answer = answer.id;
			// A person's press alone: a script's `click()` is not trusted, and answers nothing.
			button.addEventListener('click', (event) => {
				if (event.isTrusted) this.#answer(answer.id);
			});
			this.buttons.append(button);
			if (answer.default) first = button;
		}
		const danger = (input as { danger?: boolean }).danger === true;
		if (options.asks === 'confirmation')
			first = this.buttons.querySelector<HTMLElement>('[data-answer="cancel"]');
		first ??= this.buttons.querySelector<HTMLElement>(
			`[data-answer="${danger ? 'cancel' : answers.some((each) => each.id === 'confirm') ? 'confirm' : 'cancel'}"]`
		);
		this.#opener = deepActiveElement(doc);
		if (options.kind === 'dialog') {
			this.dialog.removeAttribute('aria-modal');
			this.dialog.show();
			// A dialog opens beside the work: it takes no focus from it (the review's 10), though `show()` moves focus
			// in; it goes back to where the person was. A press, or Tab, reaches the dialog.
			const was = this.#opener;
			if (was instanceof HTMLElement && was.isConnected && was !== doc.body) {
				was.focus({ preventScroll: true });
			}
			return;
		}
		// A modal and a prompt are modal (section 15), whatever an assistive technology makes of `showModal`.
		this.dialog.setAttribute('aria-modal', 'true');
		this.dialog.showModal();
		(this.#fields?.first ?? first)?.focus();
	}

	/** Close it, returning focus to the invoker. False when the invoker has gone, as a switch removes it. */
	hide(): boolean {
		this.overlayId = '';
		if (!this.dialog?.open) return true;
		const inside =
			this.contains(deepActiveElement(this.ownerDocument)) ||
			this.shadowRoot?.activeElement != null;
		this.#closing = true;
		this.dialog.close();
		this.content.replaceChildren();
		const opener = this.#opener;
		this.#opener = null;
		// A non-modal dialog the person was not in leaves focus where it is.
		if (this.kind === 'dialog' && !inside) return true;
		if (opener instanceof HTMLElement && opener.isConnected && !opener.closest('[inert]')) {
			opener.focus();
			return true;
		}
		return false;
	}

	/** What the kernel refused of an answer, shown in place, the prompt kept open. */
	refuse(message: string): void {
		this.error = message;
		this.#fields?.first?.setAttribute('aria-invalid', 'true');
	}

	#answer(result: string, reason?: 'withdrawn'): void {
		if (this.overlayId === '') return;
		const value = result !== 'cancel' && this.#fields ? this.#fields.read() : undefined;
		ANSWERS.get(this)?.(this.overlayId, result, value, reason);
	}

	/** A person's own Escape since it opened: the browser's close that follows is theirs (second round, 6). */
	#escaped = false;

	handleCancel(event: Event): void {
		event.preventDefault();
		if (!event.isTrusted) return;
		// Its Escape is handled here, the dialog kept open: a later close with no gesture is not theirs (third round, F;
		// Opus 5). One the browser will not let be kept (Chromium's second Escape) is handled by the close that follows.
		if (event.cancelable) this.#escaped = false;
		this.#answer('cancel');
	}

	/**
	 * The browser closed it itself, as Chromium does on a second Escape: the kernel must hear. The `close` the shell's own
	 * `hide()` queued is its own, whenever it arrives, even after the next question took this `<dialog>`, so it never
	 * cancels that one (the review's 6).
	 */
	handleClosed(): void {
		if (this.#closing) {
			this.#closing = false;
			return;
		}
		// The browser closed it on a person's Escape: their cancel. Closed with no gesture of theirs, as a script's
		// `close()` does: the question ends `withdrawn`, which never counts as the person's decline (second round, 6).
		if (this.overlayId !== '' && !this.dialog.open) {
			const escaped = this.#escaped;
			this.#escaped = false;
			this.#answer('cancel', escaped ? undefined : 'withdrawn');
		}
	}

	handleKeydown(event: KeyboardEvent): boolean {
		if (event.key === 'Escape' && event.isTrusted) this.#escaped = true;
		if (this.kind === 'dialog') {
			// A non-modal dialog has no cancel event of its own: a person's Escape cancels it here.
			if (event.key === 'Escape' && !event.defaultPrevented && event.isTrusted) {
				event.preventDefault();
				this.#escaped = false;
				this.#answer('cancel');
			}
			return true;
		}
		trapTab(event, this.dialog);
		return true;
	}
}
for (const name of ['input', 'from', 'error'] as const) observable(LoamModal.prototype, name);

export const modalDefinition = { name: 'loam-modal', template, styles } as const;
