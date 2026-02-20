/**
 * @fileoverview Unit tests for list commands
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../store/memory.js';
import { createTodo } from '../create.js';
import { createList } from '../list-create.js';
import { deleteList } from '../list-delete.js';
import { listLists } from '../list-list.js';
import { updateList } from '../list-update.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
	store.clear();
});

// ═══════════════════════════════════════════════════════════════════════════════
// list-create
// ═══════════════════════════════════════════════════════════════════════════════

describe('list-create', () => {
	it('creates a list with required fields', async () => {
		const result = await createList.handler({ name: 'My List' }, {});

		expect(result.success).toBe(true);
		expect(result.data?.name).toBe('My List');
		expect(result.data?.todoIds).toEqual([]);
		expect(result.data?.id).toBeDefined();
		expect(result.data?.createdAt).toBeDefined();
	});

	it('creates a list with description', async () => {
		const result = await createList.handler(
			{
				name: 'Work Tasks',
				description: 'Tasks for work projects',
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.name).toBe('Work Tasks');
		expect(result.data?.description).toBe('Tasks for work projects');
	});

	it('creates a list with todoIds', async () => {
		// Create some todos first
		const todo1 = await createTodo.handler({ title: 'Todo 1', priority: 2 }, {});
		const todo2 = await createTodo.handler({ title: 'Todo 2', priority: 3 }, {});

		const result = await createList.handler(
			{
				name: 'Project List',
				todoIds: [todo1.data?.id, todo2.data?.id],
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.todoIds).toHaveLength(2);
		expect(result.data?.todoIds).toContain(todo1.data?.id);
		expect(result.data?.todoIds).toContain(todo2.data?.id);
	});

	it('returns confidence of 1.0', async () => {
		const result = await createList.handler({ name: 'Test List' }, {});

		expect(result.confidence).toBe(1.0);
	});

	it('includes reasoning', async () => {
		const result = await createList.handler({ name: 'My List' }, {});

		expect(result.reasoning).toContain('My List');
	});

	it('includes todo count in reasoning when todoIds provided', async () => {
		const todo = await createTodo.handler({ title: 'Test', priority: 2 }, {});
		const result = await createList.handler(
			{
				name: 'With Todos',
				todoIds: [todo.data?.id],
			},
			{}
		);

		expect(result.reasoning).toContain('1 todo');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// list-list
// ═══════════════════════════════════════════════════════════════════════════════

describe('list-list', () => {
	beforeEach(async () => {
		await createList.handler({ name: 'List 1', description: 'First list' }, {});
		await createList.handler({ name: 'List 2', description: 'Second list' }, {});
		await createList.handler({ name: 'Work Items' }, {});
	});

	it('lists all lists', async () => {
		const result = await listLists.handler(
			{
				sortBy: 'createdAt',
				sortOrder: 'desc',
				limit: 20,
				offset: 0,
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.lists).toHaveLength(3);
		expect(result.data?.total).toBe(3);
		expect(result.data?.hasMore).toBe(false);
	});

	it('searches by name', async () => {
		const result = await listLists.handler(
			{
				search: 'Work',
				sortBy: 'createdAt',
				sortOrder: 'desc',
				limit: 20,
				offset: 0,
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.lists).toHaveLength(1);
		expect(result.data?.lists[0].name).toBe('Work Items');
	});

	it('searches by description', async () => {
		const result = await listLists.handler(
			{
				search: 'First',
				sortBy: 'createdAt',
				sortOrder: 'desc',
				limit: 20,
				offset: 0,
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.lists).toHaveLength(1);
		expect(result.data?.lists[0].name).toBe('List 1');
	});

	it('supports pagination', async () => {
		const page1 = await listLists.handler(
			{
				limit: 2,
				offset: 0,
				sortBy: 'createdAt',
				sortOrder: 'desc',
			},
			{}
		);
		const page2 = await listLists.handler(
			{
				limit: 2,
				offset: 2,
				sortBy: 'createdAt',
				sortOrder: 'desc',
			},
			{}
		);

		expect(page1.data?.lists).toHaveLength(2);
		expect(page1.data?.hasMore).toBe(true);
		expect(page2.data?.lists).toHaveLength(1);
		expect(page2.data?.hasMore).toBe(false);
	});

	it('sorts by name', async () => {
		const result = await listLists.handler(
			{
				sortBy: 'name',
				sortOrder: 'asc',
				limit: 20,
				offset: 0,
			},
			{}
		);

		expect(result.data?.lists[0].name).toBe('List 1');
		expect(result.data?.lists[1].name).toBe('List 2');
		expect(result.data?.lists[2].name).toBe('Work Items');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// list-update
// ═══════════════════════════════════════════════════════════════════════════════

describe('list-update', () => {
	it('updates list name', async () => {
		const created = await createList.handler({ name: 'Original' }, {});

		const result = await updateList.handler(
			{
				id: created.data?.id,
				name: 'Updated Name',
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.name).toBe('Updated Name');
		expect(result.data?.updatedAt).toBeDefined();
	});

	it('updates list description', async () => {
		const created = await createList.handler({ name: 'Test List' }, {});

		const result = await updateList.handler(
			{
				id: created.data?.id,
				description: 'New description',
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.description).toBe('New description');
	});

	it('updates list todoIds', async () => {
		const todo = await createTodo.handler({ title: 'New Todo', priority: 2 }, {});
		const created = await createList.handler({ name: 'Test List' }, {});

		const result = await updateList.handler(
			{
				id: created.data?.id,
				todoIds: [todo.data?.id],
			},
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.todoIds).toContain(todo.data?.id);
	});

	it('returns NOT_FOUND for missing list', async () => {
		const result = await updateList.handler(
			{
				id: 'nonexistent',
				name: 'New name',
			},
			{}
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NOT_FOUND');
	});

	it('returns NO_CHANGES when nothing to update', async () => {
		const created = await createList.handler({ name: 'Test' }, {});
		const result = await updateList.handler({ id: created.data?.id }, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NO_CHANGES');
	});

	it('includes reasoning with change summary', async () => {
		const created = await createList.handler({ name: 'Original' }, {});
		const result = await updateList.handler(
			{
				id: created.data?.id,
				name: 'New Name',
			},
			{}
		);

		expect(result.reasoning).toContain('name');
		expect(result.reasoning).toContain('New Name');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// list-delete
// ═══════════════════════════════════════════════════════════════════════════════

describe('list-delete', () => {
	it('deletes a list', async () => {
		const created = await createList.handler({ name: 'Delete me' }, {});
		const result = await deleteList.handler({ id: created.data?.id }, {});

		expect(result.success).toBe(true);
		expect(result.data?.deleted).toBe(true);

		// Verify it's gone
		const lists = await listLists.handler(
			{
				sortBy: 'createdAt',
				sortOrder: 'desc',
				limit: 20,
				offset: 0,
			},
			{}
		);
		expect(lists.data?.lists).toHaveLength(0);
	});

	it('includes warning about permanence', async () => {
		const created = await createList.handler({ name: 'Delete me' }, {});
		const result = await deleteList.handler({ id: created.data?.id }, {});

		expect(result.warnings).toBeDefined();
		expect(result.warnings?.[0].code).toBe('PERMANENT');
	});

	it('returns NOT_FOUND for missing list', async () => {
		const result = await deleteList.handler({ id: 'nonexistent' }, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NOT_FOUND');
	});

	it('includes list name in reasoning', async () => {
		const created = await createList.handler({ name: 'My Special List' }, {});
		const result = await deleteList.handler({ id: created.data?.id }, {});

		expect(result.reasoning).toContain('My Special List');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// AFD Compliance Tests for List Commands
// ═══════════════════════════════════════════════════════════════════════════════

describe('List Commands AFD Compliance', () => {
	it('all list commands return valid CommandResult structure', async () => {
		const created = await createList.handler({ name: 'Test' }, {});

		const commands = [
			() => createList.handler({ name: 'New List' }, {}),
			() => listLists.handler({ sortBy: 'createdAt', sortOrder: 'desc', limit: 20, offset: 0 }, {}),
			() => updateList.handler({ id: created.data?.id, name: 'Updated' }, {}),
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

	it('success results include confidence', async () => {
		const result = await createList.handler({ name: 'Test' }, {});

		expect(result.success).toBe(true);
		expect(result.confidence).toBeGreaterThanOrEqual(0);
		expect(result.confidence).toBeLessThanOrEqual(1);
	});

	it('success results include reasoning', async () => {
		const result = await createList.handler({ name: 'Test' }, {});

		expect(result.success).toBe(true);
		expect(result.reasoning).toBeDefined();
		expect(typeof result.reasoning).toBe('string');
		expect(result.reasoning?.length).toBeGreaterThan(0);
	});

	it('error results include suggestion', async () => {
		const result = await updateList.handler({ id: 'nonexistent', name: 'Test' }, {});

		expect(result.success).toBe(false);
		expect(result.error?.suggestion).toBeDefined();
	});

	it('mutation commands include warnings when appropriate', async () => {
		const created = await createList.handler({ name: 'Test' }, {});
		const result = await deleteList.handler({ id: created.data?.id }, {});

		expect(result.warnings).toBeDefined();
		expect(result.warnings?.length).toBeGreaterThan(0);
		expect(result.warnings?.[0]).toHaveProperty('code');
		expect(result.warnings?.[0]).toHaveProperty('message');
	});
});
