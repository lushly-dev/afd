/**
 * Specification-authored execution-controls vectors (`spec/vectors/execution-controls.json`;
 * `spec/execution-controls.md`, #1737, #2128).
 *
 * Runs every case in the vector file and asserts that `gaps.typescript` is empty/absent.
 */
import { readFileSync } from 'node:fs';
import {
	type BatchRequest,
	DEFAULT_MAX_BATCH_PARALLELISM,
	DEFAULT_MAX_BATCH_SIZE,
	executeBatch,
	failure,
	success,
} from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DEFAULT_COMMAND_TIMEOUT_MS, withCommandDeadlines } from './command-timeout.js';
import { createDirectRegistry } from './direct-registry.js';
import { createRetryMiddleware } from './middleware.js';
import { defineCommand } from './schema.js';
import { createMcpServer } from './server.js';
import { DEFAULT_MAX_VALIDATION_ISSUES } from './validation.js';

interface ExecutionControlsVectors {
	defaults: {
		defaultTimeoutMs: number;
		maxBatchSize: number;
		maxBatchParallelism: number;
		maxValidationIssues: number;
	};
	gaps: Record<string, Record<string, string>>;
	cases: Array<Record<string, unknown>>;
}

const vectors: ExecutionControlsVectors = JSON.parse(
	readFileSync(new URL('../../../spec/vectors/execution-controls.json', import.meta.url), 'utf8')
);

const EXECUTED_CONTROLS = new Set([
	'deadline',
	'defaultDeadline',
	'singleCancellation',
	'batchCancellation',
	'batchLimits',
	'validationIssueCap',
	'retryMutation',
]);

