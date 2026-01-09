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
import type { Todo, Priority } from '../types.js';
import { PRIORITY_LABELS } from '../types.js';

const inputSchema = z.object({
	completed: z.boolean().optional(),
	priority: (z.number().int().min(0).max(3) as z.ZodType<Priority>).optional(),
	search: z.string().optional(),
	dueBefore: z
		.string()
		.datetime({ message: 'dueBefore must be a valid ISO 8601 date-time' })
		.optional(),
	dueAfter: z
		.string()
		.datetime({ message: 'dueAfter must be a valid ISO 8601 date-time' })
		.optional(),
	overdue: z.boolean().optional(),
	tags: z.array(z.string()).optional(),
	anyTag: z.array(z.string()).optional(),
	sortBy: z.enum(['createdAt', 'updatedAt', 'priority', 'title', 'dueDate']).default('createdAt'),
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
			dueBefore: input.dueBefore,
			dueAfter: input.dueAfter,
			overdue: input.overdue,
			tags: input.tags,
			anyTag: input.anyTag,
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
			dueBefore: input.dueBefore,
			dueAfter: input.dueAfter,
			overdue: input.overdue,
			tags: input.tags,
			anyTag: input.anyTag,
		});

		const total = allMatching.length;
		const hasMore = input.offset + todos.length < total;

		// Build reasoning
		const filters: string[] = [];
		if (input.completed !== undefined) {
			filters.push(input.completed ? 'completed' : 'pending');
		}
		if (input.priority !== undefined) {
			filters.push(`${PRIORITY_LABELS[input.priority]} priority`);
		}
		if (input.search) {
			filters.push(`matching "${input.search}"`);
		}
		if (input.dueBefore) {
			filters.push(`due before ${new Date(input.dueBefore).toLocaleDateString()}`);
		}
		if (input.dueAfter) {
			filters.push(`due after ${new Date(input.dueAfter).toLocaleDateString()}`);
		}
		if (input.overdue !== undefined) {
			filters.push(input.overdue ? 'overdue' : 'not overdue');
		}
		if (input.tags && input.tags.length > 0) {
			filters.push(`tagged with all of [${input.tags.join(', ')}]`);
		}
		if (input.anyTag && input.anyTag.length > 0) {
			filters.push(`tagged with any of [${input.anyTag.join(', ')}]`);
		}

		const filterText = filters.length > 0 ? ` (${filters.join(', ')})` : '';
		const isFiltered =
			input.completed !== undefined ||
			input.priority !== undefined ||
			input.search !== undefined ||
			input.dueBefore !== undefined ||
			input.dueAfter !== undefined ||
			input.overdue !== undefined ||
			(input.tags !== undefined && input.tags.length > 0) ||
			(input.anyTag !== undefined && input.anyTag.length > 0);

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
