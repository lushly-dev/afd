/**
 * @fileoverview subtask-add command - Create a subtask under an existing todo
 */

import { z } from 'zod';
import { defineCommand, success, failure } from '@afd/server';
import { store } from '../store/index.js';
import type { Todo, Priority } from '../types.js';
import { PRIORITY_LABELS } from '../types.js';

const inputSchema = z.object({
	parentId: z.string().min(1, 'Parent ID is required'),
	title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
	description: z.string().max(1000).optional(),
	priority: z.number().int().min(0).max(3).default(2) as z.ZodType<Priority, z.ZodTypeDef, Priority>,
	dueDate: z
		.string()
		.datetime({ message: 'Due date must be a valid ISO 8601 date-time' })
		.optional(),
});

export const addSubtask = defineCommand<typeof inputSchema, Todo>({
	name: 'subtask-add',
	description: 'Add a subtask to an existing todo',
	category: 'todo',
	tags: ['todo', 'subtask', 'create', 'write'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND', 'VALIDATION_ERROR'],

	async handler(input) {
		// Verify parent exists
		const parent = store.get(input.parentId);
		if (!parent) {
			return failure({
				code: 'NOT_FOUND',
				message: `Parent todo with ID "${input.parentId}" not found`,
				suggestion: 'Use todo-list to find existing todos',
			});
		}

		const subtask = store.create({
			title: input.title,
			description: input.description,
			priority: input.priority,
			dueDate: input.dueDate,
			parentId: input.parentId,
		});

		const dueDateText = input.dueDate ? `, due ${new Date(input.dueDate).toLocaleDateString()}` : '';
		return success(subtask, {
			reasoning: `Created subtask "${subtask.title}" under parent "${parent.title}" with ${PRIORITY_LABELS[input.priority]} priority${dueDateText}`,
			confidence: 1.0,
		});
	},
});
