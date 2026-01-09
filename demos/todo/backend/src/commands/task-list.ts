/**
 * task-list command
 */
import { z } from 'zod';
import { defineCommand, success } from '@lushly-dev/afd-server';
import type { Task } from '../types.js';
import type { TaskStore } from '../stores/task-store.js';

const inputSchema = z.object({
	listId: z.string().optional().describe('Filter by list'),
	status: z.enum(['pending', 'completed', 'all']).optional().describe('Filter by status'),
	dueDate: z.string().optional().describe('Filter by due date'),
	limit: z.number().optional().describe('Max results'),
});

export interface TaskListResult {
	tasks: Task[];
	total: number;
}

export function createTaskListCommand(taskStore: TaskStore) {
	return defineCommand<typeof inputSchema, TaskListResult>({
		name: 'task-list',
		description: 'List tasks with optional filters',
		category: 'task',
		tags: ['task', 'list', 'read'],
		mutation: false,
		version: '1.0.0',
		input: inputSchema,
		errors: [],

		async handler(input) {
			const tasks = taskStore.list({
				listId: input.listId,
				status: input.status,
				dueDate: input.dueDate,
				limit: input.limit,
			});

			return success(
				{
					tasks,
					total: tasks.length,
				},
				{
					reasoning: `Found ${tasks.length} tasks`,
					confidence: 1.0,
				}
			);
		},
	});
}
