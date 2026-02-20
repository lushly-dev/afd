/**
 * @fileoverview todo-create command
 */

import { defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';

const inputSchema = z.object({
	title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
	description: z.string().max(1000).optional(),
	priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const createTodo = defineCommand<typeof inputSchema, Todo>({
	name: 'todo-create',
	description: 'Create a new todo item',
	category: 'todo',
	tags: ['todo', 'create', 'write', 'single'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['VALIDATION_ERROR'],

	async handler(input) {
		const todo = store.create({
			title: input.title,
			description: input.description,
			priority: input.priority,
		});

		return success(todo, {
			reasoning: `Created todo "${todo.title}" with ${input.priority} priority`,
			confidence: 1.0,
		});
	},
});
