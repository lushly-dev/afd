/**
 * @fileoverview list-delete command
 */

import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { store } from '../store/index.js';

const inputSchema = z.object({
	id: z.string().min(1, 'List ID is required'),
});

export interface ListDeleteResult {
	deleted: boolean;
	id: string;
}

export const deleteList = defineCommand<typeof inputSchema, ListDeleteResult>({
	name: 'list-delete',
	description: 'Delete a list',
	category: 'list',
	tags: ['list', 'delete', 'write', 'single', 'destructive'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND'],

	async handler(input) {
		const existing = store.getList(input.id);
		if (!existing) {
			return failure({
				code: 'NOT_FOUND',
				message: `List with ID "${input.id}" not found`,
				suggestion: 'Use list-list to see available lists',
			});
		}

		const deleted = store.deleteList(input.id);

		if (!deleted) {
			return failure({
				code: 'NOT_FOUND',
				message: `List with ID "${input.id}" not found`,
				suggestion: 'Use list-list to see available lists',
			});
		}

		return success(
			{ deleted: true, id: input.id },
			{
				reasoning: `Deleted list "${existing.name}"`,
				confidence: 1.0,
				warnings: [
					{
						code: 'PERMANENT',
						message: 'This action cannot be undone',
						severity: 'info',
					},
				],
			}
		);
	},
});
