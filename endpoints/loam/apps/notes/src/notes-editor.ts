/**
 * @fileoverview `notes-editor`, the type's editor (documents specification, 5.6, 5.7 and 10): a
 * `violet-text-area` from the kit, filling the frame, holding a draft until `save()`. It reports dirty on each
 * edit and its selection as a `text-range` in UTF-16 units, both as the SDK's events. `documentChanged`
 * re-reads: a clean draft takes the stored text, keeping the caret by offset; a dirty one says the note
 * changed elsewhere, with Keep mine and Use theirs, since D46's conflict rule is per property and the text is
 * one. Its client is a surface port fixed to the note's scope, so it reads and writes nothing of another.
 * Links, the inspector and embeds are step 12's.
 */

import { css, FASTElement, html, observable, ref, Updates } from '@lushly-dev/fast-element';
import {
	type AppContextV1,
	type DocumentChangeV1,
	type DocumentRefV1,
	EDITOR_DIRTY_EVENT,
	EDITOR_SELECTION_EVENT,
	type LoamEditorElementV1,
} from '@lushly-dev/loam-sdk';

interface TextArea extends HTMLElement {
	value: string;
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
	/** The text as last read or saved: the draft is dirty when it differs. */
	#saved = '';
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
		return this.draft !== this.#saved;
	}

	#control(): HTMLTextAreaElement | null {
		return this.area?.shadowRoot?.querySelector('textarea') ?? null;
	}

	async #content(): Promise<string | undefined> {
		const id = this.document?.id;
		if (!id || !this.context) return undefined;
		const result = await this.context.client.call<{ text: string }>('notes-content-get', {
			document: id,
		});
		if (!result.success || typeof result.data?.text !== 'string') {
			this.status = `This note could not be read: ${result.error?.message ?? 'no answer'}`;
			return undefined;
		}
		this.status = '';
		return result.data.text;
	}

	async #read(first: boolean): Promise<void> {
		const text = await this.#content();
		if (text === undefined) return;
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
		this.#saving = text;
		let result: Awaited<ReturnType<AppContextV1['client']['call']>>;
		try {
			result = await this.context.client.call('notes-content-set', { document: id, text });
		} finally {
			this.#saving = null;
		}
		if (!result.success) throw refusal(result.error);
		this.#saved = text;
		this.conflict = false;
		this.#report();
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

export async function defineNotesElements(context: AppContextV1): Promise<void> {
	const { registry } = context;
	await FASTElement.define(NotesEditor, {
		name: 'notes-editor',
		template,
		styles,
		registry,
		shadowOptions: { mode: 'open' as const, customElementRegistry: registry },
	});
}
