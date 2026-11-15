/**
 * @fileoverview todo-create command
 */

import { defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { TODO_EDIT_CONTEXTS } from '../contexts.js';
import { TodoSchema } from '../schemas.js';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';
import { stampFrom } from './shared.js';

const inputSchema = z.object({
	title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
	description: z.string().max(1000).optional(),
	priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const createTodo = defineCommand<typeof inputSchema, Todo>({
	name: 'todo-create',
	description: 'Create a new todo item',
	category: 'todo',
	contexts: TODO_EDIT_CONTEXTS,
	expose: { mcp: true },
	tags: ['todo', 'create', 'write', 'single'],
	mutation: true,
	undoable: true,
	approval: 'not-required',
	version: '1.0.0',
	input: inputSchema,
	output: TodoSchema,
	errors: ['VALIDATION_ERROR'],

	async handler(input, context) {
		const todo = store.create(
			{
				title: input.title,
				description: input.description,
				priority: input.priority,
			},
			stampFrom(context)
		);

		return success(todo, {
			reasoning: `Created todo "${todo.title}" with ${input.priority} priority`,
			confidence: 1.0,
			undoCommand: 'todo-delete',
			undoArgs: { id: todo.id },
		});
	},
});
