/**
 * @fileoverview tag.remove command - Remove tags from a todo
 */

import { z } from 'zod';
import { defineCommand, success, failure } from '@afd/server';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Todo ID is required'),
	tags: z.array(z.string().min(1).max(50)).min(1, 'At least one tag is required'),
});

export const removeTags = defineCommand<typeof inputSchema, Todo>({
	name: 'tag-remove',
	description: 'Remove one or more tags from a todo',
	category: 'tag',
	tags: ['tag', 'remove', 'write', 'single'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND'],

	async handler(input) {
		const todo = store.removeTags(input.id, input.tags);

		if (!todo) {
			return failure({
				code: 'NOT_FOUND',
				message: `Todo with ID "${input.id}" not found`,
				suggestion: 'Use todo-list to see available todos',
			});
		}

		const removedCount = input.tags.length;
		return success(todo, {
			reasoning: `Removed ${removedCount} tag${removedCount === 1 ? '' : 's'} from "${todo.title}": ${input.tags.join(', ')}`,
			confidence: 1.0,
		});
	},
});
