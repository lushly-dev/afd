/**
 * @fileoverview SQLite todo store on `@lushly-dev/local-db`'s adapter (`node:sqlite`)
 *
 * Three tables in one database file: `todos` (live), `deleted_todos` (what todo-restore brings
 * back) and `changes` (the history todo-history reads). Several processes can share the file.
 *
 * Each write is one adapter `batch`, one transaction, so a delete or restore moves its todo
 * between the live and deleted tables all or nothing. A write that changes an existing todo starts
 * by touching that row (`PATCH` with no fields), which fails if another process removed it since
 * it was read, and rolls the whole batch back; the store then answers as if the todo were missing.
 * The history entry for a change is written afterwards, in its own transaction.
 *
 * The filtering, sorting, paging and undo rules are the in-memory store's (`memory.ts`): a read
 * loads the table into a `TodoStore` and asks it, and a change computes the new record with one.
 * Each row keeps a hidden `_order`, so a table reads back in the order its todos entered it, as
 * the in-memory store's Map does, and ties in a sort come out the same in every store.
 *
 * Environment: `TODO_STORE_TYPE=sqlite`, `TODO_STORE_PATH` (default `data/todos.db`).
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BatchOperation } from '@lushly-dev/local-db';
import { createSqliteAdapter, type SqliteAdapter } from '@lushly-dev/local-db/sqlite';
import type { ChangeEntry, Priority, Stamp, Todo, TodoFilter, TodoStats } from '../types.js';
import { HISTORY_LIMIT, systemStamp, TodoStore } from './memory.js';

const TODOS = 'todos';
const DELETED = 'deleted_todos';
const CHANGES = 'changes';

type Editable = Parameters<TodoStore['update']>[1];

/** A todo as stored: with the order it entered its table. */
type Row = Todo & { _order: number };

/** A record path for `batch`. */
const at = (table: string, id: string) => `/${table}/${encodeURIComponent(id)}`;

/** A change's record id: its sequence number, zero-padded so ids sort as numbers do. */
const changeId = (seq: number) => String(seq).padStart(12, '0');

/** Whether the adapter can store a record under this id ("", "." and ".." it refuses). */
const storable = (id: string) => id !== '' && id !== '.' && id !== '..';

/** The todo without the store's bookkeeping. */
function todoOf(row: Row): Todo {
	const { _order: _ignored, ...todo } = row;
	return todo;
}

/** A batch's outcome: whether it ran, or a guarded row was gone. */
type Outcome = 'done' | 'missing';

/**
 * SQLite todo store. Every method is asynchronous; callers `await` it as they do the others.
 */
export class SqliteStore {
	readonly db: SqliteAdapter;
	private orderCounter = 0;

	constructor(readonly path: string) {
		mkdirSync(dirname(path), { recursive: true });
		this.db = createSqliteAdapter({ path });
	}

	/**
	 * Open the database now, so a path that cannot hold one fails at startup rather than on the
	 * first command, as the file store does.
	 */
	async check(): Promise<void> {
		const health = await this.db.health();
		if (health.status !== 'ok') {
			throw new Error(`SQLite store ${this.path} is not usable: ${JSON.stringify(health)}`);
		}
	}

	/** A position after every row written so far in this process (time first, then a counter). */
	private nextOrder(): number {
		this.orderCounter = (this.orderCounter + 1) % 1000;
		return Date.now() * 1000 + this.orderCounter;
	}

	private async rows(table: string): Promise<Row[]> {
		const rows = (await this.db.list<Row>(table)).data;
		return rows.sort((a, b) => (a._order ?? 0) - (b._order ?? 0));
	}

	private async row(table: string, id: string): Promise<Row | undefined> {
		if (!storable(id)) return undefined;
		return (await this.db.get<Row>(table, id)) ?? undefined;
	}

