/**
 * @fileoverview `notes-editor`, the type's editor (documents specification, 5.6, 5.7 and 10): a
 * `violet-text-area` from the kit, filling the frame, holding a draft until `save()`. It reports dirty on each
 * edit and its selection as a `text-range` in UTF-16 units, both as the SDK's events. `documentChanged`
 * re-reads: a clean draft takes the stored text, keeping the caret by offset; a dirty one says the note
 * changed elsewhere, with Keep mine and Use theirs, since D46's conflict rule is per property and the text is
 * one. Its client is a surface port fixed to the note's scope, so it reads and writes nothing of another.
 * `Insert link` lists the scope's documents, filtered as typed, and inserts a link token; `Embed` adds one to
 * the note's embeds, each a `loam-embed` under the text. After each save the shell's index is brought to what
 * the text links and embeds, by `document-link-add` and `-remove` (10).
 */

import { css, FASTElement, html, observable, ref, repeat, Updates } from '@lushly-dev/fast-element';
import {
	type AppContextV1,
	type DocumentChangeV1,
	type DocumentRecordV1,
	type DocumentRefV1,
	EDITOR_DIRTY_EVENT,
	EDITOR_SELECTION_EVENT,
	type LoamEditorElementV1,
} from '@lushly-dev/loam-sdk';
import { linkChanges, linkToken } from './links.js';
import { NotesEmbed, notesEmbedDefinition } from './notes-embed.js';
import { NotesInspector, notesInspectorDefinition } from './notes-inspector.js';

interface TextArea extends HTMLElement {
	value: string;
}

/** What the picker offers: a document of the note's scope, by its title. */
interface Found {
	id: string;
	title: string;
}

/** A failed command as a rejection, with its code and suggestion, so the shell's toast can say them. */
function refusal(
	error: { code?: string; message?: string; suggestion?: string } | undefined
): Error {
	return Object.assign(new Error(error?.message ?? 'The note could not be saved'), {
		code: error?.code,
		suggestion: error?.suggestion,
	});
}

const template = html<NotesEditor>`
	<div class="conflict" role="alert" ?hidden="${(x) => !x.conflict}">
		<p>This note changed elsewhere</p>
		<div class="actions">
			<violet-button class="keep" @click="${(x) => x.keepMine()}">Keep mine</violet-button>
			<violet-button class="theirs" @click="${(x) => x.useTheirs()}">Use theirs</violet-button>
		</div>
	</div>
	<p class="status" role="status">${(x) => x.status}</p>
	<violet-text-area
		${ref('area')}
		class="text"
		label="${(x) => x.document?.title ?? 'Note'}"
		rows="12"
		?readonly="${(x) => x.document?.readOnly === true}"
		@input="${(x, c) => x.edited(c.event)}"
		@keyup="${(x) => x.selected()}"
		@mouseup="${(x) => x.selected()}"
		@select="${(x) => x.selected()}"
	></violet-text-area>
	<div class="tools" ?hidden="${(x) => x.document?.readOnly === true}">
		<violet-button class="link" @click="${(x) => x.pick('link')}">Insert link</violet-button>
		<violet-button class="embed" @click="${(x) => x.pick('embed')}">Embed</violet-button>
	</div>
	<div
		class="picker"
		role="group"
		aria-label="${(x) => (x.picking === 'embed' ? 'Embed a document' : 'Insert a link')}"
		?hidden="${(x) => x.picking === null}"
		@keydown="${(x, c) => x.pickerKey(c.event as KeyboardEvent)}"
	>
		<violet-text-field
			${ref('filter')}
			class="filter"
			label="Find a document"
			@input="${(x) => x.find()}"
		></violet-text-field>
		<p class="count" role="status">${(x) => x.counted}</p>
		<ul class="found" aria-label="Documents" ?hidden="${(x) => x.found.length === 0}">
			${repeat(
				(x) => x.found,
				html<Found, NotesEditor>`<li>
					<violet-button appearance="quiet" class="choice" @click="${(d, c) => c.parent.choose(d)}"
						>${(d) => d.title}</violet-button
					>
				</li>`
			)}
		</ul>
		<p class="none" ?hidden="${(x) => x.found.length > 0}">No documents match</p>
		<violet-button class="cancel" @click="${(x) => x.closePicker()}">Cancel</violet-button>
	</div>
	<ul class="embeds" aria-label="Embedded documents" ?hidden="${(x) => x.embeds.length === 0}">
		${repeat(
			(x) => x.embeds,
			html<string, NotesEditor>`<li>
				<loam-embed :document="${(id) => id}"></loam-embed>
				<violet-button
					class="unembed"
					aria-label="${(id, c) => `Remove embed: ${c.parent.titles[id] ?? 'document'}`}"
					@click="${(id, c) => c.parent.unembed(id)}"
					>Remove embed</violet-button
				>
			</li>`
		)}
	</ul>
`;

