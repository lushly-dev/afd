/**
 * @fileoverview todo.update command
 */

import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { store } from '../store/index.js';
import type { Priority, Todo } from '../types.js';
import { PRIORITY_LABELS } from '../types.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Todo ID is required'),
	title: z.string().min(1).max(200).optional(),
	description: z.string().max(1000).optional(),
	completed: z.boolean().optional(),
	priority: (
		z.number().int().min(0).max(3) as z.ZodType<Priority, z.ZodTypeDef, Priority>
	).optional(),
	dueDate: z
		.string()
		.datetime({ message: 'Due date must be a valid ISO 8601 date-time' })
		.optional()
		.nullable(),
});

export const updateTodo = defineCommand<typeof inputSchema, Todo>({
	name: 'todo-update',
	description: 'Update a todo item',
	category: 'todo',
	tags: ['todo', 'update', 'write', 'single'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND', 'NO_CHANGES'],

	async handler(input) {
		const { id, ...updates } = input;

		// Check if there are any changes (null is a valid change for dueDate)
		const hasChanges = Object.entries(updates).some(
			([key, v]) => v !== undefined || (key === 'dueDate' && v === null)
		);
		if (!hasChanges) {
			return failure({
				code: 'NO_CHANGES',
				message: 'No fields to update',
				suggestion: 'Provide at least one of: title, description, completed, priority, dueDate',
			});
		}

		const existing = store.get(id);
		if (!existing) {
			return failure({
				code: 'NOT_FOUND',
				message: `Todo with ID "${id}" not found`,
				suggestion: 'Use todo.list to see available todos',
			});
		}

		const updated = store.update(id, {
			title: updates.title,
			description: updates.description,
			completed: updates.completed,
			priority: updates.priority,
			dueDate: updates.dueDate,
		});

		if (!updated) {
			return failure({
				code: 'NOT_FOUND',
				message: `Todo with ID "${id}" not found`,
				suggestion: 'Use todo.list to see available todos',
			});
		}

		// Build change summary
		const changes: string[] = [];
		if (updates.title) changes.push(`title to "${updates.title}"`);
		if (updates.description !== undefined) changes.push('description');
		if (updates.priority !== undefined)
			changes.push(`priority to ${PRIORITY_LABELS[updates.priority]}`);
		if (updates.dueDate !== undefined) {
			if (updates.dueDate === null) {
				changes.push('cleared due date');
			} else {
				changes.push(`due date to ${new Date(updates.dueDate).toLocaleDateString()}`);
			}
		}

		return success(updated, {
			reasoning: `Updated ${changes.join(', ')} for todo "${updated.title}"`,
			confidence: 1.0,
		});
	},
});
