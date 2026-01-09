/**
 * Task Commands Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TaskStore } from '../stores/task-store.js';
import { createTaskCreateCommand } from './task-create.js';
import { createTaskUpdateCommand } from './task-update.js';
import { createTaskDeleteCommand } from './task-delete.js';
import { createTaskListCommand } from './task-list.js';
import type { Task } from '../types.js';

describe('Task Commands', () => {
	let taskStore: TaskStore;

	beforeEach(() => {
		// Use in-memory database for testing
		taskStore = new TaskStore(':memory:');
	});

	describe('task-create', () => {
		it('creates a task with required fields', async () => {
			const command = createTaskCreateCommand(taskStore);
			const result = await command.handler({ title: 'Test task' }, {});

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect((result.data as Task).title).toBe('Test task');
			expect((result.data as Task).status).toBe('pending');
			expect((result.data as Task).listId).toBe('inbox');
			expect((result.data as Task).priority).toBe(0);
		});

		it('creates a task with all fields', async () => {
			const command = createTaskCreateCommand(taskStore);
			const result = await command.handler(
				{
					title: 'Complete task',
					description: 'A detailed description',
					listId: 'work',
					dueDate: '2026-01-15',
					dueTime: '14:00',
					priority: 2,
					tags: ['important', 'urgent'],
				},
				{}
			);

			expect(result.success).toBe(true);
			const task = result.data as Task;
			expect(task.title).toBe('Complete task');
			expect(task.description).toBe('A detailed description');
			expect(task.listId).toBe('work');
			expect(task.dueDate).toBe('2026-01-15');
			expect(task.dueTime).toBe('14:00');
			expect(task.priority).toBe(2);
			expect(task.tags).toEqual(['important', 'urgent']);
		});

		it('includes reasoning and confidence', async () => {
			const command = createTaskCreateCommand(taskStore);
			const result = await command.handler({ title: 'Test task' }, {});

			expect(result.reasoning).toContain('Created task');
			expect(result.confidence).toBe(1.0);
		});
	});

	describe('task-update', () => {
		let existingTask: Task;

		beforeEach(() => {
			existingTask = taskStore.create({ title: 'Original task' });
		});

		it('updates task title', async () => {
			const command = createTaskUpdateCommand(taskStore);
			const result = await command.handler({ id: existingTask.id, title: 'Updated title' }, {});

			expect(result.success).toBe(true);
			expect((result.data as Task).title).toBe('Updated title');
		});

		it('updates task priority', async () => {
			const command = createTaskUpdateCommand(taskStore);
			const result = await command.handler({ id: existingTask.id, priority: 3 }, {});

			expect(result.success).toBe(true);
			expect((result.data as Task).priority).toBe(3);
		});

		it('fails when task not found', async () => {
			const command = createTaskUpdateCommand(taskStore);
			const result = await command.handler({ id: 'non-existent-id', title: 'New title' }, {});

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('NOT_FOUND');
		});
	});

	describe('task-delete', () => {
		let existingTask: Task;

		beforeEach(() => {
			existingTask = taskStore.create({ title: 'Task to delete' });
		});

		it('deletes an existing task', async () => {
			const command = createTaskDeleteCommand(taskStore);
			const result = await command.handler({ id: existingTask.id }, {});

			expect(result.success).toBe(true);
			expect((result.data as { deleted: boolean }).deleted).toBe(true);

			// Verify task is gone
			const found = taskStore.get(existingTask.id);
			expect(found).toBeNull();
		});

		it('includes warning about permanent action', async () => {
			const command = createTaskDeleteCommand(taskStore);
			const result = await command.handler({ id: existingTask.id }, {});

			expect(result.warnings).toBeDefined();
			expect(result.warnings?.length).toBeGreaterThan(0);
			expect(result.warnings?.[0].code).toBe('PERMANENT_ACTION');
		});

		it('fails when task not found', async () => {
			const command = createTaskDeleteCommand(taskStore);
			const result = await command.handler({ id: 'non-existent-id' }, {});

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('NOT_FOUND');
		});
	});

	describe('task-list', () => {
		beforeEach(() => {
			taskStore.create({ title: 'Task 1', priority: 1 });
			taskStore.create({ title: 'Task 2', priority: 2 });
			taskStore.create({ title: 'Task 3', priority: 3 });
		});

		it('lists all tasks', async () => {
			const command = createTaskListCommand(taskStore);
			const result = await command.handler({}, {});

			expect(result.success).toBe(true);
			expect((result.data as { tasks: Task[] }).tasks.length).toBe(3);
			expect((result.data as { total: number }).total).toBe(3);
		});

		it('filters by status', async () => {
			// Complete one task
			const tasks = taskStore.list({});
			taskStore.setStatus(tasks[0].id, 'completed');

			const command = createTaskListCommand(taskStore);
			const result = await command.handler({ status: 'pending' }, {});

			expect(result.success).toBe(true);
			expect((result.data as { tasks: Task[] }).tasks.length).toBe(2);
		});

		it('limits results', async () => {
			const command = createTaskListCommand(taskStore);
			const result = await command.handler({ limit: 2 }, {});

			expect(result.success).toBe(true);
			expect((result.data as { tasks: Task[] }).tasks.length).toBe(2);
		});

		it('includes reasoning', async () => {
			const command = createTaskListCommand(taskStore);
			const result = await command.handler({}, {});

			expect(result.reasoning).toContain('Found 3 tasks');
		});
	});
});
