/**
 * Specification-authored execution-controls vectors (`spec/vectors/execution-controls.json`;
 * `spec/execution-controls.md`, #1737).
 *
 * Runs every case TypeScript implements today (per-call deadline, pre-cancelled single command,
 * pre-cancelled batch) and asserts that unimplemented controls remain listed in `gaps.typescript`
 * (#2128).
 */
import { readFileSync } from 'node:fs';
import { type BatchRequest, executeBatch, success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { withCommandDeadlines } from './command-timeout.js';
import { createDirectRegistry } from './direct-registry.js';
import { defineCommand } from './schema.js';

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

const EXECUTED_CONTROLS = new Set(['deadline', 'singleCancellation', 'batchCancellation']);

describe('spec/vectors/execution-controls.json', () => {
	it('pins the normative defaults and accounts for every vector control', () => {
		expect(vectors.defaults).toEqual({
			defaultTimeoutMs: 30_000,
			maxBatchSize: 500,
			maxBatchParallelism: 16,
			maxValidationIssues: 100,
		});
		expect(vectors.gaps.typescript).toEqual({
			defaultDeadline: 'https://github.com/lushly-dev/afd/issues/2128',
			batchLimits: 'https://github.com/lushly-dev/afd/issues/2128',
			validationIssueCap: 'https://github.com/lushly-dev/afd/issues/2128',
		});
		const gapped = new Set(Object.keys(vectors.gaps.typescript ?? {}));
		for (const entry of vectors.cases) {
			const control = String(entry.control);
			expect(
				EXECUTED_CONTROLS.has(control) !== gapped.has(control),
				`control ${control} must be either executed or listed in gaps.typescript`
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
		expect(Boolean(result.error?.retryable)).toBe(expected.retryable);
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
});
