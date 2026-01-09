/**
 * @fileoverview todo-uncomplete command
 */

import { z } from 'zod';
import { defineCommand, success, failure } from '@lushly-dev/afd-server';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Todo ID is required'),
});

export const uncompleteTodo = defineCommand<typeof inputSchema, Todo>({
	name: 'todo-uncomplete',
	description: 'Mark a todo as not completed (pending)',
	category: 'todo',
	tags: ['todo', 'uncomplete', 'write', 'single'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND', 'NOT_COMPLETED'],

	async handler(input) {
		const existing = store.get(input.id);
		if (!existing) {
			return failure({
				code: 'NOT_FOUND',
				message: `Todo with ID "${input.id}" not found`,
				suggestion: 'Use todo-list to see available todos',
			});
		}

		if (!existing.completed) {
			return failure({
				code: 'NOT_COMPLETED',
				message: `Todo "${existing.title}" is not completed`,
				suggestion: 'Use todo-complete to mark it as completed, or todo-toggle to switch the status',
			});
		}

		const updated = store.update(input.id, { completed: false });

		if (!updated) {
			return failure({
				code: 'NOT_FOUND',
				message: `Todo with ID "${input.id}" not found`,
				suggestion: 'Use todo-list to see available todos',
			});
		}

		return success(updated, {
			reasoning: `Marked as pending: "${updated.title}"`,
			confidence: 1.0,
		});
	},
});