describe('spec/vectors/execution-controls.json', () => {
	it('pins the normative defaults and has no remaining TypeScript gaps', () => {
		expect(vectors.defaults).toEqual({
			defaultTimeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
			maxBatchSize: DEFAULT_MAX_BATCH_SIZE,
			maxBatchParallelism: DEFAULT_MAX_BATCH_PARALLELISM,
			maxValidationIssues: DEFAULT_MAX_VALIDATION_ISSUES,
		});
		expect(vectors.gaps.typescript).toBeUndefined();
		for (const entry of vectors.cases) {
			const control = String(entry.control);
			expect(
				EXECUTED_CONTROLS.has(control),
				`control ${control} must be executed by TypeScript`
			).toBe(true);
		}
	});

	it('per-call-deadline-timeout: returns TIMEOUT (retryable) and aborts context.signal', async () => {
		const vector = vectors.cases.find((c) => c.id === 'per-call-deadline-timeout');
		expect(vector).toBeDefined();
		const call = vector?.call as {
			command: string;
			timeoutMs: number;
			handler: { delayMs: number };
		};
		const expected = vector?.expect as {
			success: boolean;
			code: string;
			retryable: boolean;
			signalAborted: boolean;
		};

		let observedSignal: AbortSignal | undefined;
		const slow = defineCommand({
			name: call.command,
			description: 'Slow command for deadline vector',
			input: z.object({}),
			handler: async (_input, context) => {
				observedSignal = context.signal;
				await new Promise((resolve) => setTimeout(resolve, call.handler.delayMs));
				return success({ done: true });
			},
		});
		const registry = createDirectRegistry([slow], {
			middleware: withCommandDeadlines([]),
		});

		const result = await registry.execute(call.command, {}, { timeout: call.timeoutMs });
		expect(result.success).toBe(expected.success);
		expect(result.error?.code).toBe(expected.code);
		expect(result.error?.retryable).toBe(expected.retryable);
		expect(observedSignal?.aborted).toBe(expected.signalAborted);
	});

	it('server-default-deadline: enforces configured defaultTimeoutMs when call sets no timeout', async () => {
		const vector = vectors.cases.find((c) => c.id === 'server-default-deadline');
		expect(vector).toBeDefined();
		const serverCfg = vector?.server as { defaultTimeoutMs: number };
		const call = vector?.call as {
			command: string;
			handler: { delayMs: number };
		};
		const expected = vector?.expect as {
			success: boolean;
			code: string;
			retryable: boolean;
			signalAborted: boolean;
		};

		let observedSignal: AbortSignal | undefined;
		const slow = defineCommand({
			name: call.command,
			description: 'Slow command for default deadline vector',
			input: z.object({}),
			handler: async (_input, context) => {
				observedSignal = context.signal;
				await new Promise((resolve) => setTimeout(resolve, call.handler.delayMs));
				return success({ done: true });
			},
		});
		const server = createMcpServer({
			name: 'vector-default-deadline',
			version: '1.0.0',
			commands: [slow],
			defaultTimeoutMs: serverCfg.defaultTimeoutMs,
		});

		const result = await server.execute(call.command, {});
		expect(result.success).toBe(expected.success);
		expect(result.error?.code).toBe(expected.code);
		expect(result.error?.retryable).toBe(expected.retryable);
		expect(result.error?.details).toEqual({
			command: call.command,
			timeoutMs: serverCfg.defaultTimeoutMs,
		});
		expect(observedSignal?.aborted).toBe(expected.signalAborted);
	});

	it('pre-cancelled-single-command: skips handler and returns COMMAND_CANCELLED', async () => {
		const vector = vectors.cases.find((c) => c.id === 'pre-cancelled-single-command');
		expect(vector).toBeDefined();
		const call = vector?.call as { command: string };
		const expected = vector?.expect as {
			success: boolean;
			code: string;
			retryable: boolean;
			handlerRan: boolean;
		};

		let handlerRan = false;
		const cmd = defineCommand({
			name: call.command,
			description: 'Command for cancellation vector',
			input: z.object({}),
			handler: async () => {
				handlerRan = true;
				return success({ ok: true });
			},
		});
		const registry = createDirectRegistry([cmd], {
			middleware: withCommandDeadlines([]),
		});

		const result = await registry.execute(call.command, {}, { signal: AbortSignal.abort() });
		expect(result.success).toBe(expected.success);
		expect(result.error?.code).toBe(expected.code);
		expect(result.error?.retryable).toBe(expected.retryable);
		expect(handlerRan).toBe(expected.handlerRan);
	});

	it('pre-cancelled-batch: starts no command and marks items COMMAND_CANCELLED with durationMs 0', async () => {
		const vector = vectors.cases.find((c) => c.id === 'pre-cancelled-batch');
		expect(vector).toBeDefined();
		const request = vector?.request as BatchRequest;
		const expected = vector?.expect as {
			success: boolean;
			calls: number;
			itemCode: string;
			durationMs: number;
		};

		let calls = 0;
		const result = await executeBatch(
			request,
			async (_cmd, input) => {
				calls += 1;
				return success(input);
			},
			{ signal: AbortSignal.abort() }
		);
		expect(result.success).toBe(expected.success);
		expect(calls).toBe(expected.calls);
		expect(result.results.length).toBe(request.commands.length);
		for (const item of result.results) {
			expect(item.result.success).toBe(false);
			expect(item.result.error?.code).toBe(expected.itemCode);
			expect(item.durationMs).toBe(expected.durationMs);
		}
	});

	it.each([
		'batch-at-max-size-allowed',
		'batch-over-max-size-refused',
		'batch-at-max-parallelism-allowed',
		'batch-over-max-parallelism-refused',
	])('%s: enforces batch size and parallelism limits', async (caseId) => {
		const vector = vectors.cases.find((c) => c.id === caseId);
		expect(vector).toBeDefined();
		const limits = vector?.limits as { maxBatchSize: number; maxBatchParallelism: number };
		const commandCount = vector?.commandCount as number;
		const parallelism = vector?.parallelism as number;
		const expected = vector?.expect as {
			success: boolean;
			total?: number;
			successCount?: number;
			code?: string;
			retryable?: boolean;
			calls?: number;
			resultsLength?: number;
		};

		let calls = 0;
		const request: BatchRequest = {
			commands: Array.from({ length: commandCount }, (_, i) => ({
				command: 'work-run',
				input: { i },
			})),
			options: { parallelism },
		};
		const result = await executeBatch(
			request,
			async (_cmd, input) => {
				calls += 1;
				return success(input);
			},
			{},
			{
				maxBatchSize: limits.maxBatchSize,
				maxBatchParallelism: limits.maxBatchParallelism,
			}
		);

		expect(result.success).toBe(expected.success);
		if (expected.success) {
			expect(result.summary.total).toBe(expected.total);
			expect(result.summary.successCount).toBe(expected.successCount);
		} else {
			expect(calls).toBe(expected.calls);
			expect(result.results.length).toBe(expected.resultsLength);
			expect(result.error?.code).toBe(expected.code);
			expect(result.error?.retryable).toBe(expected.retryable);
			expect(result.error?.suggestion).toContain(String(limits.maxBatchSize));
			expect(result.error?.suggestion).toContain(String(limits.maxBatchParallelism));
		}
	});

	it.each(['validation-issues-at-cap-not-truncated', 'validation-issues-over-cap-truncated'])(
		'%s: enforces maxValidationIssues cap with explicit truncation metadata',
		async (caseId) => {
			const vector = vectors.cases.find((c) => c.id === caseId);
			expect(vector).toBeDefined();
			const limit = vector?.limit as number;
			const invalidItemCount = vector?.invalidItemCount as number;
			const expected = vector?.expect as {
				success: boolean;
				code: string;
				retryable: boolean;
				reportedErrors: number;
				truncated: boolean;
				detailsLimit?: number;
			};

			const cmd = defineCommand({
				name: 'validate-many',
				description: 'Command for validation issue cap vector',
				input: z.object({ values: z.array(z.string()) }),
				handler: async (input) => success(input),
			});
			const registry = createDirectRegistry([cmd], { maxValidationIssues: limit });
			const result = await registry.execute('validate-many', {
				values: Array(invalidItemCount).fill(0),
			});

			expect(result.success).toBe(expected.success);
			expect(result.error?.code).toBe(expected.code);
			expect(Boolean(result.error?.retryable)).toBe(expected.retryable);
			const details = result.error?.details as {
				errors?: unknown[];
				truncated?: boolean;
				limit?: number;
				totalErrors?: number;
			};
			expect(details.errors?.length).toBe(expected.reportedErrors);
			if (expected.truncated) {
				expect(details.truncated).toBe(true);
				expect(details.limit).toBe(expected.detailsLimit);
				expect(details.totalErrors).toBe(invalidItemCount);
				expect(result.error?.suggestion).toContain(`Showing first ${limit} validation issues`);
			} else {
				expect(details.truncated).toBeUndefined();
				expect(details.limit).toBeUndefined();
				expect(details.totalErrors).toBeUndefined();
			}
		}
	);

	describe('retryMutation: the retry middleware repeats a mutation only with the option (#2673)', () => {
		interface RetryCase {
			id: string;
			command: { name: string; mutation: boolean };
			handler: { failFirst: { code: string } };
			retry: {
				maxRetries: number;
				retryDelayMs: number;
				jitter: boolean;
				retryMutations?: boolean;
			};
			expect: { handlerRuns: number; success: boolean; code?: string };
		}
		const cases = vectors.cases.filter(
			(c) => c.control === 'retryMutation'
		) as unknown as RetryCase[];

		it('has the read, mutation and option cases', () => {
			expect(cases.map((c) => c.id)).toEqual([
				'retry-read-after-timeout',
				'retry-mutation-not-repeated',
				'retry-mutation-with-option',
			]);
		});

		for (const vector of cases) {
			it(vector.id, async () => {
				let runs = 0;
				const command = defineCommand({
					name: vector.command.name,
					description: 'Fails once, then succeeds',
					input: z.object({}),
					mutation: vector.command.mutation,
					handler: async () =>
						++runs === 1
							? failure({
									code: vector.handler.failFirst.code,
									message: 'Downstream timed out',
									suggestion: 'Check whether the change applied, then retry',
								})
							: success({ runs }),
				});
				const retry = createRetryMiddleware({
					maxRetries: vector.retry.maxRetries,
					retryDelay: vector.retry.retryDelayMs,
					jitter: vector.retry.jitter,
					...(vector.retry.retryMutations !== undefined && {
						retryMutations: vector.retry.retryMutations,
					}),
				});
				const registry = createDirectRegistry([command], { middleware: [retry] });
				const result = await registry.execute(vector.command.name, {});
				expect(runs).toBe(vector.expect.handlerRuns);
				expect(result.success).toBe(vector.expect.success);
				if (vector.expect.code) expect(result.error?.code).toBe(vector.expect.code);
			});
		}
	});
});
