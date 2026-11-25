/**
 * @fileoverview `loam-toast-region` and `loam-toast` (phase 1 specification, section 8). The region is
 * `role="status"`, in the top layer with `popover="manual"`, and stays open while it is empty, because a
 * live region must be in the accessibility tree before its text arrives. It announces additions alone,
 * not every toast again. An item's tone is its icon and a word as well as its color; a `danger` item is
 * `role="alert"`. A state's background may be translucent, so each sits on the floating surface.
 *
 * Phase 4 (its 6.4, 6.6 and 6.7): an app's or an agent's toast leads with its owner line, which the kernel sets and
 * the shell's own never has; a toast with a link offers it; and while the region holds a toast it is an F6 stop. A
 * toast that also landed in the inbox, as a sticky one does, offers "Open inbox", which opens the inbox at it (step 5).
 */

import { attr, css, FASTElement, html } from '@lushly-dev/fast-element';

export const TOAST_DISMISS_EVENT = 'loam-toast-dismiss';
/** A toast that also landed in the inbox, asked to open the inbox at its notice (phase 4 specification, 6.7). */
export const TOAST_INBOX_EVENT = 'loam-toast-inbox';

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
		inset: auto var(--violet-space-inline-group) calc(var(--violet-shell-size-tabbar) + var(--violet-space-inline-tight)) auto;
		display: flex;
		flex-direction: column;
		gap: var(--violet-space-stack-group);
		box-sizing: border-box;
		inline-size: auto;
		max-inline-size: min(92vw, var(--violet-shell-size-main-min));
		block-size: auto;
		max-block-size: calc(100dvh - var(--violet-shell-size-tabbar) - var(--violet-shell-size-titlebar));
		margin: 0;
		padding: 0;
		border: 0;
		overflow: visible;
		background: transparent;
		color: var(--violet-color-text-primary);
		pointer-events: none;
	}
	:host(:has(loam-toast)) {
		overflow-block: auto;
	}
	:host(:focus-visible) {
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: var(--violet-shell-size-focus);
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
	<span class="body">
		<span class="from" ?hidden="${(x) => !x.from}">${(x) => x.from}</span>
		<span class="message">${(x) => x.message}</span>
	</span>
	<a class="link" href="${(x) => x.href}" ?hidden="${(x) => !x.href}">Open</a>
	<button
		class="inbox"
		type="button"
		?hidden="${(x) => !x.notification}"
		@click="${(x) => x.openInbox()}"
	>
		Open inbox
	</button>
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
			gap: var(--violet-space-inline-tight);
			padding-block: var(--violet-space-stack-group);
			padding-inline: var(--violet-space-inline-group);
			border: 1px solid var(--violet-color-border-strong);
			border-radius: var(--violet-radius-control);
			background: var(--violet-color-surface-floating);
			color: var(--violet-color-text-primary);
			box-shadow: var(--violet-shadow-floating);
			font-family: var(--violet-font-family-body);
			font-size: var(--violet-type-body-size);
			line-height: var(--violet-type-body-line);
			pointer-events: auto;
			opacity: 1;
			transition: opacity var(--violet-duration-base) var(--violet-easing-emphasized);
		}
		@starting-style {
			:host {
				opacity: 0;
			}
		}
		@media (prefers-reduced-motion: reduce) {
			:host {
				transition-duration: var(--violet-duration-fast);
			}
		}
		.word {
			flex: none;
			font-weight: var(--violet-weight-semibold);
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
			border-color: var(--violet-color-state-success-border);
			background:
				linear-gradient(var(--violet-color-state-success-background), var(--violet-color-state-success-background)),
				var(--violet-color-surface-floating);
			color: var(--violet-color-state-success-text);
		}
		:host([tone='warning']) {
			border-color: var(--violet-color-state-warning-border);
			background:
				linear-gradient(var(--violet-color-state-warning-background), var(--violet-color-state-warning-background)),
				var(--violet-color-surface-floating);
			color: var(--violet-color-state-warning-text);
		}
		:host([tone='danger']) {
			border-color: var(--violet-color-state-danger-border);
			background:
				linear-gradient(var(--violet-color-state-danger-background), var(--violet-color-state-danger-background)),
				var(--violet-color-surface-floating);
			color: var(--violet-color-state-danger-text);
		}
		[hidden] {
			display: none;
		}
		.tone {
			flex: none;
			--violet-icon-size: var(--violet-type-body-line);
		}
		.body {
			display: flex;
			flex: 1;
			flex-direction: column;
			min-inline-size: 0;
		}
		.from {
			font-size: var(--violet-type-label-size);
			line-height: var(--violet-type-label-line);
		}
		.message {
			overflow-wrap: anywhere;
		}
		.link {
			flex: none;
			color: inherit;
			font-weight: var(--violet-weight-semibold);
		}
		.inbox {
			flex: none;
			min-block-size: var(--violet-size-target-natural);
			padding-inline: var(--violet-space-inline-tight);
			border: 1px solid currentColor;
			border-radius: var(--violet-radius-control);
			background: transparent;
			color: inherit;
			font: inherit;
			font-weight: var(--violet-weight-semibold);
			cursor: pointer;
		}
		.inbox:hover {
			background: var(--violet-color-action-secondary-hover);
		}
		.inbox:focus-visible,
		.link:focus-visible {
			outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
			outline-offset: var(--violet-shell-size-focus);
		}
		.dismiss {
			flex: none;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			box-sizing: border-box;
			min-inline-size: var(--violet-size-target-natural);
			min-block-size: var(--violet-size-target-natural);
			padding: 0;
			border: 1px solid transparent;
			border-radius: var(--violet-radius-control);
			background: transparent;
			color: inherit;
			cursor: pointer;
		}
		.dismiss violet-icon {
			--violet-icon-size: var(--violet-type-caption-line);
		}
		.dismiss:hover {
			background: var(--violet-color-action-secondary-hover);
			color: var(--violet-color-text-primary);
		}
		.dismiss:active {
			background: var(--violet-color-action-secondary-pressed);
			color: var(--violet-color-text-primary);
		}
		.dismiss:focus-visible {
			outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
			outline-offset: calc(-1 * var(--violet-shell-size-focus));
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
	/** The owner line (6.6), the kernel's: empty for the shell's own. */
	declare from: string;
	/** Where the toast's link leads, or empty. */
	declare href: string;
	/** The notice this toast also landed as, or empty (6.1, 6.7). */
	declare notification: string;

	constructor() {
		super();
		this.overlayId = '';
		this.message = '';
		this.tone = 'info';
		this.from = '';
		this.href = '';
		this.notification = '';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		if (this.tone === 'danger') this.setAttribute('role', 'alert');
	}

	/** "Open inbox" (6.7): the shell dismisses the toast and opens the inbox at its notice. */
	openInbox(): void {
		this.dispatchEvent(
			new CustomEvent(TOAST_INBOX_EVENT, {
				detail: { overlayId: this.overlayId, notification: this.notification },
				bubbles: true,
				composed: true,
			})
		);
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
attr(LoamToast.prototype, 'from');
attr(LoamToast.prototype, 'href');
attr(LoamToast.prototype, 'notification');

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
