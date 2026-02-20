/**
 * @fileoverview todo.toggleBatch command
 *
 * Demonstrates AFD batch toggle pattern with optional override.
 * Can either toggle each item's status or set all to a specific value.
 */

import type { CommandError } from '@lushly-dev/afd-core';
import { defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';

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
	name: 'todo-toggleBatch',
	description: 'Toggle completion status of multiple todos, or set all to a specific state',
	category: 'todo',
	tags: ['todo', 'toggle', 'write', 'batch'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND', 'PARTIAL_FAILURE'],

	async handler(input) {
		const succeeded: Todo[] = [];
		const failed: FailedToggle[] = [];
		let markedComplete = 0;
		let markedIncomplete = 0;

		// Determine operation mode
		const setMode = input.completed !== undefined;
		const targetState = input.completed;

		// Process each ID
		for (let i = 0; i < input.ids.length; i++) {
			const id = input.ids[i]!;

			// Check if todo exists
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

			let updated: Todo | undefined;

			if (setMode) {
				// Set to specific state - only update if different
				if (existing.completed !== targetState) {
					updated = store.toggle(id);
				} else {
					// Already in desired state, just return as-is
					updated = existing;
				}
			} else {
				// Toggle current state
				updated = store.toggle(id);
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

		return success(
			{ succeeded, failed, summary },
			{
				reasoning,
				confidence,
				warnings: warnings.length > 0 ? warnings : undefined,
			}
		);
	},
});
