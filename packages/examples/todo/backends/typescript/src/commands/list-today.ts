/**
 * @fileoverview todo-list-today command
 *
 * Filters tasks by due date to show items due today.
 * Part of the Today/Upcoming views feature.
 */

import { z } from 'zod';
import { defineCommand, success } from '@afd/server';
import type { Alternative } from '@afd/core';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';

const inputSchema = z.object({
	includeOverdue: z.boolean().default(true).describe('Include overdue items (past due date)'),
	includeCompleted: z.boolean().default(false).describe('Include completed items'),
	sortBy: z.enum(['dueDate', 'priority', 'title', 'createdAt']).default('priority'),
	sortOrder: z.enum(['asc', 'desc']).default('desc'),
	limit: z.number().int().min(1).max(100).default(20),
	offset: z.number().int().min(0).default(0),
});

export interface TodayResult {
	todos: Todo[];
	todayCount: number;
	overdueCount: number;
	total: number;
	hasMore: boolean;
}

export const listToday = defineCommand<typeof inputSchema, TodayResult>({
	name: 'todo-list-today',
	description: 'List todos due today, optionally including overdue items',
	category: 'todo',
	tags: ['todo', 'list', 'read', 'today', 'due-date', 'filter'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,

	async handler(input) {
		const now = new Date();
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

		// Get todos due today
		const todayTodos = store.list({
			completed: input.includeCompleted ? undefined : false,
			dueBefore: endOfToday.toISOString(),
			dueAfter: startOfToday.toISOString(),
			sortBy: input.sortBy,
			sortOrder: input.sortOrder,
		});

		// Get overdue todos (due before today and not completed)
		const overdueTodos = input.includeOverdue
			? store.list({
					completed: false,
					dueBefore: startOfToday.toISOString(),
					sortBy: input.sortBy,
					sortOrder: input.sortOrder,
				})
			: [];

		// Combine and sort
		let combinedTodos = [...overdueTodos, ...todayTodos];

		// Sort combined results
		combinedTodos.sort((a, b) => {
			let comparison = 0;
			switch (input.sortBy) {
				case 'priority':
					comparison = a.priority - b.priority;
					break;
				case 'title':
					comparison = a.title.localeCompare(b.title);
					break;
				case 'dueDate':
					if (!a.dueDate && !b.dueDate) comparison = 0;
					else if (!a.dueDate) comparison = 1;
					else if (!b.dueDate) comparison = -1;
					else comparison = a.dueDate.localeCompare(b.dueDate);
					break;
				case 'createdAt':
				default:
					comparison = a.createdAt.localeCompare(b.createdAt);
			}
			return input.sortOrder === 'asc' ? comparison : -comparison;
		});

		const total = combinedTodos.length;
		const todayCount = todayTodos.length;
		const overdueCount = overdueTodos.length;

		// Apply pagination
		const paginatedTodos = combinedTodos.slice(input.offset, input.offset + input.limit);
		const hasMore = input.offset + paginatedTodos.length < total;

		// Build reasoning
		const parts: string[] = [];
		if (todayCount > 0) {
			parts.push(`${todayCount} due today`);
		}
		if (overdueCount > 0) {
			parts.push(`${overdueCount} overdue`);
		}
		if (parts.length === 0) {
			parts.push('No tasks due today');
		}

		// Build alternatives
		const alternatives: Alternative<TodayResult>[] = [];

		// Offer to view upcoming if no tasks today
		if (total === 0) {
			const upcomingTodos = store.list({
				completed: false,
				dueAfter: endOfToday.toISOString(),
				sortBy: 'dueDate',
				sortOrder: 'asc',
				limit: input.limit,
			});
			if (upcomingTodos.length > 0) {
				alternatives.push({
					data: {
						todos: upcomingTodos,
						todayCount: 0,
						overdueCount: 0,
						total: upcomingTodos.length,
						hasMore: false,
					},
					reason: `View ${upcomingTodos.length} upcoming todos instead`,
					confidence: 0.8,
				});
			}
		}

		// Offer to exclude overdue if there are many
		if (input.includeOverdue && overdueCount > 3) {
			alternatives.push({
				data: {
					todos: todayTodos.slice(input.offset, input.offset + input.limit),
					todayCount,
					overdueCount: 0,
					total: todayCount,
					hasMore: input.offset + input.limit < todayCount,
				},
				reason: `View only today's ${todayCount} todos (exclude ${overdueCount} overdue)`,
				confidence: 0.7,
			});
		}

		return success(
			{
				todos: paginatedTodos,
				todayCount,
				overdueCount,
				total,
				hasMore,
			},
			{
				reasoning: parts.join(', '),
				confidence: 1.0,
				alternatives: alternatives.length > 0 ? alternatives : undefined,
			}
		);
	},
});
