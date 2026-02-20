/**
 * @fileoverview todo.createBatch command
 *
 * Demonstrates AFD batch operation pattern with partial failure handling.
 * Creates multiple todos at once, reporting success/failure for each item.
 */

import type { CommandError } from '@lushly-dev/afd-core';
import { defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';

/**
 * Schema for a single todo item in a batch
 */
const todoItemSchema = z.object({
	title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
	description: z.string().max(1000).optional(),
	priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

const inputSchema = z.object({
	todos: z
		.array(todoItemSchema)
		.min(1, 'At least one todo is required')
		.max(100, 'Maximum 100 todos per batch'),
});

/**
 * Result for a failed batch item
 */
export interface FailedItem {
	/** Position in input array (0-indexed) */
	index: number;
	/** The original input that failed */
	input: unknown;
	/** Why it failed */
	error: CommandError;
}

/**
 * Batch operation result
 */
export interface BatchCreateResult {
	/** Successfully created todos */
	succeeded: Todo[];
	/** Items that failed */
	failed: FailedItem[];
	/** Summary statistics */
	summary: {
		total: number;
		successCount: number;
		failureCount: number;
	};
}

export const createBatch = defineCommand<typeof inputSchema, BatchCreateResult>({
	name: 'todo-createBatch',
	description: 'Create multiple todos at once with partial failure support',
	category: 'todo',
	tags: ['todo', 'create', 'write', 'batch'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['VALIDATION_ERROR', 'PARTIAL_FAILURE'],

	async handler(input) {
		const succeeded: Todo[] = [];
		const failed: FailedItem[] = [];

		// Process each todo item
		for (let i = 0; i < input.todos.length; i++) {
			const item = input.todos[i]!;

			try {
				// Validate individual item (already validated by Zod, but demonstrates pattern)
				if (!item.title || item.title.trim().length === 0) {
					failed.push({
						index: i,
						input: item,
						error: {
							code: 'VALIDATION_ERROR',
							message: 'Title is required',
							suggestion: 'Provide a non-empty title for this todo',
						},
					});
					continue;
				}

				// Create the todo
				const todo = store.create({
					title: item.title.trim(),
					description: item.description?.trim(),
					priority: item.priority,
				});

				succeeded.push(todo);
			} catch (err) {
				failed.push({
					index: i,
					input: item,
					error: {
						code: 'CREATE_ERROR',
						message: err instanceof Error ? err.message : 'Failed to create todo',
						suggestion: 'Check the input and try again',
					},
				});
			}
		}

		const summary = {
			total: input.todos.length,
			successCount: succeeded.length,
			failureCount: failed.length,
		};

		// Build reasoning based on results
		let reasoning: string;
		if (failed.length === 0) {
			reasoning = `Successfully created all ${succeeded.length} todos`;
		} else if (succeeded.length === 0) {
			reasoning = `Failed to create any todos. All ${failed.length} items had errors.`;
		} else {
			reasoning = `Created ${succeeded.length} of ${summary.total} todos. ${failed.length} failed validation.`;
		}

		// Calculate confidence based on success rate
		const confidence = summary.total > 0 ? summary.successCount / summary.total : 0;

		// Add warning if partial failure
		const warnings =
			failed.length > 0 && succeeded.length > 0
				? [
						{
							code: 'PARTIAL_SUCCESS',
							message: `${failed.length} of ${summary.total} items failed`,
							severity: 'warning' as const,
						},
					]
				: undefined;

		return success(
			{ succeeded, failed, summary },
			{
				reasoning,
				confidence,
				warnings,
			}
		);
	},
});