	/**
	 * The tables as an in-memory store, to reuse its filtering, sorting and statistics. A todo in
	 * both tables (only after another process's race) counts as live.
	 */
	private async snapshot(): Promise<TodoStore> {
		const live = await this.rows(TODOS);
		const liveIds = new Set(live.map((row) => row.id));
		const deleted = (await this.rows(DELETED)).filter((row) => !liveIds.has(row.id));
		const byId = (rows: Row[]) => new Map(rows.map((row) => [row.id, todoOf(row)]));
		return new TodoStore({ todos: byId(live), deleted: byId(deleted) });
	}

	/** Run one transaction. A failed guard (`PATCH` of a missing row) reports `missing`. */
	private async run(operations: BatchOperation[]): Promise<Outcome> {
		if (operations.length === 0) return 'done';
		const result = await this.db.batch(operations);
		const failedAt = result.results.findIndex((entry) => entry.status >= 400);
		if (failedAt < 0) return 'done';
		const failed = result.results[failedAt];
		if (failed?.status === 404 && operations[failedAt]?.method === 'PATCH') return 'missing';
		throw new Error(`SQLite store batch failed (${failed?.status}): ${failed?.error ?? ''}`);
	}

	/** Fail the batch, rolled back, if another process removed this row since it was read. */
	private guard(table: string, id: string): BatchOperation {
		return { method: 'PATCH', path: at(table, id), body: {} };
	}

	async create(
		data: { title: string; description?: string; priority?: Priority },
		stamp: Stamp = systemStamp()
	): Promise<Todo> {
		const todo = new TodoStore().create(data, stamp);
		await this.run([
			{ method: 'POST', path: `/${TODOS}`, body: { ...todo, _order: this.nextOrder() } },
		]);
		return todo;
	}

	async get(id: string): Promise<Todo | undefined> {
		const row = await this.row(TODOS, id);
		return row && todoOf(row);
	}

	async getDeleted(id: string): Promise<Todo | undefined> {
		const row = await this.row(DELETED, id);
		return row && todoOf(row);
	}

	async list(filter: TodoFilter = {}): Promise<Todo[]> {
		return (await this.snapshot()).list(filter);
	}

	/** Apply one in-memory change to a live todo and write the whole record back. */
	private async change(
		id: string,
		apply: (store: TodoStore) => Todo | undefined
	): Promise<Todo | undefined> {
		const current = await this.row(TODOS, id);
		if (!current) return undefined;
		const updated = apply(new TodoStore({ todos: new Map([[id, todoOf(current)]]) }));
		if (!updated) return undefined;
		// A POST replaces the stored record, so a field the change removed is removed
		const outcome = await this.run([
			this.guard(TODOS, id),
			{ method: 'POST', path: `/${TODOS}`, body: { ...updated, _order: current._order } },
		]);
		return outcome === 'done' ? updated : undefined;
	}

	async update(id: string, data: Editable, now: string = systemStamp().now) {
		return this.change(id, (store) => store.update(id, data, now));
	}

	async toggle(id: string, now: string = systemStamp().now) {
		return this.change(id, (store) => store.toggle(id, now));
	}

	async delete(id: string, now: string = systemStamp().now): Promise<Todo | undefined> {
		const current = await this.get(id);
		if (!current) return undefined;
		const deleted: Todo = { ...current, deletedAt: now };
		const outcome = await this.run([
			this.guard(TODOS, id),
			{ method: 'DELETE', path: at(TODOS, id) },
			{ method: 'POST', path: `/${DELETED}`, body: { ...deleted, _order: this.nextOrder() } },
		]);
		return outcome === 'done' ? deleted : undefined;
	}

	async restore(id: string): Promise<Todo | undefined> {
		const deleted = await this.getDeleted(id);
		if (!deleted) return undefined;
		const { deletedAt: _deletedAt, ...todo } = deleted;
		const outcome = await this.run([
			this.guard(DELETED, id),
			{ method: 'DELETE', path: at(DELETED, id) },
			{ method: 'POST', path: `/${TODOS}`, body: { ...todo, _order: this.nextOrder() } },
		]);
		return outcome === 'done' ? todo : undefined;
	}

