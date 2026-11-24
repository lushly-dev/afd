/**
 * @fileoverview `loam-titlebar`: `banner`, "Loam". The title, the New button (documents specification, 7),
 * the palette's search button, the inbox's button (phase 4 specification, 10.3), the part toggles and the account
 * button (5.1, 6.5). The New button is text with no icon, and its menu is the `new` chunk's, loaded on its first
 * press. The inbox's is text too, "Inbox 3" with the unread count, its name "Inbox 3 unread" (15): 10.3's bell,
 * which Violet's system icons do not draw.
 */

import {
	attr,
	css,
	FASTElement,
	html,
	nullableNumberConverter,
	when,
} from '@lushly-dev/fast-element';
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

// The search button's label carries the shortcut it shows, so its name contains its visible text
// (WCAG 2.5.3). It needs the label: at compact width only the icon shows.
/** The name, with a non-default persona's title beside it (phase 3 specification, 6.3). */
const named = (x: LoamTitlebar): string => (x.persona ? `${x.account} · ${x.persona}` : x.account);

/** The count the inbox's button shows and names alike (WCAG 2.5.3): `99+` past 99. */
const countOf = (unread: number): string => (unread > 99 ? '99+' : String(unread));

const template = html<LoamTitlebar>`
	<span class="name">Loam</span>
	<span class="new"
		><button
			class="quiet"
			type="button"
			aria-haspopup="menu"
			aria-expanded="false"
			@click="${(x) => dispatchAction(x, { action: 'new' })}"
			@keydown="${(x, c) => {
				const { key } = c.event as KeyboardEvent;
				return !/^Arrow(Down|Up)$/.test(key) || dispatchAction(x, { action: 'new', key });
			}}"
		>
			New
		</button></span
	>
	<button
		class="quiet search"
		type="button"
		aria-label="${(x) => `Search commands ${x.shortcut}`}"
		aria-keyshortcuts="${(x) => x.ariaShortcut}"
		@click="${(x) => dispatchAction(x, { action: 'palette-open' })}"
	>
		<violet-icon icon="system/search" decorative></violet-icon>
		<span>Search commands</span>
		<kbd>${(x) => x.shortcut}</kbd>
	</button>
	<span class="spacer"></span>
	<button
		class="quiet inbox"
		type="button"
		aria-label="${(x) => (x.unread > 0 ? `Inbox ${countOf(x.unread)} unread` : 'Inbox')}"
		@click="${(x) => dispatchAction(x, { action: 'inbox' })}"
	>
		Inbox <span class="count" ?hidden="${(x) => !(x.unread > 0)}"
			>${(x) => countOf(x.unread)}</span
		>
	</button>
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
		(x) => x.account !== '' && x.provider,
		html<LoamTitlebar>`<button class="quiet account" type="button" aria-haspopup="menu" aria-expanded="false" @click="${(
			x
		) => dispatchAction(x, { action: 'account-menu' })}">${named}</button>`
	)}
	${when(
		(x) => x.account !== '' && !x.provider,
		html<LoamTitlebar>`
			<span class="actor">${named}</span>
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
			gap: var(--violet-space-inline-sm);
			block-size: var(--violet-shell-size-titlebar);
			padding-inline: var(--violet-space-inline-md);
			background: var(--violet-color-surface-subtle);
			color: var(--violet-color-text-secondary);
			border-block-end: 1px solid var(--violet-color-border-subtle);
			overflow: hidden;
			container-type: inline-size;
		}
		.name {
			padding-inline-end: var(--violet-space-inline-md);
			color: var(--violet-color-text-primary);
			font-size: var(--violet-type-label-sm-size);
			line-height: var(--violet-type-label-sm-line);
			font-weight: var(--violet-weight-semibold);
		}
		.spacer {
			flex: 1;
		}
		.new {
			position: relative;
		}
		.count {
			color: var(--violet-color-text-primary);
			font-weight: var(--violet-weight-semibold);
		}
		.toggles {
			display: inline-flex;
			gap: var(--violet-space-inline-sm);
		}
		.actor {
			font-size: var(--violet-type-label-sm-size);
			line-height: var(--violet-type-label-sm-line);
			color: var(--violet-color-text-secondary);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		kbd {
			font: inherit;
			font-size: var(--violet-type-caption-xs-size);
			line-height: var(--violet-type-caption-xs-line);
			color: var(--violet-color-text-secondary);
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
			kbd,
			.count {
				color: CanvasText;
			}
			.quiet:hover kbd,
			.quiet:active kbd,
			.quiet:hover .count,
			.quiet:active .count {
				color: inherit;
			}
		}
	`,
];

export class LoamTitlebar extends FASTElement {
	/** The signed-in name, or empty when signed out. */
	declare account: string;
	/** The active persona's title, shown beside the name; empty for `default` (phase 3 specification, 6.3). */
	declare persona: string;
	/** The palette chord as the platform writes it, for example `⌘K` or `Ctrl+K`. */
	declare shortcut: string;
	/** The palette chord for `aria-keyshortcuts`, for example `Meta+K`. */
	declare ariaShortcut: string;
	/** The parts shown now, space-separated: `sidebar`, `inspector`, `panel`. */
	declare shownParts: string;
	/** A `provider` deployment: the account button opens the account menu (phase 3 specification, 5.1). */
	declare provider: boolean;
	/** The person's unread notices, which the inbox's button shows and names (phase 4 specification, 10.3, 15). */
	declare unread: number;

	constructor() {
		super();
		registerChromeIcons();
		this.account = '';
		this.persona = '';
		this.shortcut = 'Ctrl+K';
		this.ariaShortcut = 'Control+K';
		this.shownParts = '';
		this.unread = 0;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute('role', 'banner');
		this.setAttribute('aria-label', 'Loam');
	}

	/** Move focus to a part's toggle, for when the part that held focus closes. */
	focusToggle(part: 'sidebar' | 'inspector' | 'panel'): void {
		this.shadowRoot?.querySelector<HTMLElement>(`[data-toggle="${part}"]`)?.focus();
	}

	shown(part: string): boolean {
		return this.shownParts.split(' ').includes(part);
	}
}
attr(LoamTitlebar.prototype, 'account');
attr(LoamTitlebar.prototype, 'persona');
attr(LoamTitlebar.prototype, 'shortcut');
attr({ attribute: 'key-shortcut' })(LoamTitlebar.prototype, 'ariaShortcut');
attr({ attribute: 'shown-parts' })(LoamTitlebar.prototype, 'shownParts');
attr({ mode: 'boolean' })(LoamTitlebar.prototype, 'provider');
attr({ converter: nullableNumberConverter })(LoamTitlebar.prototype, 'unread');

export const titlebarDefinition = { name: 'loam-titlebar', template, styles } as const;
