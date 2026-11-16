/**
 * @fileoverview Shared Zod schemas for output shape declarations.
 *
 * These schemas mirror the TypeScript types in `types.ts` and are used
 * by commands to declare their output shape via `defineCommand({ output })`.
 */

import { z } from 'zod';

/**
 * Zod schema for a Todo item — matches the `Todo` interface in types.ts.
 */
export const TodoSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string().optional(),
	priority: z.enum(['low', 'medium', 'high']),
	completed: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
	completedAt: z.string().optional(),
	deletedAt: z.string().optional(),
});

/** An error inside a batch result: what failed and how to recover. */
const ItemErrorSchema = z.object({
	code: z.string(),
	message: z.string(),
	suggestion: z.string(),
});

/** A batch item that failed, named by its id (todo-delete-batch, todo-toggle-batch, todo-restore). */
export const FailedByIdSchema = z.object({
	index: z.number(),
	id: z.string(),
	error: ItemErrorSchema,
});

/** A todo-create-batch item that failed, with the input it was given. */
export const FailedCreateSchema = z.object({
	index: z.number(),
	input: z.unknown(),
	error: ItemErrorSchema,
});

/** The counts every batch result carries. */
export const BatchSummarySchema = z.object({
	total: z.number(),
	successCount: z.number(),
	failureCount: z.number(),
});

/** todo-stats' result. */
export const TodoStatsSchema = z.object({
	total: z.number(),
	completed: z.number(),
	pending: z.number(),
	byPriority: z.object({ low: z.number(), medium: z.number(), high: z.number() }),
	completionRate: z.number(),
});
