/**
 * @fileoverview The to-do page's state and actions, shared by the FAST-AF and React frontends so
 * they differ only in how they render. Every action is a backend command; the page keeps no
 * logic a CLI or an agent could not run the same way.
 *
 * What the session shows a person, beyond the list:
 * - the last result's trust summary (confidence, reasoning, warnings, sources, alternatives);
 * - a log of every command the page ran, with its input and result;
 * - an undo offer after each change that names one (`undoCommand`, `undoArgs`);
 * - a person's approval when the server holds a call (`todo-clear` from anyone but a person),
 *   asked through MCP form elicitation and answered from the page;
 * - an error with its suggestion and a retry;
 * - the change history (`todo-history`), with an undo on each entry still the latest to its todos;
 * - changes another client made, found by polling the history.
 */

import type { ElicitationRequest, ElicitationResponse } from '@lushly-dev/afd-client';
import type { CommandResult } from '@lushly-dev/afd-core';
import { type CallRecord, TodoClient } from './client.ts';
import { type TrustSummary, trustOf } from './trust.ts';
import { listInput, type TodoFilter, TodoViewState } from './view-state.ts';

export type Priority = 'low' | 'medium' | 'high';

export interface Todo {
	id: string;
	title: string;
	description?: string;
	priority: Priority;
	completed: boolean;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
	deletedAt?: string;
}

export interface Stats {
	total: number;
	completed: number;
	pending: number;
	completionRate: number;
}

export interface HistoryEntry {
	seq: number;
	at: string;
	actor: { kind: string; id?: string };
	command: string;
	ids: string[];
	undoCommand?: string;
	undoArgs?: Record<string, unknown>;
	superseded?: true;
}

/** A question the server is waiting on a person to answer. */
export interface PendingApproval {
	message: string;
	/** Whether this is an approval (`approve`) or a confirmation (`confirm`). */
	kind: 'approval' | 'confirmation';
}

export interface UndoOffer {
	message: string;
	command: string;
	args: Record<string, unknown>;
}

export interface PageError {
	command: string;
	code: string;
	message: string;
	suggestion?: string;
	retry?: () => Promise<void>;
}

export interface SessionState {
	connected: boolean;
	todos: Todo[];
	total: number;
	stats?: Stats;
	filter: TodoFilter;
	/** Which list is shown: the live todos or the deleted ones */
	showing: 'live' | 'deleted';
	history: HistoryEntry[];
	log: CallRecord[];
	trust?: TrustSummary;
	undo?: UndoOffer;
	approval?: PendingApproval;
	error?: PageError;
	/** The latest notice about changes another client made */
	remote?: string;
	busy: boolean;
}

/** How many commands the log keeps. */
const LOG_LIMIT = 40;

/** Commands the page runs only to read: they are logged but leave the trust panel alone. */
const READS = new Set(['todo-list', 'todo-stats', 'todo-history', 'todo-get']);

export interface TodoSessionOptions {
	baseUrl: string;
	/** How often to look for changes another client made, in milliseconds; 0 turns it off. */
	pollMs?: number;
	fetch?: typeof fetch;
}

export class TodoSession {
	readonly view = new TodoViewState();
	readonly client: TodoClient;
	private state: SessionState;
	private readonly listeners = new Set<(state: SessionState) => void>();
	private answer: ((response: ElicitationResponse) => void) | undefined;
	private knownSeq = 0;
	private timer: ReturnType<typeof setInterval> | undefined;
	private readonly pollMs: number;

	constructor(options: TodoSessionOptions) {
		this.pollMs = options.pollMs ?? 3000;
		this.client = new TodoClient({
			baseUrl: options.baseUrl,
			ask: (request) => this.ask(request),
			onCall: (record) => this.logCall(record),
			...(options.fetch && { fetch: options.fetch }),
		});
		this.state = {
			connected: false,
			todos: [],
			total: 0,
			filter: this.view.current,
			showing: 'live',
			history: [],
			log: [],
			busy: false,
		};
		this.view.subscribe((filter) => {
			this.update({ filter });
			void this.refresh();
		});
	}

