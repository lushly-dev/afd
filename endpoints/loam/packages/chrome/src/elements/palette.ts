/**
 * @fileoverview `loam-palette`: a `violet-dialog` opened with `showModal()`, holding a search field
 * and a `violet-listbox` of results from `palette-search` (section 7). The field keeps focus and
 * points at the active result with `aria-activedescendant`; Enter runs it. A failure shows its
 * message and suggestion in the list's footer. The shell owns every command: the palette asks it
 * to search, run and close.
 */

import {
	css,
	FASTElement,
	html,
	observable,
	ref,
	repeat,
	Updates,
	when,
} from '@lushly-dev/fast-element';
import '@lushly-dev/violet-elements/dist/dialog/violet-dialog.js';
import '@lushly-dev/violet-elements/dist/listbox/violet-listbox.js';
import '@lushly-dev/violet-elements/dist/option/violet-option.js';
import type { VioletDialog } from '@lushly-dev/violet-elements/dist/dialog/violet-dialog.js';
import type { VioletListbox } from '@lushly-dev/violet-elements/dist/listbox/violet-listbox.js';

export interface PaletteResult {
	name: string;
	title?: string;
	description: string;
	disabled: boolean;
	keybinding?: string;
}

export interface PaletteFailure {
	message: string;
	suggestion?: string;
}

export interface PaletteHost {
	search(query: string): Promise<PaletteResult[]>;
	run(name: string): Promise<PaletteFailure | null>;
	close(): void;
}

const resultTemplate = html<PaletteResult, LoamPalette>`
	<violet-option
		value="${(x) => x.name}"
		?disabled="${(x) => x.disabled}"
		data-command="${(x) => x.name}"
	>
		<span class="result-name">${(x) => x.title ?? x.name}</span>
		<span slot="description" class="result-description">
			${(x) => (x.disabled ? `${x.description} (needs input)` : x.description)}
		</span>
	</violet-option>
`;

const template = html<LoamPalette>`
	<violet-dialog
		${ref('dialog')}
		type="modal"
		padding="none"
		@request-close="${(x, c) => x.handleRequestClose(c.event)}"
		@open-change="${(x, c) => x.handleOpenChange(c.event as CustomEvent<{ open: boolean }>)}"
	>
		<span slot="title">Command palette</span>
		<div class="search">
			<input
				${ref('field')}
				class="field"
				type="text"
				role="combobox"
				aria-label="Search commands"
				aria-autocomplete="list"
				aria-expanded="true"
				aria-controls="palette-results"
				placeholder="Type a command"
				autocomplete="off"
				spellcheck="false"
				@input="${(x) => x.handleInput()}"
				@keydown="${(x, c) => x.handleKeydown(c.event as KeyboardEvent)}"
			/>
		</div>
		<violet-listbox
			${ref('listbox')}
			id="palette-results"
			class="results"
			label="Commands"
			@change="${(x, c) => x.handleChange(c.event as CustomEvent<{ value: string }>)}"
		>
			${repeat((x) => x.results, resultTemplate)}
		</violet-listbox>
		<div class="footer" role="status">
			${when(
				(x) => x.failure !== null,
				html<LoamPalette>`
				<p class="failure">${(x) => x.failure?.message}</p>
				<p class="suggestion">${(x) => x.failure?.suggestion ?? ''}</p>
			`
			)}
			${when(
				(x) => x.failure === null && x.searched && x.results.length === 0,
				html<LoamPalette>`<p>No commands match</p>`
			)}
		</div>
	</violet-dialog>
`;

