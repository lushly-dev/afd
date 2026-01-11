/**
 * @fileoverview todo.create command
 */

import { z } from 'zod';
import { defineCommand, success } from '@lushly-dev/afd-server';
import { store } from '../store/index.js';
import type { Todo, Priority } from '../types.js';
import { PRIORITY_LABELS } from '../types.js';

const inputSchema = z.object({
	title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
	description: z.string().max(1000).optional(),
	priority: z.number().int().min(0).max(3).default(2) as z.ZodType<Priority, z.ZodTypeDef, Priority>,
	dueDate: z
		.string()
		.datetime({ message: 'Due date must be a valid ISO 8601 date-time' })
		.optional(),
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
			dueDate: input.dueDate,
		});

		const dueDateText = input.dueDate ? `, due ${new Date(input.dueDate).toLocaleDateString()}` : '';
		return success(todo, {
			reasoning: `Created todo "${todo.title}" with ${PRIORITY_LABELS[input.priority]} priority${dueDateText}`,
			confidence: 1.0,
		});
	},
});
