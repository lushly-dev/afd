/**
 * @fileoverview `loam-documents-sidebar` (documents specification, 8.1), in the `documents` chunk: the
 * documents section's sidebar, a `loam-tree` in the shell's sidebar part while the section is open, with
 * tabs or without. `Recent`, the last ten by `document-list`; a branch per type the scope allows, whose
 * documents load when it opens, 200 at a time with `Show more`; and `Trash`. It re-reads on every
 * `document-*` event. A press opens a document as a preview, and a second press or Enter keeps it (5.3).
 * Each row's menu: Open beside, Rename, Links and Trash, or Restore in the trash. Rename and Links open a
 * modal dialog of this element's, Links with that document's rows from `document-link-list`, by the person's
 * client, so a link across projects shows to someone who may enter both. Every title is text (D8).
 */

import { css, FASTElement, html, observable, Updates } from '@lushly-dev/fast-element';
import type { LoamKernelV2 } from '@lushly-dev/loam-kernel';
import type { DocumentRecordV1, DocumentTypeV1 } from '@lushly-dev/loam-sdk';
import { trapTab } from '../elements/focus.js';
import { dateOf, el } from './cards.js';
import { documentsStyles } from './documents-styles.js';
import {
	type LoamTree,
	type LoamTreeNode,
	TREE_ACTION_EVENT,
	TREE_EXPAND_EVENT,
	TREE_SELECT_EVENT,
	type TreeMenuItem,
} from './tree.js';

/** How many documents a type's branch reads at a time (8.1). */
export const BRANCH_PAGE = 200;
const RECENT = 10;
const DAY_MS = 86_400_000;

/** A type's title in the plural, as the tree names its branch: `Notes`, `Checklists`. */
export function plural(title: string): string {
	if (/(s|x|z|ch|sh)$/i.test(title)) return `${title}es`;
	if (/[^aeiou]y$/i.test(title)) return `${title.slice(0, -1)}ies`;
	return `${title}s`;
}

interface LinkRow {
	link: { id: string };
	document: { id: string; title: string; type: string; status: string };
}

const template = html<LoamDocumentsSidebar>`
	<loam-tree label="Documents" empty-message="No documents yet"></loam-tree>
	<dialog
		aria-labelledby="dialog-heading"
		@keydown="${(x, c) => x.dialogKey(c.event as KeyboardEvent)}"
		@close="${(x) => x.dialogClosed()}"
	>
		<h2 id="dialog-heading">${(x) => x.dialogTitle}</h2>
		<form data-ref="rename" ?hidden="${(x) => x.dialogKind !== 'rename'}" @submit="${(x, c) => x.submitRename(c.event)}">
			<label
				>Title
				<input
					class="field"
					data-ref="title"
					required
					maxlength="200"
					aria-invalid="${(x) => String(x.error !== '')}"
					aria-describedby="title-help"
			/></label>
			<p id="title-help" class="${(x) => (x.error ? 'failure' : 'muted')}">
				${(x) => x.error || '1 to 200 characters.'}
			</p>
		</form>
		<div ?hidden="${(x) => x.dialogKind !== 'links'}">
			<p class="muted" ?hidden="${(x) => x.error === ''}" role="alert">${(x) => x.error}</p>
			<table data-ref="links" aria-labelledby="dialog-heading"></table>
		</div>
		<div class="actions">
			<button
				type="button"
				class="button primary"
				?hidden="${(x) => x.dialogKind !== 'rename'}"
				@click="${(x) => x.rename()}"
			>
				Save
			</button>
			<button type="button" class="button" @click="${(x) => x.closeDialog()}">
				${(x) => (x.dialogKind === 'rename' ? 'Cancel' : 'Close')}
			</button>
		</div>
	</dialog>
`;

