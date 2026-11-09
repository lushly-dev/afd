/**
 * @fileoverview `loam-documents-section` (documents specification, 8.2), in the `documents` chunk: main's
 * documents list, shown when the documents section is open with no tab, which the editor area's columns
 * take the place of once one opens (5.1). `h1` Documents; a filter field, `document-list`'s `query`; type,
 * tag and status filters and `All projects`; a table of title, type, project with `All projects`, updated
 * and owner. Its Trash status shows the same table with Restore and `Trashed <date>, kept until <date>`.
 * Empty, it offers what the New button's menu does, inline. A press on a title opens it as a preview, a
 * second press keeps it (5.3). Every title is text (D8): rows are built with the DOM API.
 */

import { css, FASTElement, html, observable, Updates, when } from '@lushly-dev/fast-element';
import type { LoamKernelV2 } from '@lushly-dev/loam-kernel';
import type { DocumentRecordV1, DocumentTypeV1 } from '@lushly-dev/loam-sdk';
import { formatRoute } from '../route-format.js';
import { dateOf, el, isoOf, numberOf } from './cards.js';
import { documentsStyles } from './documents-styles.js';

const DAY_MS = 86_400_000;

type Status = 'active' | 'archived' | 'trashed';

/** Who a record's owner is, as text: `local` is this browser's person, signed out. */
export const ownerOf = (owner: string): string =>
	owner === 'local' ? 'You, signed out' : owner.replace(/^mock-user-/, '');

const template = html<LoamDocumentsSection>`
	<section class="section" aria-labelledby="heading" aria-busy="${(x) => String(!x.loaded)}">
		<h1 id="heading" tabindex="-1">${(x) => (x.status === 'trashed' ? 'Trash' : 'Documents')}</h1>
		<div class="tools">
			<label
				>Filter
				<input
					class="field"
					type="search"
					maxlength="200"
					autocomplete="off"
					@input="${(x, c) => x.setQuery((c.event.target as HTMLInputElement).value)}"
			/></label>
			<label
				>Type
				<select data-ref="type" @change="${(x, c) => x.setType((c.event.target as HTMLSelectElement).value)}"></select
			></label>
			<label
				>Tag
				<select data-ref="tag" @change="${(x, c) => x.setTag((c.event.target as HTMLSelectElement).value)}"></select
			></label>
			<label
				>Show
				<select
					data-ref="status"
					@change="${(x, c) => x.setStatus((c.event.target as HTMLSelectElement).value as Status)}"
				>
					<option value="active">Active</option>
					<option value="archived">Archived</option>
					<option value="trashed">Trash</option>
				</select></label
			>
			<label class="check"
				><input
					type="checkbox"
					?checked="${(x) => x.all}"
					@change="${(x, c) => x.setAll((c.event.target as HTMLInputElement).checked)}"
				/>All projects</label
			>
		</div>
		${when(
			(x) => x.loaded && x.documents.length === 0,
			html<LoamDocumentsSection>`<p class="empty">${(x) => x.emptyText}</p>`
		)}
		<div class="new" data-ref="new" ?hidden="${(x) => !x.offering}"></div>
		<table aria-labelledby="heading" ?hidden="${(x) => x.documents.length === 0}">
			<thead data-ref="head"></thead>
			<tbody data-ref="rows"></tbody>
		</table>
	</section>
	<p class="failure read-failure" role="alert" ?hidden="${(x) => !x.failure}">${(x) => x.failure}</p>
	<p class="said" role="status">${(x) => x.said}</p>
`;

/** What the section reads of the shell, so it imports nothing first paint holds but FAST (2.4). */
export interface DocumentsHost {
	readonly kernel: LoamKernelV2 | null;
	readonly shadowRoot: ShadowRoot | null;
	readonly ownerDocument: Document;
}

export class LoamDocumentsSection extends FASTElement {
	kernel: LoamKernelV2 | null = null;
	/** The shell, which the inline New items create through. */
	host: DocumentsHost | null = null;
	base = '';
	workspace = '';
	/** Each project's slug and name by id, for the URLs and the project column. */
	projects = new Map<string, { slug: string; name: string }>();
	declare documents: DocumentRecordV1[];
	declare loaded: boolean;
	declare status: Status;
	declare all: boolean;
	declare failure: string;
	declare said: string;
	/** Whether the empty list offers what New creates. */
	declare offering: boolean;
	#query = '';
	#type = '';
	#tag = '';
	#types = new Map<string, DocumentTypeV1>();
	#trashDays = 30;
	#reads = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#unsubscribe: (() => void) | null = null;
	/** The document a press last opened as a preview, which a second press keeps (5.3). */
	#pressed: string | null = null;

