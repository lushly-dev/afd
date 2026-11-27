/**
 * @fileoverview todo-toggle-batch command
 *
 * Demonstrates AFD batch toggle pattern with optional override.
 * Can either toggle each item's status or set all to a specific value.
 */

import type { CommandError } from '@lushly-dev/afd-core';
import { defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { TODO_EDIT_CONTEXTS } from '../contexts.js';
import { BatchSummarySchema, FailedByIdSchema, TodoSchema } from '../schemas.js';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';
import { stampFrom, todoNotFound } from './shared.js';

const inputSchema = z.object({
	ids: z
		.array(z.string().min(1, 'ID is required'))
		.min(1, 'At least one ID is required')
		.max(100, 'Maximum 100 toggles per batch'),
	/**
	 * If provided, sets all todos to this completion state.
	 * If not provided, toggles each todo's current state.
	 */
	completed: z.boolean().optional(),
});

/**
 * Result for a failed batch item
 */
export interface FailedToggle {
	/** Position in input array (0-indexed) */
	index: number;
	/** The ID that failed */
	id: string;
	/** Why it failed */
	error: CommandError;
}

/**
 * Batch toggle result
 */
export interface BatchToggleResult {
	/** Successfully toggled todos */
	succeeded: Todo[];
	/** Items that failed */
	failed: FailedToggle[];
	/** Summary statistics */
	summary: {
		total: number;
		successCount: number;
		failureCount: number;
		/** How many were marked complete */
		markedComplete: number;
		/** How many were marked incomplete */
		markedIncomplete: number;
	};
}

export const toggleBatch = defineCommand<typeof inputSchema, BatchToggleResult>({
	name: 'todo-toggle-batch',
	title: 'Toggle several todos',
	description:
		'Toggle the completion status of the listed todos, or set them all to completed: true or false',
	category: 'todo',
	contexts: TODO_EDIT_CONTEXTS,
	expose: { mcp: true },
	tags: ['todo', 'toggle', 'write', 'batch'],
	requires: ['todo-list'],
	mutation: true,
	idempotency: 'keyed',
	undoable: true,
	approval: 'not-required',
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND', 'PARTIAL_FAILURE'],

	output: z.object({
		succeeded: TodoSchema.array(),
		failed: FailedByIdSchema.array(),
		summary: BatchSummarySchema.extend({
			markedComplete: z.number(),
			markedIncomplete: z.number(),
		}),
	}),
	examples: [
		{
			title: 'Mark two todos done',
			input: { ids: ['todo-1700000000000-abc1234', 'todo-1700000000000-def5678'], completed: true },
		},
	],
	async handler(input, context) {
		const now = stampFrom(context).now;
		const succeeded: Todo[] = [];
		const failed: FailedToggle[] = [];
		let markedComplete = 0;
		let markedIncomplete = 0;
		// The todos this call changed, and the state each had before
		const changed: { id: string; previous: boolean }[] = [];

		// Determine operation mode
		const setMode = input.completed !== undefined;
		const targetState = input.completed;

		// Process each ID
		for (let i = 0; i < input.ids.length; i++) {
			const id = input.ids[i];
			if (!id) continue;

			// Check if todo exists
			const existing = await store.get(id);
			if (!existing) {
				failed.push({
					index: i,
					id,
					error: todoNotFound(id),
				});
				continue;
			}

			let updated: Todo | undefined;

			if (setMode) {
				// Set to specific state - only update if different
				if (existing.completed !== targetState) {
					updated = await store.update(id, { completed: targetState }, now);
					if (updated) changed.push({ id, previous: existing.completed });
				} else {
					// Already in desired state, just return as-is
					updated = existing;
				}
			} else {
				// Toggle current state
				updated = await store.toggle(id, now);
				if (updated) changed.push({ id, previous: existing.completed });
			}

			if (updated) {
				succeeded.push(updated);
				if (updated.completed) {
					markedComplete++;
				} else {
					markedIncomplete++;
				}
			} else {
				failed.push({
					index: i,
					id,
					error: {
						code: 'TOGGLE_FAILED',
						message: `Failed to toggle todo "${id}"`,
						suggestion: 'Try again or check if the todo still exists',
					},
				});
			}
		}

		const summary = {
			total: input.ids.length,
			successCount: succeeded.length,
			failureCount: failed.length,
			markedComplete,
			markedIncomplete,
		};

		// Build reasoning based on mode and results
		let reasoning: string;
		const modeDescription = setMode
			? `set to ${targetState ? 'complete' : 'incomplete'}`
			: 'toggled';

		if (failed.length === 0) {
			reasoning = `Successfully ${modeDescription} all ${succeeded.length} todos`;
			if (setMode) {
				reasoning += ` (${markedComplete} complete, ${markedIncomplete} incomplete)`;
			}
		} else if (succeeded.length === 0) {
			reasoning = `Failed to update any todos. All ${failed.length} IDs were not found.`;
		} else {
			reasoning = `${modeDescription.charAt(0).toUpperCase() + modeDescription.slice(1)} ${succeeded.length} of ${summary.total} todos. ${failed.length} were not found.`;
		}

		// Calculate confidence
		const confidence = summary.total > 0 ? summary.successCount / summary.total : 0;

		// Build warnings
		const warnings = [];

		if (failed.length > 0 && succeeded.length > 0) {
			warnings.push({
				code: 'PARTIAL_SUCCESS',
				message: `${failed.length} of ${summary.total} items could not be toggled`,
				severity: 'warning' as const,
			});
		}

		// One call undoes this only when every changed todo had the same state before.
		const previousStates = new Set(changed.map((item) => item.previous));
		const singleUndo = previousStates.size === 1;
		if (previousStates.size > 1) {
			warnings.push({
				code: 'NO_SINGLE_UNDO',
				message:
					'These todos had different states before, so no single call undoes this. Set each group back with todo-toggle-batch and completed, or each todo with todo-update.',
				severity: 'info' as const,
			});
		}

		return success(
			{ succeeded, failed, summary },
			{
				reasoning,
				confidence,
				warnings: warnings.length > 0 ? warnings : undefined,
				...(singleUndo && {
					undoCommand: 'todo-toggle-batch',
					undoArgs: {
						ids: changed.map((item) => item.id),
						completed: changed[0]?.previous,
					},
				}),
			}
		);
	},
});
