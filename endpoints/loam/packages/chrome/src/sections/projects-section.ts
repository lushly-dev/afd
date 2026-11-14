/**
 * @fileoverview `loam-projects-section` (phase 2 specification, 7.7), in the `sections` chunk: main's
 * projects section. At workspace level, the list: `h1` Projects, a filter, a table of name, status and
 * updated, each row a link to the project's home, `Show archived`, and `New project`'s inline form, whose
 * refusal shows beside its field. In a project, its home: the name, its status and access, Rename, Archive
 * or Restore, then one card per app with a summary, from `project-summary-get`.
 *
 * Trust (13, architecture section 7): the shell never reads an app's resources, only what each summary
 * returns, which the kernel read by hand. Every text here is a binding, never markup, and every link is
 * a URL formatted by the scheme, which the router turns into commands: navigation, never execution.
 */

import { FASTElement, html, observable, Updates, when } from '@lushly-dev/fast-element';
import type {
	KernelEventV3,
	LoamKernelV3,
	ProjectSummaryResultV1,
	ProjectSummaryRowV1,
	ProjectV1,
	ResourceLinkV1,
} from '@lushly-dev/loam-kernel';
import type { DocumentRecordV1, DocumentTypeV1 } from '@lushly-dev/loam-sdk';
import '@lushly-dev/violet-elements/dist/button/violet-button.js';
import '@lushly-dev/violet-elements/dist/text-field/violet-text-field.js';
import type { VioletTextField } from '@lushly-dev/violet-elements/dist/text-field/violet-text-field.js';
import { type ProjectLookup, resourceLinkUrl } from '../resource-link.js';
import { formatRoute } from '../route-format.js';
import {
	type CardView,
	cardOf,
	type DocumentsCardView,
	dateOf,
	documentsCardOf,
	el,
	isoOf,
	numberOf,
	REPORT,
	sentences,
} from './cards.js';
import { styles } from './section-styles.js';

/** A field's refusal, beside it, as the console words one. */
const withError = (message: string, help: string): string =>
	message ? `Error: ${message}${help ? ` ${help}` : ''}` : help;

const SLUG_HELP =
	"Up to 63 lower-case letters, digits and inner hyphens. It is the project's address and cannot change; left empty, it comes from the name.";

const NAME_HELP = '1 to 80 characters.';

/** Where a `project-create` or `project-update` refusal belongs. */
const FIELD_OF: Readonly<Record<string, 'name' | 'slug'>> = {
	PROJECT_NAME_INVALID: 'name',
	PROJECT_SLUG_INVALID: 'slug',
	PROJECT_SLUG_UNAVAILABLE: 'slug',
};

const createForm = html<LoamProjectsSection>`
	<form
		id="create"
		class="form"
		aria-labelledby="create-heading"
		@submit="${(x, c) => x.submitCreate(c.event)}"
		@keydown="${(x, c) => x.formKey(c.event as KeyboardEvent, () => x.create())}"
	>
		<h2 id="create-heading">New project</h2>
		<violet-text-field
			data-ref="nameField"
			label="Name"
			required
			maxlength="80"
			?invalid="${(x) => x.errors.name !== ''}"
			supporting-text="${(x) => withError(x.errors.name, NAME_HELP)}"
		></violet-text-field>
		<violet-text-field
			data-ref="slugField"
			label="Slug"
			?invalid="${(x) => x.errors.slug !== ''}"
			supporting-text="${(x) => withError(x.errors.slug, SLUG_HELP)}"
		></violet-text-field>
		<p class="failure" role="alert" ?hidden="${(x) => !x.errors.form}">${(x) => x.errors.form}</p>
		<div class="actions">
			<violet-button appearance="primary" ?disabled="${(x) => x.busy}" @click="${(x) => x.create()}"
				>Create</violet-button
			>
			<violet-button appearance="secondary" @click="${(x) => x.closeForm()}">Cancel</violet-button>
		</div>
	</form>
`;