	/** Remove the listed rows, each guarded, so a row another process removed first is skipped. */
	private async removeEach(table: string, ids: string[]): Promise<string[]> {
		const removed: string[] = [];
		for (const id of ids) {
			const outcome = await this.run([
				this.guard(table, id),
				{ method: 'DELETE', path: at(table, id) },
			]);
			if (outcome === 'done') removed.push(id);
		}
		return removed;
	}

	async clearCompleted(): Promise<{ clearedIds: string[]; remaining: number }> {
		const completed = (await this.rows(TODOS)).filter((row) => row.completed).map((row) => row.id);
		// One transaction for the lot: re-read inside would need SQL, so remove what was read
		const outcome = await this.run(
			completed.flatMap((id) => [
				this.guard(TODOS, id),
				{ method: 'DELETE' as const, path: at(TODOS, id) },
			])
		);
		const clearedIds = outcome === 'done' ? completed : await this.removeEach(TODOS, completed);
		return { clearedIds, remaining: await this.count() };
	}

	async clearDeleted(): Promise<{ clearedIds: string[]; remaining: number }> {
		const ids = (await this.rows(DELETED)).map((row) => row.id);
		const outcome = await this.run(
			ids.flatMap((id) => [
				this.guard(DELETED, id),
				{ method: 'DELETE' as const, path: at(DELETED, id) },
			])
		);
		const clearedIds = outcome === 'done' ? ids : await this.removeEach(DELETED, ids);
		return { clearedIds, remaining: await this.count() };
	}

	async clearAll(): Promise<{ clearedIds: string[]; remaining: number }> {
		const live = (await this.rows(TODOS)).map((row) => row.id);
		const deleted = (await this.rows(DELETED)).map((row) => row.id);
		await this.run([
			...live.map((id) => ({ method: 'DELETE' as const, path: at(TODOS, id) })),
			...deleted.map((id) => ({ method: 'DELETE' as const, path: at(DELETED, id) })),
		]);
		return { clearedIds: [...live, ...deleted], remaining: await this.count() };
	}

	async getStats(): Promise<TodoStats> {
		return (await this.snapshot()).getStats();
	}

	/**
	 * Add a change, keeping the latest {@link HISTORY_LIMIT}. The next `seq` is read from the
	 * table before the write, so two processes writing at the same moment can take the same one;
	 * the later write then replaces the earlier entry.
	 */
	async record(change: Omit<ChangeEntry, 'seq'>): Promise<ChangeEntry> {
		const latest = await this.db.list<ChangeEntry>(CHANGES, {
			sort: 'seq',
			order: 'desc',
			limit: 1,
		});
		const seq = (latest.data[0]?.seq ?? 0) + 1;
		const entry: ChangeEntry = { seq, ...change };
		const stale = seq - HISTORY_LIMIT;
		await this.run([
			{ method: 'POST', path: `/${CHANGES}`, body: { ...entry, id: changeId(seq) } },
			...(stale > 0 ? [{ method: 'DELETE' as const, path: at(CHANGES, changeId(stale)) }] : []),
		]);
		return entry;
	}

	async history(): Promise<ChangeEntry[]> {
		const rows = (await this.db.list<ChangeEntry & { id: string }>(CHANGES, { sort: 'seq' })).data;
		return rows.map(({ id: _id, ...entry }) => entry);
	}

	/** Remove everything: live and deleted todos and the history (for tests). */
	async clear(): Promise<void> {
		await this.clearAll();
		const changes = (await this.db.list<{ id: string }>(CHANGES)).data.map((row) => row.id);
		await this.run(changes.map((id) => ({ method: 'DELETE' as const, path: at(CHANGES, id) })));
	}

	async count(): Promise<number> {
		return (await this.db.list(TODOS, { limit: 0 })).total;
	}

	/** Close the database. */
	close(): void {
		this.db.close();
	}
}
