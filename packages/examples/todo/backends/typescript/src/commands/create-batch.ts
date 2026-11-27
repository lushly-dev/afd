/**
 * @fileoverview todo-create-batch command
 *
 * Demonstrates AFD batch operation pattern with partial failure handling.
 * Creates multiple todos at once, reporting success/failure for each item.
 */

import {
	AFD_IDEMPOTENCY_KEY_META_KEY,
	type CommandContext,
	type CommandError,
	type CommandResult,
	systemClock,
} from '@lushly-dev/afd-core';
import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { TODO_EDIT_CONTEXTS } from '../contexts.js';
import { BatchSummarySchema, FailedCreateSchema, TodoSchema } from '../schemas.js';
import { store } from '../store/index.js';
import type { Todo } from '../types.js';
import { stampFrom } from './shared.js';

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
	name: 'todo-create-batch',
	title: 'Create several todos',
	description: 'Create multiple todos at once with partial failure support',
	category: 'todo',
	contexts: TODO_EDIT_CONTEXTS,
	expose: { mcp: true },
	tags: ['todo', 'create', 'write', 'batch'],
	mutation: true,
	idempotency: 'keyed',
	undoable: true,
	approval: 'not-required',
	task: 'optional',
	version: '1.0.0',
	input: inputSchema,
	errors: ['VALIDATION_ERROR', 'PARTIAL_FAILURE'],

	output: z.object({
		succeeded: TodoSchema.array(),
		failed: FailedCreateSchema.array(),
		summary: BatchSummarySchema,
	}),
	examples: [
		{
			title: 'Two todos at once',
			input: {
				todos: [{ title: 'Net the brassicas' }, { title: 'Sow the broad beans', priority: 'low' }],
			},
		},
	],
	// Keyed in its handler, not by the server's idempotency step: it may run as an MCP task, on
	// which the step does not act (spec/idempotency.md, D5 and S11).
	handler(input, context) {
		const key = context.idempotencyKey;
		if (key === undefined) return createAll(input, context);
		const now = (context.clock ?? systemClock).now();
		const answers = answersOf(store, now);
		// The key's scope is the caller (its kind, id and whom it acts for) and the key (K5).
		const actor = context.actor;
		const scope = JSON.stringify([
			actor?.kind ?? null,
			actor?.id ?? null,
			actor?.onBehalfOf ?? null,
			key,
		]);
		const digest = JSON.stringify(input);
		const held = answers.get(scope);
		if (held) {
			return held.digest === digest
				? held.result
				: Promise.resolve(
						failure({
							code: 'IDEMPOTENCY_KEY_REUSED',
							message: 'This idempotency key is already held for a batch with other todos',
							suggestion:
								'Use a new idempotency key for a different batch. Reuse a key only to repeat the same batch.',
							retryable: false,
							recovery: { kind: 'stop' },
							details: { meta: AFD_IDEMPOTENCY_KEY_META_KEY },
						})
					);
		}
		// Kept before it settles, so a repeat that arrives while it runs waits for the same answer;
		// dropped if it fails, so a repeat after a failure runs again.
		const result = createAll(input, context);
		answers.set(scope, { digest, result, expiresAt: now + ANSWER_TTL_MS });
		void result.then(
			(settled) => {
				if (!settled.success) answers.delete(scope);
			},
			() => answers.delete(scope)
		);
		return result;
	},
});

/** How long a keyed batch's answer is kept: a day, as the server's idempotency step keeps one. */
const ANSWER_TTL_MS = 86_400_000;

interface Answer {
	digest: string;
	result: Promise<CommandResult<BatchCreateResult>>;
	expiresAt: number;
}

/**
 * The answers of keyed batches, kept per store so a new store starts with none, and for this
 * process only. A store that persists todos across restarts would commit the key with the todos in
 * one transaction instead, which is what lets a handler promise a batch is created once
 * (spec/idempotency.md, "Two tiers"); this example's promise ends with the process, as the
 * server's default idempotency store's does (S13).
 */
const answersByStore = new WeakMap<object, Map<string, Answer>>();

/** The answers kept for `owner`, without those expired at `now`. */
function answersOf(owner: object, now: number): Map<string, Answer> {
	let answers = answersByStore.get(owner);
	if (!answers) {
		answers = new Map();
		answersByStore.set(owner, answers);
	}
	for (const [scope, answer] of answers) if (now > answer.expiresAt) answers.delete(scope);
	return answers;
}

/** Create every todo of the batch. */
async function createAll(
	input: z.output<typeof inputSchema>,
	context: CommandContext
): Promise<CommandResult<BatchCreateResult>> {
	{
		const stamp = stampFrom(context);
		const succeeded: Todo[] = [];
		const failed: FailedItem[] = [];

		// Process each todo item
		for (let i = 0; i < input.todos.length; i++) {
			const item = input.todos[i];
			if (!item) continue;

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
				const todo = await store.create(
					{
						title: item.title.trim(),
						description: item.description?.trim(),
						priority: item.priority,
					},
					stamp
				);

				succeeded.push(todo);
				context.reportProgress?.(`Created ${succeeded.length} of ${input.todos.length} todos`);
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
				...(succeeded.length > 0 && {
					undoCommand: 'todo-delete-batch',
					undoArgs: { ids: succeeded.map((todo) => todo.id) },
				}),
			}
		);
	}
}
