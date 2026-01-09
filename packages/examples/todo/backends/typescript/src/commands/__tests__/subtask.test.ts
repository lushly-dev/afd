/**
 * @fileoverview Unit tests for subtask commands
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../../store/memory.js';
import { createTodo } from '../create.js';
import { addSubtask } from '../subtask-add.js';
import { listSubtasks } from '../subtask-list.js';
import { moveSubtask } from '../subtask-move.js';
import { toggleTodo } from '../toggle.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
	store.clear();
});

// ═══════════════════════════════════════════════════════════════════════════════
// subtask-add
// ═══════════════════════════════════════════════════════════════════════════════

describe('subtask-add', () => {
	it('creates a subtask under an existing todo', async () => {
		const parent = await createTodo.handler({ title: 'Parent Task', priority: 2 }, {});
		const result = await addSubtask.handler(
			{
				parentId: parent.data!.id,
				title: 'Subtask 1',
				priority: 2,
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.title).toBe('Subtask 1');
		expect(result.data?.parentId).toBe(parent.data!.id);
		expect(result.data?.completed).toBe(false);
		expect(result.reasoning).toContain('Subtask 1');
		expect(result.reasoning).toContain('Parent Task');
	});

	it('creates a subtask with all optional fields', async () => {
		const parent = await createTodo.handler({ title: 'Parent Task', priority: 2 }, {});
		const dueDate = new Date(Date.now() + 86400000).toISOString();
		const result = await addSubtask.handler(
			{
				parentId: parent.data!.id,
				title: 'Full Subtask',
				description: 'A detailed description',
				priority: 3,
				dueDate,
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.description).toBe('A detailed description');
		expect(result.data?.priority).toBe(3);
		expect(result.data?.dueDate).toBe(dueDate);
		expect(result.reasoning).toContain('high');
	});

	it('returns NOT_FOUND when parent does not exist', async () => {
		const result = await addSubtask.handler(
			{
				parentId: 'nonexistent-parent',
				title: 'Orphan Subtask',
				priority: 2,
			},
			{}
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NOT_FOUND');
		expect(result.error?.suggestion).toBeDefined();
	});

	it('returns confidence of 1.0', async () => {
		const parent = await createTodo.handler({ title: 'Parent', priority: 2 }, {});
		const result = await addSubtask.handler(
			{
				parentId: parent.data!.id,
				title: 'Subtask',
				priority: 2,
			},
			{}
		);

		expect(result.confidence).toBe(1.0);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// subtask-list
// ═══════════════════════════════════════════════════════════════════════════════

describe('subtask-list', () => {
	it('lists all subtasks of a parent', async () => {
		const parent = await createTodo.handler({ title: 'Parent Task', priority: 2 }, {});
		await addSubtask.handler({ parentId: parent.data!.id, title: 'Subtask 1', priority: 2 }, {});
		await addSubtask.handler({ parentId: parent.data!.id, title: 'Subtask 2', priority: 1 }, {});
		await addSubtask.handler({ parentId: parent.data!.id, title: 'Subtask 3', priority: 3 }, {});

		const result = await listSubtasks.handler(
			{
				parentId: parent.data!.id,
				sortBy: 'createdAt',
				sortOrder: 'desc',
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.subtasks).toHaveLength(3);
		expect(result.data?.total).toBe(3);
		expect(result.data?.parent.id).toBe(parent.data!.id);
	});

	it('filters subtasks by completion status', async () => {
		const parent = await createTodo.handler({ title: 'Parent Task', priority: 2 }, {});
		const sub1 = await addSubtask.handler(
			{ parentId: parent.data!.id, title: 'Subtask 1', priority: 2 },
			{}
		);
		await addSubtask.handler({ parentId: parent.data!.id, title: 'Subtask 2', priority: 2 }, {});

		// Complete one subtask
		await toggleTodo.handler({ id: sub1.data!.id }, {});

		const pending = await listSubtasks.handler(
			{
				parentId: parent.data!.id,
				completed: false,
				sortBy: 'createdAt',
				sortOrder: 'desc',
			},
			{}
		);
		const completed = await listSubtasks.handler(
			{
				parentId: parent.data!.id,
				completed: true,
				sortBy: 'createdAt',
				sortOrder: 'desc',
			},
			{}
		);

		expect(pending.data?.subtasks).toHaveLength(1);
		expect(pending.data?.pending).toBe(1);
		expect(completed.data?.subtasks).toHaveLength(1);
		expect(completed.data?.completed).toBe(1);
	});

	it('returns empty list when no subtasks', async () => {
		const parent = await createTodo.handler({ title: 'Parent Task', priority: 2 }, {});

		const result = await listSubtasks.handler(
			{
				parentId: parent.data!.id,
				sortBy: 'createdAt',
				sortOrder: 'desc',
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.subtasks).toHaveLength(0);
		expect(result.data?.total).toBe(0);
		expect(result.reasoning).toContain('No subtasks');
	});

	it('returns NOT_FOUND when parent does not exist', async () => {
		const result = await listSubtasks.handler(
			{
				parentId: 'nonexistent-parent',
				sortBy: 'createdAt',
				sortOrder: 'desc',
			},
			{}
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NOT_FOUND');
	});

	it('sorts subtasks correctly', async () => {
		const parent = await createTodo.handler({ title: 'Parent', priority: 2 }, {});
		await addSubtask.handler({ parentId: parent.data!.id, title: 'Low', priority: 1 }, {});
		await addSubtask.handler({ parentId: parent.data!.id, title: 'High', priority: 3 }, {});
		await addSubtask.handler({ parentId: parent.data!.id, title: 'Medium', priority: 2 }, {});

		const result = await listSubtasks.handler(
			{
				parentId: parent.data!.id,
				sortBy: 'priority',
				sortOrder: 'desc',
			},
			{}
		);

		expect(result.data?.subtasks[0].priority).toBe(3);
		expect(result.data?.subtasks[1].priority).toBe(2);
		expect(result.data?.subtasks[2].priority).toBe(1);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// subtask-move
// ═══════════════════════════════════════════════════════════════════════════════

describe('subtask-move', () => {
	it('moves a root todo to become a subtask', async () => {
		const parent = await createTodo.handler({ title: 'Parent Task', priority: 2 }, {});
		const child = await createTodo.handler({ title: 'Soon-to-be Subtask', priority: 2 }, {});

		const result = await moveSubtask.handler(
			{
				id: child.data!.id,
				parentId: parent.data!.id,
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.parentId).toBe(parent.data!.id);
		expect(result.reasoning).toContain('Moved');
	});

	it('promotes a subtask to root level', async () => {
		const parent = await createTodo.handler({ title: 'Parent Task', priority: 2 }, {});
		const subtask = await addSubtask.handler(
			{ parentId: parent.data!.id, title: 'Subtask', priority: 2 },
			{}
		);

		const result = await moveSubtask.handler(
			{
				id: subtask.data!.id,
				parentId: null,
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.parentId).toBeUndefined();
		expect(result.reasoning).toContain('Promoted');
		expect(result.reasoning).toContain('root level');
	});

	it('moves a subtask to a different parent', async () => {
		const parent1 = await createTodo.handler({ title: 'Parent 1', priority: 2 }, {});
		const parent2 = await createTodo.handler({ title: 'Parent 2', priority: 2 }, {});
		const subtask = await addSubtask.handler(
			{ parentId: parent1.data!.id, title: 'Subtask', priority: 2 },
			{}
		);

		const result = await moveSubtask.handler(
			{
				id: subtask.data!.id,
				parentId: parent2.data!.id,
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.parentId).toBe(parent2.data!.id);
	});

	it('returns NOT_FOUND when todo does not exist', async () => {
		const parent = await createTodo.handler({ title: 'Parent', priority: 2 }, {});

		const result = await moveSubtask.handler(
			{
				id: 'nonexistent-todo',
				parentId: parent.data!.id,
			},
			{}
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NOT_FOUND');
	});

	it('returns NOT_FOUND when new parent does not exist', async () => {
		const todo = await createTodo.handler({ title: 'Task', priority: 2 }, {});

		const result = await moveSubtask.handler(
			{
				id: todo.data!.id,
				parentId: 'nonexistent-parent',
			},
			{}
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NOT_FOUND');
	});

	it('prevents circular reference (moving to self)', async () => {
		const todo = await createTodo.handler({ title: 'Task', priority: 2 }, {});

		const result = await moveSubtask.handler(
			{
				id: todo.data!.id,
				parentId: todo.data!.id,
			},
			{}
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('CIRCULAR_REFERENCE');
		expect(result.error?.suggestion).toBeDefined();
	});

	it('prevents circular reference (moving to descendant)', async () => {
		const grandparent = await createTodo.handler({ title: 'Grandparent', priority: 2 }, {});
		const parent = await addSubtask.handler(
			{ parentId: grandparent.data!.id, title: 'Parent', priority: 2 },
			{}
		);
		const child = await addSubtask.handler(
			{ parentId: parent.data!.id, title: 'Child', priority: 2 },
			{}
		);

		// Try to move grandparent under child (its grandchild)
		const result = await moveSubtask.handler(
			{
				id: grandparent.data!.id,
				parentId: child.data!.id,
			},
			{}
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('CIRCULAR_REFERENCE');
	});

	it('includes warning when hierarchy changes', async () => {
		const parent = await createTodo.handler({ title: 'Parent', priority: 2 }, {});
		const todo = await createTodo.handler({ title: 'Task', priority: 2 }, {});

		const result = await moveSubtask.handler(
			{
				id: todo.data!.id,
				parentId: parent.data!.id,
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.warnings).toBeDefined();
		expect(result.warnings![0].code).toBe('HIERARCHY_CHANGED');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Nested Hierarchy Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Nested Hierarchy', () => {
	it('supports multiple levels of nesting', async () => {
		const level1 = await createTodo.handler({ title: 'Level 1', priority: 2 }, {});
		const level2 = await addSubtask.handler(
			{ parentId: level1.data!.id, title: 'Level 2', priority: 2 },
			{}
		);
		const level3 = await addSubtask.handler(
			{ parentId: level2.data!.id, title: 'Level 3', priority: 2 },
			{}
		);

		expect(level1.data?.parentId).toBeUndefined();
		expect(level2.data?.parentId).toBe(level1.data!.id);
		expect(level3.data?.parentId).toBe(level2.data!.id);
	});

	it('lists only direct children, not grandchildren', async () => {
		const level1 = await createTodo.handler({ title: 'Level 1', priority: 2 }, {});
		await addSubtask.handler({ parentId: level1.data!.id, title: 'Child 1', priority: 2 }, {});
		const child2 = await addSubtask.handler(
			{ parentId: level1.data!.id, title: 'Child 2', priority: 2 },
			{}
		);
		await addSubtask.handler(
			{ parentId: child2.data!.id, title: 'Grandchild', priority: 2 },
			{}
		);

		const result = await listSubtasks.handler(
			{
				parentId: level1.data!.id,
				sortBy: 'createdAt',
				sortOrder: 'desc',
			},
			{}
		);

		expect(result.data?.subtasks).toHaveLength(2);
		expect(result.data?.subtasks.every((s) => s.parentId === level1.data!.id)).toBe(true);
	});

	it('store.getDescendants returns all nested children', () => {
		// Create hierarchy manually for store testing
		const root = store.create({ title: 'Root', priority: 2 });
		const child1 = store.create({ title: 'Child 1', priority: 2, parentId: root.id });
		const child2 = store.create({ title: 'Child 2', priority: 2, parentId: root.id });
		const grandchild = store.create({ title: 'Grandchild', priority: 2, parentId: child1.id });

		const descendants = store.getDescendants(root.id);

		expect(descendants).toHaveLength(3);
		expect(descendants.map((d) => d.id)).toContain(child1.id);
		expect(descendants.map((d) => d.id)).toContain(child2.id);
		expect(descendants.map((d) => d.id)).toContain(grandchild.id);
	});

	it('store.wouldCreateCycle detects deep cycles', () => {
		const root = store.create({ title: 'Root', priority: 2 });
		const child = store.create({ title: 'Child', priority: 2, parentId: root.id });
		const grandchild = store.create({ title: 'Grandchild', priority: 2, parentId: child.id });

		// Should detect that moving root under grandchild creates a cycle
		expect(store.wouldCreateCycle(root.id, grandchild.id)).toBe(true);

		// Should detect that moving root under child creates a cycle
		expect(store.wouldCreateCycle(root.id, child.id)).toBe(true);

		// Moving grandchild under root should be fine (no cycle)
		expect(store.wouldCreateCycle(grandchild.id, root.id)).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// AFD Compliance Tests for Subtasks
// ═══════════════════════════════════════════════════════════════════════════════

describe('AFD Compliance for Subtasks', () => {
	it('all subtask commands return valid CommandResult structure', async () => {
		const parent = await createTodo.handler({ title: 'Parent', priority: 2 }, {});

		const commands = [
			() => addSubtask.handler({ parentId: parent.data!.id, title: 'Sub', priority: 2 }, {}),
			() =>
				listSubtasks.handler({ parentId: parent.data!.id, sortBy: 'createdAt', sortOrder: 'desc' }, {}),
		];

		for (const cmd of commands) {
			const result = await cmd();

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

	it('subtask commands include confidence', async () => {
		const parent = await createTodo.handler({ title: 'Parent', priority: 2 }, {});
		const result = await addSubtask.handler(
			{ parentId: parent.data!.id, title: 'Sub', priority: 2 },
			{}
		);

		expect(result.confidence).toBeGreaterThanOrEqual(0);
		expect(result.confidence).toBeLessThanOrEqual(1);
	});

	it('subtask commands include reasoning', async () => {
		const parent = await createTodo.handler({ title: 'Parent', priority: 2 }, {});
		const result = await addSubtask.handler(
			{ parentId: parent.data!.id, title: 'Sub', priority: 2 },
			{}
		);

		expect(result.reasoning).toBeDefined();
		expect(typeof result.reasoning).toBe('string');
		expect(result.reasoning!.length).toBeGreaterThan(0);
	});

	it('subtask error results include suggestion', async () => {
		const result = await addSubtask.handler(
			{ parentId: 'nonexistent', title: 'Sub', priority: 2 },
			{}
		);

		expect(result.success).toBe(false);
		expect(result.error?.suggestion).toBeDefined();
	});
});
