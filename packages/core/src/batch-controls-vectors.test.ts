/**
 * The language-neutral vectors in `spec/vectors/batch-controls.json`.
 *
 * `spec/vectors/generate-batch-controls.mjs` generated the file from these executors on a
 * virtual clock; here the cases run on Vitest's fake timers. A failure means an unintended
 * behavior change or a stale file. Python, Rust and C++ load the same file (see
 * `spec/vectors/README.md`).
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchRequest, BatchResult } from './batch.js';
import { executeBatch } from './command-execution.js';
import type { CommandError } from './errors.js';
import type { PipelineRequest, PipelineResult } from './pipeline.js';
import { executePipeline } from './pipeline-executor.js';
import { failure, success } from './result.js';

interface HandlerSpec {
	delayMs?: number;
	untilCancelled?: boolean;
	fail?: CommandError;
}

interface Case {
	name: string;
	handlers: Record<string, HandlerSpec>;
	request: unknown;
	expected: { calls: Array<{ command: string; input: unknown }> } & Record<string, unknown>;
}

const vectors: { batch: Case[]; pipeline: Case[] } = JSON.parse(
	readFileSync(new URL('../../../spec/vectors/batch-controls.json', import.meta.url), 'utf8')
);

interface Call {
	command: string;
	input: unknown;
	index?: number;
}

/** An executor that runs the case's declarative handlers and records calls and concurrency. */
function executorFor(handlers: Case['handlers']) {
	const record = { calls: [] as Call[], active: 0, peak: 0 };
	const execute = async (command: string, input: unknown, context: Record<string, unknown>) => {
		const spec = handlers[command];
		if (spec === undefined) throw new Error(`No handler for ${command}`);
		record.calls.push({ command, input });
		record.active++;
		record.peak = Math.max(record.peak, record.active);
		try {
			if (spec.untilCancelled) {
				const signal = context.signal as AbortSignal;
				await new Promise<void>((resolve) => {
					if (signal.aborted) resolve();
					else signal.addEventListener('abort', () => resolve(), { once: true });
				});
			} else if (spec.delayMs) {
				await new Promise((resolve) => setTimeout(resolve, spec.delayMs));
			}
			return spec.fail ? failure(spec.fail) : success(input);
		} finally {
			record.active--;
		}
	};
	return { execute, record };
}

/** Run `execution` to completion, advancing the fake clock whenever it waits. */
async function onFakeClock<T>(execution: Promise<T>): Promise<T> {
	await vi.runAllTimersAsync();
	return execution;
}

function projectError(error: CommandError | undefined) {
	if (error === undefined) return undefined;
	return {
		code: error.code,
		message: error.message,
		...(error.retryable === undefined ? {} : { retryable: error.retryable }),
	};
}

function projectBatch(result: BatchResult, calls: Call[]) {
	if (!result.success) {
		return { success: false, error: projectError(result.error), results: result.results };
	}
	return {
		success: true,
		summary: result.summary,
		results: result.results.map((entry) => ({
			id: entry.id,
			index: entry.index,
			command: entry.command,
			success: entry.result.success,
			...(entry.result.success
				? { data: entry.result.data }
				: { error: projectError(entry.result.error) }),
			...(calls.some((call) => call.index === entry.index) ? {} : { durationMs: entry.durationMs }),
		})),
	};
}

function projectPipeline(result: PipelineResult) {
	return {
		...(result.data === undefined ? {} : { data: result.data }),
		completedSteps: result.metadata.completedSteps,
		totalSteps: result.metadata.totalSteps,
		steps: result.steps.map((step) => ({
			index: step.index,
			command: step.command,
			...(step.alias === undefined ? {} : { alias: step.alias }),
			status: step.status,
			...(step.data === undefined ? {} : { data: step.data }),
			...(step.error === undefined ? {} : { error: projectError(step.error) }),
		})),
	};
}

describe('spec/vectors/batch-controls.json', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('has the expected cases', () => {
		expect(vectors.batch.length).toBeGreaterThanOrEqual(20);
		expect(vectors.pipeline.length).toBeGreaterThanOrEqual(20);
	});

	it.each(vectors.batch.map((vector) => [vector.name, vector] as const))(
		'batch: %s',
		async (_name, { handlers, request, expected }) => {
			const { execute, record } = executorFor(handlers);
			// Each command's trace ID is batch-<index>; keep the index so a result can say
			// whether its command ran.
			const indexed = (command: string, input: unknown, context: Record<string, unknown>) => {
				const execution = execute(command, input, context);
				const call = record.calls.at(-1);
				if (call) call.index = Number(String(context.traceId).slice('batch-'.length));
				return execution;
			};
			const result = await onFakeClock(
				executeBatch(request as BatchRequest, indexed, { traceId: 'batch' })
			);
			const { calls, peakConcurrency, ...outcome } = expected;
			expect(record.calls.map(({ command, input }) => ({ command, input }))).toEqual(calls);
			if (peakConcurrency !== undefined) expect(record.peak).toBe(peakConcurrency);
			expect(projectBatch(result, record.calls)).toEqual(outcome);
		}
	);

	it.each(vectors.pipeline.map((vector) => [vector.name, vector] as const))(
		'pipeline: %s',
		async (_name, { handlers, request, expected }) => {
			const { execute, record } = executorFor(handlers);
			const result = await onFakeClock(executePipeline(request as PipelineRequest, execute));
			const { calls, ...outcome } = expected;
			expect(record.calls).toEqual(calls);
			expect(projectPipeline(result)).toEqual(outcome);
		}
	);
});