	constructor() {
		super();
		this.documents = [];
		this.loaded = false;
		this.status = 'active';
		this.all = false;
		this.failure = '';
		this.said = '';
		this.offering = false;
	}

	#ref<T extends HTMLElement>(name: string): T | null {
		return this.shadowRoot?.querySelector<T>(`[data-ref="${name}"]`) ?? null;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.#unsubscribe ??=
			this.kernel?.subscribe((event) => {
				// From anyone: a document or an app changed, or the actor did.
				if (
					event.success &&
					event.mutation &&
					/^(document-(?!open$)|workspace-app-set$|auth-)/.test(event.command)
				) {
					void this.read();
				}
			}) ?? null;
	}

	override disconnectedCallback(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		super.disconnectedCallback();
	}

	get emptyText(): string {
		if (this.#query || this.#type || this.#tag) return 'No document matches';
		return this.status === 'trashed'
			? 'The trash is empty'
			: this.status === 'archived'
				? 'No archived documents'
				: 'No documents yet';
	}

	focusHeading(): void {
		this.shadowRoot?.querySelector<HTMLElement>('h1')?.focus();
	}

	setQuery(value: string): void {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#query = value.trim().slice(0, 200);
			void this.read(true);
		}, 300);
	}
	setType(value: string): void {
		this.#type = value;
		void this.read(true);
	}
	setTag(value: string): void {
		this.#tag = value;
		void this.read(true);
	}
	setStatus(value: Status): void {
		this.status = value;
		void this.read(true);
	}
	setAll(value: boolean): void {
		this.all = value;
		void this.read(true);
	}

	/** Read the types and the rows again; a later read wins. With `say`, the count is said once it ends. */
	async read(say = false): Promise<void> {
		const kernel = this.kernel;
		if (!kernel) return;
		const read = ++this.#reads;
		try {
			const [types, listed, workspace] = await Promise.all([
				kernel.call<{ types: DocumentTypeV1[] }>('document-type-list', { all: true }),
				kernel.call<{ documents: DocumentRecordV1[]; total: number }>('document-list', {
					status: this.status,
					sort: 'recent',
					limit: 200,
					...(this.#query ? { query: this.#query } : {}),
					...(this.#type ? { type: this.#type } : {}),
					...(this.#tag ? { tag: this.#tag } : {}),
					...(this.all ? { project: 'all' } : {}),
				}),
				kernel.call<{ trashDays?: number }>('workspace-get'),
			]);
			if (read !== this.#reads) return;
			if (!listed.success) throw new Error(listed.error?.message ?? 'document-list failed');
			this.#types = new Map((types.data?.types ?? []).map((type) => [type.id, type]));
			this.#trashDays = workspace.data?.trashDays ?? 30;
			this.documents = listed.data?.documents ?? [];
			this.failure = '';
			if (say) {
				const total = listed.data?.total ?? 0;
				this.said = total === 1 ? '1 document' : `${numberOf(total)} documents`;
			}
		} catch (cause) {
			if (read !== this.#reads) return;
			this.documents = [];
			this.failure = `The documents could not be read: ${String((cause as Error)?.message ?? cause).slice(0, 200)}`;
			reportError(cause);
		}
		this.loaded = true;
		await this.#paint();
	}

	#urlOf(record: DocumentRecordV1): string {
		const project =
			record.scope.project === undefined ? undefined : this.projects.get(record.scope.project);
		return formatRoute(
			{
				kind: 'section',
				workspace: this.workspace,
				...(project ? { project: project.slug } : {}),
				section: 'documents',
				rest: [record.id],
			},
			this.base
		);
	}

	/** A press opens it as a preview; a second press on the same keeps it (5.3). */
	async #open(record: DocumentRecordV1): Promise<void> {
		const preview = this.#pressed !== record.id;
		this.#pressed = record.id;
		await this.kernel?.call('document-open', { document: record.id, preview });
	}

	async #paint(): Promise<void> {
		await Updates.next();
		const trash = this.status === 'trashed';
		const columns = ['Title', 'Type', ...(this.all ? ['Project'] : []), 'Updated', 'Owner'];
		if (trash) columns.push('In the trash', 'Actions');
		this.#ref('head')?.replaceChildren(
			el('tr', {}, ...columns.map((column) => el('th', { scope: 'col' }, column)))
		);
		this.#ref('rows')?.replaceChildren(
			...this.documents.map((record) => {
				const project =
					record.scope.project === undefined ? undefined : this.projects.get(record.scope.project);
				let title: HTMLElement;
				if (trash) title = el('span', { dir: 'auto' }, record.title);
				else {
					title = el(
						'a',
						{ href: this.#urlOf(record), dir: 'auto', 'data-document': record.id },
						record.title
					);
					title.addEventListener('click', (event) => {
						if (
							event.button !== 0 ||
							event.metaKey ||
							event.ctrlKey ||
							event.shiftKey ||
							event.altKey
						)
							return;
						event.preventDefault();
						void this.#open(record);
					});
				}
				const cells: Array<Node | string> = [
					el('td', {}, title),
					el('td', { dir: 'auto' }, this.#types.get(record.type)?.title ?? record.type),
					...(this.all ? [el('td', { dir: 'auto' }, project?.name ?? 'Workspace')] : []),
					el('td', {}, el('time', { datetime: isoOf(record.updatedAt) }, dateOf(record.updatedAt))),
					el('td', { dir: 'auto' }, ownerOf(record.owner)),
				];
				if (trash) {
					const at = record.trashedAt ?? record.updatedAt;
					cells.push(
						el(
							'td',
							{},
							`Trashed ${dateOf(at)}, kept until ${dateOf(at + this.#trashDays * DAY_MS)}`
						)
					);
					const restore = el('button', { type: 'button', class: 'button' }, 'Restore');
					restore.setAttribute('aria-label', `Restore ${record.title}`);
					restore.addEventListener('click', () => void this.#restore(record));
					cells.push(el('td', {}, restore));
				}
				return el('tr', {}, ...cells);
			})
		);
		this.#paintFilters();
		await this.#paintNew();
	}

	async #restore(record: DocumentRecordV1): Promise<void> {
		const result = await this.kernel?.call('document-restore', { document: record.id });
		this.said = result?.success
			? `${record.title} restored`
			: `${record.title} was not restored: ${result?.error?.message ?? 'it failed'}`;
	}

	/** The type and tag pickers, from the types and the tags of what is listed, the choice kept. */
	#paintFilters(): void {
		const fill = (name: string, any: string, values: Array<[string, string]>, chosen: string) => {
			const select = this.#ref<HTMLSelectElement>(name);
			if (!select) return;
			select.replaceChildren(
				el('option', { value: '' }, any),
				...values.map(([value, label]) => el('option', { value }, label))
			);
			select.value = chosen;
		};
		fill(
			'type',
			'All types',
			[...this.#types.values()].map((type) => [type.id, type.title]),
			this.#type
		);
		const tags = [
			...new Set([...this.documents.flatMap((record) => record.tags), this.#tag].filter(Boolean)),
		].sort();
		fill(
			'tag',
			'Any tag',
			tags.map((tag) => [tag, tag]),
			this.#tag
		);
	}

	/** With nothing yet, what New creates here, inline: the New button's menu, as buttons (8.2). */
	async #paintNew(): Promise<void> {
		const holder = this.#ref('new');
		const offering =
			this.loaded &&
			this.status === 'active' &&
			this.documents.length === 0 &&
			!this.#query &&
			!this.#type &&
			!this.#tag;
		this.offering = offering;
		if (!holder || !offering || !this.kernel || !this.host) {
			holder?.replaceChildren();
			return;
		}
		const { readNew, runNew } = await import('../new/new-menu.js');
		const offer = await readNew(this.kernel);
		const host = this.host;
		holder.replaceChildren(
			...(offer.items.length === 0
				? [el('p', { class: 'muted' }, offer.elsewhere ?? 'Nothing to create here')]
				: offer.items.map((item) => {
						const button = el('button', { type: 'button', class: 'button' }, `New ${item.title}`);
						button.addEventListener('click', () => void runNew(host, item));
						return button;
					}))
		);
	}
}
observable(LoamDocumentsSection.prototype, 'documents');
observable(LoamDocumentsSection.prototype, 'loaded');
observable(LoamDocumentsSection.prototype, 'status');
observable(LoamDocumentsSection.prototype, 'all');
observable(LoamDocumentsSection.prototype, 'failure');
observable(LoamDocumentsSection.prototype, 'said');
observable(LoamDocumentsSection.prototype, 'offering');

/** Main holds no padding while the documents section is open (5.1): the list scrolls in its own. */
const own = css`
	:host {
		display: block;
		flex: 1 1 auto;
		min-block-size: 0;
		overflow: auto;
		padding: var(--space-layout-md);
	}
	.section {
		display: grid;
		gap: var(--space-stack-md);
	}
	.read-failure:not([hidden]) {
		margin-block-start: var(--space-stack-md);
	}
	.new:not([hidden]) {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-inline-sm);
	}
`;

export const documentsSectionDefinition = {
	name: 'loam-documents-section' as const,
	template,
	styles: [documentsStyles, own],
};
