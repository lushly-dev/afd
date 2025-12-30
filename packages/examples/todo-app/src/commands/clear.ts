/**
 * @fileoverview todo.clear command
 */

import { z } from 'zod';
import { defineCommand, success } from '@afd/server';
import { store } from '../store/memory.js';

const inputSchema = z.object({});

export interface ClearResult {
	cleared: number;
}

export const clearCompleted = defineCommand<typeof inputSchema, ClearResult>({
	name: 'todo.clear',
	description: 'Clear all completed todos',
	category: 'todo',
	mutation: true,
	version: '1.0.0',
	input: inputSchema,

	async handler() {
		const cleared = store.clearCompleted();

		return success(
			{ cleared },
			{
				reasoning:
					cleared > 0
						? `Cleared ${cleared} completed todo${cleared === 1 ? '' : 's'}`
						: 'No completed todos to clear',
				confidence: 1.0,
				warnings:
					cleared > 0
						? [
								{
									code: 'PERMANENT',
									message: 'This action cannot be undone',
									severity: 'info',
								},
							]
						: undefined,
			}
		);
	},
});
