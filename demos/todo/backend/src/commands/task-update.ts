/**
 * task-update command
 */
import { z } from 'zod';
import { defineCommand, success, failure } from '@lushly-dev/afd-server';
import type { Task } from '../types.js';
import type { TaskStore } from '../stores/task-store.js';

const inputSchema = z.object({
	id: z.string().describe('Task ID'),
	title: z.string().min(1).optional().describe('Task title'),
	description: z.string().optional().describe('Task description'),
	listId: z.string().optional().describe('List ID'),
	dueDate: z.string().optional().describe('Due date (ISO format)'),
	dueTime: z.string().optional().describe('Due time (HH:mm format)'),
	priority: z
		.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
		.optional()
		.describe('Priority: 0=none, 1=low, 2=medium, 3=high'),
	tags: z.array(z.string()).optional().describe('Tags for the task'),
});

export function createTaskUpdateCommand(taskStore: TaskStore) {
	return defineCommand<typeof inputSchema, Task>({
		name: 'task-update',
		description: 'Update an existing task',
		category: 'task',
		tags: ['task', 'update', 'write', 'single'],
		mutation: true,
		version: '1.0.0',
		input: inputSchema,
		errors: ['NOT_FOUND', 'VALIDATION_ERROR'],

		async handler(input) {
			const existingTask = taskStore.get(input.id);
			if (!existingTask) {
				return failure({
					code: 'NOT_FOUND',
					message: `Task ${input.id} not found`,
					suggestion: 'Check the task ID and try again',
				});
			}

			const { id, ...updates } = input;
			const task = taskStore.update(id, updates);

			return success(task, {
				reasoning: `Updated task "${task.title}"`,
				confidence: 1.0,
			});
		},
	});
}
