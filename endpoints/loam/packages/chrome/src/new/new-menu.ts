/**
 * @fileoverview The `new` chunk (documents specification, 7): `loam-new-menu`, the title bar's New button's
 * menu, loaded on its first press or on the palette's first `new` query, so first paint holds the button
 * alone. A `violet-menu`, as APG's menu button pattern has it: Enter, Space, ArrowDown or a press on the
 * button opens it with focus on the first item, ArrowUp on the last; arrows, Home, End and type-ahead move; Enter or Space chooses; Escape closes it
 * and returns focus to the button, and Tab moves on. Its items are `new-list`'s, recents first, under a
 * heading per plugin when there is more than one. Choosing a template runs `document-create` with
 * `recent: true` then `document-open { preview: false }`, and focus goes to the new editor; choosing a
 * creator runs its command, and a failure is a `danger` toast. Every person's action here is a command, so
 * an agent does the same by calling them.
 */

import { css, FASTElement, html } from '@lushly-dev/fast-element';
import type { LoamKernelV2 } from '@lushly-dev/loam-kernel';
import type { DocumentRecordV1, DocumentTypeV1, NewItemV1 } from '@lushly-dev/loam-sdk';
import '@lushly-dev/violet-elements/dist/menu/violet-menu.js';
import '@lushly-dev/violet-elements/dist/menu/violet-menu-item.js';
import type { VioletMenu } from '@lushly-dev/violet-elements/dist/menu/violet-menu.js';

/** What this chunk reads of the shell, so it imports nothing first paint holds but FAST (2.4). */
export interface NewHost {
	readonly kernel: LoamKernelV2 | null;
	readonly shadowRoot: ShadowRoot | null;
	readonly ownerDocument: Document;
}

/** What New offers here, and the sentence for the types the level does not allow (7). */
export interface NewOffer {
	items: NewItemV1[];
	/** The plugin each item belongs to, by its instance, for the menu's headings. */
	plugins: Map<NewItemV1, { instance: string; title: string }>;
	/** At workspace level with nothing to offer and project-only types: `Choose a project to create a …`. */
	elsewhere: string | null;
}

/** `new-list`, with each item's plugin and the sentence for nothing to offer here (7). */
export async function readNew(kernel: LoamKernelV2): Promise<NewOffer> {
	const [listed, types, apps, scope] = await Promise.all([
		kernel.call<{ items: NewItemV1[] }>('new-list'),
		kernel.call<{ types: DocumentTypeV1[] }>('document-type-list', { all: true }),
		kernel.call<{ apps: Array<{ instance: string; title: string }> }>('app-list'),
		kernel.call<{ scope: { project?: string } }>('scope-get'),
	]);
	const items = listed.data?.items ?? [];
	const byType = new Map((types.data?.types ?? []).map((type) => [type.id, type]));
	const titles = new Map((apps.data?.apps ?? []).map((app) => [app.instance, app.title]));
	const plugins = new Map<NewItemV1, { instance: string; title: string }>();
	for (const item of items) {
		const instance = item.kind === 'creator' ? item.instance : byType.get(item.type)?.instance;
		if (instance !== undefined)
			plugins.set(item, { instance, title: titles.get(instance) ?? instance });
	}
	const atWorkspace = scope.data?.scope.project === undefined;
	const projectOnly = [...byType.values()]
		.filter((type) => !type.scopeLevels.includes('workspace'))
		.map((type) => type.title);
	return {
		items,
		plugins,
		elsewhere:
			items.length === 0 && atWorkspace && projectOnly.length > 0
				? `Choose a project to create a ${projectOnly.join(' or a ')}`
				: null,
	};
}

/**
 * Create what `item` names, as the menu does: a template's document, then opened, focus going to its editor;
 * a creator's command. A failure is a `danger` toast. True when it ran.
 */
export async function runNew(host: NewHost, item: NewItemV1): Promise<boolean> {
	const kernel = host.kernel;
	if (!kernel) return false;
	// As a failed save's toast: what failed, its code and suggestion, for 30 seconds (documents specification, 5.5).
	const fail = (
		error: { code?: string; message?: string; suggestion?: string } | undefined,
		what: string
	) =>
		void kernel.call('toast-show', {
			tone: 'danger',
			durationMs: 30_000,
			message:
				`${what} could not be created: ${error?.message ?? 'it failed'}${error?.code ? ` (${error.code})` : ''}${error?.suggestion ? `. ${error.suggestion}` : ''}`.slice(
					0,
					200
				),
		});
	if (item.kind === 'creator') {
		const result = await kernel.call(item.command, {});
		if (!result.success) fail(result.error, item.title);
		return result.success;
	}
	const created = await kernel.call<DocumentRecordV1>('document-create', {
		type: item.type,
		template: item.template,
		recent: true,
	});
	if (!created.success || !created.data) {
		fail(created.error, item.title);
		return false;
	}
	const opened = await kernel.call<{ tab: string }>('document-open', {
		document: created.data.id,
		preview: false,
	});
	if (!opened.success || !opened.data) {
		fail(opened.error, item.title);
		return false;
	}
	await focusEditor(host, opened.data.tab);
	return true;
}

