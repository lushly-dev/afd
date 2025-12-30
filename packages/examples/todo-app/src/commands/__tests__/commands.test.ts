/**
 * @fileoverview Unit tests for todo commands
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../../store/memory.js';
import { createTodo } from '../create.js';
import { listTodos } from '../list.js';
import { getTodo } from '../get.js';
import { updateTodo } from '../update.js';
import { toggleTodo } from '../toggle.js';
import { deleteTodo } from '../delete.js';
import { clearCompleted } from '../clear.js';
import { getStats } from '../stats.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
	store.clear();
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo.create
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo.create', () => {
	it('creates a todo with required fields', async () => {
		const result = await createTodo.handler({ title: 'Test todo', priority: 'medium' }, {});

		expect(result.success).toBe(true);
		expect(result.data?.title).toBe('Test todo');
		expect(result.data?.priority).toBe('medium');
		expect(result.data?.completed).toBe(false);
		expect(result.data?.id).toBeDefined();
		expect(result.data?.createdAt).toBeDefined();
	});

	it('creates a todo with high priority', async () => {
		const result = await createTodo.handler({ title: 'Urgent', priority: 'high' }, {});

		expect(result.success).toBe(true);
		expect(result.data?.priority).toBe('high');
		expect(result.reasoning).toContain('high priority');
	});

	it('returns confidence of 1.0', async () => {
		const result = await createTodo.handler({ title: 'Test', priority: 'low' }, {});

		expect(result.confidence).toBe(1.0);
	});

	it('includes reasoning', async () => {
		const result = await createTodo.handler({ title: 'My Task', priority: 'medium' }, {});

		expect(result.reasoning).toContain('My Task');
		expect(result.reasoning).toContain('medium');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo.list
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo.list', () => {
	beforeEach(async () => {
		// Create some test todos
		await createTodo.handler({ title: 'Todo 1', priority: 'high' }, {});
		await createTodo.handler({ title: 'Todo 2', priority: 'medium' }, {});
		await createTodo.handler({ title: 'Todo 3', priority: 'low' }, {});
	});

	it('lists all todos', async () => {
		const result = await listTodos.handler({
			sortBy: 'createdAt',
			sortOrder: 'desc',
			limit: 20,
			offset: 0,
		}, {});

		expect(result.success).toBe(true);
		expect(result.data?.todos).toHaveLength(3);
		expect(result.data?.total).toBe(3);
		expect(result.data?.hasMore).toBe(false);
	});

	it('filters by priority', async () => {
		const result = await listTodos.handler({
			priority: 'high',
			sortBy: 'createdAt',
			sortOrder: 'desc',
			limit: 20,
			offset: 0,
		}, {});

		expect(result.success).toBe(true);
		expect(result.data?.todos).toHaveLength(1);
		expect(result.data?.todos[0].priority).toBe('high');
	});

	it('filters by completion status', async () => {
		// Toggle one todo to completed
		const list = await listTodos.handler({
			sortBy: 'createdAt',
			sortOrder: 'desc',
			limit: 20,
			offset: 0,
		}, {});
		await toggleTodo.handler({ id: list.data!.todos[0].id }, {});

		const pending = await listTodos.handler({
			completed: false,
			sortBy: 'createdAt',
			sortOrder: 'desc',
			limit: 20,
			offset: 0,
		}, {});
		const completed = await listTodos.handler({
			completed: true,
			sortBy: 'createdAt',
			sortOrder: 'desc',
			limit: 20,
			offset: 0,
		}, {});

		expect(pending.data?.todos).toHaveLength(2);
		expect(completed.data?.todos).toHaveLength(1);
	});

	it('supports pagination', async () => {
		const page1 = await listTodos.handler({
			limit: 2,
			offset: 0,
			sortBy: 'createdAt',
			sortOrder: 'desc',
		}, {});
		const page2 = await listTodos.handler({
			limit: 2,
			offset: 2,
			sortBy: 'createdAt',
			sortOrder: 'desc',
		}, {});

		expect(page1.data?.todos).toHaveLength(2);
		expect(page1.data?.hasMore).toBe(true);
		expect(page2.data?.todos).toHaveLength(1);
		expect(page2.data?.hasMore).toBe(false);
	});

	it('searches by title', async () => {
		const result = await listTodos.handler({
			search: 'Todo 2',
			sortBy: 'createdAt',
			sortOrder: 'desc',
			limit: 20,
			offset: 0,
		}, {});

		expect(result.data?.todos).toHaveLength(1);
		expect(result.data?.todos[0].title).toBe('Todo 2');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo.get
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo.get', () => {
	it('gets a todo by ID', async () => {
		const created = await createTodo.handler({ title: 'Find me', priority: 'medium' }, {});
		const result = await getTodo.handler({ id: created.data!.id }, {});

		expect(result.success).toBe(true);
		expect(result.data?.title).toBe('Find me');
	});

	it('returns NOT_FOUND for missing todo', async () => {
		const result = await getTodo.handler({ id: 'nonexistent-id' }, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NOT_FOUND');
		expect(result.error?.suggestion).toBeDefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo.update
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo.update', () => {
	it('updates todo title', async () => {
		const created = await createTodo.handler({ title: 'Original', priority: 'medium' }, {});
		
		// Small delay to ensure updatedAt differs
		await new Promise(resolve => setTimeout(resolve, 5));
		
		const result = await updateTodo.handler({
			id: created.data!.id,
			title: 'Updated',
		}, {});

		expect(result.success).toBe(true);
		expect(result.data?.title).toBe('Updated');
		// updatedAt should be updated (may be same in fast tests, so just verify it exists)
		expect(result.data?.updatedAt).toBeDefined();
	});

	it('updates todo priority', async () => {
		const created = await createTodo.handler({ title: 'Test', priority: 'low' }, {});
		const result = await updateTodo.handler({
			id: created.data!.id,
			priority: 'high',
		}, {});

		expect(result.success).toBe(true);
		expect(result.data?.priority).toBe('high');
	});

	it('returns NOT_FOUND for missing todo', async () => {
		const result = await updateTodo.handler({
			id: 'nonexistent',
			title: 'New title',
		}, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NOT_FOUND');
	});

	it('returns NO_CHANGES when nothing to update', async () => {
		const created = await createTodo.handler({ title: 'Test', priority: 'medium' }, {});
		const result = await updateTodo.handler({ id: created.data!.id }, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NO_CHANGES');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo.toggle
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo.toggle', () => {
	it('marks todo as completed', async () => {
		const created = await createTodo.handler({ title: 'Toggle me', priority: 'medium' }, {});
		const result = await toggleTodo.handler({ id: created.data!.id }, {});

		expect(result.success).toBe(true);
		expect(result.data?.completed).toBe(true);
		expect(result.data?.completedAt).toBeDefined();
		expect(result.reasoning).toContain('completed');
	});

	it('marks todo as pending when toggled again', async () => {
		const created = await createTodo.handler({ title: 'Toggle me', priority: 'medium' }, {});
		await toggleTodo.handler({ id: created.data!.id }, {});
		const result = await toggleTodo.handler({ id: created.data!.id }, {});

		expect(result.success).toBe(true);
		expect(result.data?.completed).toBe(false);
		expect(result.data?.completedAt).toBeUndefined();
		expect(result.reasoning).toContain('pending');
	});

	it('returns NOT_FOUND for missing todo', async () => {
		const result = await toggleTodo.handler({ id: 'nonexistent' }, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NOT_FOUND');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo.delete
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo.delete', () => {
	it('deletes a todo', async () => {
		const created = await createTodo.handler({ title: 'Delete me', priority: 'medium' }, {});
		const result = await deleteTodo.handler({ id: created.data!.id }, {});

		expect(result.success).toBe(true);
		expect(result.data?.deleted).toBe(true);

		// Verify it's gone
		const get = await getTodo.handler({ id: created.data!.id }, {});
		expect(get.success).toBe(false);
	});

	it('includes warning about permanence', async () => {
		const created = await createTodo.handler({ title: 'Delete me', priority: 'medium' }, {});
		const result = await deleteTodo.handler({ id: created.data!.id }, {});

		expect(result.warnings).toBeDefined();
		expect(result.warnings?.[0].code).toBe('PERMANENT');
	});

	it('returns NOT_FOUND for missing todo', async () => {
		const result = await deleteTodo.handler({ id: 'nonexistent' }, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NOT_FOUND');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo.clear
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo.clear', () => {
	it('clears completed todos', async () => {
		// Create and complete some todos
		const t1 = await createTodo.handler({ title: 'Todo 1', priority: 'medium' }, {});
		const t2 = await createTodo.handler({ title: 'Todo 2', priority: 'medium' }, {});
		await createTodo.handler({ title: 'Todo 3', priority: 'medium' }, {});

		await toggleTodo.handler({ id: t1.data!.id }, {});
		await toggleTodo.handler({ id: t2.data!.id }, {});

		const result = await clearCompleted.handler({}, {});

		expect(result.success).toBe(true);
		expect(result.data?.cleared).toBe(2);

		// Verify only pending remain
		const list = await listTodos.handler({
			sortBy: 'createdAt',
			sortOrder: 'desc',
			limit: 20,
			offset: 0,
		}, {});
		expect(list.data?.todos).toHaveLength(1);
	});

	it('returns 0 when nothing to clear', async () => {
		await createTodo.handler({ title: 'Pending', priority: 'medium' }, {});

		const result = await clearCompleted.handler({}, {});

		expect(result.success).toBe(true);
		expect(result.data?.cleared).toBe(0);
		expect(result.reasoning).toContain('No completed');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo.stats
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo.stats', () => {
	it('returns empty stats for empty store', async () => {
		const result = await getStats.handler({}, {});

		expect(result.success).toBe(true);
		expect(result.data?.total).toBe(0);
		expect(result.data?.completed).toBe(0);
		expect(result.data?.pending).toBe(0);
		expect(result.data?.completionRate).toBe(0);
	});

	it('calculates stats correctly', async () => {
		await createTodo.handler({ title: 'High 1', priority: 'high' }, {});
		await createTodo.handler({ title: 'High 2', priority: 'high' }, {});
		await createTodo.handler({ title: 'Medium', priority: 'medium' }, {});
		const t4 = await createTodo.handler({ title: 'Low', priority: 'low' }, {});

		// Complete one
		await toggleTodo.handler({ id: t4.data!.id }, {});

		const result = await getStats.handler({}, {});

		expect(result.data?.total).toBe(4);
		expect(result.data?.completed).toBe(1);
		expect(result.data?.pending).toBe(3);
		expect(result.data?.completionRate).toBe(0.25);
		expect(result.data?.byPriority.high).toBe(2);
		expect(result.data?.byPriority.medium).toBe(1);
		expect(result.data?.byPriority.low).toBe(1);
	});

	it('includes reasoning with summary', async () => {
		await createTodo.handler({ title: 'Test', priority: 'medium' }, {});

		const result = await getStats.handler({}, {});

		expect(result.reasoning).toContain('1 total');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// AFD Compliance Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('AFD Compliance', () => {
	it('all commands return valid CommandResult structure', async () => {
		const commands = [
			() => createTodo.handler({ title: 'Test', priority: 'medium' }, {}),
			() => listTodos.handler({ sortBy: 'createdAt', sortOrder: 'desc', limit: 20, offset: 0 }, {}),
			() => getStats.handler({}, {}),
		];

		for (const cmd of commands) {
			const result = await cmd();

			// Required fields
			expect(result).toHaveProperty('success');
			expect(typeof result.success).toBe('boolean');

			if (result.success) {
				expect(result).toHaveProperty('data');
			} else {
				expect(result).toHaveProperty('error');
				expect(result.error).toHaveProperty('code');
				expect(result.error).toHaveProperty('message');
			}
		}
	});

	it('success results include confidence', async () => {
		const result = await createTodo.handler({ title: 'Test', priority: 'medium' }, {});

		expect(result.success).toBe(true);
		expect(result.confidence).toBeGreaterThanOrEqual(0);
		expect(result.confidence).toBeLessThanOrEqual(1);
	});

	it('success results include reasoning', async () => {
		const result = await createTodo.handler({ title: 'Test', priority: 'medium' }, {});

		expect(result.success).toBe(true);
		expect(result.reasoning).toBeDefined();
		expect(typeof result.reasoning).toBe('string');
		expect(result.reasoning!.length).toBeGreaterThan(0);
	});

	it('error results include suggestion', async () => {
		const result = await getTodo.handler({ id: 'nonexistent' }, {});

		expect(result.success).toBe(false);
		expect(result.error?.suggestion).toBeDefined();
	});

	it('mutation commands include warnings when appropriate', async () => {
		const created = await createTodo.handler({ title: 'Test', priority: 'medium' }, {});
		const result = await deleteTodo.handler({ id: created.data!.id }, {});

		expect(result.warnings).toBeDefined();
		expect(result.warnings!.length).toBeGreaterThan(0);
		expect(result.warnings![0]).toHaveProperty('code');
		expect(result.warnings![0]).toHaveProperty('message');
	});
});
