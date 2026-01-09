/**
 * task-create command
 */
import { z } from 'zod';
import { defineCommand, success } from '@lushly-dev/afd-server';
import type { Task } from '../types.js';
import type { TaskStore } from '../stores/task-store.js';

const inputSchema = z.object({
	title: z.string().min(1, 'Title is required').describe('Task title'),
	description: z.string().optional().describe('Task description'),
	listId: z.string().optional().describe('List to add task to (defaults to Inbox)'),
	dueDate: z.string().optional().describe('Due date (ISO format)'),
	dueTime: z.string().optional().describe('Due time (HH:mm format)'),
	priority: z
		.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
		.optional()
		.describe('Priority: 0=none, 1=low, 2=medium, 3=high'),
	tags: z.array(z.string()).optional().describe('Tags for the task'),
});

export function createTaskCreateCommand(taskStore: TaskStore) {
	return defineCommand<typeof inputSchema, Task>({
		name: 'task-create',
		description: 'Create a new task',
		category: 'task',
		tags: ['task', 'create', 'write', 'single'],
		mutation: true,
		version: '1.0.0',
		input: inputSchema,
		errors: ['VALIDATION_ERROR'],

		async handler(input) {
			const task = taskStore.create({
				title: input.title,
				description: input.description,
				listId: input.listId,
				dueDate: input.dueDate,
				dueTime: input.dueTime,
				priority: input.priority,
				tags: input.tags,
			});

			return success(task, {
				reasoning: `Created task "${task.title}"`,
				confidence: 1.0,
			});
		},
	});
}
