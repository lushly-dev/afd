/**
 * @fileoverview `loam-sidebar` and `loam-inspector`: `complementary` parts that render inline, as a
 * non-modal overlay drawer, or in the compact class as a modal drawer, a `<dialog>` opened with
 * `showModal()` (5.3). The shell sets `mode`; the part never changes layout state itself, it asks
 * with a `loam-action` event.
 */

import { attr, css, FASTElement, html, ref } from '@lushly-dev/fast-element';
import type { SideMode } from '../layout-class.js';
import { deepActiveElement, dispatchAction } from './events.js';
import { trapTab } from './focus.js';
import { registerChromeIcons } from './icons.js';
import { partHeader, partHost, quietButton } from './styles.js';

type SidePart = 'sidebar' | 'inspector';

const template = html<LoamSidePart>`
	<div class="frame" ${ref('frame')}>
		<div class="header">
			<h2 class="title">${(x) => x.heading}</h2>
			<button
				class="quiet close"
				type="button"
				aria-label="${(x) => `Close ${x.heading.toLowerCase()}`}"
				title="${(x) => `Close ${x.heading.toLowerCase()}`}"
				@click="${(x) => x.requestClose()}"
			>
				<violet-icon icon="system/close" decorative></violet-icon>
			</button>
		</div>
		<div class="body"><slot></slot></div>
	</div>
	<slot name="handle"></slot>
	<dialog
		class="drawer"
		${ref('drawer')}
		aria-label="${(x) => x.heading}"
		@cancel="${(x, c) => x.handleCancel(c.event)}"
		@close="${(x) => x.handleDrawerClosed()}"
		@keydown="${(x, c) => x.handleDrawerKeydown(c.event as KeyboardEvent)}"
		@click="${(x, c) => x.handleDrawerClick(c.event as MouseEvent)}"
	></dialog>
`;

const styles = (side: SidePart) => [
	partHost,
	quietButton,
	partHeader,
	css`
		:host {
			position: relative;
			display: block;
			box-sizing: border-box;
			background: var(--violet-color-surface-card);
			color: var(--violet-color-text-primary);
		}
		:host([mode='overlay']) {
			z-index: var(--violet-z-index-overlay);
			background: var(--violet-color-surface-floating);
			box-shadow: var(--violet-shadow-floating);
		}
		:host([mode='drawer']) {
			display: contents;
		}
		.frame {
			display: flex;
			flex-direction: column;
			block-size: 100%;
			min-block-size: 0;
			overflow: hidden;
		}
		::slotted([slot='handle']) {
			position: absolute;
			inset-block: 0;
		}
		.body {
			flex: 1;
		}
		.drawer {
			box-sizing: border-box;
			position: fixed;
			inset-block: 0;
			margin: 0;
			inline-size: min(85vw, var(--violet-shell-size-drawer-max));
			max-inline-size: none;
			block-size: 100dvh;
			max-block-size: none;
			padding: 0;
			border: 0;
			background: var(--violet-color-surface-floating);
			box-shadow: var(--violet-shadow-floating);
			color: var(--violet-color-text-primary);
			font: inherit;
			opacity: 0;
			transition:
				opacity var(--violet-duration-fast) var(--violet-easing-standard),
				display var(--violet-duration-fast) var(--violet-easing-standard) allow-discrete,
				overlay var(--violet-duration-fast) var(--violet-easing-standard) allow-discrete;
		}
		.drawer[open] {
			opacity: 1;
			transition:
				opacity var(--violet-duration-base) var(--violet-easing-emphasized),
				display var(--violet-duration-base) var(--violet-easing-emphasized) allow-discrete,
				overlay var(--violet-duration-base) var(--violet-easing-emphasized) allow-discrete;
		}
		@starting-style {
			.drawer[open] {
				opacity: 0;
			}
		}
		.drawer::backdrop {
			background: color-mix(in srgb, var(--violet-color-surface-page) 60%, transparent);
		}
		@media (prefers-reduced-motion: reduce) {
			.drawer,
			.drawer[open] {
				transition-duration: var(--violet-duration-fast);
			}
		}
		@media (forced-colors: active) {
			:host,
			.drawer {
				background: Canvas;
				color: CanvasText;
			}
			:host([mode='overlay']),
			.drawer {
				border: 1px solid CanvasText;
			}
		}
	`,
	side === 'sidebar'
		? css`
				:host([mode='inline']) {
					border-inline-end: 1px solid var(--violet-color-border-subtle);
				}
				::slotted([slot='handle']) {
					inset-inline-end: 0;
				}
				.drawer {
					inset-inline-start: 0;
					inset-inline-end: auto;
				}
				@media (forced-colors: active) {
					:host([mode='inline']) {
						border-inline-end-color: CanvasText;
					}
				}
			`
		: css`
				:host([mode='inline']) {
					border-inline-start: 1px solid var(--violet-color-border-subtle);
				}
				::slotted([slot='handle']) {
					inset-inline-start: 0;
				}
				.drawer {
					inset-inline-start: auto;
					inset-inline-end: 0;
				}
				@media (forced-colors: active) {
					:host([mode='inline']) {
						border-inline-start-color: CanvasText;
					}
				}
			`,
];