const list = html<LoamProjectsSection>`
	<header class="head">
		<h1 id="heading" tabindex="-1">Projects</h1>
		<violet-button
			data-ref="newButton"
			appearance="primary"
			aria-expanded="${(x) => String(x.formOpen)}"
			@click="${(x) => x.openForm()}"
			>New project</violet-button
		>
	</header>
	${when((x) => x.formOpen, createForm)}
	<div class="tools">
		<violet-text-field
			label="Filter"
			type="search"
			:value="${(x) => x.filter}"
			@input="${(x, c) => {
				x.filter = (c.event.target as VioletTextField).value;
			}}"
		></violet-text-field>
		<label class="check"
			><input
				type="checkbox"
				?checked="${(x) => x.showArchived}"
				@change="${(x, c) => x.setArchived((c.event.target as HTMLInputElement).checked)}"
			/>Show archived</label
		>
	</div>
	${when(
		(x) => x.loaded && x.projects.length === 0,
		html<LoamProjectsSection>`<p class="empty">No projects yet</p>`
	)}
	${when(
		(x) => x.shown.length > 0,
		html<LoamProjectsSection>`<table aria-labelledby="heading">
			<thead>
				<tr><th scope="col">Name</th><th scope="col">Status</th><th scope="col">Updated</th></tr>
			</thead>
			<tbody data-ref="rows"></tbody>
		</table>`
	)}
	${when(
		(x) => x.projects.length > 0 && x.shown.length === 0,
		html<LoamProjectsSection>`<p class="empty">${(x) => x.noneShown}</p>`
	)}
`;

const renameForm = html<LoamProjectsSection>`
	<form
		id="rename"
		class="form"
		aria-labelledby="rename-heading"
		@submit="${(x, c) => x.submitRename(c.event)}"
		@keydown="${(x, c) => x.formKey(c.event as KeyboardEvent, () => x.rename())}"
	>
		<h2 id="rename-heading">Rename</h2>
		<violet-text-field
			data-ref="renameField"
			label="Name"
			required
			maxlength="80"
			:value="${(x) => x.project?.name ?? ''}"
			?invalid="${(x) => x.errors.name !== ''}"
			supporting-text="${(x) => withError(x.errors.name, 'Its address stays the same.')}"
		></violet-text-field>
		<p class="failure" role="alert" ?hidden="${(x) => !x.errors.form}">${(x) => x.errors.form}</p>
		<div class="actions">
			<violet-button appearance="primary" ?disabled="${(x) => x.busy}" @click="${(x) => x.rename()}"
				>Save</violet-button
			>
			<violet-button appearance="secondary" @click="${(x) => x.closeForm()}">Cancel</violet-button>
		</div>
	</form>
`;

const home = html<LoamProjectsSection>`
	<header class="head">
		<h1 id="heading" tabindex="-1" dir="auto">${(x) => x.project?.name}</h1>
		<div class="actions">
			<violet-button
				data-ref="renameButton"
				appearance="secondary"
				aria-expanded="${(x) => String(x.formOpen)}"
				@click="${(x) => x.openForm()}"
				>Rename</violet-button
			>
			${when(
				(x) => x.project?.status !== 'archived',
				html<LoamProjectsSection>`<violet-button
					data-ref="archiveButton"
					appearance="secondary"
					?disabled="${(x) => x.busy}"
					@click="${(x) => x.setStatus('project-archive')}"
					>Archive</violet-button
				>`
			)}
			${when(
				(x) => x.project?.status === 'archived',
				html<LoamProjectsSection>`<violet-button
					data-ref="restoreButton"
					appearance="primary"
					?disabled="${(x) => x.busy}"
					@click="${(x) => x.setStatus('project-restore')}"
					>Restore</violet-button
				>`
			)}
		</div>
		<p class="failure action-error" role="alert" ?hidden="${(x) => !x.actionError}">${(x) => x.actionError}</p>
	</header>
	<dl class="facts">
		<div><dt>Status</dt><dd>${(x) => (x.project?.status === 'archived' ? 'Archived: it refuses changes until it is restored' : 'Active')}</dd></div>
		<div>
			<dt>Access</dt>
			<dd>${(x) => (x.project?.access.mode === 'restricted' ? 'Restricted to its members' : 'Everyone in the workspace')}</dd>
		</div>
	</dl>
	<p class="all"><a href="${(x) => x.allUrl}">All projects</a></p>
	${when((x) => x.formOpen, renameForm)}
	${when(
		(x) => !x.loaded,
		// Text, not `violet-progress`, which would put `sectionsMinified` over its ceiling (about 6 KB).
		html<LoamProjectsSection>`<p class="muted">Loading the summaries…</p>`
	)}
	${when(
		(x) => x.loaded && x.cards.length === 0,
		html<LoamProjectsSection>`<p class="empty">No app summarizes this project yet</p>`
	)}
	<div class="cards" data-ref="cards"></div>
	<div data-ref="documents"></div>
`;

