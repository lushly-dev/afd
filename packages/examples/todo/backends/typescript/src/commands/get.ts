/**
 * @fileoverview todo-get command
 */

import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { TODO_READ_CONTEXTS } from '../contexts.js';
import { TodoSchema } from '../schemas.js';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';
import { todoNotFound } from './shared.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Todo ID is required'),
});

export const getTodo = defineCommand<typeof inputSchema, Todo>({
	name: 'todo-get',
	title: 'Get a todo',
	description: 'Get a single todo by ID',
	category: 'todo',
	contexts: TODO_READ_CONTEXTS,
	expose: { mcp: true },
	tags: ['todo', 'get', 'read', 'single'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,
	output: TodoSchema,
	errors: ['NOT_FOUND'],

	examples: [{ title: 'One todo by id', input: { id: 'todo-1700000000000-abc1234' } }],
	async handler(input) {
		const todo = store.get(input.id);

		if (!todo) {
			return failure(todoNotFound(input.id));
		}

		return success(todo, {
			reasoning: `Retrieved todo "${todo.title}"`,
			confidence: 1.0,
		});
	},
});
