/**
 * @fileoverview list-list command
 */

import { z } from 'zod';
import { defineCommand, success } from '@afd/server';
import { store } from '../store/index.js';
import type { List } from '../types.js';

const inputSchema = z.object({
	search: z.string().optional(),
	sortBy: z.enum(['createdAt', 'updatedAt', 'name']).default('createdAt'),
	sortOrder: z.enum(['asc', 'desc']).default('desc'),
	limit: z.number().int().min(1).max(100).default(20),
	offset: z.number().int().min(0).default(0),
});

export interface ListListResult {
	lists: List[];
	total: number;
	hasMore: boolean;
}

export const listLists = defineCommand<typeof inputSchema, ListListResult>({
	name: 'list-list',
	description: 'List all lists with optional filtering and pagination',
	category: 'list',
	tags: ['list', 'list', 'read'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,

	async handler(input) {
		const lists = store.listLists({
			search: input.search,
			sortBy: input.sortBy,
			sortOrder: input.sortOrder,
			limit: input.limit,
			offset: input.offset,
		});

		// Get total count for pagination
		const allMatching = store.listLists({
			search: input.search,
		});

		const total = allMatching.length;
		const hasMore = input.offset + lists.length < total;

		// Build reasoning
		const filters: string[] = [];
		if (input.search) {
			filters.push(`matching "${input.search}"`);
		}

		const filterText = filters.length > 0 ? ` (${filters.join(', ')})` : '';

		return success(
			{ lists, total, hasMore },
			{
				reasoning: `Found ${total} lists${filterText}, returning ${lists.length} starting at offset ${input.offset}`,
				confidence: 1.0,
			}
		);
	},
});