/** The region is busy while it reads; its live lines are beside it, so nothing they say waits for the read. */
const template = html<LoamProjectsSection>`
	<section class="section" aria-labelledby="heading" aria-busy="${(x) => String(!x.loaded)}">
		${when((x) => x.view === 'list', list)}
		${when((x) => x.view === 'home' && x.project !== null, home)}
	</section>
	<p class="failure read-failure" role="alert" ?hidden="${(x) => !x.failure}">${(x) => x.failure}</p>
	<p class="said" role="status">${(x) => x.status}</p>
`;

type Status = 'project-archive' | 'project-restore';

export class LoamProjectsSection extends FASTElement {
	kernel: LoamKernelV3 | null = null;
	/** The deployment's root, absolute, for the URLs the scheme formats (6.2). */
	base = '';
	declare workspace: string;
	/** `list` at workspace level; `home` in a project, which is the active one. */
	declare view: 'list' | 'home';
	declare project: ProjectV1 | null;
	declare projects: ProjectV1[];
	declare cards: CardView[];
	/** The home's `Documents` card, the shell's, not an app's summary (documents specification, 8.3). */
	declare documents: DocumentsCardView | null;
	declare loaded: boolean;
	declare filter: string;
	declare showArchived: boolean;
	declare formOpen: boolean;
	declare busy: boolean;
	declare errors: { name: string; slug: string; form: string };
	/** The section's own live region: what an action did, which focus alone would not say. */
	declare status: string;
	/** Why the section could not read, shown in place of what it would have (T1). */
	declare failure: string;
	/** Why Archive or Restore was refused, beside the actions (A5). */
	declare actionError: string;

