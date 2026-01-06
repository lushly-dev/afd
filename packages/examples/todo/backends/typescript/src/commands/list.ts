/**
 * @fileoverview todo.list command
 *
 * Demonstrates AFD alternatives pattern: when filters are applied,
 * we also return the unfiltered result as an alternative option.
 */

import { z } from 'zod';
import { defineCommand, success } from '@afd/server';
import type { Alternative } from '@afd/core';
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

		// Build reasoning
		const filters: string[] = [];
		if (input.completed !== undefined) {
			filters.push(input.completed ? 'completed' : 'pending');
		}
		if (input.priority) {
			filters.push(`${input.priority} priority`);
		}
		if (input.search) {
			filters.push(`matching "${input.search}"`);
		}

		const filterText = filters.length > 0 ? ` (${filters.join(', ')})` : '';
		const isFiltered =
			input.completed !== undefined || input.priority !== undefined || input.search !== undefined;

		// Build alternatives when filtering
		// This demonstrates the AFD alternatives pattern - giving users other options
		const alternatives: Alternative<ListResult>[] = [];

		if (isFiltered) {
			// Get unfiltered results as an alternative
			const allTodos = store.list({
				sortBy: input.sortBy,
				sortOrder: input.sortOrder,
				limit: input.limit,
				offset: input.offset,
			});
			const allTotal = store.list({}).length;

			alternatives.push({
				data: {
					todos: allTodos,
					total: allTotal,
					hasMore: input.offset + allTodos.length < allTotal,
				},
				reason: `View all ${allTotal} todos without filters`,
				confidence: 1.0,
			});

			// If filtering by completed, offer the opposite
			if (input.completed !== undefined) {
				const oppositeTodos = store.list({
					completed: !input.completed,
					priority: input.priority,
					search: input.search,
					sortBy: input.sortBy,
					sortOrder: input.sortOrder,
					limit: input.limit,
					offset: input.offset,
				});
				const oppositeTotal = store.list({
					completed: !input.completed,
					priority: input.priority,
					search: input.search,
				}).length;

				if (oppositeTotal > 0) {
					alternatives.push({
						data: {
							todos: oppositeTodos,
							total: oppositeTotal,
							hasMore: input.offset + oppositeTodos.length < oppositeTotal,
						},
						reason: `View ${input.completed ? 'pending' : 'completed'} todos instead (${oppositeTotal})`,
						confidence: 1.0,
					});
				}
			}
		}

		return success(
			{ todos, total, hasMore },
			{
				reasoning: `Found ${total} todos${filterText}, returning ${todos.length} starting at offset ${input.offset}`,
				confidence: 1.0,
				alternatives: alternatives.length > 0 ? alternatives : undefined,
			}
		);
	},
});
