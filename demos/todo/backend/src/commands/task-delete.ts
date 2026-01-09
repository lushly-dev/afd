/**
 * task-delete command
 */
import { z } from 'zod';
import { defineCommand, success, failure } from '@lushly-dev/afd-server';
import type { TaskStore } from '../stores/task-store.js';

const inputSchema = z.object({
	id: z.string().describe('Task ID'),
});

export interface DeleteResult {
	deleted: boolean;
	id: string;
}

export function createTaskDeleteCommand(taskStore: TaskStore) {
	return defineCommand<typeof inputSchema, DeleteResult>({
		name: 'task-delete',
		description: 'Delete a task',
		category: 'task',
		tags: ['task', 'delete', 'write', 'single', 'destructive'],
		mutation: true,
		version: '1.0.0',
		input: inputSchema,
		errors: ['NOT_FOUND'],

		async handler(input) {
			const existingTask = taskStore.get(input.id);
			if (!existingTask) {
				return failure({
					code: 'NOT_FOUND',
					message: `Task ${input.id} not found`,
					suggestion: 'Check the task ID and try again',
				});
			}

			taskStore.delete(input.id);

			return success(
				{ deleted: true, id: input.id },
				{
					reasoning: `Deleted task ${input.id}`,
					confidence: 1.0,
					warnings: [
						{
							code: 'PERMANENT_ACTION',
							message: 'This action cannot be undone',
							severity: 'warning' as const,
						},
					],
				}
			);
		},
	});
}
