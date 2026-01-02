/**
 * @fileoverview todo.stats command
 */

import { z } from 'zod';
import { defineCommand, success } from '@afd/server';
import { store } from '../store/memory.js';
import type { TodoStats } from '../types.js';

const inputSchema = z.object({});

export const getStats = defineCommand<typeof inputSchema, TodoStats>({
	name: 'todo.stats',
	description: 'Get todo statistics',
	category: 'todo',
	mutation: false,
	version: '1.0.0',
	input: inputSchema,

	async handler() {
		const stats = store.getStats();

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
