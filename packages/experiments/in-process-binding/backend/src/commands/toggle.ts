/**
 * @fileoverview todo-toggle command
 */

import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Todo ID is required'),
});

export const toggleTodo = defineCommand<typeof inputSchema, Todo>({
	name: 'todo-toggle',
	description: 'Toggle the completion status of a todo',
	category: 'todo',
	tags: ['todo', 'toggle', 'write', 'single'],
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
				suggestion: 'Use todo-list to see available todos',
			});
		}

		const updated = store.toggle(input.id);

		if (!updated) {
			return failure({
				code: 'NOT_FOUND',
				message: `Todo with ID "${input.id}" not found`,
				suggestion: 'Use todo-list to see available todos',
			});
		}

		const action = updated.completed ? 'Marked as completed' : 'Marked as pending';

		return success(updated, {
			reasoning: `${action}: "${updated.title}"`,
			confidence: 1.0,
		});
	},
});
