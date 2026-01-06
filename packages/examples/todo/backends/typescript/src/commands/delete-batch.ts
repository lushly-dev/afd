/**
 * @fileoverview todo.deleteBatch command
 *
 * Demonstrates AFD batch delete pattern with warnings for destructive operations.
 */

import { z } from 'zod';
import { defineCommand, success } from '@afd/server';
import type { CommandError } from '@afd/core';
import { store } from '../store/memory.js';

const inputSchema = z.object({
	ids: z
		.array(z.string().min(1, 'ID is required'))
		.min(1, 'At least one ID is required')
		.max(100, 'Maximum 100 deletions per batch'),
});

/**
 * Result for a failed batch item
 */
export interface FailedDelete {
	/** Position in input array (0-indexed) */
	index: number;
	/** The ID that failed to delete */
	id: string;
	/** Why it failed */
	error: CommandError;
}

/**
 * Batch delete result
 */
export interface BatchDeleteResult {
	/** IDs that were successfully deleted */
	deletedIds: string[];
	/** Items that failed */
	failed: FailedDelete[];
	/** Summary statistics */
	summary: {
		total: number;
		successCount: number;
		failureCount: number;
	};
}

export const deleteBatch = defineCommand<typeof inputSchema, BatchDeleteResult>({
	name: 'todo-deleteBatch',
	description: 'Delete multiple todos at once',
	category: 'todo',
	tags: ['todo', 'delete', 'write', 'batch', 'destructive'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND', 'PARTIAL_FAILURE'],

	async handler(input) {
		const deletedIds: string[] = [];
		const failed: FailedDelete[] = [];

		// Process each ID
		for (let i = 0; i < input.ids.length; i++) {
			const id = input.ids[i]!;

			// Check if todo exists first
			const existing = store.get(id);
			if (!existing) {
				failed.push({
					index: i,
					id,
					error: {
						code: 'NOT_FOUND',
						message: `Todo with ID "${id}" not found`,
						suggestion: 'Use todo.list to see available todos',
					},
				});
				continue;
			}

			// Attempt deletion
			const deleted = store.delete(id);
			if (deleted) {
				deletedIds.push(id);
			} else {
				failed.push({
					index: i,
					id,
					error: {
						code: 'DELETE_FAILED',
						message: `Failed to delete todo "${id}"`,
						suggestion: 'Try again or check if the todo still exists',
					},
				});
			}
		}

		const summary = {
			total: input.ids.length,
			successCount: deletedIds.length,
			failureCount: failed.length,
		};

		// Build reasoning
		let reasoning: string;
		if (failed.length === 0) {
			reasoning = `Successfully deleted all ${deletedIds.length} todos`;
		} else if (deletedIds.length === 0) {
			reasoning = `Failed to delete any todos. All ${failed.length} IDs were not found.`;
		} else {
			reasoning = `Deleted ${deletedIds.length} of ${summary.total} todos. ${failed.length} were not found.`;
		}

		// Calculate confidence
		const confidence = summary.total > 0 ? summary.successCount / summary.total : 0;

		// Build warnings
		const warnings = [];

		// Always warn about destructive batch operation
		warnings.push({
			code: 'DESTRUCTIVE_BATCH',
			message: `This operation permanently deleted ${deletedIds.length} todos`,
			severity: 'caution' as const,
		});

		// Add partial success warning if applicable
		if (failed.length > 0 && deletedIds.length > 0) {
			warnings.push({
				code: 'PARTIAL_SUCCESS',
				message: `${failed.length} of ${summary.total} items could not be deleted`,
				severity: 'warning' as const,
			});
		}

		return success(
			{ deletedIds, failed, summary },
			{
				reasoning,
				confidence,
				warnings,
			}
		);
	},
});
