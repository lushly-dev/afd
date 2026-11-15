/**
 * @fileoverview todo-toggle command
 */

import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { TODO_EDIT_CONTEXTS } from '../contexts.js';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';
import { stampFrom, todoNotFound } from './shared.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Todo ID is required'),
});

export const toggleTodo = defineCommand<typeof inputSchema, Todo>({
	name: 'todo-toggle',
	description: 'Toggle the completion status of a todo',
	category: 'todo',
	contexts: TODO_EDIT_CONTEXTS,
	expose: { mcp: true },
	tags: ['todo', 'toggle', 'write', 'single'],
	mutation: true,
	undoable: true,
	approval: 'not-required',
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND'],

	async handler(input, context) {
		const existing = store.get(input.id);
		if (!existing) {
			return failure(todoNotFound(input.id));
		}

		const updated = store.toggle(input.id, stampFrom(context).now);

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
