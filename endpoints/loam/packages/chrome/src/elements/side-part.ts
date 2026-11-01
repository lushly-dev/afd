/**
 * @fileoverview `loam-sidebar` and `loam-inspector`: `complementary` parts that render inline, as a
 * non-modal overlay drawer, or in the compact class as a modal drawer, a `<dialog>` opened with
 * `showModal()` (5.3). The shell sets `mode`; the part never changes layout state itself, it asks
 * with a `loam-action` event.
 */

import { attr, css, FASTElement, html, ref } from '@lushly-dev/fast-element';
import type { SideMode } from '../layout-class.js';
import { deepActiveElement, dispatchAction } from './events.js';
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
	<dialog
		class="drawer"
		${ref('drawer')}
		aria-label="${(x) => x.heading}"
		@cancel="${(x, c) => x.handleCancel(c.event)}"
		@click="${(x, c) => x.handleDrawerClick(c.event as MouseEvent)}"
	></dialog>
`;

const styles = (side: SidePart) => [
	partHost,
	quietButton,
	partHeader,
	css`
		:host {
			display: block;
			background: var(--color-surface-card);
			color: var(--color-text-primary);
			overflow: hidden;
		}
		:host([mode='overlay']) {
			z-index: var(--z-index-overlay);
			background: var(--color-surface-floating);
			box-shadow: var(--shadow-floating);
		}
		:host([mode='drawer']) {
			display: contents;
		}
		.frame {
			display: flex;
			flex-direction: column;
			block-size: 100%;
			min-block-size: 0;
		}
		.body {
			flex: 1;
		}
		.drawer {
			box-sizing: border-box;
			position: fixed;
			inset-block: 0;
			margin: 0;
			inline-size: min(85vw, var(--shell-size-drawer-max));
			max-inline-size: none;
			block-size: 100dvh;
			max-block-size: none;
			padding: 0;
			border: 0;
			background: var(--color-surface-floating);
			box-shadow: var(--shadow-floating);
			color: var(--color-text-primary);
			font: inherit;
			opacity: 0;
			transition:
				opacity var(--duration-fast) var(--easing-standard),
				display var(--duration-fast) var(--easing-standard) allow-discrete,
				overlay var(--duration-fast) var(--easing-standard) allow-discrete;
		}
		.drawer[open] {
			opacity: 1;
			transition:
				opacity var(--duration-base) var(--easing-emphasized),
				display var(--duration-base) var(--easing-emphasized) allow-discrete,
				overlay var(--duration-base) var(--easing-emphasized) allow-discrete;
		}
		@starting-style {
			.drawer[open] {
				opacity: 0;
			}
		}
		.drawer::backdrop {
			background: color-mix(in srgb, var(--color-surface-page) 60%, transparent);
		}
		@media (prefers-reduced-motion: reduce) {
			.drawer,
			.drawer[open] {
				transition-duration: var(--duration-fast);
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
				.drawer {
					inset-inline-start: 0;
					inset-inline-end: auto;
				}
			`
		: css`
				.drawer {
					inset-inline-start: auto;
					inset-inline-end: 0;
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
		this.#sync();
	}

	headingChanged(): void {
		if (this.$fastController?.isConnected) this.setAttribute('aria-label', this.heading);
	}

	requestClose(): void {
		dispatchAction(this, { action: 'close', part: this.shellPart });
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
			if (this.drawer.open) return;
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