	/** An element of the template by its `data-ref`: no `ref` directive, so this chunk shares less with first paint. */
	#ref<T extends HTMLElement>(name: string): T | null {
		return this.shadowRoot?.querySelector<T>(`[data-ref="${name}"]`) ?? null;
	}
	get nameField() {
		return this.#ref<VioletTextField>('nameField');
	}
	get slugField() {
		return this.#ref<VioletTextField>('slugField');
	}
	get renameField() {
		return this.#ref<VioletTextField>('renameField');
	}
	get newButton() {
		return this.#ref('newButton');
	}
	get renameButton() {
		return this.#ref('renameButton');
	}
	get archiveButton() {
		return this.#ref('archiveButton');
	}
	get restoreButton() {
		return this.#ref('restoreButton');
	}

	#reads = 0;
	#unsubscribe: (() => void) | null = null;
	/** The project a create made, whose row takes focus once the list has it. */
	#created: string | null = null;
	/** Whether the empty list opened its form already, so a person's Cancel keeps it closed (A3). */
	#emptyOpened = false;
	#filterTimer: ReturnType<typeof setTimeout> | undefined;
	/** What the section's own archive said, kept across the scope move it causes, which clears the rest. */
	#carried = '';
	/** Whether this home's first read says what it found, once it has ended and focus is in the section. */
	#announce = false;
	/** Whether the sync that showed this home moves focus to its heading, which may come after the read. */
	#focusing = false;

	constructor() {
		super();
		this.workspace = '';
		this.view = 'list';
		this.project = null;
		this.projects = [];
		this.cards = [];
		this.documents = null;
		this.loaded = false;
		this.filter = '';
		this.showArchived = false;
		this.formOpen = false;
		this.busy = false;
		this.errors = { name: '', slug: '', form: '' };
		this.status = '';
		this.failure = '';
		this.actionError = '';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.#unsubscribe ??= this.kernel?.subscribe((event) => this.#heard(event)) ?? null;
	}

	override disconnectedCallback(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		super.disconnectedCallback();
	}

	/** What the list shows: the filter's matches, by name or slug, and the archived ones only when asked. */
	get shown(): ProjectV1[] {
		const filter = this.filter.trim().toLowerCase();
		return this.projects.filter(
			(project) =>
				(this.showArchived || project.status !== 'archived') &&
				(!filter || project.name.toLowerCase().includes(filter) || project.slug.includes(filter))
		);
	}

	/** Why the list shows no row while it holds projects: the filter, or only archived ones (A8). */
	get noneShown(): string {
		if (this.filter.trim()) return 'No project matches';
		const archived = this.projects.filter((project) => project.status === 'archived').length;
		return `No active projects. Show archived to see ${numberOf(archived)}.`;
	}

	get allUrl(): string {
		return formatRoute(
			{ kind: 'section', workspace: this.workspace, section: 'projects', rest: [] },
			this.base
		);
	}

	homeOf(project: ProjectV1): string {
		return formatRoute(
			{ kind: 'project', workspace: this.workspace, project: project.slug },
			this.base
		);
	}

	/**
	 * Show `view`, for `project` when it is the home; read what it shows. `focusing` says that the sync puts
	 * focus on the heading once this resolves, so the read's result waits for it.
	 */
	async show(
		view: 'list' | 'home',
		project: ProjectV1 | null,
		workspace: string,
		focusing = false
	): Promise<void> {
		const changed = view !== this.view || project?.id !== this.project?.id;
		this.workspace = workspace;
		this.view = view;
		this.project = project;
		if (changed) {
			this.formOpen = false;
			this.cards = [];
			this.documents = null;
			this.loaded = false;
			this.status = this.#carried;
			this.#carried = '';
			this.#announce = view === 'home';
			this.#focusing = focusing;
			this.failure = '';
			this.actionError = '';
			this.#emptyOpened = false;
			this.#clearErrors();
		}
		// Not awaited: a summary may take its whole deadline, and the section follows the next change meanwhile.
		void this.read();
		await Updates.next();
	}

	/** Read the list, or the home's project and summaries, again; a later read wins over an earlier one. */
	async read(): Promise<void> {
		const kernel = this.kernel;
		if (!kernel) return;
		const read = ++this.#reads;
		try {
			// Every project the actor may enter, active and archived, so the filter and the checkbox need no read.
			const listed = await kernel.call<{ projects: ProjectV1[] }>('project-list', {
				status: 'all',
			});
			if (read !== this.#reads) return;
			this.projects = listed.data?.projects ?? [];
			// "No projects yet, with the form open" (7.7): opened once, with focus left where it is (A3).
			if (this.view === 'list' && this.projects.length === 0 && !this.#emptyOpened) {
				this.#emptyOpened = true;
				this.formOpen = true;
			}
			if (this.view === 'home' && this.project) {
				const summary = await kernel.call<ProjectSummaryResultV1>('project-summary-get', {
					project: this.project.id,
				});
				if (read !== this.#reads) return;
				if (summary.success && summary.data) {
					this.project = summary.data.project as ProjectV1;
					this.cards = summary.data.summaries.map((row) => this.#safeCard(row));
				} else {
					this.cards = [];
				}
				const documents = await this.#readDocuments(kernel, this.project);
				if (read !== this.#reads) return;
				this.documents = documents;
			}
			this.failure = '';
		} catch (cause) {
			// The section says it could not read, and is no longer loading, whatever threw (T1).
			if (read !== this.#reads) return;
			this.failure = `The projects could not be read: ${String((cause as Error)?.message ?? cause).slice(0, 200)}`;
			reportError(cause);
		}
		this.loaded = true;
		await this.paint();
		// The read's result, heard where focus alone would say nothing of it: "4 summaries", said now if
		// focus is in the section, or by `focusHeading` if the sync is about to put it there.
		if (this.#announce && this.view === 'home') {
			if (this.matches(':focus-within')) this.#sayCount();
			else if (!this.#focusing) this.#announce = false;
		}
		if (this.#created !== null) {
			const id = this.#created;
			this.#created = null;
			// Its row, or New project if none shows it, never the page (A4).
			(
				this.shadowRoot?.querySelector<HTMLElement>(`a[data-project="${CSS.escape(id)}"]`) ??
				this.newButton
			)?.focus();
		}
	}

	/**
	 * The `Documents` card: per type the project allows, its count and the five most recent, by
	 * `document-list` at the project (documents specification, 8.3); none when no type is registered.
	 */
	async #readDocuments(
		kernel: LoamKernelV3,
		project: ProjectV1
	): Promise<DocumentsCardView | null> {
		const scope = { workspace: this.workspace, project: project.id };
		const types = await kernel.call<{ types: DocumentTypeV1[] }>(
			'document-type-list',
			{},
			{ scope }
		);
		if (!types.success || !types.data || types.data.types.length === 0) return null;
		const lookup = this.#lookup();
		return {
			types: await Promise.all(
				types.data.types.map(async (type) => {
					const listed = await kernel.call<{ documents: DocumentRecordV1[]; total: number }>(
						'document-list',
						{ type: type.id, limit: 5 },
						{ scope }
					);
					return {
						title: type.title,
						icon: type.icon,
						total: listed.data?.total ?? 0,
						recent: (listed.data?.documents ?? []).map((record) => ({
							label: record.title,
							url: resourceLinkUrl(
								{ kind: 'document', document: record.id, scope: record.scope },
								this.base,
								lookup
							),
							updated: dateOf(record.updatedAt),
							iso: isoOf(record.updatedAt),
						})),
					};
				})
			),
		};
	}

	/** One row's card, or its error alone: a row that cannot be shown never fails the others (T1). */
	#safeCard(row: ProjectSummaryRowV1): CardView {
		try {
			return this.#cardOf(row);
		} catch {
			return this.#cardOf({
				instance: row.instance,
				title: row.title,
				icon: row.icon,
				error: {
					code: 'PROJECT_SUMMARY_INVALID',
					message: `${row.title} returned a summary the shell cannot show`,
					suggestion: REPORT,
				},
			});
		}
	}

	/** The table's rows and the home's cards, built again from what the section holds. */
	async paint(): Promise<void> {
		await Updates.next();
		this.#ref('rows')?.replaceChildren(
			...this.shown.map((project) =>
				el(
					'tr',
					{},
					el(
						'td',
						{},
						el(
							'a',
							{ href: this.homeOf(project), 'data-project': project.id, dir: 'auto' },
							project.name
						)
					),
					el('td', {}, project.status === 'archived' ? 'Archived' : 'Active'),
					el('td', {}, dateOf(project.updatedAt))
				)
			)
		);
		this.#ref('cards')?.replaceChildren(...this.cards.map(cardOf));
		this.#ref('documents')?.replaceChildren(
			...(this.documents ? [documentsCardOf(this.documents)] : [])
		);
	}

	projectsChanged(): void {
		void this.paint();
	}
	cardsChanged(): void {
		void this.paint();
	}
	documentsChanged(): void {
		void this.paint();
	}
	filterChanged(): void {
		void this.paint();
		// The result, said once typing pauses (A7).
		clearTimeout(this.#filterTimer);
		this.#filterTimer = setTimeout(() => {
			const pool = this.projects.filter(
				(project) => this.showArchived || project.status !== 'archived'
			).length;
			const shown = this.shown.length;
			this.status = !this.filter.trim()
				? ''
				: shown === 0
					? 'No project matches'
					: `${numberOf(shown)} of ${numberOf(pool)} projects`;
		}, 500);
	}
	showArchivedChanged(): void {
		void this.paint();
	}
	viewChanged(): void {
		void this.paint();
	}

	focusHeading(): void {
		this.shadowRoot?.querySelector<HTMLElement>('h1')?.focus();
		// A read that ended before focus arrived says its result now, once (item 3).
		if (this.#announce && this.loaded && this.view === 'home') this.#sayCount();
	}

	/** Say how many summaries the home shows, once per home, unless something else is being said. */
	#sayCount(): void {
		this.#announce = false;
		this.#focusing = false;
		const count = this.cards.length;
		if (!this.status && !this.failure)
			this.status = count === 1 ? '1 summary' : `${numberOf(count)} summaries`;
	}

	#lookup(): ProjectLookup {
		const projects = this.projects;
		return {
			workspace: this.workspace,
			slugOf: (id) => projects.find((project) => project.id === id)?.slug,
		};
	}

	#cardOf(row: ProjectSummaryRowV1): CardView {
		const lookup = this.#lookup();
		const scope = {
			workspace: this.workspace,
			...(this.project ? { project: this.project.id } : {}),
		};
		const url = (link: ResourceLinkV1 | undefined) =>
			link === undefined ? undefined : resourceLinkUrl(link, this.base, lookup);
		return {
			row,
			// The card's heading opens the app in this project: the shell's own link, by the scheme.
			url: resourceLinkUrl({ kind: 'app', instance: row.instance, scope }, this.base, lookup),
			recent: (row.summary?.recent ?? []).map((item) => ({
				label: item.title,
				url: url(item.link),
				updated: item.updatedAt === undefined ? '' : dateOf(item.updatedAt),
				iso: item.updatedAt === undefined ? '' : isoOf(item.updatedAt),
			})),
			links: (row.summary?.links ?? []).map((item) => ({ label: item.label, url: url(item.link) })),
		};
	}

	#heard(event: KernelEventV3): void {
		// From anyone: a project changed, an app was enabled or disabled, or the actor changed.
		if (!event.success || !event.mutation) return;
		// What an action said goes with the actor that made it: a signed-out person sees no restricted name (T3),
		// nor does the next person after a change no command made (phase 3 specification, 4.4; #864).
		if (event.actorChanged || event.command.startsWith('auth-')) {
			this.status = '';
			this.#carried = '';
		}
		// A home's documents card follows every document's change too (documents specification, 8.3).
		if (
			event.actorChanged ||
			/^(project-|workspace-app-set$|auth-)/.test(event.command) ||
			(this.view === 'home' && event.command.startsWith('document-'))
		)
			void this.read();
	}

	#clearErrors(): void {
		this.errors = { name: '', slug: '', form: '' };
	}

	/** New project and Rename are toggles: a second press closes the form. */
	async openForm(): Promise<void> {
		if (this.formOpen) {
			await this.closeForm();
			return;
		}
		this.#clearErrors();
		this.formOpen = true;
		await Updates.next();
		(this.view === 'list' ? this.nameField : this.renameField)?.focus();
	}

	async closeForm(): Promise<void> {
		this.formOpen = false;
		this.#clearErrors();
		await Updates.next();
		(this.view === 'list' ? this.newButton : this.renameButton)?.focus();
	}

	submitCreate(event: Event): void {
		event.preventDefault();
		void this.create();
	}

	submitRename(event: Event): void {
		event.preventDefault();
		void this.rename();
	}

	/**
	 * Enter in a field submits, as a native form's would, since a field's input is in its own shadow root;
	 * Escape closes the form, focus returning to the button that opened it.
	 */
	formKey(event: KeyboardEvent, submit: () => Promise<void>): boolean {
		if (event.key === 'Escape') {
			event.stopPropagation();
			void this.closeForm();
			return false;
		}
		if (event.key !== 'Enter' || (event.target as Element).localName !== 'violet-text-field') {
			return true;
		}
		event.preventDefault();
		void submit();
		return false;
	}

	/** A refusal beside its field, which takes focus; any other in the form's alert. */
	async #refused(
		error: { code: string; message: string; suggestion?: string } | undefined
	): Promise<void> {
		const field = FIELD_OF[error?.code ?? ''];
		// A slug made from the name, which the person never typed, is explained as that.
		const derived =
			error?.code === 'PROJECT_SLUG_INVALID' &&
			this.view === 'list' &&
			!this.slugField?.value.trim();
		const message = derived
			? 'The name gives no address of its own. Type a slug of up to 63 lower-case letters, digits and inner hyphens.'
			: sentences(error?.message ?? 'That did not work', error?.suggestion);
		this.errors = {
			name: field === 'name' ? message : '',
			slug: field === 'slug' ? message : '',
			form: field === undefined ? message : '',
		};
		await Updates.next();
		const target =
			field === 'slug' ? this.slugField : this.view === 'list' ? this.nameField : this.renameField;
		target?.focus();
	}

	async create(): Promise<void> {
		const kernel = this.kernel;
		if (!kernel || this.busy) return;
		const name = this.nameField?.value ?? '';
		const slug = this.slugField?.value.trim() ?? '';
		this.busy = true;
		try {
			const result = await kernel.call<ProjectV1>('project-create', {
				name,
				...(slug ? { slug } : {}),
			});
			if (!result.success) {
				await this.#refused(result.error);
				return;
			}
			const created = result.data as ProjectV1;
			this.formOpen = false;
			this.#clearErrors();
			// A filter that would hide the new row is cleared, so its row can take focus (A4).
			this.filter = '';
			// Clearing the filter starts its timer, which would replace what create said (N3).
			clearTimeout(this.#filterTimer);
			this.status = `${created.name} created`;
			// Its row takes focus once the list has read it.
			this.#created = created.id;
			await this.read();
		} finally {
			this.busy = false;
		}
	}

	async rename(): Promise<void> {
		const kernel = this.kernel;
		const project = this.project;
		if (!kernel || !project || this.busy) return;
		this.busy = true;
		try {
			const result = await kernel.call<ProjectV1>('project-update', {
				project: project.id,
				name: this.renameField?.value ?? '',
			});
			if (!result.success) {
				await this.#refused(result.error);
				return;
			}
			this.project = result.data as ProjectV1;
			this.status = `Renamed ${this.project.name}`;
			await this.closeForm();
		} finally {
			this.busy = false;
		}
	}

	/**
	 * Archive or restore the home's project. Archiving the active project moves the scope to the workspace
	 * (4.3), so the section shows the list then, and its heading takes focus; a restore keeps the home, with
	 * focus on Archive, which replaces Restore.
	 */
	async setStatus(command: Status): Promise<void> {
		const kernel = this.kernel;
		const project = this.project;
		if (!kernel || !project || this.busy) return;
		this.busy = true;
		this.actionError = '';
		try {
			const result = await kernel.call<{ project: ProjectV1 }>(command, { project: project.id });
			if (!result.success) {
				// Beside the actions, seen and heard (A5).
				this.actionError = `Error: ${sentences(result.error?.message ?? 'That did not work', result.error?.suggestion)}`;
				return;
			}
			const done = result.data?.project ?? project;
			const said =
				command === 'project-archive' ? `${done.name} archived` : `${done.name} restored`;
			// An archive of the home's project moves the scope (4.3); the list it shows says this still.
			if (command === 'project-archive' && this.view === 'home') this.#carried = said;
			this.status = said;
			if (this.view === 'home' && this.project?.id === done.id) this.project = done;
		} finally {
			this.busy = false;
		}
		// Once enabled again: Archive replaces Restore and takes focus. An archive leaves the home for the
		// list (4.3), whose heading the section's sync focuses.
		await Updates.next();
		if (command === 'project-restore') this.archiveButton?.focus();
	}

	setArchived(checked: boolean): void {
		this.showArchived = checked;
	}
}
observable(LoamProjectsSection.prototype, 'workspace');
observable(LoamProjectsSection.prototype, 'view');
observable(LoamProjectsSection.prototype, 'project');
observable(LoamProjectsSection.prototype, 'projects');
observable(LoamProjectsSection.prototype, 'cards');
observable(LoamProjectsSection.prototype, 'documents');
observable(LoamProjectsSection.prototype, 'loaded');
observable(LoamProjectsSection.prototype, 'filter');
observable(LoamProjectsSection.prototype, 'showArchived');
observable(LoamProjectsSection.prototype, 'formOpen');
observable(LoamProjectsSection.prototype, 'busy');
observable(LoamProjectsSection.prototype, 'errors');
observable(LoamProjectsSection.prototype, 'status');
observable(LoamProjectsSection.prototype, 'failure');
observable(LoamProjectsSection.prototype, 'actionError');

export const projectsSectionDefinition = {
	name: 'loam-projects-section',
	template,
	styles,
} as const;