const styles = css`
	:host {
		display: flex;
		flex-direction: column;
		gap: var(--space-stack-sm);
		box-sizing: border-box;
		block-size: 100%;
		padding: var(--space-layout-md);
	}
	[hidden] {
		display: none;
	}
	p {
		margin: 0;
	}
	.status:empty {
		display: none;
	}
	.status {
		color: var(--color-state-danger-text);
	}
	.conflict {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-inline-sm);
		padding: var(--space-stack-sm) var(--space-inline-md);
		border: 1px solid var(--color-state-warning-border);
		border-radius: var(--radius-md);
		background: var(--color-state-warning-background);
		color: var(--color-state-warning-text);
	}
	.conflict[hidden] {
		display: none;
	}
	.actions {
		display: flex;
		gap: var(--space-inline-sm);
	}
	.tools,
	.picker {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-inline-sm);
	}
	.picker {
		flex-direction: column;
		align-items: stretch;
		padding: var(--space-stack-sm) var(--space-inline-md);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
	}
	.picker[hidden],
	.tools[hidden],
	.embeds[hidden],
	.none[hidden],
	.found[hidden] {
		display: none;
	}
	.count {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	ul {
		display: grid;
		gap: var(--space-stack-xs);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.none {
		color: var(--color-text-secondary);
	}
	.embeds li {
		display: grid;
		gap: var(--space-stack-xs);
		justify-items: start;
	}
	.embeds loam-embed {
		justify-self: stretch;
	}
	.text {
		flex: 1 1 auto;
		min-block-size: 0;
	}
	.text::part(field),
	.text::part(control-frame) {
		block-size: 100%;
	}
	.text::part(field) {
		display: flex;
		flex-direction: column;
	}
	.text::part(control-frame) {
		flex: 1 1 auto;
	}
	.text::part(control) {
		box-sizing: border-box;
		block-size: 100%;
		resize: none;
	}
	@media (forced-colors: active) {
		.conflict {
			border-color: CanvasText;
			background: Canvas;
			color: CanvasText;
		}
		.status {
			color: CanvasText;
		}
	}
`;

export class NotesEditor extends FASTElement implements LoamEditorElementV1 {
	context?: AppContextV1;
	declare document?: DocumentRefV1;
	declare conflict: boolean;
	declare status: string;
	declare area: TextArea;
	declare filter: TextArea;
	/** The documents embedded under the text, in order: the draft's, saved with it. */
	declare embeds: string[];
	/** The picker open, for a link or an embed, or null. */
	declare picking: 'link' | 'embed' | null;
	declare found: Found[];
	/** The picker's count of what it found, read out as it changes. */
	declare counted: string;
	/** Each embedded document's title, for its Remove button's name. */
	declare titles: Record<string, string>;
	/** The text as last read or saved: the draft is dirty when it differs. */
	#saved = '';
	/** The embeds as last read or saved, as a key. */
	#savedEmbeds = '';
	/** The caret when the picker opened, where a link goes. */
	#caret: [number, number] = [0, 0];
	#finding = 0;
	/** The stored text a conflict found, until a person chooses. */
	#theirs = '';
	#selection = '';
	/** The text a save in flight is writing: its own event's re-read may land before the save returns. */
	#saving: string | null = null;
	/** The save in flight: one at a time, so two never overlap and a re-read never meets a half-written draft. */
	#writing: Promise<void> = Promise.resolve();
	#reading: Promise<void> | null = null;

	constructor() {
		super();
		this.conflict = false;
		this.status = '';
		this.embeds = [];
		this.picking = null;
		this.found = [];
		this.counted = '';
		this.titles = {};
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.#reading ??= this.#read(true);
	}

	/** The text area takes focus, as Enter on the tab asks (5.8). */
	override focus(options?: FocusOptions): void {
		this.#control()?.focus(options);
	}

	get draft(): string {
		return this.area?.value ?? '';
	}

	get dirty(): boolean {
		return this.draft !== this.#saved || this.embeds.join(' ') !== this.#savedEmbeds;
	}

