/**
 * `<todo-app>`: the to-do page on violet-elements. It renders the shared session's state
 * (`@afd/example-todo-ui/session`) into light DOM, so landmarks and headings are part of the
 * document, and every action calls the session, which calls a backend command.
 */

import type { CallRecord } from '@afd/example-todo-ui/client';
import type {
	HistoryEntry,
	Priority,
	SessionState,
	Todo,
	TodoSession,
} from '@afd/example-todo-ui/session';
import type { PriorityFilter, StatusFilter } from '@afd/example-todo-ui/view-state';
import { FASTElement, html, observable, repeat, when } from '@lushly-dev/fast-element';

const PRIORITY_COLOR: Record<Priority, string> = {
	high: 'danger',
	medium: 'warning',
	low: 'neutral',
};

const time = (iso: string) =>
	new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** What a result showed, as the command log's card state. */
const callState = (record: CallRecord) =>
	record.result === undefined
		? 'executing'
		: record.result.success
			? 'output-available'
			: 'output-error';

const json = (value: unknown) => JSON.stringify(value, null, 2);

const todoTemplate = html<Todo, TodoApp>`
	<li class="todo" data-id="${(x) => x.id}" ?data-completed="${(x) => x.completed}">
		${when(
			(_, c) => c.parent.state.showing === 'live',
			html<Todo, TodoApp>`
				<violet-checkbox
					class="todo-done"
					?checked="${(x) => x.completed}"
					@change="${(x, c) => c.parent.toggleFrom(x, c.event)}"
				>
					${(x) => x.title}
				</violet-checkbox>
			`,
			html<Todo, TodoApp>`<span class="todo-title">${(x) => x.title}</span>`
		)}
		<violet-badge class="todo-priority" color="${(x) => PRIORITY_COLOR[x.priority]}" size="sm">
			${(x) => x.priority}
		</violet-badge>
		${when(
			(_, c) => c.parent.state.showing === 'live',
			html<Todo, TodoApp>`
				<violet-button
					class="todo-delete"
					appearance="quiet"
					@click="${(x, c) => c.parent.afterRemoving(c.parent.session?.remove(x.id))}"
					>Delete<span class="visually-hidden"> ${(x) => x.title}</span></violet-button
				>
			`,
			html<Todo, TodoApp>`
				<span class="todo-deleted-at">Deleted ${(x) => (x.deletedAt ? time(x.deletedAt) : '')}</span>
				<violet-button
					class="todo-restore"
					appearance="secondary"
					@click="${(x, c) => c.parent.afterRemoving(c.parent.session?.restore([x.id]))}"
					>Restore<span class="visually-hidden"> ${(x) => x.title}</span></violet-button
				>
			`
		)}
	</li>
`;

const historyTemplate = html<HistoryEntry, TodoApp>`
	<li class="history-entry" data-seq="${(x) => x.seq}">
		<span class="history-what"><code>${(x) => x.command}</code> by ${(x) => x.actor.kind}</span>
		<span class="history-when">${(x) => time(x.at)}</span>
		${when(
			(x) => x.undoCommand !== undefined,
			html<HistoryEntry, TodoApp>`
				<violet-button
					class="history-undo"
					appearance="quiet"
					@click="${(x, c) => c.parent.session?.undoEntry(x)}"
					>Undo<span class="visually-hidden"> ${(x) => x.command}</span></violet-button
				>
			`
		)}
		${when(
			(x) => x.superseded === true,
			html<HistoryEntry>`<span class="history-superseded">changed since</span>`
		)}
	</li>
`;

const logTemplate = html<CallRecord>`
	<violet-tool-call-card
		class="log-entry"
		tool-name="${(x) => x.command}"
		state="${(x) => callState(x)}"
	>
		<span slot="summary">
			${(x) =>
				x.result === undefined
					? 'Running…'
					: `${x.result.success ? 'Succeeded' : `Failed: ${x.result.error?.code ?? ''}`} in ${x.durationMs ?? 0} ms`}
		</span>
		<pre slot="input">${(x) => json(x.input)}</pre>
		<pre slot="output">${(x) => (x.result ? json(x.result) : '')}</pre>
	</violet-tool-call-card>
`;

