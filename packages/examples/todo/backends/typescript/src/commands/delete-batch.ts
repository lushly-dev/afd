/**
 * @fileoverview todo-delete-batch command
 *
 * Demonstrates AFD batch delete pattern with warnings for destructive operations.
 */

import type { CommandError } from '@lushly-dev/afd-core';
import { defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { TODO_EDIT_CONTEXTS } from '../contexts.js';
import { BatchSummarySchema, FailedByIdSchema } from '../schemas.js';
import { store } from '../store/index.js';
import { stampFrom, todoNotFound } from './shared.js';

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
	name: 'todo-delete-batch',
	title: 'Delete several todos',
	description:
		'Remove up to 100 todos in one call, reporting each id that fails. They stay restorable with todo-restore until todo-clear empties the deleted todos',
	category: 'todo',
	contexts: TODO_EDIT_CONTEXTS,
	expose: { mcp: true },
	tags: ['todo', 'delete', 'write', 'batch', 'destructive'],
	mutation: true,
	idempotency: 'natural',
	destructive: true,
	undoable: true,
	// It can be undone, so it is not held for approval
	approval: 'not-required',
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND', 'PARTIAL_FAILURE'],

	output: z.object({
		deletedIds: z.string().array(),
		failed: FailedByIdSchema.array(),
		summary: BatchSummarySchema,
	}),
	examples: [
		{
			title: 'Delete two todos',
			input: { ids: ['todo-1700000000000-abc1234', 'todo-1700000000000-def5678'] },
		},
	],
	async handler(input, context) {
		const now = stampFrom(context).now;
		const deletedIds: string[] = [];
		const failed: FailedDelete[] = [];

		// Process each ID
		for (let i = 0; i < input.ids.length; i++) {
			const id = input.ids[i];
			if (!id) continue;

			// Check if todo exists first
			const existing = await store.get(id);
			if (!existing) {
				failed.push({
					index: i,
					id,
					error: todoNotFound(id),
				});
				continue;
			}

			// Attempt deletion
			const deleted = await store.delete(id, now);
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

		if (deletedIds.length > 0) {
			warnings.push({
				code: 'DESTRUCTIVE_BATCH',
				message: `Deleted ${deletedIds.length} todos; todo-restore brings them back until todo-clear empties the deleted todos`,
				severity: 'caution' as const,
			});
		}

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
				warnings: warnings.length > 0 ? warnings : undefined,
				...(deletedIds.length > 0 && {
					undoCommand: 'todo-restore',
					undoArgs: { ids: deletedIds },
				}),
			}
		);
	},
});