/** The editor area's controller, as the editor chunk sets it on the shell, read by its shape alone. */
interface AreaLike {
	readonly idle: Promise<void>;
	readonly lifecycle: readonly [unknown, ReadonlyMap<string, { editor?: HTMLElement | null }>];
}

/** Focus the new tab's editor once the area renders it, within two seconds (7). */
async function focusEditor(host: NewHost, tab: string): Promise<void> {
	const view = host.ownerDocument.defaultView ?? window;
	for (let frame = 0; frame < 120; frame++) {
		const area = (host as unknown as { editor?: AreaLike }).editor;
		if (area) await area.idle;
		const editor = area?.lifecycle[1].get(tab)?.editor;
		if (editor?.isConnected) {
			editor.focus();
			return;
		}
		await new Promise((resolve) => view.requestAnimationFrame(resolve));
	}
}

const template = html<LoamNewMenu>`<violet-menu label="New"></violet-menu>`;

const styles = css`
	/* Over the New button, so the menu's panel opens from it; the panel alone takes the pointer. */
	:host {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	violet-menu {
		display: block;
		block-size: 100%;
		--violet-menu-background: var(--color-surface-floating);
		--violet-menu-shadow: var(--shadow-floating);
		--violet-menu-border-color: var(--color-border-subtle);
		--violet-menu-radius: var(--radius-lg);
		--violet-menu-padding: var(--size-space-xs);
		--violet-menu-gap: var(--size-space-xs);
		--violet-menu-min-inline-size: calc(var(--shell-size-sidebar-min) * 1.1);
	}
	violet-menu::part(panel) {
		pointer-events: auto;
		color: var(--color-text-primary);
	}
	/*
	 * violet-menu-item reads two surfaces that are not contract ids, whose white fallbacks fail contrast in
	 * dark: the hover's and the pressed state's contract colors stand in, as the palette's options do.
	 */
	violet-menu-item {
		--color-surface-highlight: var(--color-surface-subtle);
		--color-surface-pressed: var(--color-action-secondary-pressed);
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	violet-menu-item::part(control) {
		min-block-size: var(--size-target-natural);
		color: var(--color-text-primary);
	}
	violet-menu-item::part(control):focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: calc(-1 * var(--shell-size-focus));
	}
	violet-menu-item[disabled]::part(control) {
		opacity: 1;
		color: var(--color-text-secondary);
	}
	.heading {
		padding-block: var(--space-stack-xs) 0;
		padding-inline: var(--space-inline-md);
		color: var(--color-text-secondary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--weight-semibold);
	}
	@media (forced-colors: active) {
		.heading,
		violet-menu-item::part(control) {
			color: CanvasText;
		}
		violet-menu-item[disabled]::part(control) {
			color: GrayText;
		}
		violet-menu-item::part(control):focus-visible {
			outline-color: Highlight;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		violet-menu-item::part(control) {
			transition: none;
		}
	}
`;

export class LoamNewMenu extends FASTElement {
	host: NewHost | null = null;
	/** The New button, whose `aria-expanded` follows the menu and which focus returns to. */
	button: HTMLButtonElement | null = null;
	/** A press of the button that closed the open menu, by light dismiss, opens nothing. */
	#pressClosed = false;
	/** The click that ended such a press: the open it asks for, which comes later, after the import, is skipped. */
	#skip = false;
	#opening: Promise<void> | null = null;

	get menu(): VioletMenu {
		return this.shadowRoot?.querySelector('violet-menu') as VioletMenu;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.menu.addEventListener('open-change', (event) => {
			const open = (event as CustomEvent<{ open: boolean }>).detail.open;
			this.button?.setAttribute('aria-expanded', String(open));
			// Opened: no press closed it. Closed by a press's light dismiss, its click comes next and reads it.
			if (open) {
				this.#pressClosed = false;
				return;
			}
			// Escape and a choice leave focus in the closed menu or on the page: it goes back to the button.
			const active = this.ownerDocument.activeElement;
			if (
				active === this.ownerDocument.body ||
				this.shadowRoot?.activeElement ||
				this.contains(active)
			) {
				this.button?.focus();
			}
		});
	}

