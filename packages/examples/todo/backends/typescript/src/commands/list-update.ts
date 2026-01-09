/**
 * @fileoverview list-update command
 */

import { z } from 'zod';
import { defineCommand, success, failure } from '@afd/server';
import { store } from '../store/index.js';
import type { List } from '../types.js';

const inputSchema = z.object({
	id: z.string().min(1, 'List ID is required'),
	name: z.string().min(1).max(100).optional(),
	description: z.string().max(500).optional(),
	todoIds: z.array(z.string()).optional(),
});

export const updateList = defineCommand<typeof inputSchema, List>({
	name: 'list-update',
	description: 'Update a list',
	category: 'list',
	tags: ['list', 'update', 'write', 'single'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND', 'NO_CHANGES'],

	async handler(input) {
		const { id, ...updates } = input;

		// Check if there are any changes
		const hasChanges = Object.values(updates).some((v) => v !== undefined);
		if (!hasChanges) {
			return failure({
				code: 'NO_CHANGES',
				message: 'No fields to update',
				suggestion: 'Provide at least one of: name, description, todoIds',
			});
		}

		const existing = store.getList(id);
		if (!existing) {
			return failure({
				code: 'NOT_FOUND',
				message: `List with ID "${id}" not found`,
				suggestion: 'Use list-list to see available lists',
			});
		}

		const updated = store.updateList(id, {
			name: updates.name,
			description: updates.description,
			todoIds: updates.todoIds,
		});

		if (!updated) {
			return failure({
				code: 'NOT_FOUND',
				message: `List with ID "${id}" not found`,
				suggestion: 'Use list-list to see available lists',
			});
		}

		// Build change summary
		const changes: string[] = [];
		if (updates.name) changes.push(`name to "${updates.name}"`);
		if (updates.description !== undefined) changes.push('description');
		if (updates.todoIds !== undefined) changes.push(`todoIds (${updates.todoIds.length} items)`);

		return success(updated, {
			reasoning: `Updated ${changes.join(', ')} for list "${updated.name}"`,
			confidence: 1.0,
		});
	},
});