const styles = css`
	:host {
		display: contents;
	}
	violet-dialog {
		--violet-dialog-width: min(92vw, calc(var(--shell-size-main-min) * 1.6));
		--violet-dialog-max-height: 70dvh;
		--violet-dialog-background: var(--color-surface-floating);
		--violet-dialog-shadow: var(--shadow-floating);
		--violet-dialog-radius: var(--radius-lg);
		--violet-dialog-backdrop: color-mix(in srgb, var(--color-surface-page) 60%, transparent);
	}
	violet-dialog::part(header) {
		padding-block: var(--space-stack-sm);
		padding-inline: var(--space-layout-sm);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
	.search {
		padding: var(--space-layout-sm);
		border-block-end: 1px solid var(--color-border-subtle);
	}
	.field {
		box-sizing: border-box;
		inline-size: 100%;
		min-block-size: var(--size-target-comfortable);
		padding-inline: var(--size-space-md);
		border: 1px solid var(--color-field-border);
		border-radius: var(--radius-md);
		background: var(--color-field-background);
		color: var(--color-field-text);
		font: inherit;
		font-size: var(--type-title-sm-size);
		line-height: var(--type-title-sm-line);
	}
	.field:hover {
		border-color: var(--color-field-border-hover);
	}
	.field::placeholder {
		color: var(--color-field-placeholder);
	}
	.field:focus-visible {
		border-color: var(--color-field-border-focus);
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: var(--size-space-xs);
	}
	.results {
		display: block;
		max-block-size: 50dvh;
		overflow: auto;
		padding: var(--size-space-sm);
	}
	/*
	 * violet-option reads --color-surface-highlight for its active row, which is not a contract id,
	 * so its white fallback shows in every theme and fails contrast in dark. Map it to a contract
	 * surface until the component reads one (a follow-up in the phase 0 specification).
	 */
	violet-option {
		--color-surface-highlight: var(--color-surface-card);
	}
	.result-name {
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	.result-description {
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
	.footer {
		min-block-size: var(--size-target-compact);
		padding-block: var(--space-stack-xs);
		padding-inline: var(--space-layout-sm);
		border-block-start: 1px solid var(--color-border-subtle);
		color: var(--color-text-secondary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
	.footer p {
		margin: 0;
	}
	.failure {
		color: var(--color-state-danger-text);
		font-weight: var(--weight-semibold);
	}
	@media (forced-colors: active) {
		.field {
			border-color: ButtonText;
			background: Field;
			color: FieldText;
		}
		.field:focus-visible {
			outline-color: Highlight;
		}
		.failure,
		.footer {
			color: CanvasText;
		}
		/* violet-option sets forced-color-adjust: none, so its slotted text keeps author colors. */
		.result-name,
		.result-description {
			color: ButtonText;
		}
		violet-option[data-active] .result-name,
		violet-option[data-active] .result-description {
			color: HighlightText;
		}
	}
`;

export class LoamPalette extends FASTElement {
	declare dialog: VioletDialog;
	declare field: HTMLInputElement;
	declare listbox: VioletListbox;
	declare results: PaletteResult[];
	declare failure: PaletteFailure | null;
	declare searched: boolean;
	host: PaletteHost | null = null;
	#generation = 0;

	constructor() {
		super();
		this.results = [];
		this.failure = null;
		this.searched = false;
	}

	get isOpen(): boolean {
		return this.dialog?.open === true;
	}

	/** Open with a query and search it. */
	async open(query = ''): Promise<void> {
		if (!this.dialog) return;
		this.failure = null;
		this.field.value = query;
		if (!this.dialog.open) this.dialog.show();
		this.field.focus();
		await this.search();
	}

	/** Close without asking the shell; the shell calls it after `palette-close`. */
	close(): void {
		if (this.dialog?.open) this.dialog.hide();
	}

	async search(): Promise<void> {
		const host = this.host;
		if (!host) return;
		const generation = ++this.#generation;
		const results = await host.search(this.field.value);
		if (generation !== this.#generation) return;
		this.results = results;
		this.searched = true;
		// The results render on FAST's next update; then point the listbox and the field at the first.
		await Updates.next();
		this.listbox.activeValue = results.find((result) => !result.disabled)?.name ?? '';
		this.#syncActive();
	}

	handleInput(): void {
		this.failure = null;
		void this.search();
	}

	handleKeydown(event: KeyboardEvent): boolean {
		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp':
				this.listbox.handleKeydown(event);
				this.#syncActive();
				return false;
			case 'Enter':
				event.preventDefault();
				void this.runActive();
				return false;
			default:
				return true;
		}
	}

	handleChange(event: CustomEvent<{ value: string }>): void {
		event.stopPropagation();
		if (event.detail?.value) void this.run(event.detail.value);
	}

	async runActive(): Promise<void> {
		const name = this.listbox.activeValue;
		if (name) await this.run(name);
	}

	async run(name: string): Promise<void> {
		const result = this.results.find((candidate) => candidate.name === name);
		if (!this.host || !result || result.disabled) return;
		this.failure = await this.host.run(name);
	}

	/** Escape, the close button and the backdrop all ask the shell, which calls `palette-close`. */
	handleRequestClose(event: Event): void {
		event.preventDefault();
		this.host?.close();
	}

	handleOpenChange(event: CustomEvent<{ open: boolean }>): void {
		if (!event.detail?.open) {
			this.results = [];
			this.searched = false;
			this.failure = null;
		}
	}

	#syncActive(): void {
		const option = this.listbox.options.find(
			(candidate) => candidate.value === this.listbox.activeValue
		);
		for (const candidate of this.listbox.options)
			candidate.toggleAttribute('data-active', candidate === option);
		if (option) this.field.setAttribute('aria-activedescendant', option.id);
		else this.field.removeAttribute('aria-activedescendant');
	}
}
observable(LoamPalette.prototype, 'results');
observable(LoamPalette.prototype, 'failure');
observable(LoamPalette.prototype, 'searched');

export const paletteDefinition = { name: 'loam-palette', template, styles } as const;
