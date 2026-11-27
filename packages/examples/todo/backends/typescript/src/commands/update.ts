/**
 * @fileoverview todo-update command
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
	title: z.string().min(1).max(200).optional(),
	description: z.string().max(1000).optional(),
	completed: z.boolean().optional(),
	priority: z.enum(['low', 'medium', 'high']).optional(),
});

export const updateTodo = defineCommand<typeof inputSchema, Todo>({
	name: 'todo-update',
	title: 'Update a todo',
	description:
		"Update a todo's title, description, priority or completion; the result names the undo",
	category: 'todo',
	contexts: TODO_EDIT_CONTEXTS,
	expose: { mcp: true },
	tags: ['todo', 'update', 'write', 'single'],
	mutation: true,
	idempotency: 'keyed',
	undoable: true,
	approval: 'not-required',
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND', 'NO_CHANGES'],

	output: TodoSchema,
	examples: [
		{
			title: 'Rename and reprioritise',
			input: {
				id: 'todo-1700000000000-abc1234',
				title: 'Order seed potatoes and onions',
				priority: 'high',
			},
		},
	],
	async handler(input, context) {
		const { id, ...updates } = input;

		// Check if there are any changes
		const hasChanges = Object.values(updates).some((v) => v !== undefined);
		if (!hasChanges) {
			return failure({
				code: 'NO_CHANGES',
				message: 'No fields to update',
				suggestion: 'Provide at least one of: title, description, completed, priority',
			});
		}

		const existing = await store.get(id);
		if (!existing) {
			return failure(todoNotFound(id));
		}

		const updated = await store.update(
			id,
			{
				title: updates.title,
				description: updates.description,
				completed: updates.completed,
				priority: updates.priority,
			},
			stampFrom(context).now
		);

		if (!updated) {
			return failure(todoNotFound(id));
		}

		// Build change summary
		const changes: string[] = [];
		if (updates.title) changes.push(`title to "${updates.title}"`);
		if (updates.description !== undefined) changes.push('description');
		if (updates.priority) changes.push(`priority to ${updates.priority}`);

		// The undo sets each changed field back; a description that was absent comes back as "",
		// which the store treats as none.
		const previous: Record<string, unknown> = { id };
		if (updates.title !== undefined) previous.title = existing.title;
		if (updates.description !== undefined) previous.description = existing.description ?? '';
		if (updates.completed !== undefined) previous.completed = existing.completed;
		if (updates.priority !== undefined) previous.priority = existing.priority;

		return success(updated, {
			reasoning: `Updated ${changes.join(', ')} for todo "${updated.title}"`,
			confidence: 1.0,
			undoCommand: 'todo-update',
			undoArgs: previous,
		});
	},
});
