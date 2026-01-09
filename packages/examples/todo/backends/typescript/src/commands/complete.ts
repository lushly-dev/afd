/**
 * @fileoverview todo-complete command
 */

import { z } from 'zod';
import { defineCommand, success, failure } from '@afd/server';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Todo ID is required'),
});

export const completeTodo = defineCommand<typeof inputSchema, Todo>({
	name: 'todo-complete',
	description: 'Mark a todo as completed',
	category: 'todo',
	tags: ['todo', 'complete', 'write', 'single'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND', 'ALREADY_COMPLETED'],

	async handler(input) {
		const existing = store.get(input.id);
		if (!existing) {
			return failure({
				code: 'NOT_FOUND',
				message: `Todo with ID "${input.id}" not found`,
				suggestion: 'Use todo-list to see available todos',
			});
		}

		if (existing.completed) {
			return failure({
				code: 'ALREADY_COMPLETED',
				message: `Todo "${existing.title}" is already completed`,
				suggestion: 'Use todo-uncomplete to mark it as pending, or todo-toggle to switch the status',
			});
		}

		const updated = store.update(input.id, { completed: true });

		if (!updated) {
			return failure({
				code: 'NOT_FOUND',
				message: `Todo with ID "${input.id}" not found`,
				suggestion: 'Use todo-list to see available todos',
			});
		}

		return success(updated, {
			reasoning: `Marked as completed: "${updated.title}"`,
			confidence: 1.0,
		});
	},
});
