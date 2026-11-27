/**
 * @fileoverview The SQLite store: persistence across instances, atomic moves between the live and
 * deleted tables, the history's order and limit, and the clears.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpServer } from '@lushly-dev/afd-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTodoServerOptions } from '../server-options.js';
import { DEFAULT_SEED_PATH } from './file.js';
import { createStore, DEFAULT_SQLITE_PATH, setStore } from './index.js';
import { TodoStore } from './memory.js';
import { SqliteStore } from './sqlite.js';

let dir: string;
const open: SqliteStore[] = [];

function store(): SqliteStore {
	const created = new SqliteStore(join(dir, 'todos.db'));
	open.push(created);
	return created;
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'todo-sqlite-'));
});

afterEach(() => {
	// A test that pins the clock restores it here too, even when it timed out mid-run.
	vi.restoreAllMocks();
	for (const each of open.splice(0)) each.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('SqliteStore', () => {
	it('keeps todos, deleted todos and the history across instances', async () => {
		const first = store();
		const kept = await first.create({ title: 'Kept' });
		const gone = await first.create({ title: 'Gone' });
		await first.delete(gone.id, '2026-11-15T09:00:00.000Z');
		await first.record({
			at: '2026-11-15T09:00:00.000Z',
			actor: { kind: 'test' },
			command: 'todo-delete',
			ids: [gone.id],
		});

		const second = store();
		expect((await second.get(kept.id))?.title).toBe('Kept');
		expect(await second.get(gone.id)).toBeUndefined();
		expect((await second.getDeleted(gone.id))?.deletedAt).toBe('2026-11-15T09:00:00.000Z');
		expect(await second.history()).toHaveLength(1);
	});

	it('moves a todo to the deleted table and back as it was', async () => {
		const db = store();
		const todo = await db.create({
			title: 'Round trip',
			description: 'With a note',
			priority: 'high',
		});
		await db.delete(todo.id);
		expect(await db.count()).toBe(0);
		expect(await db.list({ deleted: true })).toHaveLength(1);

		const restored = await db.restore(todo.id);
		expect(restored).toEqual(todo);
		expect(await db.get(todo.id)).toEqual(todo);
		expect(await db.list({ deleted: true })).toHaveLength(0);
	});

	it('removes a field an update clears', async () => {
		const db = store();
		const todo = await db.create({ title: 'Notes', description: 'Remove me' });
		await db.update(todo.id, { description: '' });
		await db.toggle(todo.id);
		await db.toggle(todo.id);
		const read = await db.get(todo.id);
		expect(read).not.toHaveProperty('description');
		expect(read).not.toHaveProperty('completedAt');
	});

	it('filters, sorts and counts as the in-memory store does', async () => {
		const db = store();
		await db.create({ title: 'Low one', priority: 'low' });
		const high = await db.create({ title: 'High one', priority: 'high' });
		await db.toggle(high.id);
		expect((await db.list({ priority: 'high' })).map((todo) => todo.id)).toEqual([high.id]);
		expect(
			(await db.list({ sortBy: 'title', sortOrder: 'asc' })).map((todo) => todo.title)
		).toEqual(['High one', 'Low one']);
		expect(await db.getStats()).toMatchObject({ total: 2, completed: 1, pending: 1 });
	});

	it('clears completed, then deleted, then everything', async () => {
		const db = store();
		const done = await db.create({ title: 'Done' });
		const gone = await db.create({ title: 'Gone' });
		await db.create({ title: 'Open' });
		await db.toggle(done.id);
		await db.delete(gone.id);

		expect(await db.clearCompleted()).toEqual({ clearedIds: [done.id], remaining: 1 });
		expect(await db.clearDeleted()).toEqual({ clearedIds: [gone.id], remaining: 1 });
		expect((await db.clearAll()).remaining).toBe(0);
		expect(await db.count()).toBe(0);
	});

	it('numbers changes in order, oldest first', async () => {
		const db = store();
		for (const command of ['todo-create', 'todo-toggle', 'todo-delete']) {
			await db.record({
				at: '2026-11-15T09:00:00.000Z',
				actor: { kind: 'agent' },
				command,
				ids: ['todo-1'],
			});
		}
		expect((await db.history()).map((entry) => [entry.seq, entry.command])).toEqual([
			[1, 'todo-create'],
			[2, 'todo-toggle'],
			[3, 'todo-delete'],
		]);
	});

	it('reads ties back in the order the in-memory store does', async () => {
		const db = store();
		const memory = new TodoStore();
		const stamp = { now: '2026-11-15T09:00:00.000Z', newId: () => '' };
		for (const id of ['zzz', 'aaa', 'mmm']) {
			const fixed = { ...stamp, newId: () => id };
			memory.create({ title: id }, fixed);
			await db.create({ title: id }, fixed);
		}
		const ids = (todos: { id: string }[]) => todos.map((todo) => todo.id);
		expect(ids(await db.list())).toEqual(ids(memory.list()));
		expect(ids(await db.list({ sortOrder: 'asc' }))).toEqual(
			ids(memory.list({ sortOrder: 'asc' }))
		);
	});

	it('treats an id the database cannot hold as missing', async () => {
		const db = store();
		for (const id of ['.', '..']) {
			expect(await db.get(id)).toBeUndefined();
			expect(await db.delete(id)).toBeUndefined();
			expect(await db.restore(id)).toBeUndefined();
			expect(await db.update(id, { title: 'x' })).toBeUndefined();
		}
	});

	it('does not bring back a todo another process removed meanwhile', async () => {
		const mine = store();
		const theirs = store();
		const todo = await mine.create({ title: 'Raced' });
		await mine.delete(todo.id);
		// Another process empties the deleted todos between this one's read and its write
		const read = await mine.getDeleted(todo.id);
		expect(read).toBeDefined();
		await theirs.clearDeleted();
		expect(await mine.restore(todo.id)).toBeUndefined();
		expect(await mine.get(todo.id)).toBeUndefined();
	});

	it("shows the counts in a held clear's summary", async () => {
		const db = store();
		setStore(db);
		try {
			const server = createMcpServer(createTodoServerOptions({}));
			const agent = { actor: { kind: 'agent' as const } };
			const created = await server.execute('todo-create', { title: 'Done' }, agent);
			await server.execute('todo-toggle', { id: (created.data as { id: string }).id }, agent);
			const held = await server.execute('todo-clear', {}, agent);
			expect((held.error?.details as { summary?: string } | undefined)?.summary).toBe(
				'Remove the completed todos for good (1 todo now)'
			);
		} finally {
			setStore(new TodoStore());
		}
	});

	it('fails its startup check on a path that cannot hold a database', async () => {
		const notADirectory = join(dir, 'file');
		writeFileSync(notADirectory, 'x');
		expect(() => new SqliteStore(join(notADirectory, 'todos.db'))).toThrow();
	});

	// A row's order is the clock's millisecond times 1000, plus one for each write after the first in
	// that millisecond. The clock is pinned so more than a thousand writes land in one millisecond and
	// run past the next millisecond's first order; then it moves on by one millisecond, whose writes
	// must still come after them. The ids sort in reverse of the writes, so equal orders would come
	// back by id and fail the comparison. The first 1,002 rows go in through the seed, one synced
	// commit, and the rest through `create`, one commit each, so the test makes ten disk syncs, not a
	// thousand (#2799).
	it('keeps order past a thousand writes in one millisecond', async () => {
		const pinned = Date.parse('2026-11-15T09:00:00.000Z');
		let clock = pinned;
		vi.spyOn(Date, 'now').mockImplementation(() => clock);
		const memory = new TodoStore();
		const stamp = { now: '2026-11-15T09:00:00.000Z', newId: () => '' };
		const at = (index: number) => ({
			...stamp,
			newId: () => `todo-${String(9999 - index).padStart(5, '0')}`,
		});
		const seedPath = join(dir, 'seed.json');
		const seed = Array.from({ length: 1002 }, (_, index) =>
			memory.create({ title: `Todo ${index}` }, at(index))
		);
		writeFileSync(seedPath, JSON.stringify(seed));
		const db = new SqliteStore(join(dir, 'todos.db'), { seedPath });
		open.push(db);
		await db.check();
		const write = async (index: number) => {
			memory.create({ title: `Todo ${index}` }, at(index));
			await db.create({ title: `Todo ${index}` }, at(index));
		};
		for (let index = 1002; index < 1005; index++) await write(index);
		clock = pinned + 1;
		for (let index = 1005; index < 1010; index++) await write(index);
		const ids = (todos: { id: string }[]) => todos.map((todo) => todo.id);
		expect(ids(await db.list({ sortOrder: 'asc' }))).toEqual(
			ids(memory.list({ sortOrder: 'asc' }))
		);
	});

	it('skips a todo another process removed while clearing, and clears the rest', async () => {
		const mine = store();
		const theirs = store();
		const first = await mine.create({ title: 'First' });
		const second = await mine.create({ title: 'Second' });
		await mine.toggle(first.id);
		await mine.toggle(second.id);
		// Another process deletes the second completed todo just before this clear writes
		const realRun = (mine as unknown as { run: (ops: unknown[]) => Promise<string> }).run.bind(
			mine
		);
		let raced = false;
		(mine as unknown as { run: (ops: unknown[]) => Promise<string> }).run = async (ops) => {
			if (!raced && ops.length > 2) {
				raced = true;
				await theirs.delete(second.id);
			}
			return realRun(ops);
		};
		const result = await mine.clearCompleted();
		expect(result.clearedIds).toEqual([first.id]);
		expect(await mine.getDeleted(second.id)).toBeDefined();
	});

	it('seeds a database it creates, and only that one', async () => {
		const path = join(dir, 'seeded.db');
		const seed = JSON.parse(readFileSync(DEFAULT_SEED_PATH, 'utf-8'));
		const seeded = new SqliteStore(path, { seedPath: DEFAULT_SEED_PATH });
		open.push(seeded);
		await seeded.check();
		expect(await seeded.list({ sortOrder: 'asc' })).toEqual(seed);

		await seeded.clearAll();
		const reopened = new SqliteStore(path, { seedPath: DEFAULT_SEED_PATH });
		open.push(reopened);
		await reopened.check();
		expect(await reopened.count()).toBe(0);
	});
});

describe('createStore', () => {
	it('defaults to the SQLite database the Python backend also opens', () => {
		const existed = existsSync(DEFAULT_SQLITE_PATH);
		const chosen = createStore({});
		try {
			expect(chosen).toBeInstanceOf(SqliteStore);
			expect((chosen as SqliteStore).path).toBe(DEFAULT_SQLITE_PATH);
			expect(DEFAULT_SQLITE_PATH.endsWith(join('todo', 'data', 'todos.db'))).toBe(true);
			// Choosing the store opens nothing: no file appears until it is used
			expect(existsSync(DEFAULT_SQLITE_PATH)).toBe(existed);
		} finally {
			(chosen as SqliteStore).close();
		}
	});

	it('still offers the file and memory stores', () => {
		expect(createStore({ TODO_STORE_TYPE: 'memory' })).toBeInstanceOf(TodoStore);
		const file = createStore({ TODO_STORE_TYPE: 'file', TODO_STORE_PATH: join(dir, 'todos.json') });
		expect(file.constructor.name).toBe('FileStore');
		expect(() => createStore({ TODO_STORE_TYPE: 'postgres' })).toThrow(
			'TODO_STORE_TYPE must be memory, file or sqlite'
		);
	});
});
