/**
 * @fileoverview `loam-toast-region` and `loam-toast` (phase 1 specification, section 8). The region is
 * `role="status"`, in the top layer with `popover="manual"`, and stays open while it is empty, because a
 * live region must be in the accessibility tree before its text arrives. It announces additions alone,
 * not every toast again. An item's tone is its icon and a word as well as its color; a `danger` item is
 * `role="alert"`. A state's background may be translucent, so each sits on the floating surface.
 */

import { attr, css, FASTElement, html } from '@lushly-dev/fast-element';

export const TOAST_DISMISS_EVENT = 'loam-toast-dismiss';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

const TONE_WORD: Record<ToastTone, string> = {
	info: 'Information',
	success: 'Success',
	warning: 'Warning',
	danger: 'Error',
};

const regionStyles = css`
	:host {
		position: fixed;
		inset: auto var(--space-inline-md) calc(var(--shell-size-tabbar) + var(--space-inline-sm)) auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-stack-sm);
		box-sizing: border-box;
		inline-size: auto;
		max-inline-size: min(92vw, var(--shell-size-main-min));
		block-size: auto;
		max-block-size: calc(100dvh - var(--shell-size-tabbar) - var(--shell-size-titlebar));
		margin: 0;
		padding: 0;
		border: 0;
		overflow: visible;
		background: transparent;
		color: var(--color-text-primary);
		pointer-events: none;
	}
	:host(:has(loam-toast)) {
		overflow-block: auto;
	}
	.announcement {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
`;

export class LoamToastRegion extends FASTElement {
	override connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute('role', 'status');
		this.setAttribute('aria-live', 'polite');
		this.setAttribute('aria-atomic', 'false');
		this.setAttribute('aria-relevant', 'additions');
		this.setAttribute('aria-label', 'Notifications');
		this.setAttribute('popover', 'manual');
		this.showPopover();
	}

	/** Say something no toast shows, such as an app opening. */
	announce(text: string): void {
		const announcement = this.shadowRoot?.querySelector('.announcement');
		if (announcement) announcement.textContent = text;
	}
}

const toastTemplate = html<LoamToast>`
	<violet-icon
		class="tone"
		icon="${(x) => (x.tone === 'success' ? 'system/checkmark' : 'system/warning')}"
		?hidden="${(x) => x.tone === 'info'}"
		decorative
	></violet-icon>
	<span class="word">${(x) => TONE_WORD[x.tone]}:</span>
	<span class="message">${(x) => x.message}</span>
	<button
		class="dismiss"
		type="button"
		aria-label="Dismiss notification"
		title="Dismiss notification"
		@click="${(x) => x.dismiss()}"
	>
		<violet-icon icon="system/close" decorative></violet-icon>
	</button>
`;

const toastStyles = [
	css`
		:host {
			display: flex;
			align-items: center;
			gap: var(--space-inline-sm);
			padding-block: var(--space-stack-sm);
			padding-inline: var(--space-inline-md);
			border: 1px solid var(--color-border-strong);
			border-radius: var(--radius-md);
			background: var(--color-surface-floating);
			color: var(--color-text-primary);
			box-shadow: var(--shadow-floating);
			font-family: 'Montserrat', 'Segoe UI', sans-serif;
			font-size: var(--type-body-md-size);
			line-height: var(--type-body-md-line);
			pointer-events: auto;
			opacity: 1;
			transition: opacity var(--duration-base) var(--easing-emphasized);
		}
		@starting-style {
			:host {
				opacity: 0;
			}
		}
		@media (prefers-reduced-motion: reduce) {
			:host {
				transition-duration: var(--duration-fast);
			}
		}
		.word {
			flex: none;
			font-weight: var(--weight-semibold);
		}
		:host([tone='info']) .word,
		:host([tone='success']) .word {
			position: absolute;
			inline-size: 1px;
			block-size: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		:host([tone='success']) {
			border-color: var(--color-state-success-border);
			background:
				linear-gradient(var(--color-state-success-background), var(--color-state-success-background)),
				var(--color-surface-floating);
			color: var(--color-state-success-text);
		}
		:host([tone='warning']) {
			border-color: var(--color-state-warning-border);
			background:
				linear-gradient(var(--color-state-warning-background), var(--color-state-warning-background)),
				var(--color-surface-floating);
			color: var(--color-state-warning-text);
		}
		:host([tone='danger']) {
			border-color: var(--color-state-danger-border);
			background:
				linear-gradient(var(--color-state-danger-background), var(--color-state-danger-background)),
				var(--color-surface-floating);
			color: var(--color-state-danger-text);
		}
		[hidden] {
			display: none;
		}
		.tone {
			flex: none;
			--violet-icon-size: var(--size-line-md);
		}
		.message {
			flex: 1;
			min-inline-size: 0;
			overflow-wrap: anywhere;
		}
		.dismiss {
			flex: none;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			box-sizing: border-box;
			min-inline-size: var(--size-target-natural);
			min-block-size: var(--size-target-natural);
			padding: 0;
			border: 1px solid transparent;
			border-radius: var(--radius-md);
			background: transparent;
			color: inherit;
			cursor: pointer;
		}
		.dismiss violet-icon {
			--violet-icon-size: var(--size-line-sm);
		}
		.dismiss:hover {
			background: var(--color-action-secondary-hover);
			color: var(--color-text-primary);
		}
		.dismiss:active {
			background: var(--color-action-secondary-pressed);
			color: var(--color-text-primary);
		}
		.dismiss:focus-visible {
			outline: var(--shell-size-focus) solid var(--color-focus-ring);
			outline-offset: calc(-1 * var(--shell-size-focus));
		}
		@media (forced-colors: active) {
			:host,
			:host([tone='success']),
			:host([tone='warning']),
			:host([tone='danger']) {
				border-color: CanvasText;
				background: Canvas;
				color: CanvasText;
			}
			.dismiss {
				border-color: ButtonText;
				background: ButtonFace;
				color: ButtonText;
			}
			.dismiss:hover,
			.dismiss:active {
				border-color: Highlight;
				background: Highlight;
				color: HighlightText;
			}
			.dismiss:focus-visible {
				outline-color: Highlight;
			}
			.dismiss:hover:focus-visible {
				outline-color: HighlightText;
			}
		}
	`,
];

export class LoamToast extends FASTElement {
	declare overlayId: string;
	declare message: string;
	declare tone: ToastTone;

	constructor() {
		super();
		this.overlayId = '';
		this.message = '';
		this.tone = 'info';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		if (this.tone === 'danger') this.setAttribute('role', 'alert');
	}

	dismiss(): void {
		this.dispatchEvent(
			new CustomEvent(TOAST_DISMISS_EVENT, {
				detail: { overlayId: this.overlayId },
				bubbles: true,
				composed: true,
			})
		);
	}
}
attr({ attribute: 'overlay-id' })(LoamToast.prototype, 'overlayId');
attr(LoamToast.prototype, 'message');
attr(LoamToast.prototype, 'tone');

export const toastRegionDefinition = {
	name: 'loam-toast-region',
	template: html<LoamToastRegion>`<slot></slot><span class="announcement"></span>`,
	styles: regionStyles,
} as const;
export const toastDefinition = {
	name: 'loam-toast',
	template: toastTemplate,
	styles: toastStyles,
} as const;
