/**
 * @fileoverview Unit tests for todo-complete and todo-uncomplete commands
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../../store/memory.js';
import { createTodo } from '../create.js';
import { completeTodo } from '../complete.js';
import { uncompleteTodo } from '../uncomplete.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
	store.clear();
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo-complete
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo-complete', () => {
	it('marks todo as completed', async () => {
		const created = await createTodo.handler({ title: 'Complete me', priority: 2 }, {});
		const result = await completeTodo.handler({ id: created.data!.id }, {});

		expect(result.success).toBe(true);
		expect(result.data?.completed).toBe(true);
		expect(result.data?.completedAt).toBeDefined();
		expect(result.reasoning).toContain('completed');
	});

	it('returns ALREADY_COMPLETED for completed todo', async () => {
		const created = await createTodo.handler({ title: 'Already done', priority: 2 }, {});
		await completeTodo.handler({ id: created.data!.id }, {});
		const result = await completeTodo.handler({ id: created.data!.id }, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('ALREADY_COMPLETED');
		expect(result.error?.suggestion).toBeDefined();
	});

	it('returns NOT_FOUND for missing todo', async () => {
		const result = await completeTodo.handler({ id: 'nonexistent' }, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NOT_FOUND');
		expect(result.error?.suggestion).toBeDefined();
	});

	it('returns confidence of 1.0', async () => {
		const created = await createTodo.handler({ title: 'Test', priority: 2 }, {});
		const result = await completeTodo.handler({ id: created.data!.id }, {});

		expect(result.confidence).toBe(1.0);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo-uncomplete
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo-uncomplete', () => {
	it('marks todo as pending', async () => {
		const created = await createTodo.handler({ title: 'Uncomplete me', priority: 2 }, {});
		await completeTodo.handler({ id: created.data!.id }, {});
		const result = await uncompleteTodo.handler({ id: created.data!.id }, {});

		expect(result.success).toBe(true);
		expect(result.data?.completed).toBe(false);
		expect(result.data?.completedAt).toBeUndefined();
		expect(result.reasoning).toContain('pending');
	});

	it('returns NOT_COMPLETED for pending todo', async () => {
		const created = await createTodo.handler({ title: 'Still pending', priority: 2 }, {});
		const result = await uncompleteTodo.handler({ id: created.data!.id }, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NOT_COMPLETED');
		expect(result.error?.suggestion).toBeDefined();
	});

	it('returns NOT_FOUND for missing todo', async () => {
		const result = await uncompleteTodo.handler({ id: 'nonexistent' }, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NOT_FOUND');
		expect(result.error?.suggestion).toBeDefined();
	});

	it('returns confidence of 1.0', async () => {
		const created = await createTodo.handler({ title: 'Test', priority: 2 }, {});
		await completeTodo.handler({ id: created.data!.id }, {});
		const result = await uncompleteTodo.handler({ id: created.data!.id }, {});

		expect(result.confidence).toBe(1.0);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// complete/uncomplete interaction
// ═══════════════════════════════════════════════════════════════════════════════

describe('complete/uncomplete interaction', () => {
	it('can complete and uncomplete repeatedly', async () => {
		const created = await createTodo.handler({ title: 'Toggle test', priority: 2 }, {});

		// Complete
		let result = await completeTodo.handler({ id: created.data!.id }, {});
		expect(result.data?.completed).toBe(true);

		// Uncomplete
		result = await uncompleteTodo.handler({ id: created.data!.id }, {});
		expect(result.data?.completed).toBe(false);

		// Complete again
		result = await completeTodo.handler({ id: created.data!.id }, {});
		expect(result.data?.completed).toBe(true);
		expect(result.data?.completedAt).toBeDefined();
	});

	it('updates timestamps correctly', async () => {
		const created = await createTodo.handler({ title: 'Timestamp test', priority: 2 }, {});
		const originalUpdatedAt = created.data!.updatedAt;

		// Small delay to ensure timestamps differ
		await new Promise(resolve => setTimeout(resolve, 5));

		const completed = await completeTodo.handler({ id: created.data!.id }, {});
		expect(completed.data?.updatedAt).toBeDefined();
		expect(completed.data?.completedAt).toBeDefined();

		// Small delay again
		await new Promise(resolve => setTimeout(resolve, 5));

		const uncompleted = await uncompleteTodo.handler({ id: created.data!.id }, {});
		expect(uncompleted.data?.completedAt).toBeUndefined();
		expect(uncompleted.data?.updatedAt).toBeDefined();
	});
});
