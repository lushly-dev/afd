/**
 * @fileoverview `loam-account-menu`, the `account-menu` chunk (phase 3 specification, 5.1 and 14), loaded when a
 * `provider` deployment's account button is pressed: the person's name and email, and "Sign out". A menu button's
 * menu (APG): focus moves to its first item, the arrows move between items, Escape or a press outside closes it
 * and focus returns to the button. Step 4 adds "Account" and step 5 the persona switch.
 */

import { css, FASTElement, html, observable } from '@lushly-dev/fast-element';
import type { LoamKernelV3 } from '@lushly-dev/loam-kernel';
import type { LoamShell } from '../elements/shell.js';

const template = html<LoamAccountMenu>`
	<div class="menu" role="menu" aria-label="Account" @keydown="${(x, c) =>
		x.keydown(c.event as KeyboardEvent)}">
		<p class="who" role="none">
			<span class="name">${(x) => x.name}</span>
			<span class="email">${(x) => x.email}</span>
		</p>
		<button class="item" role="menuitem" type="button" tabindex="-1" @click="${(x) => x.signOut()}">
			Sign out
		</button>
	</div>
`;

const styles = css`
	:host {
		position: fixed;
		inset-block-start: var(--shell-size-titlebar);
		inset-inline-end: var(--space-inline-md);
		z-index: 10;
	}
	.menu {
		display: grid;
		min-inline-size: var(--shell-size-sidebar-min);
		padding-block: var(--size-space-sm);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-surface-floating);
		box-shadow: var(--shadow-floating);
		color: var(--color-text-primary);
	}
	.who {
		display: grid;
		margin: 0;
		padding: var(--size-space-sm) var(--size-space-md);
		border-block-end: 1px solid var(--color-border-subtle);
	}
	.name {
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--weight-semibold);
	}
	.email {
		color: var(--color-text-secondary);
		font-size: var(--type-caption-xs-size);
		line-height: var(--type-caption-xs-line);
	}
	.item {
		min-block-size: var(--size-target-natural);
		padding-inline: var(--size-space-md);
		border: 0;
		background: transparent;
		color: var(--color-text-primary);
		font: inherit;
		font-size: var(--type-label-sm-size);
		text-align: start;
		cursor: pointer;
	}
	.item:hover {
		background: var(--color-action-secondary-hover);
	}
	.item:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: calc(-1 * var(--shell-size-focus));
	}
	@media (forced-colors: active) {
		.menu {
			border-color: CanvasText;
		}
		.item:focus-visible {
			outline-color: Highlight;
		}
	}
`;

export class LoamAccountMenu extends FASTElement {
	// Read from the shadow root, not by `ref`: a lazy chunk importing `ref` would part it from first paint (13).
	get menu(): HTMLElement {
		return this.shadowRoot?.querySelector('.menu') as HTMLElement;
	}
	declare name: string;
	declare email: string;
	kernel: LoamKernelV3 | null = null;
	/** The account button: `aria-expanded` while open, and where focus returns. */
	button: HTMLElement | null = null;
	#outside = (event: Event) => {
		if (
			!event.composedPath().includes(this) &&
			!event.composedPath().includes(this.button as EventTarget)
		)
			this.close();
	};

	constructor() {
		super();
		this.name = '';
		this.email = '';
	}

	#items(): HTMLElement[] {
		return [...this.menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
	}

	open(): void {
		this.button?.setAttribute('aria-expanded', 'true');
		this.ownerDocument.addEventListener('pointerdown', this.#outside, true);
		this.#items()[0]?.focus();
	}

	close(focus = true): void {
		this.ownerDocument.removeEventListener('pointerdown', this.#outside, true);
		this.button?.setAttribute('aria-expanded', 'false');
		this.remove();
		if (focus) this.button?.focus();
	}

	keydown(event: KeyboardEvent): boolean {
		const items = this.#items();
		const at = items.indexOf(event.composedPath()[0] as HTMLElement);
		if (event.key === 'Escape') this.close();
		else if (event.key === 'Tab') this.close(false);
		else if (/^(ArrowDown|ArrowUp|Home|End)$/.test(event.key)) {
			const next =
				event.key === 'Home'
					? 0
					: event.key === 'End'
						? items.length - 1
						: (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
			items[next]?.focus();
		} else return true;
		return event.key === 'Tab';
	}

	async signOut(): Promise<void> {
		this.close();
		await this.kernel?.call('auth-sign-out');
	}
}
observable(LoamAccountMenu.prototype, 'name');
observable(LoamAccountMenu.prototype, 'email');

/** Open the account menu under the title bar's account button, or close it when it is open. */
export async function openAccountMenu(shell: LoamShell): Promise<LoamAccountMenu | null> {
	if (!customElements.get('loam-account-menu')) {
		await LoamAccountMenu.define({ name: 'loam-account-menu', template, styles });
	}
	// In the title bar's own tree, so the menu is inside the banner landmark that holds its button.
	const bar = (shell.shadowRoot as ShadowRoot).querySelector('loam-titlebar')
		?.shadowRoot as ShadowRoot;
	const held = bar.querySelector('loam-account-menu') as LoamAccountMenu | null;
	if (held) {
		held.close();
		return null;
	}
	const menu = shell.ownerDocument.createElement('loam-account-menu') as LoamAccountMenu;
	menu.kernel = shell.kernel;
	menu.button = bar.querySelector('.account') as HTMLElement | null;
	const session = (await shell.kernel?.call('auth-session-get')) as
		| { data?: { user?: { name?: string; email?: string } } }
		| undefined;
	menu.name = session?.data?.user?.name ?? shell.account;
	menu.email = session?.data?.user?.email ?? '';
	bar.append(menu);
	menu.open();
	return menu;
}
