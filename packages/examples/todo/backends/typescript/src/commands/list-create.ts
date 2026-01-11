/**
 * @fileoverview list-create command
 */

import { z } from 'zod';
import { defineCommand, success } from '@afd/server';
import { store } from '../store/index.js';
import type { List } from '../types.js';

const inputSchema = z.object({
	name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
	description: z.string().max(500).optional(),
	todoIds: z.array(z.string()).optional(),
});

export const createList = defineCommand<typeof inputSchema, List>({
	name: 'list-create',
	description: 'Create a new list to group todos',
	category: 'list',
	tags: ['list', 'create', 'write', 'single'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['VALIDATION_ERROR'],

	async handler(input) {
		const list = store.createList({
			name: input.name,
			description: input.description,
			todoIds: input.todoIds,
		});

		const todoCount = input.todoIds?.length ?? 0;
		const todoText = todoCount > 0 ? ` with ${todoCount} todo${todoCount === 1 ? '' : 's'}` : '';

		return success(list, {
			reasoning: `Created list "${list.name}"${todoText}`,
			confidence: 1.0,
		});
	},
});