const template = html<TodoApp>`
	<header class="banner">
		<h1>Todos</h1>
		<p class="banner-status">
			<span role="status">
				<violet-badge
					class="connection"
					color="${(x) => (x.state.connected ? 'success' : 'danger')}"
					size="sm"
					>${(x) => (x.state.connected ? 'Connected' : 'Offline')}</violet-badge
				>
			</span>
			${(x) =>
				x.state.stats
					? `${x.state.stats.pending} open, ${x.state.stats.completed} done, ${Math.round(x.state.stats.completionRate * 100)}% complete`
					: ''}
		</p>
	</header>

	<main id="main" class="page">
		<section class="work" aria-labelledby="work-heading">
			<h2 id="work-heading" class="visually-hidden">Your todos</h2>

			${when(
				(x) => x.state.error !== undefined,
				html<TodoApp>`
					<violet-alert class="page-error" tone="danger" announcement="assertive">
						<span slot="title">${(x) => `${x.state.error?.command}: ${x.state.error?.code}`}</span>
						<p>${(x) => x.state.error?.message}</p>
						${when(
							(x) => x.state.error?.suggestion !== undefined,
							html<TodoApp>`<p class="suggestion">${(x) => x.state.error?.suggestion}</p>`
						)}
						<span slot="actions">
							${when(
								(x) => x.state.error?.retry !== undefined,
								html<TodoApp>`<violet-button appearance="secondary" @click="${(x) => x.session?.retry()}"
									>Retry</violet-button
								>`
							)}
							<violet-button appearance="quiet" @click="${(x) => x.session?.dismissError()}"
								>Dismiss</violet-button
							>
						</span>
					</violet-alert>
				`
			)}
			${when(
				(x) => x.state.remote !== undefined,
				html<TodoApp>`
					<violet-alert
						class="remote-change"
						tone="info"
						announcement="polite"
						dismissible
						@dismiss="${(x) => x.session?.dismissRemote()}"
						>${(x) => x.state.remote}</violet-alert
					>
				`
			)}

			<form class="add" @submit="${(x, c) => x.addFromForm(c.event)}">
				<violet-text-field
					class="add-title"
					label="New todo"
					required
					maxlength="200"
					@keydown="${(x, c) => x.addOnEnter(c.event as KeyboardEvent)}"
				></violet-text-field>
				<violet-select class="add-priority" label="Priority" value="medium">
					<violet-option value="low">Low</violet-option>
					<violet-option value="medium">Medium</violet-option>
					<violet-option value="high">High</violet-option>
				</violet-select>
				<violet-button class="add-submit" @click="${(x, c) => x.addFromForm(c.event)}">Add</violet-button>
			</form>

			<div class="filters">
				<violet-segmented-control
					class="filter-status"
					label="Show"
					:value="${(x) => x.state.filter.status}"
					@change="${(x, c) => x.session?.setFilter({ status: (c.event.target as HTMLInputElement).value as StatusFilter })}"
				>
					<violet-segment value="all">All</violet-segment>
					<violet-segment value="pending">Open</violet-segment>
					<violet-segment value="completed">Done</violet-segment>
				</violet-segmented-control>
				<violet-select
					class="filter-priority"
					label="Priority"
					:value="${(x) => x.state.filter.priority}"
					@change="${(x, c) => x.session?.setFilter({ priority: (c.event.target as HTMLInputElement).value as PriorityFilter })}"
				>
					<violet-option value="all">Any</violet-option>
					<violet-option value="high">High</violet-option>
					<violet-option value="medium">Medium</violet-option>
					<violet-option value="low">Low</violet-option>
				</violet-select>
				<violet-text-field
					class="filter-search"
					label="Search"
					type="search"
					:value="${(x) => x.state.filter.search}"
					@change="${(x, c) => x.session?.setFilter({ search: (c.event.target as HTMLInputElement).value })}"
				></violet-text-field>
				<violet-segmented-control
					class="filter-list"
					label="List"
					:value="${(x) => x.state.showing}"
					@change="${(x, c) => x.session?.show((c.event.target as HTMLInputElement).value as 'live' | 'deleted')}"
				>
					<violet-segment value="live">Todos</violet-segment>
					<violet-segment value="deleted">Deleted</violet-segment>
				</violet-segmented-control>
			</div>

			${when(
				(x) => x.state.todos.length > 0,
				html<TodoApp>`
					<ul class="todo-list" aria-label="${(x) => (x.state.showing === 'live' ? 'Todos' : 'Deleted todos')}">
						${repeat((x) => x.state.todos, todoTemplate)}
					</ul>
				`,
				html<TodoApp>`
					<violet-empty-state
						class="empty"
						heading="${(x) => (x.state.showing === 'live' ? 'Nothing here' : 'No deleted todos')}"
						message="${(x) =>
							x.state.showing === 'live'
								? 'Add a todo, or change the filter.'
								: 'A todo you delete stays here until you empty the deleted todos.'}"
					></violet-empty-state>
				`
			)}

			<div class="list-actions">
				${when(
					(x) => x.state.showing === 'live',
					html<TodoApp>`<violet-button
						class="clear-completed"
						appearance="danger"
						@click="${(x) => x.session?.clearCompleted()}"
						>Clear completed</violet-button
					>`,
					html<TodoApp>`<violet-button
						class="empty-deleted"
						appearance="danger"
						@click="${(x) => x.session?.emptyDeleted()}"
						>Empty deleted todos</violet-button
					>`
				)}
			</div>
		</section>

		<aside class="insight" aria-label="What the commands did">
			<section class="trust" aria-labelledby="trust-heading">
				<h2 id="trust-heading">Last result</h2>
				${when(
					(x) => x.state.trust !== undefined,
					html<TodoApp>`
						<p class="trust-command">
							<code>${(x) => x.state.trust?.command}</code>
							${(x) => (x.state.trust?.success ? 'succeeded' : 'failed')}
							${(x) => (x.state.trust?.durationMs !== undefined ? `in ${x.state.trust?.durationMs} ms` : '')}
						</p>
						${when(
							(x) => x.state.trust?.confidencePercent !== undefined,
							html<TodoApp>`<violet-progress
								class="trust-confidence"
								label="Confidence"
								value="${(x) => String(x.state.trust?.confidencePercent ?? 0)}"
							></violet-progress>`
						)}
						${when(
							(x) => x.state.trust?.reasoning !== undefined,
							html<TodoApp>`<p class="trust-reasoning">${(x) => x.state.trust?.reasoning}</p>`
						)}
						${repeat(
							(x) => x.state.trust?.warnings ?? [],
							html<{ code: string; message: string }>`
								<violet-alert class="trust-warning" tone="warning">
									<span slot="title">${(x) => x.code}</span>${(x) => x.message}
								</violet-alert>
							`
						)}
						${repeat(
							(x) => x.state.trust?.sources ?? [],
							html<{ title: string; href?: string }>`
								<violet-source-citation
									source-title="${(x) => x.title}"
									href="${(x) => x.href ?? ''}"
								></violet-source-citation>
							`
						)}
						${when(
							(x) => (x.state.trust?.alternatives.length ?? 0) > 0,
							html<TodoApp>`<p class="trust-alternatives">
								${(x) => `${x.state.trust?.alternatives.length} other ways to see this: `}
								${(x) => x.state.trust?.alternatives.map((each) => each.reason).join('; ')}
							</p>`
						)}
						${when(
							(x) => x.state.trust?.undo !== undefined,
							html<TodoApp>`<p class="trust-undo">
								Undo with <code>${(x) => x.state.trust?.undo?.command}</code>
								<code>${(x) => JSON.stringify(x.state.trust?.undo?.args)}</code>
							</p>`
						)}
					`,
					html<TodoApp>`<p>Run a command to see its confidence, reasoning and undo.</p>`
				)}
			</section>

			<section class="history" aria-labelledby="history-heading">
				<h2 id="history-heading">Recent changes</h2>
				<p class="history-note">
					From <code>todo-history</code>. Without sign-in, the server counts every page and MCP
					client as an agent.
				</p>
				<ul class="history-list">
					${repeat((x) => x.state.history, historyTemplate)}
				</ul>
			</section>

			<section class="command-log" aria-labelledby="log-heading">
				<h2 id="log-heading">Command log</h2>
				${repeat((x) => x.state.log, logTemplate)}
			</section>
		</aside>
	</main>

	<violet-snackbar
		class="undo-offer"
		dismissible
		?open="${(x) => x.state.undo !== undefined}"
		@dismiss="${(x) => x.session?.dismissUndo()}"
	>
		${(x) => x.state.undo?.message}
		<violet-button slot="action" appearance="quiet" @click="${(x) => x.session?.undo()}"
			>Undo</violet-button
		>
	</violet-snackbar>

	<violet-dialog
		class="approval"
		type="alert"
		no-close-button
		@request-close="${(_, c) => c.event.preventDefault()}"
		?open="${(x) => x.state.approval !== undefined}"
	>
		<span slot="title"
			>${(x) => (x.state.approval?.kind === 'approval' ? 'Approve this change?' : 'Confirm this change?')}</span
		>
		<violet-approval-card
			class="approval-card"
			@approve="${(x) => x.session?.approve()}"
			@deny="${(x) => x.session?.deny()}"
		>
			<p slot="summary" class="approval-message">${(x) => x.state.approval?.message}</p>
			<span slot="detail"
				>The server holds this until a person answers. Nothing is removed if you deny it.</span
			>
		</violet-approval-card>
	</violet-dialog>
`;

