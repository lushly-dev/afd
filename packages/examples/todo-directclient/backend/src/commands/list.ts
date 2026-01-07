/**
 * @fileoverview todo-list command
 */

import { z } from 'zod';
import { defineCommand, success } from '@lushly-dev/afd-server';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';

const inputSchema = z.object({
	completed: z.boolean().optional(),
	priority: z.enum(['low', 'medium', 'high']).optional(),
	search: z.string().optional(),
	sortBy: z.enum(['createdAt', 'updatedAt', 'priority', 'title']).default('createdAt'),
	sortOrder: z.enum(['asc', 'desc']).default('desc'),
	limit: z.number().int().min(1).max(100).default(20),
	offset: z.number().int().min(0).default(0),
});

export interface ListResult {
	todos: Todo[];
	total: number;
	hasMore: boolean;
}

export const listTodos = defineCommand<typeof inputSchema, ListResult>({
	name: 'todo-list',
	description: 'List todos with optional filtering and pagination',
	category: 'todo',
	tags: ['todo', 'list', 'read'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,

	async handler(input) {
		const todos = store.list({
			completed: input.completed,
			priority: input.priority,
			search: input.search,
			sortBy: input.sortBy,
			sortOrder: input.sortOrder,
			limit: input.limit,
			offset: input.offset,
		});

		// Get total count for pagination
		const allMatching = store.list({
			completed: input.completed,
			priority: input.priority,
			search: input.search,
		});

		const total = allMatching.length;
		const hasMore = input.offset + todos.length < total;

		return success(
			{ todos, total, hasMore },
			{
				reasoning: `Found ${total} todos, returning ${todos.length}`,
				confidence: 1.0,
			}
		);
	},
});
