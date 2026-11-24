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
import '@lushly-dev/violet-elements/dialog/define';
import '@lushly-dev/violet-elements/listbox/define';
import '@lushly-dev/violet-elements/option/define';
import type { VioletDialog } from '@lushly-dev/violet-elements/dialog';
import type { VioletListbox } from '@lushly-dev/violet-elements/listbox';
import { trapTab } from './focus.js';

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
		<span class="result-name">${(x) => x.title ?? x.name}</span
		><span class="pause">, </span>
		<span slot="description" class="result-description">
			${(x) => (x.disabled ? `${x.description} (needs input)` : x.description)}
		</span>
		${when(
			(x) => Boolean(x.keybinding),
			html<PaletteResult>`<kbd slot="after" class="result-shortcut">${(x) => x.keybinding}</kbd>`
		)}
	</violet-option>
`;

const template = html<LoamPalette>`
	<violet-dialog
		${ref('dialog')}
		type="modal"
		padding="none"
		@request-close="${(x, c) => x.handleRequestClose(c.event)}"
		@keydown="${(x, c) => x.handleDialogKeydown(c.event as KeyboardEvent)}"
		@open-change="${(x, c) => x.handleOpenChange(c.event as CustomEvent<{ open: boolean }>)}"
	>
		<span slot="title">Command palette</span>
		<div class="search">
			<input
				${ref('field')}
				class="field"
				type="text"
				role="combobox"
				aria-label="Search commands, documents and settings"
				aria-autocomplete="list"
				aria-expanded="true"
				aria-controls="palette-results"
				placeholder="Type a command or a title"
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
			label="Commands, documents and settings"
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
				html<LoamPalette>`<p>No commands, documents or settings match</p>`
			)}
		</div>
	</violet-dialog>
`;

const styles = css`
	:host {
		display: contents;
	}
	violet-dialog {
		--violet-dialog-width: min(92vw, calc(var(--violet-shell-size-main-min) * 1.6));
		--violet-dialog-max-height: 70dvh;
		--violet-dialog-background: var(--violet-color-surface-floating);
		--violet-dialog-shadow: var(--violet-shadow-floating);
		--violet-dialog-radius: var(--violet-radius-lg);
		--violet-dialog-backdrop: color-mix(in srgb, var(--violet-color-surface-page) 60%, transparent);
	}
	violet-dialog::part(header) {
		padding-block: var(--violet-space-stack-sm);
		padding-inline: var(--violet-space-layout-sm);
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
	}
	.search {
		padding: var(--violet-space-layout-sm);
		border-block-end: 1px solid var(--violet-color-border-subtle);
	}
	.field {
		box-sizing: border-box;
		inline-size: 100%;
		min-block-size: var(--violet-size-target-comfortable);
		padding-inline: var(--violet-size-space-md);
		border: 1px solid var(--violet-color-field-border);
		border-radius: var(--violet-radius-md);
		background: var(--violet-color-field-background);
		color: var(--violet-color-field-text);
		font: inherit;
		font-size: var(--violet-type-title-sm-size);
		line-height: var(--violet-type-title-sm-line);
	}
	.field:hover {
		border-color: var(--violet-color-field-border-hover);
	}
	.field::placeholder {
		color: var(--violet-color-field-placeholder);
	}
	.field:focus-visible {
		border-color: var(--violet-color-field-border-focus);
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: var(--violet-size-space-xs);
	}
	.results {
		display: block;
		max-block-size: 50dvh;
		overflow: auto;
		padding: var(--violet-size-space-sm);
	}
	/* The active result is where Enter goes while focus stays in the field: show the focus indicator. */
	violet-option[data-active]::part(control) {
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: calc(-1 * var(--violet-shell-size-focus));
	}
	/* A pause between a row's title and its description, heard and not seen (A-N1). */
	.pause {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.result-name {
		font-size: var(--violet-type-body-md-size);
		line-height: var(--violet-type-body-md-line);
	}
	.result-description {
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
	}
	.result-shortcut {
		font-family: var(--violet-font-family-body);
		font-size: var(--violet-type-caption-xs-size);
		line-height: var(--violet-type-caption-xs-line);
		font-weight: var(--violet-type-caption-xs-weight);
		color: var(--violet-color-text-secondary);
		white-space: nowrap;
	}
	.footer {
		min-block-size: var(--violet-size-target-compact);
		padding-block: var(--violet-space-stack-xs);
		padding-inline: var(--violet-space-layout-sm);
		border-block-start: 1px solid var(--violet-color-border-subtle);
		color: var(--violet-color-text-secondary);
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
	}
	.footer p {
		margin: 0;
	}
	.failure {
		color: var(--violet-color-state-danger-text);
		font-weight: var(--violet-weight-semibold);
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
		.result-description,
		.result-shortcut {
			color: ButtonText;
		}
		violet-option[data-active] .result-name,
		violet-option[data-active] .result-description,
		violet-option[data-active] .result-shortcut,
		violet-option[selected] .result-name,
		violet-option[selected] .result-description,
		violet-option[selected] .result-shortcut {
			color: HighlightText;
		}
		violet-option[disabled] .result-name,
		violet-option[disabled] .result-description,
		violet-option[disabled] .result-shortcut {
			color: GrayText;
		}
		violet-option[data-active]::part(control) {
			outline-color: Highlight;
		}
		.search,
		.footer {
			border-color: CanvasText;
		}
		.field::placeholder {
			color: GrayText;
		}
	}
`;

/**
 * A script's Enter or Space never chooses a row (phase 4 specification, 8.3; step 7's R6 and re-check, 3): heard on the
 * listbox's own shadow root before its control, so Violet's listbox is unchanged. Escape and F6 pass, as before.
 */
function hearOnlyPeople(listbox: VioletListbox | undefined): void {
	listbox?.shadowRoot?.addEventListener(
		'keydown',
		(event) => {
			const key = (event as KeyboardEvent).key;
			if (event.isTrusted || (key !== 'Enter' && key !== ' ')) return;
			event.preventDefault();
			event.stopImmediatePropagation();
		},
		{ capture: true }
	);
}

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

	override connectedCallback(): void {
		super.connectedCallback();
		hearOnlyPeople(this.listbox);
	}

	/** Open with a query and search it. */
	async open(query = ''): Promise<void> {
		// Defined lazily, the element may not have rendered its dialog on the frame it upgrades.
		for (let attempt = 0; attempt < 60 && typeof this.dialog?.show !== 'function'; attempt++)
			await Updates.next();
		if (typeof this.dialog?.show !== 'function') return;
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
				// Only a person's own Enter runs the row (8.3; step 7's R6 and re-check, 3).
				if (event.isTrusted) void this.runActive();
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

	/** Chromium lets Tab leave a modal dialog, so the palette keeps it inside, as the drawers do. */
	handleDialogKeydown(event: KeyboardEvent): boolean {
		trapTab(event, this.dialog);
		return true;
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
