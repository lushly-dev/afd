/**
 * @fileoverview todo-clear command
 *
 * The one todo change with no way back, so the one held for approval: any caller that is not
 * a person waits until a person approves (the server's approval middleware, `APPROVALS`).
 */

import type { CommandContext } from '@lushly-dev/afd-core';
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

/**
 * The text a person approves: what goes for good, and how many that is when the call is held.
 * The approval covers the call's input, not those todos, so the text says the count is as of now.
 */
export function summarizeClear(input: unknown): string {
	const parsed = inputSchema.safeParse(input);
	const what = parsed.success ? scope(parsed.data) : 'completed';
	const live = store.count();
	const deleted = store.list({ deleted: true }).length;
	const completed = store.list({ completed: true }).length;
	const plural = (count: number) => `${count} ${count === 1 ? 'todo' : 'todos'}`;
	switch (what) {
		case 'all':
			return `Remove every todo for good, live and deleted (${plural(live + deleted)} now)`;
		case 'deleted':
			return `Empty the deleted todos for good (${plural(deleted)} now)`;
		default:
			return `Remove the completed todos for good (${plural(completed)} now)`;
	}
}

export const clearCompleted = defineCommand<typeof inputSchema, ClearResult>({
	name: 'todo-clear',
	description:
		'Remove todos for good: completed ones, or the deleted todos with deleted: true, or every todo with all: true. A caller that is not a person waits for a person to approve',
	category: 'todo',
	contexts: TODO_EDIT_CONTEXTS,
	expose: { mcp: true },
	tags: ['todo', 'clear', 'write', 'batch', 'destructive'],
	mutation: true,
	destructive: true,
	// Enforced when the server runs with CONFIRMATIONS=enforce (spec/confirmation-cases.json).
	confirmPrompt: 'Delete these todos? This cannot be undone.',
	// Nothing undoes a clear, so only a person runs it without approval.
	approval: (_input: ClearInput, context: CommandContext) =>
		context.actor?.kind === 'human' ? 'not-required' : 'required',
	version: '1.0.0',
	input: inputSchema,

	async handler(input) {
		const what = scope(input);
		const result =
			what === 'all'
				? store.clearAll()
				: what === 'deleted'
					? store.clearDeleted()
					: store.clearCompleted();
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
