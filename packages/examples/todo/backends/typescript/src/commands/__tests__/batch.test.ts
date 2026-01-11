/**
 * @fileoverview Unit tests for batch commands
 *
 * Tests the AFD batch operation pattern with partial failure handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../../store/memory.js';
import { createTodo } from '../create.js';
import { createBatch } from '../create-batch.js';
import { deleteBatch } from '../delete-batch.js';
import { toggleBatch } from '../toggle-batch.js';
import { listTodos } from '../list.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
	store.clear();
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo-createBatch
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo-createBatch', () => {
	it('creates multiple todos successfully', async () => {
		const result = await createBatch.handler(
			{
				todos: [
					{ title: 'Task 1', priority: 'high' },
					{ title: 'Task 2', priority: 'medium' },
					{ title: 'Task 3', priority: 'low' },
				],
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.succeeded).toHaveLength(3);
		expect(result.data?.failed).toHaveLength(0);
		expect(result.data?.summary.total).toBe(3);
		expect(result.data?.summary.successCount).toBe(3);
		expect(result.data?.summary.failureCount).toBe(0);
		expect(result.confidence).toBe(1.0);
		expect(result.warnings).toBeUndefined();
	});

	it('creates todos with different priorities', async () => {
		const result = await createBatch.handler(
			{
				todos: [
					{ title: 'High priority', priority: 'high' },
					{ title: 'Low priority', priority: 'low' },
				],
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.succeeded[0].priority).toBe('high');
		expect(result.data?.succeeded[1].priority).toBe('low');
	});

	it('defaults priority to medium', async () => {
		const result = await createBatch.handler(
			{
				todos: [{ title: 'Default priority' }],
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.succeeded[0].priority).toBe('medium');
	});

	it('includes description when provided', async () => {
		const result = await createBatch.handler(
			{
				todos: [{ title: 'With description', description: 'Test description', priority: 'medium' }],
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.succeeded[0].description).toBe('Test description');
	});

	it('includes reasoning for full success', async () => {
		const result = await createBatch.handler(
			{
				todos: [{ title: 'Task 1', priority: 'medium' }, { title: 'Task 2', priority: 'medium' }],
			},
			{}
		);

		expect(result.reasoning).toContain('Successfully created all 2 todos');
	});

	it('verifies todos are actually created in store', async () => {
		await createBatch.handler(
			{
				todos: [
					{ title: 'Batch 1', priority: 'high' },
					{ title: 'Batch 2', priority: 'medium' },
				],
			},
			{}
		);

		const list = await listTodos.handler(
			{
				sortBy: 'createdAt',
				sortOrder: 'desc',
				limit: 20,
				offset: 0,
			},
			{}
		);

		expect(list.data?.total).toBe(2);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo-deleteBatch
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo-deleteBatch', () => {
	it('deletes multiple todos successfully', async () => {
		// Create some todos first
		const t1 = await createTodo.handler({ title: 'Delete 1', priority: 'medium' }, {});
		const t2 = await createTodo.handler({ title: 'Delete 2', priority: 'medium' }, {});
		const t3 = await createTodo.handler({ title: 'Keep', priority: 'medium' }, {});

		const result = await deleteBatch.handler(
			{
				ids: [t1.data!.id, t2.data!.id],
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.deletedIds).toHaveLength(2);
		expect(result.data?.failed).toHaveLength(0);
		expect(result.data?.summary.successCount).toBe(2);
		expect(result.confidence).toBe(1.0);

		// Verify only t3 remains
		const list = await listTodos.handler(
			{
				sortBy: 'createdAt',
				sortOrder: 'desc',
				limit: 20,
				offset: 0,
			},
			{}
		);
		expect(list.data?.total).toBe(1);
		expect(list.data?.todos[0].id).toBe(t3.data!.id);
	});

	it('handles partial failure with nonexistent IDs', async () => {
		const t1 = await createTodo.handler({ title: 'Real', priority: 'medium' }, {});

		const result = await deleteBatch.handler(
			{
				ids: [t1.data!.id, 'nonexistent-1', 'nonexistent-2'],
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.deletedIds).toHaveLength(1);
		expect(result.data?.failed).toHaveLength(2);
		expect(result.data?.summary.successCount).toBe(1);
		expect(result.data?.summary.failureCount).toBe(2);
		expect(result.confidence).toBeCloseTo(0.333, 2);
	});

	it('includes PARTIAL_SUCCESS warning for mixed results', async () => {
		const t1 = await createTodo.handler({ title: 'Real', priority: 'medium' }, {});

		const result = await deleteBatch.handler(
			{
				ids: [t1.data!.id, 'fake-id'],
			},
			{}
		);

		expect(result.warnings).toBeDefined();
		const partialWarning = result.warnings?.find((w) => w.code === 'PARTIAL_SUCCESS');
		expect(partialWarning).toBeDefined();
	});

	it('includes DESTRUCTIVE_BATCH warning', async () => {
		const t1 = await createTodo.handler({ title: 'Delete me', priority: 'medium' }, {});

		const result = await deleteBatch.handler(
			{
				ids: [t1.data!.id],
			},
			{}
		);

		const destructiveWarning = result.warnings?.find((w) => w.code === 'DESTRUCTIVE_BATCH');
		expect(destructiveWarning).toBeDefined();
		expect(destructiveWarning?.severity).toBe('caution');
	});

	it('reports all failures when all IDs are invalid', async () => {
		const result = await deleteBatch.handler(
			{
				ids: ['fake-1', 'fake-2', 'fake-3'],
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.deletedIds).toHaveLength(0);
		expect(result.data?.failed).toHaveLength(3);
		expect(result.confidence).toBe(0);
		expect(result.reasoning).toContain('Failed to delete any');
	});

	it('includes NOT_FOUND error details in failed items', async () => {
		const result = await deleteBatch.handler(
			{
				ids: ['nonexistent'],
			},
			{}
		);

		expect(result.data?.failed[0].error.code).toBe('NOT_FOUND');
		expect(result.data?.failed[0].error.suggestion).toBeDefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo-toggleBatch
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo-toggleBatch', () => {
	it('toggles multiple todos', async () => {
		const t1 = await createTodo.handler({ title: 'Toggle 1', priority: 'medium' }, {});
		const t2 = await createTodo.handler({ title: 'Toggle 2', priority: 'medium' }, {});

		const result = await toggleBatch.handler(
			{
				ids: [t1.data!.id, t2.data!.id],
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.succeeded).toHaveLength(2);
		expect(result.data?.succeeded.every((t) => t.completed)).toBe(true);
		expect(result.data?.summary.markedComplete).toBe(2);
		expect(result.data?.summary.markedIncomplete).toBe(0);
	});

	it('sets all to completed with completed=true', async () => {
		const t1 = await createTodo.handler({ title: 'Task 1', priority: 'medium' }, {});
		const t2 = await createTodo.handler({ title: 'Task 2', priority: 'medium' }, {});

		const result = await toggleBatch.handler(
			{
				ids: [t1.data!.id, t2.data!.id],
				completed: true,
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.succeeded.every((t) => t.completed)).toBe(true);
		expect(result.reasoning).toContain('set to complete');
	});

	it('sets all to incomplete with completed=false', async () => {
		// Create and complete todos first
		const t1 = await createTodo.handler({ title: 'Task 1', priority: 'medium' }, {});
		const t2 = await createTodo.handler({ title: 'Task 2', priority: 'medium' }, {});

		// Mark them complete
		await toggleBatch.handler({ ids: [t1.data!.id, t2.data!.id] }, {});

		// Now set them all to incomplete
		const result = await toggleBatch.handler(
			{
				ids: [t1.data!.id, t2.data!.id],
				completed: false,
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.succeeded.every((t) => !t.completed)).toBe(true);
		expect(result.reasoning).toContain('set to incomplete');
	});

	it('handles mixed existing states in toggle mode', async () => {
		const t1 = await createTodo.handler({ title: 'Task 1', priority: 'medium' }, {});
		const t2 = await createTodo.handler({ title: 'Task 2', priority: 'medium' }, {});

		// Complete just t1
		await toggleBatch.handler({ ids: [t1.data!.id], completed: true }, {});

		// Now toggle both - t1 becomes incomplete, t2 becomes complete
		const result = await toggleBatch.handler(
			{
				ids: [t1.data!.id, t2.data!.id],
			},
			{}
		);

		expect(result.success).toBe(true);
		const t1Result = result.data?.succeeded.find((t) => t.id === t1.data!.id);
		const t2Result = result.data?.succeeded.find((t) => t.id === t2.data!.id);
		expect(t1Result?.completed).toBe(false);
		expect(t2Result?.completed).toBe(true);
	});

	it('handles partial failure with nonexistent IDs', async () => {
		const t1 = await createTodo.handler({ title: 'Real', priority: 'medium' }, {});

		const result = await toggleBatch.handler(
			{
				ids: [t1.data!.id, 'fake-id'],
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.succeeded).toHaveLength(1);
		expect(result.data?.failed).toHaveLength(1);
		expect(result.data?.failed[0].error.code).toBe('NOT_FOUND');
	});

	it('includes PARTIAL_SUCCESS warning for mixed results', async () => {
		const t1 = await createTodo.handler({ title: 'Real', priority: 'medium' }, {});

		const result = await toggleBatch.handler(
			{
				ids: [t1.data!.id, 'fake-id'],
			},
			{}
		);

		const warning = result.warnings?.find((w) => w.code === 'PARTIAL_SUCCESS');
		expect(warning).toBeDefined();
	});

	it('reports all failures when all IDs are invalid', async () => {
		const result = await toggleBatch.handler(
			{
				ids: ['fake-1', 'fake-2'],
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.succeeded).toHaveLength(0);
		expect(result.data?.failed).toHaveLength(2);
		expect(result.confidence).toBe(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Batch AFD Compliance
// ═══════════════════════════════════════════════════════════════════════════════

describe('Batch AFD Compliance', () => {
	it('batch commands return valid CommandResult structure', async () => {
		const createResult = await createBatch.handler({ todos: [{ title: 'Test', priority: 'medium' }] }, {});
		const toggleResult = await toggleBatch.handler({ ids: [createResult.data!.succeeded[0].id] }, {});
		const deleteResult = await deleteBatch.handler({ ids: [createResult.data!.succeeded[0].id] }, {});

		for (const result of [createResult, toggleResult, deleteResult]) {
			expect(result).toHaveProperty('success');
			expect(result).toHaveProperty('data');
			expect(result).toHaveProperty('confidence');
			expect(result).toHaveProperty('reasoning');
		}
	});

	it('batch results include summary statistics', async () => {
		const result = await createBatch.handler(
			{ todos: [{ title: 'Task 1', priority: 'medium' }, { title: 'Task 2', priority: 'medium' }] },
			{}
		);

		expect(result.data?.summary).toBeDefined();
		expect(result.data?.summary.total).toBe(2);
		expect(result.data?.summary.successCount).toBe(2);
		expect(result.data?.summary.failureCount).toBe(0);
	});

	it('confidence reflects success rate', async () => {
		const t1 = await createTodo.handler({ title: 'Real', priority: 'medium' }, {});

		// 1 success, 1 failure = 0.5 confidence
		const result = await deleteBatch.handler({ ids: [t1.data!.id, 'fake'] }, {});

		expect(result.confidence).toBe(0.5);
	});

	it('failed items include index and error details', async () => {
		const result = await deleteBatch.handler({ ids: ['fake-1', 'fake-2'] }, {});

		expect(result.data?.failed[0].index).toBe(0);
		expect(result.data?.failed[0].id).toBe('fake-1');
		expect(result.data?.failed[0].error).toHaveProperty('code');
		expect(result.data?.failed[0].error).toHaveProperty('message');
		expect(result.data?.failed[0].error).toHaveProperty('suggestion');

		expect(result.data?.failed[1].index).toBe(1);
		expect(result.data?.failed[1].id).toBe('fake-2');
	});
});