	/** Watch the button for a press that closes the open menu, so that press does not open it again. */
	watch(button: HTMLButtonElement): void {
		this.button = button;
		button.addEventListener('pointerdown', () => {
			this.#pressClosed = this.menu?.open === true;
		});
		// The click, in the same task as its pointerup, takes the press's mark for the open it asks for; a press
		// dragged off the button, with no click, leaves nothing behind.
		button.addEventListener('click', () => {
			this.#skip = this.#pressClosed;
			this.#pressClosed = false;
		});
		// A pointerup off the button is not the button's: heard on the window, in capture.
		(button.ownerDocument.defaultView ?? window).addEventListener(
			'pointerup',
			() => {
				setTimeout(() => {
					this.#pressClosed = false;
				});
			},
			{ capture: true }
		);
	}

	/** Read what New offers here, render it, and open with focus on the first item, or the last for ArrowUp. */
	open(key = 'ArrowDown'): Promise<void> {
		if (this.#skip) {
			this.#skip = false;
			return Promise.resolve();
		}
		this.#opening ??= this.#open(key).finally(() => {
			this.#opening = null;
		});
		return this.#opening;
	}

	async #open(key: string): Promise<void> {
		const kernel = this.host?.kernel;
		if (!kernel) return;
		const offer = await readNew(kernel);
		this.#render(offer);
		// The menu's own way to open with focus on its first or last item, as those keys on its trigger do.
		this.menu.handleTriggerKeydown(new KeyboardEvent('keydown', { key }));
	}

	/** The items by the DOM API, a heading per plugin when more than one: their text is untrusted (D8). */
	#render(offer: NewOffer): void {
		const doc = this.ownerDocument;
		const menu = this.menu;
		const item = (text: string, choose?: () => void) => {
			const made = doc.createElement('violet-menu-item');
			made.textContent = text;
			if (choose) made.addEventListener('invoke', choose);
			else made.setAttribute('disabled', '');
			return made;
		};
		const groups = new Map<string, { title: string; items: HTMLElement[] }>();
		for (const row of offer.items) {
			const plugin = offer.plugins.get(row) ?? { instance: '', title: '' };
			const group = groups.get(plugin.instance) ?? { title: plugin.title, items: [] };
			groups.set(plugin.instance, group);
			const made = item(row.title, () => {
				if (this.host) void runNew(this.host, row);
			});
			made.dataset.new = row.kind === 'creator' ? row.command : `${row.type}/${row.template}`;
			const icon = doc.createElement('violet-icon');
			icon.setAttribute('icon', row.icon);
			icon.setAttribute('decorative', '');
			icon.slot = 'before';
			made.prepend(icon);
			group.items.push(made);
		}
		const children: HTMLElement[] = [];
		if (offer.items.length === 0) {
			children.push(item('Nothing to create here'));
			if (offer.elsewhere) children.push(item(offer.elsewhere));
		} else if (groups.size === 1) {
			children.push(...[...groups.values()].flatMap((group) => group.items));
		} else {
			let index = 0;
			for (const group of groups.values()) {
				const wrapper = doc.createElement('div');
				wrapper.setAttribute('role', 'group');
				const heading = doc.createElement('div');
				heading.className = 'heading';
				heading.id = `new-group-${index++}`;
				heading.setAttribute('role', 'presentation');
				heading.textContent = group.title;
				wrapper.setAttribute('aria-labelledby', heading.id);
				wrapper.append(heading, ...group.items);
				children.push(wrapper);
			}
		}
		menu.replaceChildren(...children);
	}
}

export const newMenuDefinition = { name: 'loam-new-menu', template, styles } as const;

let defined: Promise<unknown> | undefined;
const define = (): Promise<unknown> => {
	defined ??= customElements.get(newMenuDefinition.name)
		? Promise.resolve()
		: Promise.resolve(LoamNewMenu.define(newMenuDefinition));
	return defined;
};

/** The shell's New button pressed: its menu, made once beside the button, opened. */
export async function openNew(shell: NewHost, key?: string): Promise<void> {
	await define();
	const titlebar = shell.shadowRoot?.querySelector('loam-titlebar');
	const holder = titlebar?.shadowRoot?.querySelector<HTMLElement>('.new');
	const button = holder?.querySelector('button');
	if (!holder || !button) return;
	let menu = holder.querySelector<LoamNewMenu>(newMenuDefinition.name);
	if (!menu) {
		menu = shell.ownerDocument.createElement(newMenuDefinition.name) as LoamNewMenu;
		menu.host = shell;
		menu.watch(button);
		holder.append(menu);
	}
	await menu.open(key);
}
