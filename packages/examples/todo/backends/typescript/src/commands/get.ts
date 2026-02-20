/**
 * @fileoverview todo.get command
 */

import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Todo ID is required'),
});

export const getTodo = defineCommand<typeof inputSchema, Todo>({
	name: 'todo-get',
	description: 'Get a single todo by ID',
	category: 'todo',
	tags: ['todo', 'get', 'read', 'single'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND'],

	async handler(input) {
		const todo = store.get(input.id);

		if (!todo) {
			return failure({
				code: 'NOT_FOUND',
				message: `Todo with ID "${input.id}" not found`,
				suggestion: 'Use todo.list to see available todos',
			});
		}

		return success(todo, {
			reasoning: `Retrieved todo "${todo.title}"`,
			confidence: 1.0,
		});
	},
});
