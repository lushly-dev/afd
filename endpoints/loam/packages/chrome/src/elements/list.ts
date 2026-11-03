/**
 * @fileoverview `loam-list`: a `list` sidebar (phase 1 specification, 4.2 and 9.3), a `violet-listbox`
 * over `{ items }`, with loading, empty and error states. The shell reads the command and sets `items`;
 * a selection is an event, and the shell turns it into a command.
 */

import {
	attr,
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
import '@lushly-dev/violet-elements/dist/listbox/violet-listbox.js';
import '@lushly-dev/violet-elements/dist/option/violet-option.js';
import type { VioletListbox } from '@lushly-dev/violet-elements/dist/listbox/violet-listbox.js';

/** What a `list` sidebar's command returns per item. */
export interface LoamListItem {
	id: string;
	title: string;
	description?: string;
	/** A `tree` sidebar's row: how deep it is, from 0 (phase 2 specification, 7.4). */
	depth?: number;
}

/** A failed read, as a failure's message and suggestion. */
export interface LoamListFailure {
	message: string;
	suggestion?: string;
}

/** Dispatched with the chosen id. */
export const LIST_SELECT_EVENT = 'loam-list-select';

const itemTemplate = html<LoamListItem>`
	<violet-option
		value="${(x) => x.id}"
		data-item="${(x) => x.id}"
		data-depth="${(x) => (x.depth ? String(Math.min(x.depth, 7)) : null)}"
	>
		<span class="item-title">${(x) => x.title}</span>
		${when(
			(x) => x.description !== undefined,
			html<LoamListItem>`<span class="item-description" slot="description"
				>${(x) => x.description}</span
			>`
		)}
	</violet-option>
`;

const template = html<LoamList>`
	${when((x) => x.heading !== '', html<LoamList>`<h2>${(x) => x.heading}</h2>`)}
	${when(
		(x) => x.failure !== null,
		html<LoamList>`
			<div class="failure" role="alert">
				<p>${(x) => x.failure?.message}</p>
				<p class="suggestion">${(x) => x.failure?.suggestion ?? ''}</p>
			</div>
		`
	)}
	${when(
		(x) => x.failure === null && x.items.length === 0,
		html<LoamList>`<p class="empty">${(x) => (x.busy ? 'Loading…' : x.emptyMessage)}</p>`
	)}
	<violet-listbox
		${ref('listbox')}
		label="${(x) => x.label}"
		value="${(x) => x.selected ?? ''}"
		?hidden="${(x) => x.failure !== null || x.items.length === 0}"
		@change="${(x, c) => x.handleChange(c.event as CustomEvent<{ value: string }>)}"
	>
		${repeat((x) => x.items, itemTemplate)}
	</violet-listbox>
`;

const styles = css`
	:host {
		display: block;
		--violet-listbox-min-inline-size: 0;
		--violet-listbox-max-block-size: 100dvh;
	}
	:host([hidden]),
	[hidden] {
		display: none;
	}
	/*
	 * violet-option reads --color-surface-highlight for its active row, which is not a contract id, so its
	 * white fallback fails contrast in dark: the palette maps it the same way.
	 */
	violet-option {
		--color-surface-highlight: var(--color-surface-subtle);
	}
	violet-listbox::part(control):focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: var(--size-space-xs);
	}
	/* Focus stays on the list, so the active row is where the keyboard is (design.md, focus). */
	violet-listbox:focus-within violet-option[data-active]::part(control) {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: calc(-1 * var(--shell-size-focus));
	}
	/* Selected: the control colors and a start-edge bar, since color alone is not enough. */
	violet-option[selected]::part(control) {
		border-inline-start: var(--size-space-xs) solid var(--color-control-selected-foreground);
		background: var(--color-control-selected-background);
		color: var(--color-control-selected-foreground);
	}
	h2 {
		margin: 0 0 var(--space-stack-xs);
		color: var(--color-text-secondary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--weight-semibold);
	}
	:host([heading]:not([heading=''])) {
		margin-block-end: var(--space-stack-md);
	}
	violet-option[data-depth]::part(control) {
		padding-inline-start: calc(var(--space-inline-md) * 2);
	}
	violet-option[data-depth='2']::part(control) {
		padding-inline-start: calc(var(--space-inline-md) * 3);
	}
	violet-option[data-depth='3']::part(control),
	violet-option[data-depth='4']::part(control),
	violet-option[data-depth='5']::part(control),
	violet-option[data-depth='6']::part(control),
	violet-option[data-depth='7']::part(control) {
		padding-inline-start: calc(var(--space-inline-md) * 4);
	}
	.item-title {
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	.item-description {
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
	p {
		margin: 0;
		color: var(--color-text-secondary);
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	.failure p {
		color: var(--color-state-danger-text);
	}
	.failure .suggestion {
		margin-block-start: var(--space-stack-xs);
		color: var(--color-text-secondary);
	}
	@media (forced-colors: active) {
		h2,
		p,
		.failure p,
		.failure .suggestion {
			color: CanvasText;
		}
		/*
		 * violet-option sets forced-color-adjust: none, so it keeps author colors, and fills its active
		 * row as it does a selected one. Only a selection is filled here: the active row is outlined.
		 */
		violet-option::part(control) {
			border-color: transparent;
			background: Canvas;
			color: ButtonText;
		}
		violet-option::part(control):hover {
			border-color: ButtonText;
			background: Canvas;
		}
		.item-title,
		.item-description {
			color: ButtonText;
		}
		violet-option[selected]::part(control),
		violet-option[selected]::part(control):hover {
			border-color: Highlight;
			background: Highlight;
			color: HighlightText;
		}
		violet-option[selected] .item-title,
		violet-option[selected] .item-description {
			color: HighlightText;
		}
		violet-listbox::part(control):focus-visible,
		violet-listbox:focus-within violet-option[data-active]::part(control) {
			outline-color: Highlight;
		}
		violet-listbox:focus-within violet-option[selected][data-active]::part(control) {
			outline-color: HighlightText;
		}
	}
`;

export class LoamList extends FASTElement {
	declare label: string;
	/**
	 * A dual-scope app's sidebar has two lists, each a `region` with this heading, `In Atlas` or
	 * `In Personal` (phase 2 specification, 7.4); empty, one list with none, as phase 1.
	 */
	declare heading: string;
	/** The level its command runs at, which a selection in it carries. */
	level?: 'workspace' | 'project';
	declare emptyMessage: string;
	declare items: LoamListItem[];
	declare selected: string | null;
	declare failure: LoamListFailure | null;
	declare busy: boolean;
	declare listbox: VioletListbox;
	#activeWatch = { handleChange: () => this.#syncActive() };

	constructor() {
		super();
		this.label = 'Items';
		this.heading = '';
		this.emptyMessage = 'Nothing here yet.';
		this.items = [];
		this.selected = null;
		this.failure = null;
		this.busy = false;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		Observable.getNotifier(this.listbox).subscribe(this.#activeWatch, 'activeValue');
		this.#syncActive();
	}

	override disconnectedCallback(): void {
		Observable.getNotifier(this.listbox).unsubscribe(this.#activeWatch, 'activeValue');
		super.disconnectedCallback();
	}

	headingChanged(): void {
		if (!this.heading) {
			this.removeAttribute('role');
			this.removeAttribute('aria-label');
			return;
		}
		this.setAttribute('role', 'region');
		this.setAttribute('aria-label', this.heading);
	}

	busyChanged(): void {
		if (this.busy) this.setAttribute('aria-busy', 'true');
		else this.removeAttribute('aria-busy');
	}

	itemsChanged(): void {
		if (this.$fastController?.isConnected) void Updates.next().then(() => this.#syncActive());
	}

	/** Mark the row the keyboard is on, as the palette does, since the option does not say. */
	#syncActive(): void {
		for (const option of this.listbox?.options ?? []) {
			option.toggleAttribute('data-active', option.value === this.listbox.activeValue);
		}
	}

	handleChange(event: CustomEvent<{ value: string }>): void {
		event.stopPropagation();
		const id = event.detail?.value;
		if (typeof id !== 'string' || id === '' || id === this.selected) return;
		this.selected = id;
		this.dispatchEvent(
			new CustomEvent(LIST_SELECT_EVENT, {
				detail: { id, level: this.level },
				bubbles: true,
				composed: true,
			})
		);
	}
}
attr(LoamList.prototype, 'label');
attr(LoamList.prototype, 'heading');
attr({ attribute: 'empty-message' })(LoamList.prototype, 'emptyMessage');
observable(LoamList.prototype, 'items');
observable(LoamList.prototype, 'selected');
observable(LoamList.prototype, 'failure');
observable(LoamList.prototype, 'busy');

export const listDefinition = { name: 'loam-list', template, styles } as const;
