/**
 * @fileoverview todo.delete command
 */

import { z } from 'zod';
import { defineCommand, success, failure } from '@afd/server';
import { store } from '../store/memory.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Todo ID is required'),
});

export interface DeleteResult {
	deleted: boolean;
	id: string;
}

export const deleteTodo = defineCommand<typeof inputSchema, DeleteResult>({
	name: 'todo-delete',
	description: 'Delete a todo item',
	category: 'todo',
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND'],

	async handler(input) {
		const existing = store.get(input.id);
		if (!existing) {
			return failure({
				code: 'NOT_FOUND',
				message: `Todo with ID "${input.id}" not found`,
				suggestion: 'Use todo.list to see available todos',
			});
		}

		const deleted = store.delete(input.id);

		if (!deleted) {
			return failure({
				code: 'NOT_FOUND',
				message: `Todo with ID "${input.id}" not found`,
				suggestion: 'Use todo.list to see available todos',
			});
		}

		return success(
			{ deleted: true, id: input.id },
			{
				reasoning: `Deleted todo "${existing.title}"`,
				confidence: 1.0,
				warnings: [
					{
						code: 'PERMANENT',
						message: 'This action cannot be undone',
						severity: 'info',
					},
				],
			}
		);
	},
});