const styles = css`
	:host {
		display: block;
		padding-inline: var(--space-layout-sm);
	}
	dialog {
		box-sizing: border-box;
		inline-size: min(92vw, calc(var(--shell-size-main-min) * 1.4));
		max-block-size: 80dvh;
		padding: var(--space-layout-sm);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: var(--color-surface-floating);
		box-shadow: var(--shadow-floating);
		color: var(--color-text-primary);
	}
	dialog[open] {
		display: grid;
		gap: var(--space-stack-sm);
	}
	dialog::backdrop {
		background: color-mix(in srgb, var(--color-surface-page) 60%, transparent);
	}
	form {
		display: grid;
		gap: var(--space-stack-xs);
	}
	.actions {
		justify-content: end;
	}
	@media (forced-colors: active) {
		dialog {
			border-color: CanvasText;
			background: Canvas;
			color: CanvasText;
		}
	}
`;

type Shown = { kind: 'doc'; record: DocumentRecordV1 } | { kind: 'more'; type: string };

export class LoamDocumentsSidebar extends FASTElement {
	kernel: LoamKernelV2 | null = null;
	/** The compact class: no `Open beside` (5.2). */
	compact = false;
	declare dialogKind: 'rename' | 'links' | null;
	declare dialogTitle: string;
	declare error: string;
	#scopeKey: string | null = null;
	#types: DocumentTypeV1[] = [];
	/** By type, how many of its documents its branch shows. */
	readonly #pages = new Map<string, number>();
	/** What each row of the tree stands for, by its id. */
	readonly #rows = new Map<string, Shown>();
	#queue: Promise<void> = Promise.resolve();
	#unsubscribe: (() => void) | null = null;
	/** The row a press last opened as a preview, which a second press keeps (5.3). */
	#pressed: string | null = null;
	/** The record the dialog is for, and the row focus goes back to. */
	#dialogFor: { record: DocumentRecordV1; row: string } | null = null;

	constructor() {
		super();
		this.dialogKind = null;
		this.dialogTitle = '';
		this.error = '';
	}

	get tree(): LoamTree {
		return this.shadowRoot?.querySelector('loam-tree') as LoamTree;
	}

