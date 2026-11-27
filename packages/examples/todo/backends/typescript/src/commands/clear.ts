/**
 * @fileoverview todo-clear command
 *
 * The one todo change with no way back, so the one held for approval: any caller that is not
 * a person waits until a person approves (the server's approval middleware, `APPROVALS`).
 */

import type { CommandContext, CommandMiddleware } from '@lushly-dev/afd-core';
import { defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { TODO_EDIT_CONTEXTS } from '../contexts.js';
import { store } from '../store/index.js';

const inputSchema = z.object({
	all: z
		.boolean()
		.optional()
		.describe('If true, remove every todo, live and deleted, regardless of status'),
	deleted: z
		.boolean()
		.optional()
		.describe('If true, empty the deleted todos instead of removing completed ones'),
});

type ClearInput = z.infer<typeof inputSchema>;

export interface ClearResult {
	cleared: number;
	remaining: number;
	/** The todos removed for good */
	clearedIds: string[];
}

/** What a clear with this input removes: completed todos, deleted ones, or everything. */
function scope(input: ClearInput): 'all' | 'deleted' | 'completed' {
	if (input.all) return 'all';
	if (input.deleted) return 'deleted';
	return 'completed';
}

/** What a held clear would remove, read before the hold so the person sees counts. */
interface ClearCounts {
	live: number;
	deleted: number;
	completed: number;
}

/** Where {@link createClearCountsMiddleware} leaves the counts on a todo-clear call's context. */
const CLEAR_COUNTS = 'todo.clearCounts';

/**
 * Read the counts a todo-clear would affect before the approval middleware runs, since its
 * `summarize` hook cannot wait for the store. Place it outside the approval middleware.
 */
export function createClearCountsMiddleware(): CommandMiddleware {
	return async (commandName, _input, context, next) => {
		if (commandName === 'todo-clear') {
			const counts: ClearCounts = {
				live: await store.count(),
				deleted: (await store.list({ deleted: true })).length,
				completed: (await store.list({ completed: true })).length,
			};
			context[CLEAR_COUNTS] = counts;
		}
		return next();
	};
}

/**
 * The text a person approves: what goes for good, and how many that is when the call is held.
 * The approval covers the call's input, not those todos, so the text says the count is as of now.
 */
export function summarizeClear(input: unknown, context: CommandContext): string {
	const parsed = inputSchema.safeParse(input);
	const what = parsed.success ? scope(parsed.data) : 'completed';
	const counts = context[CLEAR_COUNTS] as ClearCounts | undefined;
	const plural = (count: number) => `${count} ${count === 1 ? 'todo' : 'todos'}`;
	const now = (count: number | undefined) => (count === undefined ? '' : ` (${plural(count)} now)`);
	switch (what) {
		case 'all':
			return `Remove every todo for good, live and deleted${now(counts && counts.live + counts.deleted)}`;
		case 'deleted':
			return `Empty the deleted todos for good${now(counts?.deleted)}`;
		default:
			return `Remove the completed todos for good${now(counts?.completed)}`;
	}
}

export const clearCompleted = defineCommand<typeof inputSchema, ClearResult>({
	name: 'todo-clear',
	title: 'Clear todos for good',
	description:
		'Remove todos for good: completed ones, or the deleted todos with deleted: true, or every todo with all: true. Nothing undoes it. Where the server holds clears for approval, a caller that is not a person waits for a person to approve; elsewhere it is gated only by its confirmation prompt, where the server enforces confirmations',
	category: 'todo',
	contexts: TODO_EDIT_CONTEXTS,
	expose: { mcp: true },
	tags: ['todo', 'clear', 'write', 'batch', 'destructive'],
	mutation: true,
	idempotency: 'natural',
	destructive: true,
	// Enforced when the server runs with CONFIRMATIONS=enforce (spec/confirmation-cases.json).
	confirmPrompt: 'Delete these todos? This cannot be undone.',
	// Nothing undoes a clear, so only a person runs it without approval.
	approval: (_input: ClearInput, context: CommandContext) =>
		context.actor?.kind === 'human' ? 'not-required' : 'required',
	version: '1.0.0',
	input: inputSchema,

	output: z.object({ cleared: z.number(), remaining: z.number(), clearedIds: z.string().array() }),
	examples: [
		{ title: 'Remove the completed todos', input: {} },
		{ title: 'Empty the deleted todos', input: { deleted: true } },
	],
	async handler(input) {
		const what = scope(input);
		const result =
			what === 'all'
				? await store.clearAll()
				: what === 'deleted'
					? await store.clearDeleted()
					: await store.clearCompleted();
		const cleared = result.clearedIds.length;
		const plural = cleared === 1 ? '' : 's';
		const reasoning =
			what === 'all'
				? `Cleared all ${cleared} todos`
				: what === 'deleted'
					? `Emptied ${cleared} deleted todo${plural}, ${result.remaining} remaining`
					: cleared > 0
						? `Cleared ${cleared} completed todo${plural}, ${result.remaining} remaining`
						: `No completed todos to clear, ${result.remaining} remaining`;

		return success(
			{ cleared, remaining: result.remaining, clearedIds: result.clearedIds },
			{
				reasoning,
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
