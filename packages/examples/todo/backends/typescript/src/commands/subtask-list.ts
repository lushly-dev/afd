/**
 * @fileoverview subtask-list command - List all subtasks of a todo
 */

import { z } from 'zod';
import { defineCommand, success, failure } from '@afd/server';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';

const inputSchema = z.object({
	parentId: z.string().min(1, 'Parent ID is required'),
	completed: z.boolean().optional(),
	sortBy: z.enum(['createdAt', 'updatedAt', 'priority', 'title', 'dueDate']).default('createdAt'),
	sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export interface SubtaskListResult {
	subtasks: Todo[];
	total: number;
	completed: number;
	pending: number;
	parent: Todo;
}

export const listSubtasks = defineCommand<typeof inputSchema, SubtaskListResult>({
	name: 'subtask-list',
	description: 'List all subtasks of a todo',
	category: 'todo',
	tags: ['todo', 'subtask', 'list', 'read'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND'],

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

		const subtasks = store.list({
			parentId: input.parentId,
			completed: input.completed,
			sortBy: input.sortBy,
			sortOrder: input.sortOrder,
		});

		const completedCount = subtasks.filter((t) => t.completed).length;
		const pendingCount = subtasks.length - completedCount;

		const reasoning =
			subtasks.length === 0
				? `No subtasks found for "${parent.title}"`
				: `Found ${subtasks.length} subtask(s) for "${parent.title}" (${completedCount} completed, ${pendingCount} pending)`;

		return success(
			{
				subtasks,
				total: subtasks.length,
				completed: completedCount,
				pending: pendingCount,
				parent,
			},
			{
				reasoning,
				confidence: 1.0,
			}
		);
	},
});
