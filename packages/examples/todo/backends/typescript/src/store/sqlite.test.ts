/**
 * @fileoverview The SQLite store: persistence across instances, atomic moves between the live and
 * deleted tables, the history's order and limit, and the clears.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});