export class TodoApp extends FASTElement {
	declare state: SessionState;
	session: TodoSession | undefined;
	#stop: (() => void) | undefined;

	constructor() {
		super();
		this.state = {
			connected: false,
			todos: [],
			total: 0,
			filter: { status: 'all', priority: 'all', search: '' },
			showing: 'live',
			history: [],
			log: [],
		};
	}

	/** Render this session's state from now on. */
	attach(session: TodoSession): void {
		this.#stop?.();
		this.session = session;
		this.#stop = session.subscribe((state) => {
			this.state = state;
		});
	}

	override connectedCallback(): void {
		super.connectedCallback();
		// Moved in the document: render the session again
		if (this.session && !this.#stop) this.attach(this.session);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.#stop?.();
		this.#stop = undefined;
	}

	/** Toggle from the row's checkbox; a failed toggle puts the box back as the list still is. */
	async toggleFrom(todo: Todo, event: Event): Promise<void> {
		const result = await this.session?.toggle(todo.id);
		if (result && !result.success) (event.target as HTMLInputElement).checked = todo.completed;
	}

	/** Enter in the title field adds the todo: violet buttons do not submit a form. */
	addOnEnter(event: KeyboardEvent): boolean {
		// Enter that ends an input method's composition only confirms the text
		if (event.key !== 'Enter' || event.isComposing) return true;
		void this.addFromForm(event);
		return false;
	}

	/**
	 * After Delete or Restore removes the focused button with its row, put focus in the title
	 * field rather than leave it on the page body.
	 */
	async afterRemoving(change: Promise<unknown> | undefined): Promise<void> {
		await change;
		this.querySelector<HTMLElement>('violet-text-field.add-title')?.focus();
	}

	/** Add the todo the form describes, then clear the title for the next one. */
	async addFromForm(event: Event): Promise<void> {
		event.preventDefault();
		const field = this.querySelector<HTMLInputElement>('violet-text-field.add-title');
		const priority = this.querySelector<HTMLInputElement>('violet-select.add-priority');
		const title = field?.value.trim() ?? '';
		if (!title || !this.session) {
			field?.focus();
			return;
		}
		const result = await this.session.add(title, (priority?.value as Priority) || 'medium');
		if (result.success && field) field.value = '';
	}
}

observable(TodoApp.prototype, 'state');

export async function defineTodoApp(): Promise<void> {
	if (customElements.get('todo-app')) return;
	await FASTElement.define(TodoApp, { name: 'todo-app', template, shadowOptions: null });
}
