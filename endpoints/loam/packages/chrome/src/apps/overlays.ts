/**
 * @fileoverview `loam-popover` and the layer that renders the kernel's popovers (phase 4 specification, 6.1 to 6.7),
 * the `overlays` chunk, loaded with the first popover. A popover is `popover="auto"`, shown with its anchor as the
 * source, so CSS anchor positioning places it and the platform light-dismisses it; a light dismissal is the person's
 * `overlay-dismiss`, and what closes on screen is what `overlay-list` no longer lists. An info popover is a `dialog`, a
 * menu a `menu` whose items are the owner's own commands, which the kernel checked; a pick is the person's
 * `overlay-dismiss { result: 'confirm', item }`, then the command, run as the person. An app's popover leads with its
 * owner line. Focus moves in, and returns to the invoker.
 */

import { css, FASTElement, html, observable, repeat } from '@lushly-dev/fast-element';
import type { LoamKernel } from '@lushly-dev/loam-kernel';
import type { OverlayV1, PopoverInputV1, PopoverItemV1, ToastInputV1 } from '@lushly-dev/loam-sdk';
import { deepActiveElement } from '../elements/events.js';
import type { LoamShell } from '../elements/shell.js';
import { resourceLinkUrl } from '../resource-link.js';
import type { AnchorFinder, LayerHelpers } from './overlay-surfaces.js';
import { createDialogs, createGlobals, promptFields } from './questions.js';

const template = html<LoamPopover>`
	<p class="from" ?hidden="${(x) => !x.from}">${(x) => x.from}</p>
	<h2 class="title" ?hidden="${(x) => !x.heading}">${(x) => x.heading}</h2>
	<p class="body" ?hidden="${(x) => !x.body}">${(x) => x.body}</p>
	<div class="items" role="none" ?hidden="${(x) => x.items.length === 0}">
		${repeat(
			(x) => x.items,
			html<PopoverItemV1, LoamPopover>`<button
				class="item"
				type="button"
				role="menuitem"
				tabindex="-1"
				@click="${(item, c) => c.parent.pick(c.index)}"
			>
				${(item) => item.label}
			</button>`,
			{ positioning: true }
		)}
	</div>
`;

const styles = css`
	:host {
		position: fixed;
		position-area: block-end span-inline-end;
		position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline;
		box-sizing: border-box;
		min-inline-size: min(92vw, var(--violet-shell-size-sidebar-min));
		max-inline-size: min(92vw, var(--violet-shell-size-main-min));
		margin: var(--violet-space-stack-xs);
		padding-block: var(--violet-space-stack-sm);
		padding-inline: var(--violet-space-inline-md);
		border: 1px solid var(--violet-color-border-strong);
		border-radius: var(--violet-radius-md);
		background: var(--violet-color-surface-floating);
		color: var(--violet-color-text-primary);
		box-shadow: var(--violet-shadow-floating);
		font-family: var(--violet-font-family-body);
		font-size: var(--violet-type-body-md-size);
		line-height: var(--violet-type-body-md-line);
	}
	:host(:focus-visible) {
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: calc(-1 * var(--violet-shell-size-focus));
	}
	:host([role='menu']) {
		padding-inline: var(--violet-space-inline-sm);
	}
	[hidden] {
		display: none;
	}
	p,
	h2 {
		margin: 0;
	}
	.from {
		padding-inline: var(--violet-space-inline-sm);
		color: var(--violet-color-text-secondary);
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
	}
	:host([role='dialog']) .from {
		padding-inline: 0;
	}
	.title {
		font-size: var(--violet-type-title-sm-size);
		line-height: var(--violet-type-title-sm-line);
		font-weight: var(--violet-type-title-sm-weight);
	}
	.body {
		overflow-wrap: anywhere;
	}
	.items {
		display: flex;
		flex-direction: column;
	}
	.item {
		box-sizing: border-box;
		min-block-size: var(--violet-size-target-natural);
		padding-inline: var(--violet-space-inline-sm);
		border: 1px solid transparent;
		border-radius: var(--violet-radius-sm);
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.item:hover {
		background: var(--violet-color-action-secondary-hover);
	}
	.item:active {
		background: var(--violet-color-action-secondary-pressed);
	}
	.item:focus-visible {
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: calc(-1 * var(--violet-shell-size-focus));
	}
	@media (forced-colors: active) {
		:host {
			border-color: CanvasText;
			background: Canvas;
			color: CanvasText;
		}
		.item:hover,
		.item:focus-visible {
			border-color: Highlight;
			background: Highlight;
			color: HighlightText;
		}
	}
`;

