/**
 * @fileoverview Undo, restore, history and the clear hold: what the scenarios in scenarios/
 * cannot assert (undoCommand, warnings, other actors).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandResult } from '@lushly-dev/afd-core';
import { fixedClock, seededRandom } from '@lushly-dev/afd-core';
import { createMcpServer } from '@lushly-dev/afd-server';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTodoServerOptions } from '../../server-options.js';
import { FileStore } from '../../store/file.js';
import { store } from '../../store/index.js';
import { HISTORY_LIMIT } from '../../store/memory.js';
import type { Todo } from '../../types.js';
import { getHistory } from '../history.js';
import type { RestoreResult } from '../restore.js';
import { stampFrom } from '../shared.js';

const server = createMcpServer(createTodoServerOptions({}));
const agent = { actor: { kind: 'agent' as const } };
const human = { actor: { kind: 'human' as const, id: 'jo' } };

async function run<T = Record<string, unknown>>(
	command: string,
	input: Record<string, unknown> = {},
	context: Record<string, unknown> = agent
): Promise<CommandResult<T>> {
	return (await server.execute(command, input, context)) as CommandResult<T>;
}

async function create(title: string): Promise<Todo> {
	const result = await run<Todo>('todo-create', { title });
	if (!result.success || !result.data) throw new Error(`create failed: ${result.error?.message}`);
	return result.data;
}

beforeEach(() => {
	store.clear();
});

describe('undo metadata', () => {
	it('names an undo that restores the state for each single change', async () => {
		const todo = await create('Weed the paths');
		const created = await run('todo-create', { title: 'Mend the gate' });
		expect(created.undoCommand).toBe('todo-delete');

		const toggled = await run('todo-toggle', { id: todo.id });
		expect(toggled.undoCommand).toBe('todo-update');
		expect(toggled.undoArgs).toEqual({ id: todo.id, completed: false });

		const updated = await run('todo-update', { id: todo.id, description: 'Both sides' });
		expect(updated.undoArgs).toEqual({ id: todo.id, description: '' });
		const undone = await run<Todo>('todo-update', updated.undoArgs);
		expect(undone.data?.description).toBeUndefined();

		const deleted = await run('todo-delete', { id: todo.id });
		expect(deleted.undoCommand).toBe('todo-restore');
		expect(deleted.undoArgs).toEqual({ ids: [todo.id] });
	});

	it('names the ids a batch actually changed', async () => {
		const first = await create('Sow carrots');
		const second = await create('Sow parsnips');
		await run('todo-toggle', { id: second.id });

		const set = await run('todo-toggle-batch', { ids: [first.id, second.id], completed: true });
		expect(set.undoArgs).toEqual({ ids: [first.id], completed: false });

		const deleted = await run('todo-delete-batch', { ids: [first.id, 'todo-missing'] });
		expect(deleted.undoCommand).toBe('todo-restore');
		expect(deleted.undoArgs).toEqual({ ids: [first.id] });
	});

	it('offers no single undo for a toggle of mixed states, and says so', async () => {
		const open = await create('Prick out the leeks');
		const done = await create('Order compost');
		await run('todo-toggle', { id: done.id });

		const toggled = await run('todo-toggle-batch', { ids: [open.id, done.id] });
		expect(toggled.undoCommand).toBeUndefined();
		expect(toggled.warnings?.map((warning) => warning.code)).toContain('NO_SINGLE_UNDO');
	});

	it('offers no undo when a set changed nothing', async () => {
		const todo = await create('Check the fleece');
		const result = await run('todo-toggle-batch', { ids: [todo.id], completed: false });
		expect(result.success).toBe(true);
		expect(result.undoCommand).toBeUndefined();
	});
});

describe('todo-restore and deleted todos', () => {
	it('keeps a deleted todo out of every live read and finds it in the deleted list', async () => {
		const todo = await create('Stake the dahlias');
		await run('todo-delete', { id: todo.id });

		expect((await run('todo-stats')).data).toMatchObject({ total: 0 });
		expect((await run('todo-list')).data).toMatchObject({ total: 0 });
		for (const command of ['todo-update', 'todo-toggle', 'todo-delete']) {
			const result = await run(command, { id: todo.id, title: 'x' });
			expect(result.error?.code, command).toBe('NOT_FOUND');
			expect(result.error?.suggestion, command).toContain('todo-list { deleted: true }');
		}
		const listed = await run<{ todos: Todo[] }>('todo-list', { deleted: true });
		expect(listed.data?.todos.map((t) => t.id)).toEqual([todo.id]);
		expect(listed.data?.todos[0]?.deletedAt).toBeDefined();
	});

	it('lists the most recently deleted first, and restores without deletedAt', async () => {
		const first = await create('Deleted first');
		const second = await create('Deleted second');
		await run(
			'todo-delete',
			{ id: first.id },
			{ ...agent, clock: fixedClock('2026-11-15T09:00:00Z') }
		);
		await run(
			'todo-delete',
			{ id: second.id },
			{ ...agent, clock: fixedClock('2026-11-15T10:00:00Z') }
		);

		const newest = await run<{ todos: Todo[] }>('todo-list', {
			deleted: true,
			sortBy: 'deletedAt',
			sortOrder: 'desc',
		});
		expect(newest.data?.todos.map((todo) => todo.id)).toEqual([second.id, first.id]);

		const restored = await run<RestoreResult>('todo-restore', { ids: [first.id] });
		expect(restored.data?.restored[0]).not.toHaveProperty('deletedAt');
		expect(store.get(first.id)).not.toHaveProperty('deletedAt');
	});

	it('reports a live id and an unknown id as failed, each with its way forward', async () => {
		const todo = await create('Net the currants');
		const result = await run<RestoreResult>('todo-restore', { ids: [todo.id, 'todo-unknown'] });

		expect(result.success).toBe(true);
		expect(result.data?.summary).toEqual({ total: 2, successCount: 0, failureCount: 2 });
		expect(result.data?.failed[0]?.error.suggestion).toContain('todo-get');
		expect(result.data?.failed[1]?.error.suggestion).toContain('todo-list { deleted: true }');
		expect(result.undoCommand).toBeUndefined();
	});
});

describe('todo-history', () => {
	it('records who made each change, when and its undo', async () => {
		const todo = await create('Turn the compost');
		await run('todo-toggle', { id: todo.id }, human);

		const history = await run<{ entries: Record<string, unknown>[] }>('todo-history');
		expect(history.data?.entries[0]).toMatchObject({
			command: 'todo-toggle',
			actor: { kind: 'human', id: 'jo' },
			ids: [todo.id],
			undoCommand: 'todo-update',
		});
		expect(history.data?.entries[1]).toMatchObject({
			command: 'todo-create',
			actor: { kind: 'agent' },
		});
	});

	it('withdraws an undo once a later change touches the same todo', async () => {
		const todo = await create('Paint the shed');
		await run('todo-update', { id: todo.id, title: 'Paint the shed green' });
		await run('todo-toggle', { id: todo.id });

		const history = await run<{ entries: Record<string, unknown>[] }>('todo-history', {
			todoId: todo.id,
		});
		const [toggle, update, created] = history.data?.entries ?? [];
		expect(toggle).toHaveProperty('undoCommand');
		expect(update).toMatchObject({ superseded: true });
		expect(update).not.toHaveProperty('undoArgs');
		expect(created).toMatchObject({ superseded: true });
	});

	it('states the history limit it keeps', () => {
		expect(getHistory.description).toContain(`latest ${HISTORY_LIMIT} changes`);
	});

	it('filters by actor and pages', async () => {
		await create('One');
		await run('todo-create', { title: 'Two' }, human);
		await create('Three');

		const byAgent = await run<{ entries: unknown[]; total: number }>('todo-history', {
			actor: 'agent',
		});
		expect(byAgent.data?.total).toBe(2);
		const page = await run<{ entries: unknown[]; hasMore: boolean }>('todo-history', {
			limit: 1,
			offset: 1,
		});
		expect(page.data?.entries).toHaveLength(1);
		expect(page.data?.hasMore).toBe(true);
	});

	it('records nothing for a held call', async () => {
		const todo = await create('Clear me');
		await run('todo-toggle', { id: todo.id });
		const held = await run('todo-clear');
		expect(held.error?.code).toBe('APPROVAL_REQUIRED');

		const history = await run<{ total: number }>('todo-history');
		expect(history.data?.total).toBe(2);
	});
});

describe('todo-clear', () => {
	it('holds any caller that is not a person, and says what would go', async () => {
		const todo = await create('Old todo');
		await run('todo-toggle', { id: todo.id });

		const held = await run('todo-clear', {});
		expect(held.error?.code).toBe('APPROVAL_REQUIRED');
		expect(held.error?.suggestion).toContain('Remove the completed todos for good (1 todo now)');
		expect((held.error?.details as { summary?: string } | undefined)?.summary).toBe(
			'Remove the completed todos for good (1 todo now)'
		);
		expect(store.get(todo.id)).toBeDefined();
	});

	it('runs for a person: completed, then deleted, then everything', async () => {
		const done = await create('Done');
		const gone = await create('Gone');
		await create('Open');
		await run('todo-toggle', { id: done.id });
		await run('todo-delete', { id: gone.id });

		const completed = await run('todo-clear', {}, human);
		expect(completed.data).toMatchObject({ cleared: 1, clearedIds: [done.id] });
		expect(store.getDeleted(gone.id)).toBeDefined();

		const deleted = await run('todo-clear', { deleted: true }, human);
		expect(deleted.data).toMatchObject({ cleared: 1, clearedIds: [gone.id], remaining: 1 });

		const all = await run('todo-clear', { all: true }, human);
		expect(all.data).toMatchObject({ cleared: 1, remaining: 0 });
	});

	it('holds nothing with APPROVALS=off', async () => {
		const open = createMcpServer(createTodoServerOptions({ APPROVALS: 'off' }));
		const result = await open.execute('todo-clear', { all: true }, agent);
		expect(result.success).toBe(true);
	});

	it('refuses an unknown APPROVALS value and a short secret', () => {
		expect(() => createTodoServerOptions({ APPROVALS: 'sometimes' })).toThrow('APPROVALS');
		expect(() => createTodoServerOptions({ TODO_APPROVAL_SECRET: 'short' })).toThrow('32 bytes');
	});
});

describe('the stamp and the file store', () => {
	it('takes ids and times from the command context', () => {
		const context = { clock: fixedClock('2026-11-15T09:00:00Z'), random: seededRandom('a') };
		const first = stampFrom(context);
		const again = stampFrom({
			clock: fixedClock('2026-11-15T09:00:00Z'),
			random: seededRandom('a'),
		});
		expect(first.now).toBe('2026-11-15T09:00:00.000Z');
		expect(first.newId()).toBe(again.newId());
	});

	it('keeps a todo found in both files live (a crash between writes)', () => {
		const dir = mkdtempSync(join(tmpdir(), 'todo-both-'));
		try {
			const path = join(dir, 'todos.json');
			const files = new FileStore(path);
			const todo = files.create({ title: 'In both' });
			writeFileSync(
				files.deletedPath,
				JSON.stringify([{ ...todo, deletedAt: '2026-11-15T09:00:00.000Z' }])
			);

			const reopened = new FileStore(path);
			expect(reopened.get(todo.id)?.title).toBe('In both');
			expect(reopened.getDeleted(todo.id)).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('keeps deleted todos and the history across instances', () => {
		const dir = mkdtempSync(join(tmpdir(), 'todo-undo-'));
		try {
			const path = join(dir, 'todos.json');
			const first = new FileStore(path);
			const todo = first.create({ title: 'Persist me' });
			first.delete(todo.id);
			first.record({
				at: '2026-11-15T09:00:00.000Z',
				actor: { kind: 'test' },
				command: 'todo-delete',
				ids: [todo.id],
			});

			const reopened = new FileStore(path);
			expect(reopened.get(todo.id)).toBeUndefined();
			expect(reopened.getDeleted(todo.id)?.title).toBe('Persist me');
			expect(reopened.history()).toHaveLength(1);
			expect(reopened.restore(todo.id)?.title).toBe('Persist me');
			expect(new FileStore(path).get(todo.id)).toBeDefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