	#control(): HTMLTextAreaElement | null {
		return this.area?.shadowRoot?.querySelector('textarea') ?? null;
	}

	async #content(): Promise<{ text: string; embeds: string[] } | undefined> {
		const id = this.document?.id;
		if (!id || !this.context) return undefined;
		const result = await this.context.client.call<{ text: string; embeds?: string[] }>(
			'notes-content-get',
			{ document: id }
		);
		if (!result.success || typeof result.data?.text !== 'string') {
			this.status = `This note could not be read: ${result.error?.message ?? 'no answer'}`;
			return undefined;
		}
		this.status = '';
		return { text: result.data.text, embeds: result.data.embeds ?? [] };
	}

	async #read(first: boolean): Promise<void> {
		const content = await this.#content();
		if (content === undefined) return;
		const { text } = content;
		// Embeds follow the store while this draft has not changed them.
		const embeds = content.embeds.join(' ');
		if (first || this.embeds.join(' ') === this.#savedEmbeds) {
			this.#savedEmbeds = embeds;
			this.embeds = [...content.embeds];
		}
		if (first) {
			this.#saved = text;
			this.#replace(text);
			return;
		}
		// The store holds the draft itself, as after this editor's own save: clean, with no conflict.
		if (text === this.draft) {
			this.#saved = text;
			this.conflict = false;
			this.#report();
			return;
		}
		if (text === this.#saved || text === this.#saving) return;
		if (!this.dirty) {
			this.#saved = text;
			this.#replace(text);
			return;
		}
		// Neither loses text until a person chooses (D7).
		this.#theirs = text;
		this.conflict = true;
	}

	/** The draft becomes `text`, the caret kept by offset. */
	#replace(text: string): void {
		const control = this.#control();
		const start = control?.selectionStart ?? 0;
		const end = control?.selectionEnd ?? 0;
		if (this.area) this.area.value = text;
		void Updates.next().then(() => {
			const now = this.#control();
			if (now && this.matches(':focus-within')) {
				now.setSelectionRange(Math.min(start, text.length), Math.min(end, text.length));
			}
		});
	}

	#report(): void {
		this.dispatchEvent(
			new CustomEvent(EDITOR_DIRTY_EVENT, {
				detail: { dirty: this.dirty },
				bubbles: true,
				composed: true,
			})
		);
	}

	edited(event: Event): boolean {
		// The text area's own event: the native one, composed out of its shadow root, is the same edit.
		if (!(event instanceof CustomEvent)) return true;
		this.#report();
		this.selected();
		return true;
	}

	selected(): boolean {
		const control = this.#control();
		if (!control) return true;
		const range = { kind: 'text-range', start: control.selectionStart, end: control.selectionEnd };
		const key = `${range.start} ${range.end}`;
		if (key === this.#selection) return true;
		this.#selection = key;
		this.dispatchEvent(
			new CustomEvent(EDITOR_SELECTION_EVENT, { detail: range, bubbles: true, composed: true })
		);
		return true;
	}

	/** Write the draft through `notes-content-set`; rejecting keeps the tab dirty (5.5). */
	save(): Promise<void> {
		const next = this.#writing.then(() => this.#write());
		// The chain continues past a rejection; the caller sees it.
		this.#writing = next.catch(() => {});
		return next;
	}

	async #write(): Promise<void> {
		await this.#reading;
		const id = this.document?.id;
		if (!id || !this.context || !this.dirty) return;
		const text = this.draft;
		const embeds = [...this.embeds];
		this.#saving = text;
		let result: Awaited<ReturnType<AppContextV1['client']['call']>>;
		try {
			result = await this.context.client.call('notes-content-set', { document: id, text, embeds });
		} finally {
			this.#saving = null;
		}
		if (!result.success) throw refusal(result.error);
		this.#saved = text;
		this.#savedEmbeds = embeds.join(' ');
		this.conflict = false;
		this.#report();
		await this.#link(id, text, embeds);
	}

	/**
	 * The shell's index brought to what the saved note links and embeds, through this surface's port, so only
	 * links within the note's scope are read or changed (10). A link the shell refuses is left out.
	 */
	async #link(id: string, text: string, embeds: string[]): Promise<void> {
		const { client, documents } = this.context as AppContextV1;
		if (!documents) return;
		const held = (await documents.links(id)).out.map(({ link }) => link);
		const { add, remove } = linkChanges(text, embeds, held);
		for (const { to, kind } of add) await client.call('document-link-add', { from: id, to, kind });
		for (const link of remove) await client.call('document-link-remove', { link });
	}

	/** Open the picker for a link at the caret, or for an embed (10). */
	pick(mode: 'link' | 'embed'): void {
		const control = this.#control();
		this.#caret = [control?.selectionStart ?? 0, control?.selectionEnd ?? 0];
		this.picking = mode;
		if (this.filter) this.filter.value = '';
		void this.find();
		void Updates.next().then(() =>
			this.filter?.shadowRoot?.querySelector<HTMLInputElement>('input')?.focus()
		);
	}

	/** The scope's documents whose title holds what is typed, at most 20, by the `documents` grant. */
	async find(): Promise<void> {
		const turn = ++this.#finding;
		const query = this.filter?.value.trim() ?? '';
		const found: DocumentRecordV1[] =
			(await this.context?.documents?.list({ ...(query ? { query } : {}), limit: 20 })) ?? [];
		if (turn !== this.#finding) return;
		this.found = found.map(({ id, title }) => ({ id, title }));
		// Said politely, as the list changes under the field (A-S5).
		this.counted = found.length === 1 ? '1 document' : `${found.length} documents`;
	}

	/** A link's token inserted at the caret, or an embed added, and the picker closed. */
	choose(found: Found): void {
		if (this.picking === 'link') {
			const [start, end] = this.#caret;
			const token = linkToken(found.id, found.title);
			this.#replace(`${this.draft.slice(0, start)}${token}${this.draft.slice(end)}`);
			this.#caret = [start + token.length, start + token.length];
		} else if (!this.embeds.includes(found.id) && this.embeds.length < 20) {
			this.embeds = [...this.embeds, found.id];
		}
		this.closePicker();
		this.#report();
	}

	/** Remove an embed; focus goes to the next Remove, else the previous, else `Embed` (A-B2). */
	/** The embeds' titles, read through the `documents` grant as the list changes. */
	embedsChanged(): void {
		const documents = this.context?.documents;
		if (!documents || !this.embeds) return;
		void Promise.all(
			this.embeds.map(async (id) => [id, (await documents.get(id))?.title ?? 'document'] as const)
		).then((pairs) => {
			this.titles = Object.fromEntries(pairs);
		});
	}

	unembed(id: string): void {
		const at = this.embeds.indexOf(id);
		this.embeds = this.embeds.filter((each) => each !== id);
		this.#report();
		void Updates.next().then(() => {
			const buttons = [...(this.shadowRoot?.querySelectorAll<HTMLElement>('.unembed') ?? [])];
			(
				buttons[at] ??
				buttons[at - 1] ??
				this.shadowRoot?.querySelector<HTMLElement>('.embed')
			)?.focus();
		});
	}

	/** Escape closes the picker and gives focus back to the text. */
	pickerKey(event: KeyboardEvent): boolean {
		if (event.key !== 'Escape') return true;
		event.stopPropagation();
		this.closePicker();
		return false;
	}

	closePicker(): void {
		this.picking = null;
		const [start, end] = this.#caret;
		void Updates.next().then(() => {
			const control = this.#control();
			control?.focus();
			control?.setSelectionRange(start, end);
		});
	}

	/** Another call changed the note: an agent's, another editor's save, an undo, or this one's (5.7). */
	documentChanged(_change: DocumentChangeV1): void {
		void this.#read(false);
	}

	/** Keep the draft: the stored text is what it now differs from, and the next save writes it over. */
	keepMine(): void {
		this.#saved = this.#theirs;
		this.conflict = false;
		this.#report();
	}

	/** Take the stored text, and the draft is clean. */
	useTheirs(): void {
		this.#saved = this.#theirs;
		this.#replace(this.#theirs);
		this.conflict = false;
		this.#report();
	}

	dispose(): void {
		this.conflict = false;
	}
}
observable(NotesEditor.prototype, 'document');
observable(NotesEditor.prototype, 'conflict');
observable(NotesEditor.prototype, 'status');
observable(NotesEditor.prototype, 'embeds');
observable(NotesEditor.prototype, 'picking');
observable(NotesEditor.prototype, 'found');
observable(NotesEditor.prototype, 'counted');
observable(NotesEditor.prototype, 'titles');

/** The type's editor, inspector and embed, each in the app's registry with its shadow root on it. */
export async function defineNotesElements(context: AppContextV1): Promise<void> {
	const { registry } = context;
	const shadowOptions = { mode: 'open' as const, customElementRegistry: registry };
	await Promise.all([
		FASTElement.define(NotesEditor, {
			name: 'notes-editor',
			template,
			styles,
			registry,
			shadowOptions,
		}),
		FASTElement.define(NotesInspector, { ...notesInspectorDefinition, registry, shadowOptions }),
		FASTElement.define(NotesEmbed, { ...notesEmbedDefinition, registry, shadowOptions }),
	]);
}
