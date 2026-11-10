/**
 * @fileoverview The project switcher's list, the `switcher` chunk (phase 2 specification, 7.2), loaded on
 * the switcher's first press. `loam-project-list`, in the switcher's own shadow root: a `violet-listbox` of
 * `project-list`, first `No project`, then each project with its icon, and last `All projects`, which opens
 * the projects section. In the rail it opens in a `violet-popover` laid over the switcher's button, so the
 * button is its anchor and never moves; in the compact class, as the palette's list does, in a modal
 * `dialog`. Selecting runs `scope-set` or `section-open`; Escape closes it; focus returns to the switcher,
 * or, when the switch left the active app, to main's heading (7.8). A pressed row is made active on
 * `mousedown`, as the console does for #712's `handleFocus`.
 */

import {
	css,
	FASTElement,
	html,
	Observable,
	observable,
	ref,
	repeat,
	Updates,
	when,
} from '@lushly-dev/fast-element';
import type { LoamKernelV3, ProjectV1 } from '@lushly-dev/loam-kernel';
import '@lushly-dev/violet-elements/dist/listbox/violet-listbox.js';
import '@lushly-dev/violet-elements/dist/option/violet-option.js';
import '@lushly-dev/violet-elements/dist/popover/violet-popover.js';
import type { VioletListbox } from '@lushly-dev/violet-elements/dist/listbox/violet-listbox.js';
import type { VioletPopover } from '@lushly-dev/violet-elements/dist/popover/violet-popover.js';
import { focusMainHeading } from '../apps/focus-fallback.js';
import { registerAppIcons } from '../apps/icons.js';
import type { LoamProjectSwitcher } from '../elements/project-switcher.js';
import type { LoamShell } from '../elements/shell.js';

/** The values of the first row, no project, and the last, which opens the projects section. */
const NONE = '~none';
const ALL = '~all';

const rows = html<LoamProjectList>`
	<violet-listbox
		${ref('listbox')}
		label="Projects"
		value="${(x) => x.active}"
		@change="${(x, c) => x.choose(c.event as CustomEvent<{ value: string }>)}"
	>
		<violet-option value="${() => NONE}">No project</violet-option>
		${repeat(
			(x) => x.projects,
			html<ProjectV1>`<violet-option value="${(p) => p.id}"
				><violet-icon slot="before" icon="${(p) => p.icon}" decorative></violet-icon
				>${(p) => p.name}</violet-option
			>`
		)}
		<violet-option value="${() => ALL}">All projects</violet-option>
	</violet-listbox>
	<p ${ref('failureLine')} class="failure" role="alert" tabindex="-1" ?hidden="${(x) => !x.failure}">${(x) => x.failure}</p>
`;

const template = html<LoamProjectList>`
	${when(
		(x) => !x.modal,
		html<LoamProjectList>`<violet-popover
			${ref('surface')}
			positioning="after"
			@open-change="${(x, c) => x.toggled((c.event as CustomEvent<{ open: boolean }>).detail.open)}"
			>${rows}</violet-popover
		>`
	)}
	${when(
		(x) => x.modal,
		html<LoamProjectList>`<dialog
			${ref('dialog')}
			aria-label="Choose a project"
			@close="${(x) => x.toggled(false)}"
			>${rows}</dialog
		>`
	)}
`;

const styles = css`
	:host {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	violet-popover,
	violet-popover::part(anchor) {
		display: block;
		inline-size: 100%;
		block-size: 100%;
	}
	violet-popover {
		--violet-popover-min-inline-size: var(--shell-size-sidebar-min);
		--violet-popover-background: var(--color-surface-floating);
		--violet-popover-shadow: var(--shadow-floating);
		--violet-popover-border: var(--color-border-subtle);
	}
	violet-popover::part(surface),
	dialog {
		pointer-events: auto;
		color: var(--color-text-primary);
	}
	dialog {
		inline-size: min(92vw, var(--shell-size-main-min));
		padding: var(--space-layout-sm);
		border: 0;
		border-radius: var(--radius-lg);
		background: var(--color-surface-floating);
		box-shadow: var(--shadow-floating);
	}
	dialog::backdrop {
		background: color-mix(in srgb, var(--color-surface-page) 60%, transparent);
	}
	violet-option {
		--color-surface-highlight: var(--color-surface-subtle);
	}
	.failure {
		margin: var(--space-stack-xs) 0 0;
		color: var(--color-state-danger-text);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
	violet-listbox::part(control):focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
	}
	violet-listbox:focus-within violet-option[data-active]::part(control) {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: calc(-1 * var(--shell-size-focus));
	}
	@media (forced-colors: active) {
		dialog {
			border: 1px solid CanvasText;
		}
		violet-listbox:focus-within violet-option[data-active]::part(control) {
			outline-color: Highlight;
		}
	}
`;

