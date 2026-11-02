/**
 * @fileoverview `loam-modal`: an overlay's modal (phase 1 specification, section 8), a native `<dialog>`
 * opened with `showModal()`, holding a title, a body and two buttons, as text. Focus starts on cancel when
 * it is `danger`, otherwise on confirm. Escape cancels, Tab wraps as the drawers do, and focus returns to
 * the invoker. It closes when the kernel's state says so: a press is an event, and the shell runs
 * `overlay-dismiss`.
 */

import { css, FASTElement, html, observable, ref, Updates } from '@lushly-dev/fast-element';
import type { ModalInputV1 } from '@lushly-dev/loam-sdk';
import { actionButton } from '../apps/action-styles.js';
import { deepActiveElement } from './events.js';
import { trapTab } from './focus.js';

export const MODAL_RESULT_EVENT = 'loam-modal-result';

const template = html<LoamModal>`
	<dialog
		${ref('dialog')}
		aria-labelledby="modal-title"
		aria-describedby="modal-body"
		@cancel="${(x, c) => x.handleCancel(c.event)}"
		@close="${(x) => x.handleClosed()}"
		@keydown="${(x, c) => x.handleKeydown(c.event as KeyboardEvent)}"
	>
		<h2 id="modal-title">${(x) => x.input?.title ?? ''}</h2>
		<p id="modal-body">${(x) => x.input?.body ?? ''}</p>
		<div class="buttons">
			<button class="action cancel" type="button" @click="${(x) => x.answer('cancel')}">
				${(x) => x.input?.cancelLabel ?? 'Cancel'}
			</button>
			<button
				class="${(x) => (x.input?.danger ? 'action danger confirm' : 'action primary confirm')}"
				type="button"
				@click="${(x) => x.answer('confirm')}"
			>
				${(x) => x.input?.confirmLabel ?? 'OK'}
			</button>
		</div>
	</dialog>
`;

const styles = [
	actionButton,
	css`
		:host {
			display: contents;
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
			font-family: 'Montserrat', 'Segoe UI', sans-serif;
			opacity: 0;
			transition:
				opacity var(--duration-fast) var(--easing-standard),
				display var(--duration-fast) var(--easing-standard) allow-discrete,
				overlay var(--duration-fast) var(--easing-standard) allow-discrete;
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
			p {
				color: CanvasText;
			}
		}
	`,
];

export class LoamModal extends FASTElement {
	declare input: ModalInputV1 | null;
	declare dialog: HTMLDialogElement;
	overlayId = '';
	#opener: Element | null = null;

	constructor() {
		super();
		this.input = null;
	}

	get isOpen(): boolean {
		return this.dialog?.open === true;
	}

	/** Show the modal, once its text is in, with focus on its first answer. */
	async show(overlayId: string, input: ModalInputV1): Promise<void> {
		this.overlayId = overlayId;
		this.input = input;
		await Updates.next();
		if (this.overlayId !== overlayId) return;
		this.#opener = deepActiveElement(this.ownerDocument);
		this.dialog.showModal();
		this.shadowRoot
			?.querySelector<HTMLElement>(input.danger ? 'button.cancel' : 'button.confirm')
			?.focus();
	}

	/** Close it, returning focus to the invoker. False when the invoker has gone, as a switch removes it. */
	hide(): boolean {
		this.overlayId = '';
		if (!this.dialog.open) return true;
		this.dialog.close();
		const opener = this.#opener;
		this.#opener = null;
		if (opener instanceof HTMLElement && opener.isConnected && !opener.closest('[inert]')) {
			opener.focus();
			return true;
		}
		return false;
	}

	answer(result: 'confirm' | 'cancel'): void {
		if (this.overlayId === '') return;
		this.dispatchEvent(
			new CustomEvent(MODAL_RESULT_EVENT, {
				detail: { overlayId: this.overlayId, result },
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
		trapTab(event, this.dialog);
		return true;
	}
}
observable(LoamModal.prototype, 'input');

export const modalDefinition = { name: 'loam-modal', template, styles } as const;
