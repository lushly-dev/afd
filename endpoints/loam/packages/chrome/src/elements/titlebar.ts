/**
 * @fileoverview `loam-titlebar`: `banner`, "Loam". The title, the palette's search button, the
 * part toggles and the account button (5.1, 6.5).
 */

import { attr, css, FASTElement, html, when } from '@lushly-dev/fast-element';
import { dispatchAction } from './events.js';
import { registerChromeIcons } from './icons.js';
import { partHost, quietButton } from './styles.js';

const toggle = (part: 'sidebar' | 'inspector' | 'panel', label: string) => html<LoamTitlebar>`
	<button
		class="quiet toggle"
		type="button"
		data-toggle="${() => part}"
		aria-pressed="${(x) => String(x.shown(part))}"
		@click="${(x) => dispatchAction(x, { action: 'toggle', part })}"
	>
		${() => label}
	</button>
`;

const template = html<LoamTitlebar>`
	<span class="name">Loam</span>
	<button
		class="quiet search"
		type="button"
		aria-keyshortcuts="${(x) => x.ariaShortcut}"
		@click="${(x) => dispatchAction(x, { action: 'palette-open' })}"
	>
		<violet-icon icon="system/search" decorative></violet-icon>
		<span>Search commands</span>
		<kbd>${(x) => x.shortcut}</kbd>
	</button>
	<span class="spacer"></span>
	<span class="toggles" role="group" aria-label="Parts">
		${toggle('sidebar', 'Sidebar')} ${toggle('panel', 'Panel')} ${toggle('inspector', 'Inspector')}
	</span>
	${when(
		(x) => x.account === '',
		html<LoamTitlebar>`
			<button
				class="quiet account"
				type="button"
				@click="${(x) => dispatchAction(x, { action: 'sign-in' })}"
			>
				Sign in
			</button>
		`
	)}
	${when(
		(x) => x.account !== '',
		html<LoamTitlebar>`
			<span class="actor">${(x) => x.account}</span>
			<button
				class="quiet account"
				type="button"
				@click="${(x) => dispatchAction(x, { action: 'sign-out' })}"
			>
				Sign out
			</button>
		`
	)}
`;

const styles = [
	partHost,
	quietButton,
	css`
		:host {
			display: flex;
			align-items: center;
			gap: var(--space-inline-sm);
			block-size: var(--shell-size-titlebar);
			padding-inline: var(--space-inline-md);
			background: var(--color-surface-subtle);
			color: var(--color-text-secondary);
			border-block-end: 1px solid var(--color-border-subtle);
			overflow: hidden;
			container-type: inline-size;
		}
		.name {
			padding-inline-end: var(--space-inline-md);
			color: var(--color-text-primary);
			font-size: var(--type-label-sm-size);
			line-height: var(--type-label-sm-line);
			font-weight: var(--weight-semibold);
		}
		.spacer {
			flex: 1;
		}
		.toggles {
			display: inline-flex;
			gap: var(--space-inline-sm);
		}
		.actor {
			font-size: var(--type-label-sm-size);
			line-height: var(--type-label-sm-line);
			color: var(--color-text-secondary);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		kbd {
			font: inherit;
			font-size: var(--type-caption-xs-size);
			line-height: var(--type-caption-xs-line);
			color: var(--color-text-secondary);
		}
		@container (max-width: 560px) {
			.search span,
			.search kbd,
			.actor {
				display: none;
			}
		}
		@media (forced-colors: active) {
			:host {
				background: Canvas;
				color: CanvasText;
				border-block-end-color: CanvasText;
			}
			.name,
			.actor,
			kbd {
				color: CanvasText;
			}
		}
	`,
];

export class LoamTitlebar extends FASTElement {
	/** The signed-in name, or empty when signed out. */
	declare account: string;
	/** The palette chord as the platform writes it, for example `⌘K` or `Ctrl+K`. */
	declare shortcut: string;
	/** The palette chord for `aria-keyshortcuts`, for example `Meta+K`. */
	declare ariaShortcut: string;
	/** The parts shown now, space-separated: `sidebar`, `inspector`, `panel`. */
	declare shownParts: string;

	constructor() {
		super();
		registerChromeIcons();
		this.account = '';
		this.shortcut = 'Ctrl+K';
		this.ariaShortcut = 'Control+K';
		this.shownParts = '';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute('role', 'banner');
		this.setAttribute('aria-label', 'Loam');
	}

	shown(part: string): boolean {
		return this.shownParts.split(' ').includes(part);
	}
}
attr(LoamTitlebar.prototype, 'account');
attr(LoamTitlebar.prototype, 'shortcut');
attr({ attribute: 'aria-shortcut' })(LoamTitlebar.prototype, 'ariaShortcut');
attr({ attribute: 'shown-parts' })(LoamTitlebar.prototype, 'shownParts');

export const titlebarDefinition = { name: 'loam-titlebar', template, styles } as const;
