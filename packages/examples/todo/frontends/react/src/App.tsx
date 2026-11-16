/**
 * The to-do page in React 19 on violet-elements. It renders the shared session
 * (`@afd/example-todo-ui/session`) with the same structure and class names as the FAST-AF page,
 * so both share the styles and the browser suite; only the rendering differs. Every action calls
 * the session, which calls a backend command.
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
import { type KeyboardEvent, useRef } from 'react';
import { useElementEvents, useSessionState } from './hooks';

const PRIORITY_COLOR: Record<Priority, string> = {
	high: 'danger',
	medium: 'warning',
	low: 'neutral',
};

const time = (iso: string) =>
	new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** What a result showed, as the command log's card state. */
const callState = (record: CallRecord) =>
	record.result === undefined
		? 'executing'
		: record.result.success
			? 'output-available'
			: 'output-error';

/** The element's `value` property, as the violet field and choice elements report it. */
const chosenValue = (event: Event) => (event.target as HTMLInputElement).value;

interface Props {
	session: TodoSession;
}

export function App({ session }: Props) {
	const state = useSessionState(session);
	const titleRef = useRef<HTMLInputElement>(null);

	/** After Delete or Restore removes the focused button with its row, focus the title field. */
	const afterRemoving = async (change: Promise<unknown>) => {
		await change;
		titleRef.current?.focus();
	};

	return (
		<>
			<header className="banner">
				<h1>Todos</h1>
				<p className="banner-status">
					<span role="status">
						<violet-badge
							className="connection"
							color={state.connected ? 'success' : 'danger'}
							size="sm"
						>
							{state.connected ? 'Connected' : 'Offline'}
						</violet-badge>
					</span>{' '}
					{state.stats
						? `${state.stats.pending} open, ${state.stats.completed} done, ${Math.round(state.stats.completionRate * 100)}% complete`
						: ''}
				</p>
			</header>

			<main id="main" className="page">
				<section className="work" aria-labelledby="work-heading">
					<h2 id="work-heading" className="visually-hidden">
						Your todos
					</h2>
					<PageError session={session} state={state} />
					<RemoteChange session={session} state={state} />
					<AddForm session={session} titleRef={titleRef} />
					<Filters session={session} state={state} />
					{state.todos.length > 0 ? (
						<ul
							className="todo-list"
							aria-label={state.showing === 'live' ? 'Todos' : 'Deleted todos'}
						>
							{state.todos.map((todo) => (
								<TodoRow
									key={todo.id}
									todo={todo}
									showing={state.showing}
									session={session}
									afterRemoving={afterRemoving}
								/>
							))}
						</ul>
					) : (
						<violet-empty-state
							className="empty"
							heading={state.showing === 'live' ? 'Nothing here' : 'No deleted todos'}
							message={
								state.showing === 'live'
									? 'Add a todo, or change the filter.'
									: 'A todo you delete stays here until you empty the deleted todos.'
							}
						/>
					)}
					<div className="list-actions">
						{state.showing === 'live' ? (
							<violet-button
								className="clear-completed"
								appearance="danger"
								onClick={() => session.clearCompleted()}
							>
								Clear completed
							</violet-button>
						) : (
							<violet-button
								className="empty-deleted"
								appearance="danger"
								onClick={() => session.emptyDeleted()}
							>
								Empty deleted todos
							</violet-button>
						)}
					</div>
				</section>

				<aside className="insight" aria-label="What the commands did">
					<Trust state={state} />
					<section className="history" aria-labelledby="history-heading">
						<h2 id="history-heading">Recent changes</h2>
						<p className="history-note">
							From <code>todo-history</code>. Without sign-in, the server counts every page and MCP
							client as an agent.
						</p>
						<ul className="history-list">
							{state.history.map((entry) => (
								<HistoryRow key={entry.seq} entry={entry} session={session} />
							))}
						</ul>
					</section>
					<section className="command-log" aria-labelledby="log-heading">
						<h2 id="log-heading">Command log</h2>
						{state.log.map((record) => (
							<LogCard key={record.id} record={record} />
						))}
					</section>
				</aside>
			</main>

			<UndoSnackbar session={session} state={state} />
			<ApprovalDialog session={session} state={state} />
		</>
	);
}

interface PartProps {
	session: TodoSession;
	state: SessionState;
}

function PageError({ session, state }: PartProps) {
	const error = state.error;
	if (!error) return null;
	return (
		<violet-alert className="page-error" tone="danger" announcement="assertive">
			<span slot="title">{`${error.command}: ${error.code}`}</span>
			<p>{error.message}</p>
			{error.suggestion !== undefined && <p className="suggestion">{error.suggestion}</p>}
			<span slot="actions">
				{error.retry !== undefined && (
					<violet-button appearance="secondary" onClick={() => session.retry()}>
						Retry
					</violet-button>
				)}
				<violet-button appearance="quiet" onClick={() => session.dismissError()}>
					Dismiss
				</violet-button>
			</span>
		</violet-alert>
	);
}

