/**
 * @fileoverview `loam-toast-region` and `loam-toast` (phase 1 specification, section 8). The region is
 * `role="status"`, in the top layer with `popover="manual"`, and stays open while it is empty, because a
 * live region must be in the accessibility tree before its text arrives. An item's tone is its icon and
 * a word as well as its color. A `danger` item is `role="alert"`.
 */

import { attr, css, FASTElement, html } from '@lushly-dev/fast-element';
import { visuallyHidden } from './styles.js';

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
		margin: 0;
		padding: 0;
		border: 0;
		overflow: visible;
		background: transparent;
		color: var(--color-text-primary);
		pointer-events: none;
	}
`;

export class LoamToastRegion extends FASTElement {
	override connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute('role', 'status');
		this.setAttribute('aria-live', 'polite');
		this.setAttribute('aria-label', 'Notifications');
		this.setAttribute('popover', 'manual');
		this.show();
	}

	/** Bring the region above what opened since, as the top layer stacks in opening order. */
	show(): void {
		if (this.matches(':popover-open')) this.hidePopover();
		this.showPopover();
	}
}

const toastTemplate = html<LoamToast>`
	<violet-icon
		class="tone"
		icon="${(x) => (x.tone === 'success' ? 'system/checkmark' : 'system/warning')}"
		?hidden="${(x) => x.tone === 'info'}"
		decorative
	></violet-icon>
	<span class="visually-hidden">${(x) => TONE_WORD[x.tone]}:</span>
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
	visuallyHidden,
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
		:host([tone='success']) {
			border-color: var(--color-state-success-border);
			background: var(--color-state-success-background);
			color: var(--color-state-success-text);
		}
		:host([tone='warning']) {
			border-color: var(--color-state-warning-border);
			background: var(--color-state-warning-background);
			color: var(--color-state-warning-text);
		}
		:host([tone='danger']) {
			border-color: var(--color-state-danger-border);
			background: var(--color-state-danger-background);
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
	template: html<LoamToastRegion>`<slot></slot>`,
	styles: regionStyles,
} as const;
export const toastDefinition = {
	name: 'loam-toast',
	template: toastTemplate,
	styles: toastStyles,
} as const;