export class LoamProjectList extends FASTElement {
	declare projects: ProjectV1[];
	/** The active project's id, or the first row's value for none. */
	declare active: string;
	/** The compact class: a modal list, as the palette's (7.2). */
	declare modal: boolean;
	/** Why the last choice was refused, shown in the list: it stays open (7.8). */
	declare failure: string;
	declare listbox: VioletListbox;
	declare failureLine: HTMLElement;
	declare surface?: VioletPopover;
	declare dialog?: HTMLDialogElement;
	kernel: LoamKernelV3 | null = null;
	shell: LoamShell | null = null;
	switcher: LoamProjectSwitcher | null = null;
	/** Its watch on the kernel's events, for a change of scope. */
	unsubscribe: (() => void) | undefined;
	#open = false;
	/** Its own choice is running: the change of scope it makes is not one to close on. */
	#choosing = false;
	/** When a press outside last closed it: the switcher's own press that did so does not reopen it. */
	#closedAt = -Infinity;
	/** It is closing itself: by Escape, a choice or a second press, so no press outside closed it. */
	#hiding = false;
	#watch = { handleChange: () => this.#markActive() };
	/** Where focus goes when it closes: the switcher, unless a choice moved it. */
	#returnFocus = true;

	constructor() {
		super();
		this.projects = [];
		this.active = NONE;
		this.modal = false;
		this.failure = '';
	}

	get isOpen(): boolean {
		return this.#open;
	}