function RemoteChange({ session, state }: PartProps) {
	const ref = useElementEvents({ dismiss: () => session.dismissRemote() });
	if (state.remote === undefined) return null;
	return (
		<violet-alert ref={ref} className="remote-change" tone="info" announcement="polite" dismissible>
			{state.remote}
		</violet-alert>
	);
}

function AddForm({
	session,
	titleRef,
}: {
	session: TodoSession;
	titleRef: React.RefObject<HTMLInputElement | null>;
}) {
	const priorityRef = useRef<HTMLInputElement>(null);

	const add = async () => {
		const field = titleRef.current;
		const title = field?.value.trim() ?? '';
		if (!title) {
			field?.focus();
			return;
		}
		const result = await session.add(title, (priorityRef.current?.value as Priority) || 'medium');
		if (result.success && field) field.value = '';
	};

	/** Enter in the title field adds the todo: violet buttons do not submit a form. */
	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
		event.preventDefault();
		void add();
	};

	return (
		<form
			className="add"
			onSubmit={(event) => {
				event.preventDefault();
				void add();
			}}
		>
			<violet-text-field
				ref={titleRef}
				className="add-title"
				label="New todo"
				required
				maxlength="200"
				onKeyDown={onKeyDown}
			/>
			<violet-select ref={priorityRef} className="add-priority" label="Priority" value="medium">
				<violet-option value="low">Low</violet-option>
				<violet-option value="medium">Medium</violet-option>
				<violet-option value="high">High</violet-option>
			</violet-select>
			<violet-button className="add-submit" onClick={() => void add()}>
				Add
			</violet-button>
		</form>
	);
}

function Filters({ session, state }: PartProps) {
	const statusRef = useElementEvents({
		change: (event) => session.setFilter({ status: chosenValue(event) as StatusFilter }),
	});
	const priorityRef = useElementEvents({
		change: (event) => session.setFilter({ priority: chosenValue(event) as PriorityFilter }),
	});
	const searchRef = useElementEvents({
		change: (event) => session.setFilter({ search: chosenValue(event) }),
	});
	const listRef = useElementEvents({
		change: (event) => session.show(chosenValue(event) as 'live' | 'deleted'),
	});

	return (
		<div className="filters">
			<violet-segmented-control
				ref={statusRef}
				className="filter-status"
				label="Show"
				value={state.filter.status}
			>
				<violet-segment value="all">All</violet-segment>
				<violet-segment value="pending">Open</violet-segment>
				<violet-segment value="completed">Done</violet-segment>
			</violet-segmented-control>
			<violet-select
				ref={priorityRef}
				className="filter-priority"
				label="Priority"
				value={state.filter.priority}
			>
				<violet-option value="all">Any</violet-option>
				<violet-option value="high">High</violet-option>
				<violet-option value="medium">Medium</violet-option>
				<violet-option value="low">Low</violet-option>
			</violet-select>
			<violet-text-field
				ref={searchRef}
				className="filter-search"
				label="Search"
				type="search"
				value={state.filter.search}
			/>
			<violet-segmented-control
				ref={listRef}
				className="filter-list"
				label="List"
				value={state.showing}
			>
				<violet-segment value="live">Todos</violet-segment>
				<violet-segment value="deleted">Deleted</violet-segment>
			</violet-segmented-control>
		</div>
	);
}

function TodoRow({
	todo,
	showing,
	session,
	afterRemoving,
}: {
	todo: Todo;
	showing: SessionState['showing'];
	session: TodoSession;
	afterRemoving: (change: Promise<unknown>) => Promise<void>;
}) {
	const checkboxRef = useElementEvents({
		change: async (event) => {
			const result = await session.toggle(todo.id);
			// A failed toggle leaves the list as it was: put the box back, since the prop did not change
			if (!result.success) (event.target as HTMLInputElement).checked = todo.completed;
		},
	});
	return (
		<li className="todo" data-id={todo.id} data-completed={todo.completed ? '' : undefined}>
			{showing === 'live' ? (
				<violet-checkbox ref={checkboxRef} className="todo-done" checked={todo.completed}>
					{todo.title}
				</violet-checkbox>
			) : (
				<span className="todo-title">{todo.title}</span>
			)}
			<violet-badge className="todo-priority" color={PRIORITY_COLOR[todo.priority]} size="sm">
				{todo.priority}
			</violet-badge>
			{showing === 'live' ? (
				<violet-button
					className="todo-delete"
					appearance="quiet"
					onClick={() => afterRemoving(session.remove(todo.id))}
				>
					Delete<span className="visually-hidden"> {todo.title}</span>
				</violet-button>
			) : (
				<>
					<span className="todo-deleted-at">
						Deleted {todo.deletedAt ? time(todo.deletedAt) : ''}
					</span>
					<violet-button
						className="todo-restore"
						appearance="secondary"
						onClick={() => afterRemoving(session.restore([todo.id]))}
					>
						Restore<span className="visually-hidden"> {todo.title}</span>
					</violet-button>
				</>
			)}
		</li>
	);
}

