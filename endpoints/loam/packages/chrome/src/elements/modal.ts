/**
 * @fileoverview `loam-modal`: an overlay's question (phase 1 specification, section 8; phase 4 specification, 6.3 to
 * 6.7), a native `<dialog>` holding an owner line, a title, a body, an app's own element or a prompt's fields, and its
 * answers, as text. In the slot (a modal or a prompt) it opens with `showModal()`, `aria-modal`, and Tab wraps; as a
 * dialog it opens with `show()`, non-modal. Focus starts on the default answer, on cancel when it is `danger`, or on a
 * prompt's first field, and returns to the invoker. Escape cancels. It closes when the kernel's state says so: a press
 * is an event, and the shell runs `overlay-dismiss`, showing what the kernel refused.
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
import { type PromptFields, promptFields } from './prompt-fields.js';

export const MODAL_RESULT_EVENT = 'loam-modal-result';

/** What the shell shows: a modal's, a dialog's or a prompt's input. */
export type QuestionInput = ModalInputV1 | DialogInputV1 | PromptInputV1;

/** How it shows: in the slot, or as a non-modal dialog. */
export interface QuestionOptions {
	kind: 'modal' | 'dialog' | 'prompt';
	/** The owner line (6.6), empty for the shell's own. */
	from?: string;
	/** An app's own element, mounted for it (6.4). */
	element?: HTMLElement | null;
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
			inline-size: min(92vw, var(--shell-size-main-min));
			max-block-size: 80dvh;
			padding: var(--space-layout-md);
			border: 0;
			border-radius: var(--radius-lg);
			background: var(--color-surface-floating);
			box-shadow: var(--shadow-floating);
			color: var(--color-text-primary);
			font-family: var(--font-family-body);
			opacity: 0;
			transition:
				opacity var(--duration-fast) var(--easing-standard),
				display var(--duration-fast) var(--easing-standard) allow-discrete,
				overlay var(--duration-fast) var(--easing-standard) allow-discrete;
		}
		/* A dialog sits at the inline end, above the parts; the next ones above it (data-stack, its place). */
		dialog:not(:modal) {
			position: fixed;
			inset: auto var(--space-layout-md) var(--space-layout-md) auto;
			z-index: var(--z-index-popover);
			margin: 0;
			inline-size: min(92vw, var(--shell-size-sidebar-max));
			border: 1px solid var(--color-border-strong);
		}
		:host([data-stack='1']) dialog:not(:modal) {
			inset-block-end: calc(var(--space-layout-md) + var(--shell-size-titlebar) * 2);
		}
		:host([data-stack='2']) dialog:not(:modal) {
			inset-block-end: calc(var(--space-layout-md) + var(--shell-size-titlebar) * 4);
		}
		:host([data-stack='3']) dialog:not(:modal) {
			inset-block-end: calc(var(--space-layout-md) + var(--shell-size-titlebar) * 6);
		}
		dialog[open] {
			opacity: 1;
			transition:
				opacity var(--duration-base) var(--easing-emphasized),
				display var(--duration-base) var(--easing-emphasized) allow-discrete,
				overlay var(--duration-base) var(--easing-emphasized) allow-discrete;
		}
		@starting-style {
			dialog[open] {
				opacity: 0;
			}
		}
		dialog::backdrop {
			background: color-mix(in srgb, var(--color-surface-page) 60%, transparent);
		}
		h2 {
			margin-block: 0 var(--space-stack-sm);
			font-size: var(--type-title-sm-size);
			line-height: var(--type-title-sm-line);
			font-weight: var(--type-title-sm-weight);
		}
		p {
			margin-block: 0 var(--space-stack-md);
			color: var(--color-text-secondary);
			font-size: var(--type-body-md-size);
			line-height: var(--type-body-md-line);
			overflow-wrap: anywhere;
		}
		.from {
			margin-block-end: var(--space-stack-xs);
			font-size: var(--type-label-sm-size);
			line-height: var(--type-label-sm-line);
		}
		.error {
			color: var(--color-state-danger-text);
		}
		.content:empty {
			display: none;
		}
		.content {
			margin-block-end: var(--space-stack-md);
		}
		.field {
			display: flex;
			flex-direction: column;
			gap: var(--space-stack-xs);
			margin-block-end: var(--space-stack-sm);
			font-size: var(--type-label-sm-size);
			line-height: var(--type-label-sm-line);
			font-weight: var(--type-label-sm-weight);
		}
		.field.check {
			flex-direction: row-reverse;
			justify-content: flex-end;
			align-items: center;
		}
		.field .hint {
			margin: 0;
			font-weight: var(--type-body-md-weight);
		}
		input:not([type='checkbox']),
		select {
			box-sizing: border-box;
			min-block-size: var(--size-target-natural);
			padding-inline: var(--size-space-sm);
			border: 1px solid var(--color-field-border);
			border-radius: var(--radius-md);
			background: var(--color-field-background);
			color: var(--color-field-text);
			font: inherit;
			font-weight: var(--type-body-md-weight);
		}
		input[type='checkbox'] {
			inline-size: var(--size-target-compact);
			block-size: var(--size-target-compact);
			margin: 0;
		}
		input:focus-visible,
		select:focus-visible {
			outline: var(--shell-size-focus) solid var(--color-focus-ring);
			outline-offset: var(--size-space-xs);
			border-color: var(--color-field-border-focus);
		}
		input[aria-invalid='true'] {
			border-color: var(--color-field-border-invalid);
		}
		.buttons {
			display: flex;
			flex-wrap: wrap;
			justify-content: flex-end;
			gap: var(--space-inline-sm);
		}
		@media (prefers-reduced-motion: reduce) {
			dialog,
			dialog[open] {
				transition-duration: var(--duration-fast);
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
		this.kind = options.kind;
		this.input = input;
		this.from = options.from ?? '';
		this.error = '';
		await Updates.next();
		if (this.overlayId !== overlayId) return;
		const doc = this.ownerDocument;
		this.content.replaceChildren();
		this.#fields = null;
		if (options.kind === 'prompt') {
			const prompt = input as PromptInputV1;
			this.#fields = promptFields(doc, prompt.schema, prompt.value);
			this.content.append(this.#fields.element);
		} else if (options.element) this.content.append(options.element);
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
			button.addEventListener('click', () => this.answer(answer.id));
			this.buttons.append(button);
			if (answer.default) first = button;
		}
		const danger = (input as { danger?: boolean }).danger === true;
		first ??= this.buttons.querySelector<HTMLElement>(
			`[data-answer="${danger ? 'cancel' : answers.some((each) => each.id === 'confirm') ? 'confirm' : 'cancel'}"]`
		);
		this.#opener = deepActiveElement(doc);
		if (options.kind === 'dialog') {
			this.dialog.removeAttribute('aria-modal');
			this.dialog.show();
		} else {
			// A modal and a prompt are modal (section 15), whatever an assistive technology makes of `showModal`.
			this.dialog.setAttribute('aria-modal', 'true');
			this.dialog.showModal();
		}
		(this.#fields?.first ?? first)?.focus();
	}

	/** Close it, returning focus to the invoker. False when the invoker has gone, as a switch removes it. */
	hide(): boolean {
		this.overlayId = '';
		if (!this.dialog?.open) return true;
		const inside =
			this.contains(deepActiveElement(this.ownerDocument)) ||
			this.shadowRoot?.activeElement != null;
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

	answer(result: string): void {
		if (this.overlayId === '') return;
		const value = result !== 'cancel' && this.#fields ? this.#fields.read() : undefined;
		this.dispatchEvent(
			new CustomEvent(MODAL_RESULT_EVENT, {
				detail: { overlayId: this.overlayId, result, ...(value !== undefined ? { value } : {}) },
				bubbles: true,
				composed: true,
			})
		);
	}

	handleCancel(event: Event): void {
		event.preventDefault();
		this.answer('cancel');
	}

	/** The browser closed it itself, as Chromium does on a second Escape: the kernel must hear. */
	handleClosed(): void {
		if (this.overlayId !== '') this.answer('cancel');
	}

	handleKeydown(event: KeyboardEvent): boolean {
		if (this.kind === 'dialog') {
			// A non-modal dialog has no cancel event of its own: Escape cancels it here.
			if (event.key === 'Escape' && !event.defaultPrevented) {
				event.preventDefault();
				this.answer('cancel');
			}
			return true;
		}
		trapTab(event, this.dialog);
		return true;
	}
}
for (const name of ['input', 'from', 'error'] as const) observable(LoamModal.prototype, name);

export const modalDefinition = { name: 'loam-modal', template, styles } as const;