	get #dialog(): HTMLDialogElement {
		return this.shadowRoot?.querySelector('dialog') as HTMLDialogElement;
	}

	#ref<T extends HTMLElement>(name: string): T | null {
		return this.shadowRoot?.querySelector<T>(`[data-ref="${name}"]`) ?? null;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		const tree = this.tree;
		if (!tree.dataset.wired) {
			tree.dataset.wired = '';
			tree.branchesSelect = false;
			tree.menu = (id) => this.#menuOf(id);
			tree.expanded.add('recent');
			tree.addEventListener(TREE_SELECT_EVENT, (event) => {
				// The shell's app surfaces hear a list's choice; this one is the section's own.
				event.stopPropagation();
				const { id, how } = (event as CustomEvent<{ id: string; how: 'press' | 'enter' }>).detail;
				void this.#chosen(id, how);
			});
			tree.addEventListener(TREE_EXPAND_EVENT, (event) => {
				if ((event as CustomEvent<{ expanded: boolean }>).detail.expanded) this.read();
			});
			tree.addEventListener(TREE_ACTION_EVENT, (event) => {
				const { id, action } = (event as CustomEvent<{ id: string; action: string }>).detail;
				void this.#act(id, action);
			});
		}
		this.#unsubscribe ??=
			this.kernel?.subscribe((event) => {
				if (
					event.success &&
					event.mutation &&
					/^(document-(?!open$)|workspace-app-set$|auth-)/.test(event.command)
				)
					this.read();
			}) ?? null;
	}

	override disconnectedCallback(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		super.disconnectedCallback();
	}

	/** Show the scope `key` names: a new scope starts again, with `Recent` open. */
	show(key: string): Promise<void> {
		if (key !== this.#scopeKey) {
			this.#scopeKey = key;
			this.#pages.clear();
			this.#pressed = null;
			this.tree.expanded.clear();
			this.tree.expanded.add('recent');
			this.tree.items = [];
			this.tree.busy = true;
		}
		return this.read();
	}

	/** Read the tree again, one read at a time, so a later one renders last. */
	read(): Promise<void> {
		this.#queue = this.#queue.then(() => this.#read()).catch(reportError);
		return this.#queue;
	}

	async #read(): Promise<void> {
		const kernel = this.kernel;
		if (!kernel) return;
		const tree = this.tree;
		const list = (input: object) =>
			kernel.call<{ documents: DocumentRecordV1[]; total: number }>('document-list', input);
		const types = await kernel.call<{ types: DocumentTypeV1[] }>('document-type-list');
		if (!types.success) {
			tree.busy = false;
			tree.failure = {
				message: types.error?.message ?? 'The documents could not be read',
				...(types.error?.suggestion ? { suggestion: types.error.suggestion } : {}),
			};
			return;
		}
		this.#types = types.data?.types ?? [];
		const titleOf = (type: string) => this.#types.find((each) => each.id === type)?.title ?? type;
		const [recent, trash, ...branches] = await Promise.all([
			list({ sort: 'recent', limit: RECENT }),
			tree.expanded.has('trash')
				? list({ status: 'trashed', sort: 'recent', limit: BRANCH_PAGE })
				: undefined,
			...this.#types.map((type) =>
				tree.expanded.has(`type:${type.id}`)
					? list({ type: type.id, sort: 'title', limit: this.#pages.get(type.id) ?? BRANCH_PAGE })
					: undefined
			),
		]);
		this.#rows.clear();
		const row = (prefix: string, record: DocumentRecordV1, description?: string): LoamTreeNode => {
			const id = `${prefix}:${record.id}`;
			this.#rows.set(id, { kind: 'doc', record });
			return { id, title: record.title, ...(description ? { description } : {}) };
		};
		const trashDays = trash?.success
			? ((await kernel.call<{ trashDays?: number }>('workspace-get')).data?.trashDays ?? 30)
			: 30;
		const nodes: LoamTreeNode[] = [
			{
				id: 'recent',
				title: 'Recent',
				lazy: true,
				children: (recent.data?.documents ?? []).map((record) =>
					row('recent', record, titleOf(record.type))
				),
			},
			...this.#types.map((type, index) => {
				const read = branches[index];
				const id = `type:${type.id}`;
				const children = (read?.data?.documents ?? []).map((record) => row(type.id, record));
				if (read?.data && read.data.total > children.length) {
					const more = `more:${type.id}`;
					this.#rows.set(more, { kind: 'more', type: type.id });
					children.push({ id: more, title: 'Show more' });
				}
				return { id, title: plural(type.title), icon: type.icon, lazy: true, children };
			}),
			{
				id: 'trash',
				title: 'Trash',
				lazy: true,
				children: (trash?.data?.documents ?? []).map((record) => {
					const at = record.trashedAt ?? record.updatedAt;
					return row(
						'trash',
						record,
						`Trashed ${dateOf(at)}, kept until ${dateOf(at + trashDays * DAY_MS)}`
					);
				}),
			},
		];
		tree.failure = null;
		tree.busy = false;
		tree.items = nodes;
	}

	async #chosen(id: string, how: 'press' | 'enter'): Promise<void> {
		const shown = this.#rows.get(id);
		if (!shown) return;
		if (shown.kind === 'more') {
			this.#pages.set(shown.type, (this.#pages.get(shown.type) ?? BRANCH_PAGE) + BRANCH_PAGE);
			await this.read();
			return;
		}
		if (shown.record.status === 'trashed') return;
		// A press opens a preview; a second press on the same row, or Enter, keeps it (5.3).
		const preview = how === 'press' && this.#pressed !== id;
		this.#pressed = id;
		await this.kernel?.call('document-open', { document: shown.record.id, preview });
	}

	#menuOf(id: string): TreeMenuItem[] {
		const shown = this.#rows.get(id);
		if (shown?.kind !== 'doc') return [];
		if (shown.record.status === 'trashed') {
			return [
				{ action: 'restore', label: 'Restore' },
				{ action: 'links', label: 'Links' },
			];
		}
		return [
			...(this.compact ? [] : [{ action: 'beside', label: 'Open beside' }]),
			{ action: 'rename', label: 'Rename' },
			{ action: 'links', label: 'Links' },
			{ action: 'trash', label: 'Trash' },
		];
	}

	async #act(id: string, action: string): Promise<void> {
		const shown = this.#rows.get(id);
		const kernel = this.kernel;
		if (shown?.kind !== 'doc' || !kernel) return;
		const { record } = shown;
		if (action === 'rename' || action === 'links') {
			await this.#openDialog(action, record, id);
			return;
		}
		const result =
			action === 'beside'
				? await kernel.call('document-open', {
						document: record.id,
						group: 'beside',
						preview: false,
					})
				: await kernel.call(action === 'trash' ? 'document-trash' : 'document-restore', {
						document: record.id,
					});
		if (!result.success) {
			const error = result.error;
			void kernel.call('toast-show', {
				tone: 'danger',
				durationMs: 30_000,
				message:
					`${record.title}: ${error?.message ?? 'it failed'}${error?.code ? ` (${error.code})` : ''}${error?.suggestion ? `. ${error.suggestion}` : ''}`.slice(
						0,
						200
					),
			});
		}
	}

	async #openDialog(
		kind: 'rename' | 'links',
		record: DocumentRecordV1,
		row: string
	): Promise<void> {
		this.#dialogFor = { record, row };
		this.dialogKind = kind;
		this.error = '';
		this.dialogTitle = kind === 'rename' ? `Rename ${record.title}` : `Links of ${record.title}`;
		await Updates.next();
		if (kind === 'rename') {
			const field = this.#ref<HTMLInputElement>('title');
			if (field) field.value = record.title;
		} else {
			this.#ref('links')?.replaceChildren();
		}
		this.#dialog.showModal();
		if (kind === 'rename') this.#ref<HTMLInputElement>('title')?.focus();
		else await this.#readLinks(record);
	}

	/** That document's links, out and in, by `document-link-list` with the person's client (8.1). */
	async #readLinks(record: DocumentRecordV1): Promise<void> {
		const result = await this.kernel?.call<{ out: LinkRow[]; in: LinkRow[] }>(
			'document-link-list',
			{
				document: record.id,
			}
		);
		const table = this.#ref('links');
		if (!table) return;
		if (!result?.success || !result.data) {
			this.error = `Its links could not be read: ${result?.error?.message ?? 'the read failed'}`;
			return;
		}
		const rows = [
			...result.data.out.map((row) => ['To', row] as const),
			...result.data.in.map((row) => ['From', row] as const),
		];
		table.replaceChildren(
			el(
				'thead',
				{},
				el(
					'tr',
					{},
					...['Direction', 'Document', 'Status'].map((column) => el('th', { scope: 'col' }, column))
				)
			),
			el(
				'tbody',
				{},
				...(rows.length === 0
					? [el('tr', {}, el('td', { colspan: '3' }, 'No links yet'))]
					: rows.map(([direction, row]) =>
							el(
								'tr',
								{},
								el('td', {}, direction),
								el('td', { dir: 'auto' }, row.document.title),
								el('td', {}, row.document.status === 'trashed' ? 'In trash' : 'Active')
							)
						))
			)
		);
	}

	submitRename(event: Event): void {
		event.preventDefault();
		void this.rename();
	}

	async rename(): Promise<void> {
		const target = this.#dialogFor;
		const kernel = this.kernel;
		const title = this.#ref<HTMLInputElement>('title')?.value ?? '';
		if (!target || !kernel) return;
		const result = await kernel.call('document-rename', { document: target.record.id, title });
		if (result.success) this.closeDialog();
		else this.error = result.error?.message ?? 'The title was not changed';
	}

	dialogKey(event: KeyboardEvent): boolean {
		trapTab(event, this.#dialog);
		if (event.key === 'Enter' && this.dialogKind === 'rename' && !event.shiftKey) {
			void this.rename();
			return false;
		}
		return true;
	}

	closeDialog(): void {
		if (this.#dialog.open) this.#dialog.close();
	}

	/** Escape, Close or a saved rename: focus goes back to the row. */
	dialogClosed(): void {
		const row = this.#dialogFor?.row;
		this.#dialogFor = null;
		this.dialogKind = null;
		this.error = '';
		if (row !== undefined) this.tree.focusItem(row);
	}
}
observable(LoamDocumentsSidebar.prototype, 'dialogKind');
observable(LoamDocumentsSidebar.prototype, 'dialogTitle');
observable(LoamDocumentsSidebar.prototype, 'error');

export const documentsSidebarDefinition = {
	name: 'loam-documents-sidebar' as const,
	template,
	styles: [documentsStyles, styles],
};
