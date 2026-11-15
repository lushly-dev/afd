/**
 * @fileoverview todo-history command
 *
 * Reads the change history that `createHistoryMiddleware` records (src/history.ts): what
 * changed, who changed it, when, and how to undo it. An entry offers its undo only while it is
 * the latest change to each of its todos, so undoing an old entry never overwrites a later edit.
 */

import { defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { TODO_READ_CONTEXTS } from '../contexts.js';
import { store } from '../store/index.js';
import type { ChangeEntry } from '../types.js';

const inputSchema = z.object({
	limit: z.number().int().min(1).max(100).default(20),
	offset: z.number().int().min(0).default(0),
	actor: z
		.string()
		.min(1)
		.optional()
		.describe('Only changes by this kind of actor: human, agent, service, script or test'),
	todoId: z.string().min(1).optional().describe('Only changes that touched this todo'),
});

/** One change as todo-history returns it. */
export interface HistoryEntry extends ChangeEntry {
	/** Set when a later change touched the same todos, so this one's undo is no longer offered */
	superseded?: true;
}

export interface HistoryResult {
	entries: HistoryEntry[];
	total: number;
	hasMore: boolean;
}

/**
 * Newest first, each entry's undo kept only while no later change touched its todos.
 */
export function withCurrentUndo(changes: readonly ChangeEntry[]): HistoryEntry[] {
	const touchedLater = new Set<string>();
	const entries: HistoryEntry[] = [];
	for (const change of [...changes].reverse()) {
		const superseded = change.ids.some((id) => touchedLater.has(id));
		for (const id of change.ids) touchedLater.add(id);
		if (superseded && change.undoCommand) {
			const { undoCommand: _command, undoArgs: _args, ...rest } = change;
			entries.push({ ...rest, superseded: true });
		} else {
			entries.push({ ...change });
		}
	}
	return entries;
}

export const getHistory = defineCommand<typeof inputSchema, HistoryResult>({
	name: 'todo-history',
	title: 'Todo change history',
	// A literal, so tools that read descriptions without running code (alfred) see it; it states
	// HISTORY_LIMIT, which undo.test.ts checks.
	description:
		'See the recent changes to the todos, newest first: what changed, who changed it, when, and the undo command and arguments for each change that is still the latest to its todos. Keeps the latest 1000 changes',
	category: 'todo',
	contexts: TODO_READ_CONTEXTS,
	expose: { mcp: true },
	tags: ['todo', 'history', 'read', 'undo'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,
	output: z.object({
		entries: z.array(
			z.object({
				seq: z.number(),
				at: z.string(),
				actor: z.object({ kind: z.string(), id: z.string().optional() }),
				command: z.string(),
				ids: z.array(z.string()),
				undoCommand: z.string().optional(),
				undoArgs: z.record(z.string(), z.unknown()).optional(),
				superseded: z.literal(true).optional(),
			})
		),
		total: z.number(),
		hasMore: z.boolean(),
	}),
	examples: [
		{ title: 'The last five changes', input: { limit: 5 } },
		{ title: 'What agents changed', input: { actor: 'agent' } },
	],

	async handler(input) {
		const matching = withCurrentUndo(store.history()).filter(
			(entry) =>
				(input.actor === undefined || entry.actor.kind === input.actor) &&
				(input.todoId === undefined || entry.ids.includes(input.todoId))
		);
		const entries = matching.slice(input.offset, input.offset + input.limit);
		const total = matching.length;
		const latest = entries[0];

		return success(
			{ entries, total, hasMore: input.offset + entries.length < total },
			{
				reasoning:
					total === 0
						? 'No changes recorded that match'
						: `${total} change${total === 1 ? '' : 's'} recorded${latest ? `; the latest shown is ${latest.command} by ${latest.actor.kind} at ${latest.at}` : ''}`,
				confidence: 1.0,
			}
		);
	},
});