	get snapshot(): SessionState {
		return this.state;
	}

	subscribe(listener: (state: SessionState) => void): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	private update(patch: Partial<SessionState>): void {
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) listener(this.state);
	}

	// ─── Connection and reading ──────────────────────────────────────────────────

	/** Connect, read everything, and start looking for other clients' changes. */
	async start(): Promise<void> {
		try {
			await this.client.connect();
			this.update({ connected: true, error: undefined });
		} catch (error) {
			this.update({
				connected: false,
				error: {
					command: 'connect',
					code: 'BACKEND_UNREACHABLE',
					message: error instanceof Error ? error.message : String(error),
					suggestion: 'Start a backend (pnpm dev:ts from packages/examples/todo), then retry',
					retry: () => this.start(),
				},
			});
			return;
		}
		await this.refresh();
		this.knownSeq = await this.latestSeq();
		if (this.pollMs > 0 && !this.timer) {
			this.timer = setInterval(() => void this.poll(), this.pollMs);
		}
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		this.client.disconnect();
	}

	/** Read the list the filter and view select, the stats and the history. */
	async refresh(): Promise<void> {
		const input = {
			...listInput(this.state.filter),
			...(this.state.showing === 'deleted' && { deleted: true, sortBy: 'deletedAt' }),
			limit: 100,
		};
		const [list, stats, history] = await Promise.all([
			this.client.call<{ todos: Todo[]; total: number }>('todo-list', input),
			this.client.call<Stats>('todo-stats'),
			this.client.call<{ entries: HistoryEntry[] }>('todo-history', { limit: 20 }),
		]);
		if (!list.success) {
			this.fail('todo-list', list, () => this.refresh());
			this.update({ connected: list.error?.code !== 'BACKEND_UNREACHABLE' });
			return;
		}
		this.update({
			connected: true,
			todos: list.data?.todos ?? [],
			total: list.data?.total ?? 0,
			...(stats.success && { stats: stats.data }),
			...(history.success && { history: history.data?.entries ?? [] }),
		});
	}

	private async latestSeq(): Promise<number> {
		const latest = await this.client.call<{ entries: HistoryEntry[] }>(
			'todo-history',
			{ limit: 1 },
			{ log: false }
		);
		return latest.data?.entries[0]?.seq ?? this.knownSeq;
	}

	/** Look for changes another client made since the page's last own change. */
	async poll(): Promise<void> {
		const history = await this.client.call<{ entries: HistoryEntry[] }>(
			'todo-history',
			{ limit: 20 },
			{ log: false }
		);
		if (!history.success) return;
		const fresh = (history.data?.entries ?? []).filter((entry) => entry.seq > this.knownSeq);
		if (fresh.length === 0) return;
		this.knownSeq = Math.max(...fresh.map((entry) => entry.seq));
		const who = [...new Set(fresh.map((entry) => entry.actor.kind))].join(' and ');
		this.update({
			remote: `${fresh.length} ${fresh.length === 1 ? 'change' : 'changes'} by ${who} from another client`,
		});
		await this.refresh();
	}

	// ─── Changing todos ──────────────────────────────────────────────────────────

	/**
	 * Run a command a person asked for: show its trust summary, offer its undo, or show its error
	 * with a retry. Then read the list again and note the history position, so the page's own
	 * change is not reported as another client's.
	 */
	async run<T>(command: string, input: Record<string, unknown> = {}): Promise<CommandResult<T>> {
		this.update({ busy: true, error: undefined, remote: undefined });
		const result = await this.client.call<T>(command, input);
		if (result.success) {
			this.update({
				undo: result.undoCommand
					? {
							message: result.reasoning ?? `${command} done`,
							command: result.undoCommand,
							args: { ...(result.undoArgs ?? {}) },
						}
					: undefined,
			});
		} else {
			this.fail(command, result, async () => {
				await this.run(command, input);
			});
		}
		await this.refresh();
		this.knownSeq = await this.latestSeq();
		this.update({ busy: false });
		return result;
	}

	add(title: string, priority: Priority = 'medium', description?: string) {
		return this.run('todo-create', {
			title,
			priority,
			...(description && { description }),
		});
	}

	toggle(id: string) {
		return this.run('todo-toggle', { id });
	}

	rename(id: string, title: string) {
		return this.run('todo-update', { id, title });
	}

	remove(id: string) {
		return this.run('todo-delete', { id });
	}

	removeMany(ids: string[]) {
		return this.run('todo-delete-batch', { ids });
	}

	restore(ids: string[]) {
		return this.run('todo-restore', { ids });
	}

	/** Remove completed todos for good; the server holds it for the person's approval. */
	clearCompleted() {
		return this.run('todo-clear', {});
	}

	/** Remove the deleted todos for good; held like any clear. */
	emptyDeleted() {
		return this.run('todo-clear', { deleted: true });
	}

	/** Take back the last change, with the command and arguments its result named. */
	async undo(): Promise<void> {
		const offer = this.state.undo;
		if (!offer) return;
		this.update({ undo: undefined });
		await this.run(offer.command, offer.args);
	}

	/** Take back a change from the history, while it is still the latest to its todos. */
	async undoEntry(entry: HistoryEntry): Promise<void> {
		if (!entry.undoCommand || entry.superseded) return;
		await this.run(entry.undoCommand, entry.undoArgs ?? {});
	}

	dismissUndo(): void {
		this.update({ undo: undefined });
	}

	dismissError(): void {
		this.update({ error: undefined });
	}

	dismissRemote(): void {
		this.update({ remote: undefined });
	}

	async retry(): Promise<void> {
		const retry = this.state.error?.retry;
		this.update({ error: undefined });
		await retry?.();
	}

	show(showing: 'live' | 'deleted'): void {
		this.update({ showing });
		void this.refresh();
	}

	setFilter(partial: Partial<TodoFilter>): void {
		this.view.set(partial);
	}

	private fail(command: string, result: CommandResult<unknown>, retry: () => Promise<void>): void {
		const error = result.error;
		this.update({
			error: {
				command,
				code: error?.code ?? 'UNKNOWN',
				message: error?.message ?? 'The command failed',
				...(error?.suggestion && { suggestion: error.suggestion }),
				...(error?.retryable !== false && { retry }),
			},
		});
	}

	// ─── Approvals ───────────────────────────────────────────────────────────────

	/**
	 * The server's question, from the client's elicitation handler: shown until the person
	 * answers, then answered with every yes-or-no field of the form set to their choice.
	 */
	private ask(request: ElicitationRequest): Promise<ElicitationResponse> {
		const fields = Object.entries(
			(request.requestedSchema.properties ?? {}) as Record<string, { type?: string }>
		)
			.filter(([, field]) => field.type === 'boolean')
			.map(([name]) => name);
		this.answer?.({ action: 'cancel' });
		return new Promise((resolve) => {
			this.answer = (response) => {
				this.answer = undefined;
				this.update({ approval: undefined });
				resolve(
					response.action === 'accept'
						? { action: 'accept', content: Object.fromEntries(fields.map((name) => [name, true])) }
						: response
				);
			};
			this.update({
				approval: {
					message: request.message,
					kind: fields.includes('approve') ? 'approval' : 'confirmation',
				},
			});
		});
	}

	approve(): void {
		this.answer?.({ action: 'accept' });
	}

	deny(): void {
		this.answer?.({ action: 'decline' });
	}

	// ─── The command log and the trust panel ─────────────────────────────────────

	private logCall(record: CallRecord): void {
		const log = [record, ...this.state.log.filter((entry) => entry.id !== record.id)].slice(
			0,
			LOG_LIMIT
		);
		const finished = record.result !== undefined;
		this.update({
			log,
			...(finished &&
				record.result &&
				!READS.has(record.command) && {
					trust: trustOf(record.command, record.result, record.durationMs),
				}),
		});
	}
}
