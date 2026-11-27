/**
 * @fileoverview todo-delete command
 */

import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { TODO_EDIT_CONTEXTS } from '../contexts.js';
import { store } from '../store/index.js';
import { stampFrom, todoNotFound } from './shared.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Todo ID is required'),
});

export interface DeleteResult {
	deleted: boolean;
	id: string;
}

export const deleteTodo = defineCommand<typeof inputSchema, DeleteResult>({
	name: 'todo-delete',
	title: 'Delete a todo',
	description:
		'Delete one todo by its id. It is kept with the deleted todos, and todo-restore brings it back until todo-clear empties them',
	category: 'todo',
	contexts: TODO_EDIT_CONTEXTS,
	expose: { mcp: true },
	tags: ['todo', 'delete', 'write', 'single', 'destructive'],
	mutation: true,
	idempotency: 'natural',
	destructive: true,
	undoable: true,
	// It can be undone, so it is not held for approval
	approval: 'not-required',
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND'],

	output: z.object({ deleted: z.boolean(), id: z.string() }),
	examples: [
		{
			title: 'Delete one todo; todo-restore brings it back',
			input: { id: 'todo-1700000000000-abc1234' },
		},
	],
	async handler(input, context) {
		const deleted = await store.delete(input.id, stampFrom(context).now);
		if (!deleted) {
			return failure(todoNotFound(input.id));
		}

		return success(
			{ deleted: true, id: input.id },
			{
				reasoning: `Deleted todo "${deleted.title}"; todo-restore brings it back`,
				confidence: 1.0,
				warnings: [
					{
						code: 'RESTORABLE',
						message:
							'Kept with the deleted todos: todo-restore brings it back until todo-clear empties them',
						severity: 'info',
					},
				],
				undoCommand: 'todo-restore',
				undoArgs: { ids: [input.id] },
			}
		);
	},
});