/** Items' keys: up and down move, Home and End go to the ends (WAI-ARIA's menu pattern). */
const MOVES: Readonly<Record<string, (index: number, count: number) => number>> = {
	ArrowDown: (index, count) => (index + 1) % count,
	ArrowUp: (index, count) => (index - 1 + count) % count,
	Home: () => 0,
	End: (_index, count) => count - 1,
};

export class LoamPopover extends FASTElement {
	declare from: string;
	declare heading: string;
	declare body: string;
	declare items: PopoverItemV1[];
	overlayId = '';
	/** Set when the shell closes it, so its own `toggle` is not taken for a light dismissal. */
	closing = false;
	onPick: (index: number) => void = () => {};

	constructor() {
		super();
		this.from = '';
		this.heading = '';
		this.body = '';
		this.items = [];
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.addEventListener('keydown', this.#onKeydown);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.removeEventListener('keydown', this.#onKeydown);
	}

	/** The menu's items, in order. */
	get itemElements(): HTMLElement[] {
		return [...(this.shadowRoot?.querySelectorAll<HTMLElement>('.item') ?? [])];
	}

	pick(index: number): void {
		this.onPick(index);
	}

	/** Focus moves in: a menu's first item, or the dialog itself. */
	focusFirst(): void {
		const [first] = this.itemElements;
		if (first) first.focus();
		else this.focus();
	}

	#onKeydown = (event: KeyboardEvent) => {
		// Escape closes it here: the shell's own keys would otherwise take the close request first.
		if (event.key === 'Escape' && !event.defaultPrevented) {
			event.preventDefault();
			if (this.matches(':popover-open')) this.hidePopover();
			return;
		}
		const move = MOVES[event.key];
		const items = this.itemElements;
		if (!move || items.length === 0) return;
		event.preventDefault();
		const current = items.indexOf(this.shadowRoot?.activeElement as HTMLElement);
		items[move(Math.max(current, 0), items.length)]?.focus();
	};
}
for (const name of ['from', 'heading', 'body', 'items'] as const)
	observable(LoamPopover.prototype, name);

export const popoverDefinition = { name: 'loam-popover', template, styles } as const;

/** What the layer gives `OverlaySurfaces`: popovers, and step 4's dialogs, prompt fields and strips. */
export interface OverlayLayer {
	render(popovers: OverlayV1[]): void;
	renderDialogs(dialogs: OverlayV1[]): Promise<void>;
	renderGlobals(strips: OverlayV1[]): void;
	promptFields: typeof promptFields;
	dispose(): void;
}