export class LoamSidePart extends FASTElement {
	declare mode: SideMode;
	declare heading: string;
	declare frame: HTMLElement;
	declare drawer: HTMLDialogElement;
	#opener: Element | null = null;

	constructor() {
		super();
		registerChromeIcons();
		this.mode = 'inline';
		this.heading = '';
	}

	get shellPart(): SidePart {
		return this.localName === 'loam-inspector' ? 'inspector' : 'sidebar';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute('role', 'complementary');
		this.setAttribute('aria-label', this.heading);
		this.#sync();
	}

	override disconnectedCallback(): void {
		if (this.drawer?.open) this.drawer.close();
		super.disconnectedCallback();
	}

	modeChanged(): void {
		// The shell sets `mode` and `hidden` in one update; open the drawer once both are in, since a
		// dialog inside a hidden part cannot take focus. Opening waits one microtask more than
		// closing, so when one drawer replaces the other, the old one has closed and returned focus.
		queueMicrotask(() => {
			if (this.mode === 'drawer') queueMicrotask(() => this.#sync());
			else this.#sync();
		});
	}

	headingChanged(): void {
		if (this.$fastController?.isConnected) this.setAttribute('aria-label', this.heading);
	}

	requestClose(): void {
		dispatchAction(this, { action: 'close', part: this.shellPart });
	}

	handleDrawerKeydown(event: KeyboardEvent): boolean {
		trapTab(event, this.drawer);
		return true;
	}

	/**
	 * The browser closed the drawer itself (Chromium does after a second Escape whose `cancel` it
	 * would not let the page keep); ask the shell, so the layout state follows.
	 */
	handleDrawerClosed(): void {
		if (this.mode === 'drawer') this.requestClose();
	}

	handleCancel(event: Event): void {
		event.preventDefault();
		this.requestClose();
	}

	/** A click on the backdrop lands on the dialog itself, outside its box. */
	handleDrawerClick(event: MouseEvent): boolean {
		if (event.target !== this.drawer) return true;
		const box = this.drawer.getBoundingClientRect();
		const inside =
			event.clientX >= box.left &&
			event.clientX <= box.right &&
			event.clientY >= box.top &&
			event.clientY <= box.bottom;
		if (!inside) this.requestClose();
		return true;
	}

	/** Move the frame into the drawer and open it modally, or back into the part and close it. */
	#sync(): void {
		if (!this.$fastController?.isConnected || !this.frame || !this.drawer) return;
		if (this.mode === 'drawer') {
			if (this.drawer.open || this.hidden) return;
			this.#opener = deepActiveElement(this.ownerDocument);
			this.drawer.append(this.frame);
			this.drawer.showModal();
		} else {
			if (this.frame.parentNode !== this.shadowRoot) this.shadowRoot?.prepend(this.frame);
			if (this.drawer.open) {
				this.drawer.close();
				const opener = this.#opener;
				this.#opener = null;
				if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
			}
		}
	}
}
attr(LoamSidePart.prototype, 'mode');
attr(LoamSidePart.prototype, 'heading');

export class LoamSidebar extends LoamSidePart {}
export class LoamInspector extends LoamSidePart {}

export const sidebarDefinition = {
	name: 'loam-sidebar',
	template,
	styles: styles('sidebar'),
} as const;
export const inspectorDefinition = {
	name: 'loam-inspector',
	template,
	styles: styles('inspector'),
} as const;