	/** Closed by the press that is asking to toggle it, so it stays closed. */
	get justClosed(): boolean {
		return performance.now() - this.#closedAt < 300;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		// Escape closes it wherever focus is in it, whatever the listbox does with the key.
		this.addEventListener(
			'keydown',
			(event) => {
				if (event.key !== 'Escape' || !this.#open) return;
				event.preventDefault();
				event.stopPropagation();
				this.hide();
			},
			true
		);
		this.addEventListener('mousedown', (event) => this.press(event));
		// Tab out of it to an element outside closes it, and focus stays where it went. With no such element,
		// as a press on its own text, an outside press is light dismiss's to close (N2a).
		// Focus moving inside it never reaches this listener on the host: the event's path stops at the host
		// when its retargeted `relatedTarget` is the host itself.
		this.addEventListener('focusout', (event) => {
			if (!this.#open || event.relatedTarget === null) return;
			this.#returnFocus = false;
			this.hide();
		});
		// A change of scope from anywhere closes it, its rows read in the scope it left; not while its own
		// choice runs, which moves focus itself (N6).
		this.unsubscribe = this.kernel?.subscribe((event) => {
			if (event.scopeChanged && !this.#choosing) this.hide();
		});
		// The keyboard's row has the focus ring, as `loam-list`'s does.
		void Updates.next().then(() =>
			Observable.getNotifier(this.listbox).subscribe(this.#watch, 'activeValue')
		);
	}

	override disconnectedCallback(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		super.disconnectedCallback();
	}

	/** The projects the actor may enter, and the active one. */
	async #read(): Promise<void> {
		const kernel = this.kernel as LoamKernelV3;
		const [listed, scoped] = await Promise.all([
			kernel.call<{ projects: ProjectV1[] }>('project-list'),
			kernel.call<{ scope: { project?: string } }>('scope-get'),
		]);
		this.projects = listed.data?.projects ?? [];
		this.active = scoped.data?.scope.project ?? NONE;
	}

	/** Read the projects, show the list, and put focus on the active row. */
	async show(): Promise<void> {
		await this.#read();
		this.failure = '';
		this.#returnFocus = true;
		await Updates.next();
		if (this.modal) this.dialog?.showModal();
		else this.surface?.show();
		this.toggled(true);
		this.listbox.activeValue = this.active;
		this.#markActive();
		this.listbox.focus();
	}

	hide(): void {
		if (!this.#open) return;
		this.#hiding = true;
		if (this.modal) this.dialog?.close();
		else this.surface?.hide();
	}

	toggled(open: boolean): void {
		if (open === this.#open) return;
		this.#open = open;
		if (!open && !this.#hiding) this.#closedAt = performance.now();
		if (!open) this.#hiding = false;
		if (this.switcher) this.switcher.expanded = open;
		// Its tooltip closes: focus moves inside the switcher, which the rail's tooltip cannot hear.
		if (open) {
			this.switcher?.dispatchEvent(
				new CustomEvent('loam-tip-close', { bubbles: true, composed: true })
			);
		}
		if (!open && this.#returnFocus) this.switcher?.shadowRoot?.querySelector('button')?.focus();
	}

	/**
	 * As the console does: the pressed row is the active one before `handleFocus` moves it (#712). A press on
	 * what takes no focus, as the popover's padding, leaves focus in the list, not on `body` (R3). A press
	 * outside the pressed element's client area is on its scrollbar, as a modal list's when a long failure
	 * makes the `dialog` scroll, and goes through, whatever overflows.
	 */
	press(event: Event): void {
		const path = event.composedPath() as HTMLElement[];
		const [at] = path as [HTMLElement];
		const box = at.getBoundingClientRect();
		const press = event as MouseEvent;
		const row = path.find((node) => node.localName === 'violet-option') as
			| (HTMLElement & { value: string })
			| undefined;
		if (row) this.listbox.activeValue = row.value;
		else if (
			press.clientX - box.left - at.clientLeft < at.clientWidth &&
			press.clientY - box.top - at.clientTop < at.clientHeight &&
			!path.includes(this.listbox) &&
			!path.includes(this.failureLine)
		) {
			event.preventDefault();
		}
	}

	#markActive(): void {
		for (const option of this.listbox.options ?? []) {
			option.toggleAttribute('data-active', option.value === this.listbox.activeValue);
		}
	}

	async choose(event: CustomEvent<{ value: string }>): Promise<void> {
		event.stopPropagation();
		this.#choosing = true;
		try {
			await this.#choose(event.detail?.value ?? '');
		} finally {
			this.#choosing = false;
		}
	}

	async #choose(value: string): Promise<void> {
		const kernel = this.kernel as LoamKernelV3;
		if (value === ALL) {
			// Opening the section leaves an open app, and focus then goes to main's heading (7.8).
			const left = (await kernel.call<{ active: string | null }>('section-get')).data?.active;
			this.#returnFocus = !left;
			this.hide();
			await kernel.call('section-open', { section: 'projects' });
			if (left) focusMainHeading(this.shell);
			return;
		}
		if (value === this.active) {
			this.hide();
			return;
		}
		const result = await kernel.call<{ app: 'kept' | 'left' }>('scope-set', {
			project: value === NONE ? null : value,
		});
		if (!result.success) {
			// Its rows were stale, or the call moved the scope before it was refused, as an expired session's
			// does: read again.
			await this.#read();
			// It stays open, and says why, as the row it chose stays selected nowhere. Emptied first, so the
			// alert speaks again for the same refusal twice.
			const message = result.error?.message ?? 'The project could not open';
			const suggestion = result.error?.suggestion;
			this.failure = '';
			await Updates.next();
			this.failure = suggestion
				? `${message}${/[.!?]$/.test(message) ? '' : '.'} ${suggestion}`
				: message;
			this.listbox.value = this.active;
			return;
		}
		// The app left: focus goes to main's heading, as phase 1 moves it from a surface that left (7.8).
		const left = result.data?.app === 'left';
		this.#returnFocus = !left;
		this.hide();
		if (left) focusMainHeading(this.shell);
	}
}
observable(LoamProjectList.prototype, 'projects');
observable(LoamProjectList.prototype, 'active');
observable(LoamProjectList.prototype, 'modal');
observable(LoamProjectList.prototype, 'failure');

let defined: Promise<void> | null = null;

/** Open the switcher's list, or close it when it is open: its button's press, after the chunk loads. */
export async function openSwitcher(shell: LoamShell, switcher: LoamProjectSwitcher): Promise<void> {
	defined ??= FASTElement.define(LoamProjectList, {
		name: 'loam-project-list',
		template,
		styles,
	}).then(() => {
		// Each project's icon, as an empty shell has no app surfaces to register them.
		registerAppIcons();
		shell.rail.showIcons();
	});
	await defined;
	const root = switcher.shadowRoot as ShadowRoot;
	let list = root.querySelector<LoamProjectList>('loam-project-list');
	if (!list) {
		list = shell.ownerDocument.createElement('loam-project-list') as LoamProjectList;
		list.kernel = shell.kernel;
		list.shell = shell;
		list.switcher = switcher;
		list.modal = switcher.variant === 'tabbar';
		root.append(list);
		await Updates.next();
	}
	if (list.isOpen) list.hide();
	else if (!list.justClosed) await list.show();
}