/** The layer, with `loam-popover` defined once. */
export function createPopoverLayer(
	shell: LoamShell,
	kernel: LoamKernel,
	find: AnchorFinder,
	{ ownerLine, focusFallback, anchorOwnerOf, optionsOf, bindAnswer }: LayerHelpers
): OverlayLayer {
	const dialogs = createDialogs(shell, { optionsOf, bindAnswer, focusFallback });
	const globals = createGlobals(shell);
	if (!customElements.get(popoverDefinition.name)) LoamPopover.define(popoverDefinition);
	const shown = new Map<
		string,
		{ element: LoamPopover; anchor: HTMLElement; container?: HTMLElement }
	>();
	const dismiss = (overlayId: string, reason: 'user' | 'anchor') =>
		void kernel.call('overlay-dismiss', { overlayId, reason });

	function close(overlayId: string): void {
		const held = shown.get(overlayId);
		if (!held) return;
		shown.delete(overlayId);
		const { element, anchor, container } = held;
		const active = deepActiveElement(shell.ownerDocument);
		const hadFocus =
			active === element ||
			active?.getRootNode() === element.shadowRoot ||
			active === shell.ownerDocument.body;
		element.closing = true;
		if (element.matches(':popover-open')) element.hidePopover();
		element.remove();
		container?.remove();
		// Focus returns to the invoker (6.7), or where it falls back when the invoker has gone.
		if (!hadFocus) return;
		if (anchor.isConnected) anchor.focus();
		else focusFallback(shell);
	}

	function open(overlay: OverlayV1): void {
		const input = overlay.input as PopoverInputV1;
		const anchor = find(anchorOwnerOf(overlay), input.anchor);
		if (!anchor) {
			// The invoker left the page after the kernel took it: nothing to sit beside, so the popover closes, as the
			// page's `anchor`, never as the person's dismissal.
			dismiss(overlay.overlayId, 'anchor');
			return;
		}
		const element = shell.ownerDocument.createElement(popoverDefinition.name) as LoamPopover;
		element.overlayId = overlay.overlayId;
		element.from = ownerLine(overlay.from);
		element.popover = 'auto';
		element.tabIndex = -1;
		let container: HTMLElement | undefined;
		if (input.kind === 'menu') {
			const label = [input.label ?? 'Menu', element.from].filter(Boolean).join(', ');
			element.setAttribute('role', 'menu');
			element.setAttribute('aria-label', label);
			element.items = input.items.map((item) => ({ ...item }));
			element.onPick = (index) => void pick(overlay.overlayId, index, input.items[index]);
			// A menu popover sits in a named landmark so its top-layer content is contained by a landmark (#2136);
			// fixed positioning keeps the wrapper out of `loam-shell`'s CSS grid without triggering CSP
			// `style-src-attr` or adding to first-paint `shell-styles.ts`.
			container = shell.ownerDocument.createElement('div');
			container.setAttribute('role', 'region');
			container.setAttribute('aria-label', `${label} popover`);
			container.style.setProperty('position', 'fixed');
			container.append(element);
		} else {
			element.setAttribute('role', 'dialog');
			element.setAttribute(
				'aria-label',
				[input.title ?? 'Information', element.from].filter(Boolean).join(', ')
			);
			element.heading = input.title ?? '';
			element.body = input.body;
		}
		element.addEventListener('toggle', (event) => {
			if ((event as ToggleEvent).newState !== 'closed' || element.closing) return;
			// Light dismissal: a press outside, Escape, or another popover's opening (6.1).
			dismiss(overlay.overlayId, 'user');
		});
		shell.shadowRoot?.append(container ?? element);
		shown.set(overlay.overlayId, { element, anchor, ...(container ? { container } : {}) });
		try {
			element.showPopover({ source: anchor } as unknown as undefined);
		} catch {
			// A platform without `source` shows it unanchored, as `position-area` falls back.
			if (!element.matches(':popover-open')) element.showPopover();
		}
		requestAnimationFrame(() => {
			if (element.isConnected) element.focusFirst();
		});
	}

	/** The person picked an item: closed as theirs, then the owner's command runs as them (6.4, 6.5). */
	async function pick(
		overlayId: string,
		index: number,
		item: PopoverItemV1 | undefined
	): Promise<void> {
		if (!item) return;
		const closed = await kernel.call('overlay-dismiss', {
			overlayId,
			result: 'confirm',
			item: index,
			reason: 'user',
		});
		if (!closed.success) return;
		const ran = await kernel.call(item.command, item.input ?? {});
		if (ran.success) return;
		// The person asked for it, so its failure is theirs to read, as a palette run's is (the review's 5).
		const { message = `${item.label} failed`, suggestion } = ran.error ?? {};
		void kernel.call('toast-show', {
			message: (suggestion ? `${message} ${suggestion}` : message).slice(0, 200),
			tone: 'danger',
			durationMs: 30_000,
		});
	}

	return {
		render(popovers) {
			for (const overlayId of [...shown.keys()]) {
				if (!popovers.some((overlay) => overlay.overlayId === overlayId)) close(overlayId);
			}
			for (const overlay of popovers) if (!shown.has(overlay.overlayId)) open(overlay);
		},
		renderDialogs: (open) => dialogs.render(open),
		renderGlobals: (strips) => globals.render(strips),
		promptFields,
		dispose() {
			for (const overlayId of [...shown.keys()]) close(overlayId);
			dialogs.dispose();
			globals.dispose();
		},
	};
}

/** A toast's link as a URL under `base` (6.4, documents specification 9.1), or empty when this page cannot open it. */
export async function toastHref(
	kernel: LoamKernel,
	base: string,
	link: NonNullable<ToastInputV1['link']>
): Promise<string> {
	const [workspace, projects] = await Promise.all([
		kernel.call<{ id: string }>('workspace-get'),
		kernel.call<{ projects: Array<{ id: string; slug: string }> }>('project-list', {}),
	]);
	const id = workspace.data?.id;
	if (id === undefined) return '';
	return (
		resourceLinkUrl(link, base, {
			workspace: id,
			slugOf: (project) => projects.data?.projects.find((each) => each.id === project)?.slug,
		}) ?? ''
	);
}