function HistoryRow({ entry, session }: { entry: HistoryEntry; session: TodoSession }) {
	return (
		<li className="history-entry" data-seq={entry.seq}>
			<span className="history-what">
				<code>{entry.command}</code> by {entry.actor.kind}
			</span>
			<span className="history-when">{time(entry.at)}</span>
			{entry.undoCommand !== undefined && (
				<violet-button
					className="history-undo"
					appearance="quiet"
					onClick={() => session.undoEntry(entry)}
				>
					Undo<span className="visually-hidden"> {entry.command}</span>
				</violet-button>
			)}
			{entry.superseded === true && <span className="history-superseded">changed since</span>}
		</li>
	);
}

function LogCard({ record }: { record: CallRecord }) {
	return (
		<violet-tool-call-card
			className="log-entry"
			tool-name={record.command}
			state={callState(record)}
		>
			<span slot="summary">
				{record.result === undefined
					? 'Running…'
					: `${record.result.success ? 'Succeeded' : `Failed: ${record.result.error?.code ?? ''}`} in ${record.durationMs ?? 0} ms`}
			</span>
			<pre slot="input">{json(record.input)}</pre>
			<pre slot="output">{record.result ? json(record.result) : ''}</pre>
		</violet-tool-call-card>
	);
}

function Trust({ state }: { state: SessionState }) {
	const trust = state.trust;
	return (
		<section className="trust" aria-labelledby="trust-heading">
			<h2 id="trust-heading">Last result</h2>
			{trust ? (
				<>
					<p className="trust-command">
						<code>{trust.command}</code> {trust.success ? 'succeeded' : 'failed'}{' '}
						{trust.durationMs !== undefined ? `in ${trust.durationMs} ms` : ''}
					</p>
					{trust.confidencePercent !== undefined && (
						<violet-progress
							className="trust-confidence"
							label="Confidence"
							value={String(trust.confidencePercent)}
						/>
					)}
					{trust.reasoning !== undefined && <p className="trust-reasoning">{trust.reasoning}</p>}
					{trust.warnings.map((warning) => (
						<violet-alert
							key={`${warning.code}:${warning.message}`}
							className="trust-warning"
							tone="warning"
						>
							<span slot="title">{warning.code}</span>
							{warning.message}
						</violet-alert>
					))}
					{trust.sources.map((source) => (
						<violet-source-citation
							key={`${source.title}:${source.href ?? ''}`}
							source-title={source.title}
							href={source.href ?? ''}
						/>
					))}
					{trust.alternatives.length > 0 && (
						<p className="trust-alternatives">
							{`${trust.alternatives.length} other ways to see this: `}
							{trust.alternatives.map((each) => each.reason).join('; ')}
						</p>
					)}
					{trust.undo !== undefined && (
						<p className="trust-undo">
							Undo with <code>{trust.undo.command}</code>{' '}
							<code>{JSON.stringify(trust.undo.args)}</code>
						</p>
					)}
				</>
			) : (
				<p>Run a command to see its confidence, reasoning and undo.</p>
			)}
		</section>
	);
}

function UndoSnackbar({ session, state }: PartProps) {
	const ref = useElementEvents({ dismiss: () => session.dismissUndo() });
	return (
		<violet-snackbar ref={ref} className="undo-offer" dismissible open={state.undo !== undefined}>
			{state.undo?.message}
			<violet-button slot="action" appearance="quiet" onClick={() => session.undo()}>
				Undo
			</violet-button>
		</violet-snackbar>
	);
}

function ApprovalDialog({ session, state }: PartProps) {
	// Escape cannot dismiss a question the server is waiting on: only Approve or Deny answer it
	const dialogRef = useElementEvents({ 'request-close': (event) => event.preventDefault() });
	const cardRef = useElementEvents({
		approve: () => session.approve(),
		deny: () => session.deny(),
	});
	return (
		<violet-dialog
			ref={dialogRef}
			className="approval"
			type="alert"
			no-close-button
			open={state.approval !== undefined}
		>
			<span slot="title">
				{state.approval?.kind === 'approval' ? 'Approve this change?' : 'Confirm this change?'}
			</span>
			<violet-approval-card ref={cardRef} className="approval-card">
				<p slot="summary" className="approval-message">
					{state.approval?.message}
				</p>
				<span slot="detail">
					The server holds this until a person answers. Nothing is removed if you deny it.
				</span>
			</violet-approval-card>
		</violet-dialog>
	);
}
