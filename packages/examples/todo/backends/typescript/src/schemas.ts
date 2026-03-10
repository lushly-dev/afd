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
});
