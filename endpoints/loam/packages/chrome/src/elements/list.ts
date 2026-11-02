/**
 * @fileoverview `loam-list`: a `list` sidebar (phase 1 specification, 4.2 and 9.3), a `violet-listbox`
 * over `{ items }`, with loading, empty and error states. The shell reads the command and sets `items`;
 * a selection is an event, and the shell turns it into a command.
 */

import { attr, css, FASTElement, html, observable, repeat, when } from '@lushly-dev/fast-element';
import '@lushly-dev/violet-elements/dist/listbox/violet-listbox.js';
import '@lushly-dev/violet-elements/dist/option/violet-option.js';

/** What a `list` sidebar's command returns per item. */
export interface LoamListItem {
	id: string;
	title: string;
	description?: string;
}

/** A failed read, as a failure's message and suggestion. */
export interface LoamListFailure {
	message: string;
	suggestion?: string;
}

/** Dispatched with the chosen id. */
export const LIST_SELECT_EVENT = 'loam-list-select';

const itemTemplate = html<LoamListItem>`
	<violet-option value="${(x) => x.id}" data-item="${(x) => x.id}">
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
		(x) => x.failure === null && !x.busy && x.items.length === 0,
		html<LoamList>`<p class="empty">${(x) => x.emptyMessage}</p>`
	)}
	<violet-listbox
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
		p,
		.failure p,
		.failure .suggestion {
			color: CanvasText;
		}
		/* violet-option sets forced-color-adjust: none, so its slotted text keeps author colors. */
		.item-title,
		.item-description {
			color: ButtonText;
		}
		violet-option[data-active] .item-title,
		violet-option[data-active] .item-description,
		violet-option[selected] .item-title,
		violet-option[selected] .item-description {
			color: HighlightText;
		}
	}
`;

export class LoamList extends FASTElement {
	declare label: string;
	declare emptyMessage: string;
	declare items: LoamListItem[];
	declare selected: string | null;
	declare failure: LoamListFailure | null;
	declare busy: boolean;

	constructor() {
		super();
		this.label = 'Items';
		this.emptyMessage = 'Nothing here yet.';
		this.items = [];
		this.selected = null;
		this.failure = null;
		this.busy = false;
	}

	busyChanged(): void {
		this.toggleAttribute('aria-busy', this.busy);
		if (this.busy) this.setAttribute('aria-busy', 'true');
	}

	handleChange(event: CustomEvent<{ value: string }>): void {
		event.stopPropagation();
		const id = event.detail?.value;
		if (typeof id !== 'string' || id === '' || id === this.selected) return;
		this.selected = id;
		this.dispatchEvent(
			new CustomEvent(LIST_SELECT_EVENT, { detail: { id }, bubbles: true, composed: true })
		);
	}
}
attr(LoamList.prototype, 'label');
attr({ attribute: 'empty-message' })(LoamList.prototype, 'emptyMessage');
observable(LoamList.prototype, 'items');
observable(LoamList.prototype, 'selected');
observable(LoamList.prototype, 'failure');
observable(LoamList.prototype, 'busy');

export const listDefinition = { name: 'loam-list', template, styles } as const;
