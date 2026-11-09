/**
 * @fileoverview `notes-inspector` (documents specification, 10): while its note's tab is active, the note's
 * `Links` and `Backlinks`, from `document-link-list` through the `documents` grant, each a button that opens
 * its document beside, with its status. Its calls go through a surface port fixed to the note's scope, so it
 * shows links within that scope and says nothing of a link across projects; a person sees every link of a
 * document in the documents section. It reads again on each change the shell tells it of.
 */

import { css, FASTElement, html, observable, repeat } from '@lushly-dev/fast-element';
import type {
	AppContextV1,
	DocumentChangeV1,
	DocumentRefV1,
	LinkRowV1,
	LoamEditorElementV1,
} from '@lushly-dev/loam-sdk';

/** A row as it shows: the other document's id, title and status, in words. */
interface Row {
	id: string;
	title: string;
	status: string;
}

const STATUS: Readonly<Record<string, string>> = {
	active: '',
	archived: 'Archived',
	trashed: 'In trash',
};

const list = (heading: string, rows: (x: NotesInspector) => Row[]) => html<NotesInspector>`
	<section aria-label="${heading}">
		<h3>${heading}</h3>
		<p class="none" ?hidden="${(x) => rows(x).length > 0}">None</p>
		<ul ?hidden="${(x) => rows(x).length === 0}">
			${repeat(
				rows,
				html<Row, NotesInspector>`<li>
					<violet-button appearance="quiet" class="open" @click="${(row, c) => c.parent.open(row.id)}"
						>${(row) => row.title}</violet-button
					>
					<span class="status" ?hidden="${(row) => !row.status}">${(row) => row.status}</span>
				</li>`
			)}
		</ul>
	</section>
`;

const template = html<NotesInspector>`
	<p class="failed" role="status">${(x) => x.failure}</p>
	${list('Links', (x) => x.links)} ${list('Backlinks', (x) => x.backlinks)}
`;

const styles = css`
	:host {
		display: grid;
		align-content: start;
		gap: var(--space-stack-md);
		padding: var(--space-stack-sm) var(--space-inline-md);
		color: var(--color-text-primary);
	}
	[hidden],
	.failed:empty {
		display: none;
	}
	h3 {
		margin: 0 0 var(--space-stack-xs);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
		color: var(--color-text-secondary);
	}
	p {
		margin: 0;
		color: var(--color-text-secondary);
	}
	ul {
		display: grid;
		gap: var(--space-stack-xs);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-inline-sm);
	}
	.status {
		color: var(--color-text-secondary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
`;

const rowOf = ({ document }: LinkRowV1): Row => ({
	id: document.id,
	title: document.title,
	status: STATUS[document.status] ?? '',
});

export class NotesInspector extends FASTElement implements LoamEditorElementV1 {
	context?: AppContextV1;
	declare document?: DocumentRefV1;
	declare links: Row[];
	declare backlinks: Row[];
	declare failure: string;
	#reading = 0;

	constructor() {
		super();
		this.links = [];
		this.backlinks = [];
		this.failure = '';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		void this.read();
	}

	/** This note's links out and in, within its scope. */
	async read(): Promise<void> {
		const id = this.document?.id;
		const documents = this.context?.documents;
		if (!id || !documents) {
			this.failure = 'Links need the documents grant';
			return;
		}
		const turn = ++this.#reading;
		const { out, in: back } = await documents.links(id);
		if (turn !== this.#reading) return;
		this.failure = '';
		this.links = out.map(rowOf);
		this.backlinks = back.map(rowOf);
	}

	/** A link opens its document beside this one (10). */
	async open(id: string): Promise<void> {
		try {
			await this.context?.documents?.open(id, { group: 'beside' });
		} catch (cause) {
			this.failure = cause instanceof Error ? cause.message : String(cause);
		}
	}

	/** Its first control takes focus, as the shell asks when it replaces an inspector that had it (A-B1). */
	focusFirst(): boolean {
		const first = this.shadowRoot?.querySelector<HTMLElement>('.open');
		first?.focus();
		return !!first;
	}

	documentChanged(_change: DocumentChangeV1): void {
		void this.read();
	}
}
observable(NotesInspector.prototype, 'document');
observable(NotesInspector.prototype, 'links');
observable(NotesInspector.prototype, 'backlinks');
observable(NotesInspector.prototype, 'failure');

export const notesInspectorDefinition = { name: 'notes-inspector', template, styles } as const;
