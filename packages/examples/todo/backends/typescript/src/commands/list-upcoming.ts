/**
 * @fileoverview todo-list-upcoming command
 *
 * Filters tasks by due date to show items due in the future.
 * Part of the Today/Upcoming views feature.
 */

import { z } from 'zod';
import { defineCommand, success } from '@afd/server';
import type { Alternative } from '@afd/core';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';

const inputSchema = z.object({
	days: z.number().int().min(1).max(365).default(7).describe('Number of days to look ahead'),
	includeCompleted: z.boolean().default(false).describe('Include completed items'),
	priority: z.enum(['low', 'medium', 'high']).optional().describe('Filter by priority'),
	sortBy: z.enum(['dueDate', 'priority', 'title', 'createdAt']).default('dueDate'),
	sortOrder: z.enum(['asc', 'desc']).default('asc'),
	limit: z.number().int().min(1).max(100).default(20),
	offset: z.number().int().min(0).default(0),
});

export interface UpcomingResult {
	todos: Todo[];
	total: number;
	hasMore: boolean;
	daysAhead: number;
	/** Breakdown by time period */
	breakdown: {
		today: number;
		tomorrow: number;
		thisWeek: number;
		later: number;
	};
}

export const listUpcoming = defineCommand<typeof inputSchema, UpcomingResult>({
	name: 'todo-list-upcoming',
	description: 'List todos due in the upcoming days',
	category: 'todo',
	tags: ['todo', 'list', 'read', 'upcoming', 'due-date', 'filter'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,

	async handler(input) {
		const now = new Date();
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
		const endOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59, 999);
		const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59, 999);
		const endOfRange = new Date(now.getFullYear(), now.getMonth(), now.getDate() + input.days, 23, 59, 59, 999);

		// Get all upcoming todos within the range
		const allUpcoming = store.list({
			completed: input.includeCompleted ? undefined : false,
			priority: input.priority,
			dueAfter: startOfToday.toISOString(),
			dueBefore: endOfRange.toISOString(),
			sortBy: input.sortBy,
			sortOrder: input.sortOrder,
		});

		// Calculate breakdown
		const breakdown = {
			today: 0,
			tomorrow: 0,
			thisWeek: 0,
			later: 0,
		};

		for (const todo of allUpcoming) {
			if (!todo.dueDate) continue;
			const dueDate = new Date(todo.dueDate);

			if (dueDate <= endOfToday) {
				breakdown.today++;
			} else if (dueDate <= endOfTomorrow) {
				breakdown.tomorrow++;
			} else if (dueDate <= endOfWeek) {
				breakdown.thisWeek++;
			} else {
				breakdown.later++;
			}
		}

		const total = allUpcoming.length;

		// Apply pagination
		const paginatedTodos = allUpcoming.slice(input.offset, input.offset + input.limit);
		const hasMore = input.offset + paginatedTodos.length < total;

		// Build reasoning
		const parts: string[] = [];
		if (total > 0) {
			parts.push(`${total} upcoming in next ${input.days} days`);
			if (breakdown.today > 0) parts.push(`${breakdown.today} today`);
			if (breakdown.tomorrow > 0) parts.push(`${breakdown.tomorrow} tomorrow`);
		} else {
			parts.push(`No upcoming tasks in the next ${input.days} days`);
		}

		// Build alternatives
		const alternatives: Alternative<UpcomingResult>[] = [];

		// Offer different time ranges
		if (input.days === 7 && total < 5) {
			// Offer to look further ahead
			const longerRange = store.list({
				completed: false,
				dueAfter: startOfToday.toISOString(),
				dueBefore: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30).toISOString(),
				sortBy: 'dueDate',
				sortOrder: 'asc',
			});
			if (longerRange.length > total) {
				alternatives.push({
					data: {
						todos: longerRange.slice(0, input.limit),
						total: longerRange.length,
						hasMore: longerRange.length > input.limit,
						daysAhead: 30,
						breakdown: { today: 0, tomorrow: 0, thisWeek: 0, later: longerRange.length },
					},
					reason: `View ${longerRange.length} todos in next 30 days`,
					confidence: 0.7,
				});
			}
		}

		// Offer to filter by high priority
		if (!input.priority && total > 10) {
			const highPriority = allUpcoming.filter((t) => t.priority === 'high');
			if (highPriority.length > 0 && highPriority.length < total) {
				alternatives.push({
					data: {
						todos: highPriority.slice(0, input.limit),
						total: highPriority.length,
						hasMore: highPriority.length > input.limit,
						daysAhead: input.days,
						breakdown: { today: 0, tomorrow: 0, thisWeek: 0, later: highPriority.length },
					},
					reason: `View ${highPriority.length} high priority upcoming todos only`,
					confidence: 0.6,
				});
			}
		}

		return success(
			{
				todos: paginatedTodos,
				total,
				hasMore,
				daysAhead: input.days,
				breakdown,
			},
			{
				reasoning: parts.join(', '),
				confidence: 1.0,
				alternatives: alternatives.length > 0 ? alternatives : undefined,
			}
		);
	},
});
