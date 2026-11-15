/**
 * @fileoverview SQLite todo store on `@lushly-dev/local-db`'s adapter (`node:sqlite`)
 *
 * Three tables in one database file: `todos` (live), `deleted_todos` (what todo-restore brings
 * back) and `changes` (the history todo-history reads). Every change runs through the adapter's
 * `batch`, one transaction, so moving a todo between the live and deleted tables is all or
 * nothing, which the JSON file store cannot promise. Several processes can share the file.
 *
 * The filtering, sorting, paging and undo rules are the in-memory store's (`memory.ts`): a read
 * loads the table into a `TodoStore` and asks it, and a change computes the new record with one.
 *
 * Environment: `TODO_STORE_TYPE=sqlite`, `TODO_STORE_PATH` (default `data/todos.db`).
 */

import type { BatchOperation } from '@lushly-dev/local-db';
import { createSqliteAdapter, type SqliteAdapter } from '@lushly-dev/local-db/sqlite';
import type { ChangeEntry, Priority, Stamp, Todo, TodoFilter, TodoStats } from '../types.js';
import { HISTORY_LIMIT, systemStamp, TodoStore } from './memory.js';

const TODOS = 'todos';
const DELETED = 'deleted_todos';
const CHANGES = 'changes';

type Editable = Parameters<TodoStore['update']>[1];

/** A record path for `batch`. */
const at = (table: string, id: string) => `/${table}/${encodeURIComponent(id)}`;

/** A change's record id: its sequence number, zero-padded so ids sort as numbers do. */
const changeId = (seq: number) => String(seq).padStart(12, '0');

/**
 * SQLite todo store. Every method is asynchronous; callers `await` it as they do the others.
 */
export class SqliteStore {
	readonly db: SqliteAdapter;

	constructor(readonly path: string) {
		this.db = createSqliteAdapter({ path });
	}

	private async rows(table: string): Promise<Todo[]> {
		return (await this.db.list<Todo>(table)).data;
	}

	/** One table as an in-memory store, to reuse its filtering, sorting and statistics. */
	private async snapshot(tables: { todos?: boolean; deleted?: boolean }): Promise<TodoStore> {
		const byId = (todos: Todo[]) => new Map(todos.map((todo) => [todo.id, todo]));
		return new TodoStore({
			todos: tables.todos ? byId(await this.rows(TODOS)) : new Map(),
			deleted: tables.deleted ? byId(await this.rows(DELETED)) : new Map(),
		});
	}

	private async run(operations: BatchOperation[]): Promise<void> {
		if (operations.length === 0) return;
		const result = await this.db.batch(operations);
		const failed = result.results.find((entry) => entry.status >= 400);
		if (failed) {
			throw new Error(`SQLite store batch failed (${failed.status}): ${failed.error ?? ''}`);
		}
	}

	async create(
		data: { title: string; description?: string; priority?: Priority },
		stamp: Stamp = systemStamp()
	): Promise<Todo> {
		const todo = new TodoStore().create(data, stamp);
		await this.db.create(TODOS, todo);
		return todo;
	}

	async get(id: string): Promise<Todo | undefined> {
		return (await this.db.get<Todo>(TODOS, id)) ?? undefined;
	}

	async getDeleted(id: string): Promise<Todo | undefined> {
		return (await this.db.get<Todo>(DELETED, id)) ?? undefined;
	}

	async list(filter: TodoFilter = {}): Promise<Todo[]> {
		const store = await this.snapshot(filter.deleted ? { deleted: true } : { todos: true });
		return store.list(filter);
	}

	/** Apply one in-memory change to a live todo and write the whole record back. */
	private async change(
		id: string,
		apply: (store: TodoStore) => Todo | undefined
	): Promise<Todo | undefined> {
		const current = await this.get(id);
		if (!current) return undefined;
		const updated = apply(new TodoStore({ todos: new Map([[id, current]]) }));
		// A create replaces the stored record, so a field the change removed is removed
		if (updated) await this.run([{ method: 'POST', path: `/${TODOS}`, body: updated }]);
		return updated;
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
		await this.run([
			{ method: 'DELETE', path: at(TODOS, id) },
			{ method: 'POST', path: `/${DELETED}`, body: deleted },
		]);
		return deleted;
	}

	async restore(id: string): Promise<Todo | undefined> {
		const deleted = await this.getDeleted(id);
		if (!deleted) return undefined;
		const { deletedAt: _deletedAt, ...todo } = deleted;
		await this.run([
			{ method: 'DELETE', path: at(DELETED, id) },
			{ method: 'POST', path: `/${TODOS}`, body: todo },
		]);
		return todo;
	}

	private async removeAll(table: string, ids: string[]): Promise<void> {
		await this.run(ids.map((id) => ({ method: 'DELETE' as const, path: at(table, id) })));
	}

	async clearCompleted(): Promise<{ clearedIds: string[]; remaining: number }> {
		const live = await this.rows(TODOS);
		const clearedIds = live.filter((todo) => todo.completed).map((todo) => todo.id);
		await this.removeAll(TODOS, clearedIds);
		return { clearedIds, remaining: live.length - clearedIds.length };
	}

	async clearDeleted(): Promise<{ clearedIds: string[]; remaining: number }> {
		const clearedIds = (await this.rows(DELETED)).map((todo) => todo.id);
		await this.removeAll(DELETED, clearedIds);
		return { clearedIds, remaining: (await this.rows(TODOS)).length };
	}

	async clearAll(): Promise<{ clearedIds: string[]; remaining: number }> {
		const live = (await this.rows(TODOS)).map((todo) => todo.id);
		const deleted = (await this.rows(DELETED)).map((todo) => todo.id);
		await this.run([
			...live.map((id) => ({ method: 'DELETE' as const, path: at(TODOS, id) })),
			...deleted.map((id) => ({ method: 'DELETE' as const, path: at(DELETED, id) })),
		]);
		return { clearedIds: [...live, ...deleted], remaining: 0 };
	}

	async getStats(): Promise<TodoStats> {
		return (await this.snapshot({ todos: true })).getStats();
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
		await this.removeAll(CHANGES, changes);
	}

	async count(): Promise<number> {
		return (await this.db.list(TODOS, { limit: 0 })).total;
	}

	/** Close the database. */
	close(): void {
		this.db.close?.();
	}
}
