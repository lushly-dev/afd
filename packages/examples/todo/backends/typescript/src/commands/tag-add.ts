/**
 * @fileoverview tag.add command - Add tags to a todo
 */

import { z } from 'zod';
import { defineCommand, success, failure } from '@afd/server';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Todo ID is required'),
	tags: z.array(z.string().min(1).max(50)).min(1, 'At least one tag is required'),
});

export const addTags = defineCommand<typeof inputSchema, Todo>({
	name: 'tag-add',
	description: 'Add one or more tags to a todo',
	category: 'tag',
	tags: ['tag', 'add', 'write', 'single'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND'],

	async handler(input) {
		const todo = store.addTags(input.id, input.tags);

		if (!todo) {
			return failure({
				code: 'NOT_FOUND',
				message: `Todo with ID "${input.id}" not found`,
				suggestion: 'Use todo-list to see available todos',
			});
		}

		const addedCount = input.tags.length;
		return success(todo, {
			reasoning: `Added ${addedCount} tag${addedCount === 1 ? '' : 's'} to "${todo.title}": ${input.tags.join(', ')}`,
			confidence: 1.0,
		});
	},
});
