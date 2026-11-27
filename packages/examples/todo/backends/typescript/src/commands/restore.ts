/**
 * @fileoverview todo-restore command
 *
 * Brings deleted todos back exactly as they were. It is the undo that todo-delete and
 * todo-delete-batch name in their results, and it reports each id it cannot restore the way
 * todo-delete-batch does.
 */

import type { CommandError } from '@lushly-dev/afd-core';
import { defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { TODO_EDIT_CONTEXTS } from '../contexts.js';
import { TodoSchema } from '../schemas.js';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';

const inputSchema = z.object({
	ids: z
		.array(z.string().min(1, 'ID is required'))
		.min(1, 'At least one ID is required')
		.max(100, 'Maximum 100 todos per restore'),
});

/** An id that was not restored. */
export interface FailedRestore {
	/** Position in the input array (0-indexed) */
	index: number;
	id: string;
	error: CommandError;
}

export interface RestoreResult {
	restoredIds: string[];
	/** The restored todos, as they were before the delete */
	restored: Todo[];
	failed: FailedRestore[];
	summary: {
		total: number;
		successCount: number;
		failureCount: number;
	};
}

export const restoreTodos = defineCommand<typeof inputSchema, RestoreResult>({
	name: 'todo-restore',
	title: 'Restore deleted todos',
	description:
		'Bring deleted todos back exactly as they were. Find deleted todos with todo-list { deleted: true }; a delete result names this command and its ids as its undo',
	category: 'todo',
	contexts: TODO_EDIT_CONTEXTS,
	expose: { mcp: true },
	tags: ['todo', 'restore', 'write', 'batch', 'undo'],
	mutation: true,
	idempotency: 'natural',
	undoable: true,
	approval: 'not-required',
	version: '1.0.0',
	input: inputSchema,
	output: z.object({
		restoredIds: z.array(z.string()),
		restored: TodoSchema.array(),
		failed: z.array(
			z.object({
				index: z.number(),
				id: z.string(),
				error: z.object({ code: z.string(), message: z.string(), suggestion: z.string() }),
			})
		),
		summary: z.object({
			total: z.number(),
			successCount: z.number(),
			failureCount: z.number(),
		}),
	}),
	errors: ['NOT_FOUND'],
	examples: [
		{
			title: 'Undo a delete',
			input: { ids: ['todo-1700000000000-abc1234'] },
		},
	],

	async handler(input) {
		const restored: Todo[] = [];
		const failed: FailedRestore[] = [];

		for (const [index, id] of input.ids.entries()) {
			const todo = await store.restore(id);
			if (todo) {
				restored.push(todo);
				continue;
			}
			failed.push({
				index,
				id,
				error: (await store.get(id))
					? {
							code: 'NOT_FOUND',
							message: `Todo "${id}" is not deleted`,
							suggestion: 'It is already a live todo: use todo-get to read it',
						}
					: {
							code: 'NOT_FOUND',
							message: `No deleted todo has ID "${id}"`,
							suggestion:
								'Use todo-list { deleted: true } to see the deleted todos, and todo-list to see the live ones',
						},
			});
		}

		const restoredIds = restored.map((todo) => todo.id);
		const summary = {
			total: input.ids.length,
			successCount: restored.length,
			failureCount: failed.length,
		};
		const reasoning =
			failed.length === 0
				? `Restored ${restored.length} todo${restored.length === 1 ? '' : 's'}`
				: restored.length === 0
					? `Restored none of ${summary.total}: no deleted todo has ${summary.total === 1 ? 'that ID' : 'those IDs'}`
					: `Restored ${restored.length} of ${summary.total} todos; ${failed.length} could not be restored`;

		return success(
			{ restoredIds, restored, failed, summary },
			{
				reasoning,
				confidence: summary.total > 0 ? summary.successCount / summary.total : 0,
				warnings:
					failed.length > 0 && restored.length > 0
						? [
								{
									code: 'PARTIAL_SUCCESS',
									message: `${failed.length} of ${summary.total} could not be restored`,
									severity: 'warning',
								},
							]
						: undefined,
				...(restoredIds.length > 0 && {
					undoCommand: 'todo-delete-batch',
					undoArgs: { ids: restoredIds },
				}),
			}
		);
	},
});
