/**
 * @fileoverview todo-stats command
 */

import { defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { TODO_READ_CONTEXTS } from '../contexts.js';
import { TodoStatsSchema } from '../schemas.js';
import { store } from '../store/index.js';
import type { TodoStats } from '../types.js';

const inputSchema = z.object({});

export const getStats = defineCommand<typeof inputSchema, TodoStats>({
	name: 'todo-stats',
	title: 'Todo statistics',
	description: 'Compute counts of the live todos by status and priority, and the completion rate',
	category: 'todo',
	contexts: TODO_READ_CONTEXTS,
	expose: { mcp: true },
	tags: ['todo', 'stats', 'read', 'safe'],
	requires: ['todo-list'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,

	output: TodoStatsSchema,
	examples: [{ title: 'Counts by status and priority', input: {} }],
	async handler() {
		const stats = await store.getStats();

		// Build reasoning with summary
		const parts: string[] = [];

		if (stats.total === 0) {
			parts.push('No todos yet');
		} else {
			parts.push(`${stats.total} total todos`);
			parts.push(`${stats.completed} completed`);
			parts.push(`${stats.pending} pending`);
			parts.push(`${Math.round(stats.completionRate * 100)}% completion rate`);
		}

		return success(stats, {
			reasoning: parts.join(', '),
			confidence: 1.0,
		});
	},
});
