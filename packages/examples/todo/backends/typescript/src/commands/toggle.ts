/**
 * @fileoverview todo-toggle command
 */

import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { TODO_EDIT_CONTEXTS } from '../contexts.js';
import { TodoSchema } from '../schemas.js';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';
import { stampFrom, todoNotFound } from './shared.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Todo ID is required'),
});

export const toggleTodo = defineCommand<typeof inputSchema, Todo>({
	name: 'todo-toggle',
	title: 'Toggle a todo',
	description: 'Set an open todo to done, or a done todo back to open; the result names the undo',
	category: 'todo',
	contexts: TODO_EDIT_CONTEXTS,
	expose: { mcp: true },
	tags: ['todo', 'toggle', 'write', 'single'],
	mutation: true,
	idempotency: 'keyed',
	undoable: true,
	approval: 'not-required',
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND'],

	output: TodoSchema,
	examples: [
		{ title: 'Mark a todo done, or open again', input: { id: 'todo-1700000000000-abc1234' } },
	],
	async handler(input, context) {
		const existing = await store.get(input.id);
		if (!existing) {
			return failure(todoNotFound(input.id));
		}

		const updated = await store.toggle(input.id, stampFrom(context).now);

		if (!updated) {
			return failure(todoNotFound(input.id));
		}

		const action = updated.completed ? 'Marked as completed' : 'Marked as pending';

		return success(updated, {
			reasoning: `${action}: "${updated.title}"`,
			confidence: 1.0,
			// Setting the previous value back is safe to repeat; toggling again is not
			undoCommand: 'todo-update',
			undoArgs: { id: updated.id, completed: existing.completed },
		});
	},
});
