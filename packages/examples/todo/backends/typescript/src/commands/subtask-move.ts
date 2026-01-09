/**
 * @fileoverview subtask-move command - Move a todo to become a subtask of another todo, or promote to root level
 */

import { z } from 'zod';
import { defineCommand, success, failure } from '@lushly-dev/afd-server';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Todo ID is required'),
	parentId: z.string().nullable().describe('New parent ID, or null to promote to root level'),
});

export const moveSubtask = defineCommand<typeof inputSchema, Todo>({
	name: 'subtask-move',
	description: 'Move a todo to become a subtask of another todo, or promote it to root level',
	category: 'todo',
	tags: ['todo', 'subtask', 'move', 'update', 'write'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND', 'CIRCULAR_REFERENCE', 'VALIDATION_ERROR'],

	async handler(input) {
		// Verify the todo exists
		const todo = store.get(input.id);
		if (!todo) {
			return failure({
				code: 'NOT_FOUND',
				message: `Todo with ID "${input.id}" not found`,
				suggestion: 'Use todo-list to find existing todos',
			});
		}

		// If setting a parent, verify it exists and won't create a cycle
		if (input.parentId !== null) {
			const newParent = store.get(input.parentId);
			if (!newParent) {
				return failure({
					code: 'NOT_FOUND',
					message: `Parent todo with ID "${input.parentId}" not found`,
					suggestion: 'Use todo-list to find existing todos',
				});
			}

			// Check for circular reference using store helper
			if (store.wouldCreateCycle(input.id, input.parentId)) {
				return failure({
					code: 'CIRCULAR_REFERENCE',
					message: 'Cannot move a todo under one of its own subtasks',
					suggestion: 'Choose a different parent todo',
				});
			}
		}

		// Update the parent
		const updated = store.update(input.id, { parentId: input.parentId });
		if (!updated) {
			return failure({
				code: 'NOT_FOUND',
				message: `Failed to update todo "${input.id}"`,
				suggestion: 'The todo may have been deleted',
			});
		}

		const oldParentText = todo.parentId ? `todo "${todo.parentId}"` : 'root level';
		const newParentText = input.parentId === null ? 'root level' : `todo "${input.parentId}"`;
		const reasoning =
			input.parentId === null
				? `Promoted "${todo.title}" to root level`
				: `Moved "${todo.title}" from ${oldParentText} to ${newParentText}`;

		return success(updated, {
			reasoning,
			confidence: 1.0,
			warnings:
				todo.parentId !== (input.parentId ?? undefined)
					? [
							{
								code: 'HIERARCHY_CHANGED',
								message: `Todo "${todo.title}" parent changed`,
							},
						]
					: undefined,
		});
	},
});
