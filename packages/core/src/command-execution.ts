/**
 * @fileoverview Transport-agnostic batch and stream execution
 *
 * `executeBatch()` and `executeStream()` hold the batch and stream semantics in
 * one place: request preflight, the batch deadline, bounded parallelism,
 * `stopOnError`, abort handling and error redaction. Like `executePipeline()`,
 * they take a `CommandExecutor` callback, so every host (the core registry, the
 * MCP server engine, DirectClient, test harnesses) can delegate to the same code
 * instead of keeping its own copy.
 *
 * Every entry is executed through the callback with the caller's context
 * (including `interface`), so the host's exposure, context and validation
 * checks apply to each batch entry and to streams exactly as they do to a
 * single call.
 */

import type { BatchCommand, BatchCommandResult, BatchRequest, BatchResult } from './batch.js';
import { createBatchResult, createFailedBatchResult } from './batch.js';
import type { CommandContext } from './commands.js';
import type { CommandError } from './errors.js';
import { withDerivedIdempotencyKey } from './idempotency-keys.js';
import type { CommandExecutor } from './pipeline-executor.js';
import { isBatchRequest } from './request-validation.js';
import type { CommandResult } from './result.js';
import { failure } from './result.js';
import type { ErrorChunk, StreamChunk } from './streaming.js';
import { createCompleteChunk, createErrorChunk } from './streaming.js';

/** Normative default maximum number of commands in a single batch (`spec/execution-controls.md`). */
export const DEFAULT_MAX_BATCH_SIZE = 500;

/** Normative default maximum concurrent commands in a single batch (`spec/execution-controls.md`). */
export const DEFAULT_MAX_BATCH_PARALLELISM = 16;

/**
 * Options shared by the core executors.
 */
export interface ExecutorOptions {
	/**
	 * Include raw exception messages and stack traces in results.
	 *
	 * Default `false`: a thrown exception becomes a generic
	 * `COMMAND_EXECUTION_ERROR` (or `STREAM_ERROR`) so internal details such as
	 * file paths never reach a remote caller. Matches `devMode` in
	 * `createMcpServer()`.
	 */
	devMode?: boolean;
	/**
	 * Maximum number of commands accepted in a single batch (positive integer).
	 * Default: {@link DEFAULT_MAX_BATCH_SIZE} (`500`).
	 */
	maxBatchSize?: number;
	/**
	 * Maximum `options.parallelism` accepted in a single batch (positive integer).
	 * Default: {@link DEFAULT_MAX_BATCH_PARALLELISM} (`16`).
	 */
	maxBatchParallelism?: number;
}

function resolveBatchLimit(value: number | undefined, fallback: number, name: string): number {
	if (value === undefined) return fallback;
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive integer`);
	}
	return value;
}

/**
 * Validate a batch request against configured size and parallelism limits (`spec/execution-controls.md`).
 * Returns an `INVALID_BATCH_REQUEST` error when a limit is exceeded, or `undefined` when within limits.
 */
export function checkBatchLimits(
	request: BatchRequest,
	limits?: Pick<ExecutorOptions, 'maxBatchSize' | 'maxBatchParallelism'>
): CommandError | undefined {
	const maxSize = resolveBatchLimit(limits?.maxBatchSize, DEFAULT_MAX_BATCH_SIZE, 'maxBatchSize');
	const maxParallelism = resolveBatchLimit(
		limits?.maxBatchParallelism,
		DEFAULT_MAX_BATCH_PARALLELISM,
		'maxBatchParallelism'
	);
	const limitsHint = `Send between 1 and ${maxSize} commands with parallelism at most ${maxParallelism}`;
	if (request.commands.length > maxSize) {
		return {
			code: 'INVALID_BATCH_REQUEST',
			message: `Batch size ${request.commands.length} exceeds maximum of ${maxSize} commands`,
			suggestion: limitsHint,
			retryable: false,
			details: { count: request.commands.length, maxBatchSize: maxSize },
		};
	}
	const requestedParallelism = request.options?.parallelism ?? 1;
	if (requestedParallelism > maxParallelism) {
		return {
			code: 'INVALID_BATCH_REQUEST',
			message: `Batch parallelism ${requestedParallelism} exceeds maximum of ${maxParallelism}`,
			suggestion: limitsHint,
			retryable: false,
			details: { parallelism: requestedParallelism, maxBatchParallelism: maxParallelism },
		};
	}
	return undefined;
}

function round(ms: number): number {
	return Math.round(ms * 100) / 100;
}

/**
 * Convert an exception thrown while executing a command into a failure result.
 *
 * Outside `devMode` the result carries no exception text or stack.
 *
 * @param error - The thrown value
 * @param devMode - Whether to include the raw message and stack
 */
export function executionFailure(error: unknown, devMode = false): CommandResult<never> {
	if (!devMode) {
		return failure({
			code: 'COMMAND_EXECUTION_ERROR',
			message: 'An internal error occurred',
			suggestion: 'Contact support if this persists',
		});
	}
	const isError = error instanceof Error;
	return failure({
		code: 'COMMAND_EXECUTION_ERROR',
		message: isError ? error.message : String(error),
		suggestion: 'Check the command implementation',
		...(isError && error.stack ? { details: { stack: error.stack } } : {}),
	});
}

/** Run the callback, turning a synchronous throw or a rejection into a failure result. */
async function settle(
	execute: CommandExecutor,
	commandName: string,
	input: unknown,
	context: CommandContext,
	devMode: boolean
): Promise<CommandResult> {
	try {
		return await execute(commandName, input, context);
	} catch (error) {
		return executionFailure(error, devMode);
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH
// ═══════════════════════════════════════════════════════════════════════════════

/** Canonical malformed batch result, shared by executor and transport preflight. */
export function failedBatchRequest(
	timing: Parameters<typeof createFailedBatchResult>[1] = {},
	details?: CommandError['details'],
	suggestion = 'Provide at least one command with a nonempty command name and optional string ID, and valid boolean stopOnError, nonnegative timeout, and positive integer parallelism options'
): BatchResult {
	return createFailedBatchResult(
		{
			code: 'INVALID_BATCH_REQUEST',
			message: 'Invalid batch request envelope',
			suggestion,
			...(details && { details }),
		},
		timing
	);
}

/**
 * Execute a batch of commands with partial success semantics.
 *
 * - The whole envelope is validated with `isBatchRequest()` before any command
 *   runs; a malformed or empty batch returns `INVALID_BATCH_REQUEST`.
 * - `options.timeout` is a deadline for the whole batch, whatever the
 *   `parallelism`: each in-flight command's `signal` is aborted and its result
 *   becomes `BATCH_TIMEOUT` when the deadline passes, and commands not yet
 *   started are reported as `BATCH_TIMEOUT` without running.
 * - With `stopOnError`, commands not yet started after a failure are reported
 *   as `COMMAND_SKIPPED`. Already-started handlers preserve their actual results.
 * - Caller cancellation stops scheduling queued commands (`COMMAND_CANCELLED`)
 *   while started handlers receive the signal and finish cooperatively.
 * - Each command runs through `execute` with the caller's `context` (so
 *   `interface` reaches the host's exposure check), a per-command `traceId`,
 *   and a `signal` that aborts on the deadline or with the caller's signal.
 *
 * @param request - The batch request (validated at runtime)
 * @param execute - Callback that executes a single command
 * @param context - Context passed to every command
 * @param options - Executor options such as `devMode`
 * @returns The aggregated batch result, one entry per requested command
 *
 * @example
 * ```typescript
 * const result = await executeBatch(request, (name, input, ctx) => registry.execute(name, input, ctx), {
 *   interface: 'mcp',
 * });
 * ```
 */
export async function executeBatch(
	request: BatchRequest,
	execute: CommandExecutor,
	context: CommandContext = {},
	options: ExecutorOptions = {}
): Promise<BatchResult> {
	const startedAt = new Date().toISOString();
	const startTime = performance.now();
	const devMode = options.devMode === true;
	const maxBatchSize = resolveBatchLimit(
		options.maxBatchSize,
		DEFAULT_MAX_BATCH_SIZE,
		'maxBatchSize'
	);
	const maxBatchParallelism = resolveBatchLimit(
		options.maxBatchParallelism,
		DEFAULT_MAX_BATCH_PARALLELISM,
		'maxBatchParallelism'
	);

	if (!isBatchRequest(request) || request.commands.length === 0) {
		return failedBatchRequest({ startedAt });
	}

	const limitError = checkBatchLimits(request, { maxBatchSize, maxBatchParallelism });
	if (limitError) {
		return createFailedBatchResult(limitError, { startedAt });
	}

	const { commands } = request;
	const batchOptions = request.options ?? {};
	const deadline =
		batchOptions.timeout === undefined ? undefined : startTime + batchOptions.timeout;
	const callerSignal = context.signal instanceof AbortSignal ? context.signal : undefined;
	const batchTraceId = context.traceId ?? `batch-${Date.now()}`;
	const timeoutError: CommandError = {
		code: 'BATCH_TIMEOUT',
		message: `Batch timeout exceeded (${batchOptions.timeout}ms)`,
		suggestion: 'Increase timeout or reduce the number of batch commands',
		retryable: true,
	};
	const cancelledError: CommandError = {
		code: 'COMMAND_CANCELLED',
		message: 'Command cancelled before starting',
		suggestion: 'Start the command again if the result is still needed',
		retryable: false,
	};
	const skippedError: CommandError = {
		code: 'COMMAND_SKIPPED',
		message: 'Command skipped because batch execution stopped after a failure',
		suggestion: 'Disable stopOnError to execute every command',
	};

	const results: Array<BatchCommandResult | undefined> = new Array(commands.length);
	let stopped = false;
	let timedOut = false;
	let nextIndex = 0;

	const runCommand = async (command: BatchCommand, index: number): Promise<CommandResult> => {
		const remainingMs = deadline === undefined ? undefined : deadline - performance.now();
		if (remainingMs !== undefined && remainingMs <= 0) {
			timedOut = true;
			return { success: false, error: timeoutError };
		}
		const controller = new AbortController();
		const signal = callerSignal
			? AbortSignal.any([callerSignal, controller.signal])
			: controller.signal;
		const execution = settle(
			execute,
			command.command,
			command.input,
			// Each item runs under the key derived from the request's (spec/idempotency.md, K4).
			withDerivedIdempotencyKey(
				{ ...context, signal, traceId: `${batchTraceId}-${index}` },
				'batch',
				index
			),
			devMode
		);
		if (remainingMs === undefined) return execution;

		let timer: ReturnType<typeof setTimeout> | undefined;
		const expiry = new Promise<CommandResult>((resolve) => {
			timer = setTimeout(() => {
				timedOut = true;
				controller.abort();
				resolve({ success: false, error: timeoutError });
			}, remainingMs);
		});
		try {
			return await Promise.race([execution, expiry]);
		} finally {
			clearTimeout(timer);
		}
	};

	const worker = async (): Promise<void> => {
		while (!stopped && !timedOut && !callerSignal?.aborted) {
			const index = nextIndex++;
			const command = commands[index];
			if (command === undefined) return;
			const commandStart = performance.now();
			const result = await runCommand(command, index);
			results[index] = {
				id: command.id ?? `cmd-${index}`,
				index,
				command: command.command,
				result,
				durationMs: round(performance.now() - commandStart),
			};
			if (!result.success && batchOptions.stopOnError) stopped = true;
		}
	};

	const parallelism = Math.min(batchOptions.parallelism ?? 1, commands.length);
	await Promise.all(Array.from({ length: parallelism }, () => worker()));

	const completed = commands.map(
		(command, index): BatchCommandResult =>
			results[index] ?? {
				id: command.id ?? `cmd-${index}`,
				index,
				command: command.command,
				result: {
					success: false,
					error: timedOut ? timeoutError : callerSignal?.aborted ? cancelledError : skippedError,
				},
				durationMs: 0,
			}
	);

	const totalMs = performance.now() - startTime;
	return createBatchResult(
		completed,
		{
			totalMs: round(totalMs),
			averageMs: round(totalMs / completed.length),
			startedAt,
			completedAt: new Date().toISOString(),
		},
		{ traceId: batchTraceId }
	);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STREAM
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for {@link executeStream}.
 */
export interface StreamExecutorOptions extends ExecutorOptions {
	/**
	 * Deadline for the whole stream in milliseconds, a nonnegative finite
	 * number. When it passes, the command's `signal` aborts and the stream ends
	 * with a `STREAM_TIMEOUT` error chunk, even if the command ignores the
	 * signal. Default: no deadline.
	 */
	timeout?: number;
}

type StreamPhase = 'starting' | 'execution' | 'data';

/** The error chunk for a stream whose signal aborted: the caller's abort or the deadline. */
type StopReason = (phase: StreamPhase, chunksEmitted: number) => ErrorChunk;

function abortedChunk(phase: StreamPhase, chunksEmitted: number): ErrorChunk {
	const message =
		phase === 'starting'
			? 'Stream was aborted before starting'
			: phase === 'execution'
				? 'Stream was aborted during execution'
				: 'Stream was aborted';
	return createErrorChunk(
		{
			code: 'STREAM_ABORTED',
			message,
			suggestion: 'Start the stream again if the result is still needed',
			retryable: true,
		},
		chunksEmitted,
		true,
		phase === 'data' ? chunksEmitted : undefined
	);
}

function timeoutChunk(timeoutMs: number, chunksEmitted: number, resumeFrom?: number): ErrorChunk {
	return createErrorChunk(
		{
			code: 'STREAM_TIMEOUT',
			message: `Stream timed out after ${timeoutMs}ms`,
			suggestion: 'Increase the stream timeout, or request less data, and retry',
			retryable: true,
		},
		chunksEmitted,
		true,
		resumeFrom
	);
}

/**
 * A deadline that aborts its `signal` (which also follows the caller's signal)
 * after `timeoutMs`; `expiry` resolves at that moment.
 */
function streamDeadline(timeoutMs: number, callerSignal: AbortSignal | undefined) {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expiry = new Promise<undefined>((resolve) => {
		timer = setTimeout(() => {
			controller.abort(new Error(`Stream timed out after ${timeoutMs}ms`));
			resolve(undefined);
		}, timeoutMs);
	});
	return {
		signal: callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal,
		expiry,
		expired: () => controller.signal.aborted,
		dispose: () => clearTimeout(timer),
	};
}

/**
 * Execute a command and stream its result.
 *
 * This is not incremental streaming: the command runs once, to completion,
 * through `execute` with `context` (so `interface` reaches the host's exposure
 * check), and the chunks are produced from its final result afterwards. An
 * array result is emitted as one data chunk per item, any other result as a
 * single data chunk, followed by a complete chunk; no progress chunks are
 * emitted. A failure result becomes an error chunk. `context.signal` cancels
 * the stream: an aborted signal yields a `STREAM_ABORTED` error chunk before
 * execution, after it, or between data chunks. With `options.timeout`, the
 * stream ends with a `STREAM_TIMEOUT` error chunk once the deadline passes.
 *
 * @param commandName - Command to execute
 * @param input - Command input
 * @param execute - Callback that executes a single command
 * @param context - Context passed to the command; `signal` cancels the stream
 * @param options - Executor options such as `devMode` and `timeout`
 */
export async function* executeStream<TOutput = unknown>(
	commandName: string,
	input: unknown,
	execute: CommandExecutor,
	context: CommandContext = {},
	options: StreamExecutorOptions = {}
): AsyncGenerator<StreamChunk<TOutput>, void, unknown> {
	const { timeout } = options;
	if (timeout !== undefined && !(Number.isFinite(timeout) && timeout >= 0)) {
		yield createErrorChunk(
			{
				code: 'VALIDATION_ERROR',
				message: 'Stream timeout must be a nonnegative finite number of milliseconds',
				suggestion: 'Pass a timeout such as 30000, or omit it for no deadline',
				retryable: false,
			},
			0,
			false
		);
		return;
	}
	const callerSignal = context.signal instanceof AbortSignal ? context.signal : undefined;
	if (callerSignal?.aborted) {
		yield abortedChunk('starting', 0);
		return;
	}
	if (timeout === undefined) {
		yield* streamResult<TOutput>(commandName, input, execute, context, options, abortedChunk);
		return;
	}

	const deadline = streamDeadline(timeout, callerSignal);
	const stopped: StopReason = (phase, chunksEmitted) =>
		deadline.expired()
			? timeoutChunk(timeout, chunksEmitted, phase === 'data' ? chunksEmitted : undefined)
			: abortedChunk(phase, chunksEmitted);
	// The command gets the deadline's signal; if it ignores it, the race ends the wait.
	const raced: CommandExecutor = (name, commandInput, commandContext) =>
		Promise.race([execute(name, commandInput, commandContext), deadline.expiry]).then(
			(result) => result ?? { success: false }
		);
	try {
		yield* streamResult<TOutput>(
			commandName,
			input,
			raced,
			{ ...context, signal: deadline.signal },
			options,
			stopped
		);
	} finally {
		deadline.dispose();
	}
}

/** Run the command once and yield its result as chunks, stopping when `context.signal` aborts. */
async function* streamResult<TOutput>(
	commandName: string,
	input: unknown,
	execute: CommandExecutor,
	context: CommandContext,
	options: ExecutorOptions,
	stopped: StopReason
): AsyncGenerator<StreamChunk<TOutput>, void, unknown> {
	const startTime = performance.now();
	const signal = context.signal instanceof AbortSignal ? context.signal : undefined;

	let result: CommandResult;
	try {
		result = await execute(commandName, input, context);
	} catch (error) {
		yield createErrorChunk(
			{
				code: 'STREAM_ERROR',
				message:
					options.devMode === true
						? error instanceof Error
							? error.message
							: String(error)
						: 'Stream execution failed',
				suggestion: 'Retry the stream; contact support if this persists',
				retryable: true,
			},
			0,
			true
		);
		return;
	}

	if (signal?.aborted) {
		yield stopped('execution', 0);
		return;
	}

	if (!result.success) {
		yield createErrorChunk(
			result.error ?? {
				code: 'COMMAND_FAILED',
				message: 'Command execution failed',
				suggestion: 'Check the command input and try again',
			},
			0,
			result.error?.retryable ?? false
		);
		return;
	}

	const items: unknown[] = Array.isArray(result.data) ? result.data : [result.data];
	let chunksEmitted = 0;
	for (let index = 0; index < items.length; index++) {
		if (signal?.aborted) {
			yield stopped('data', chunksEmitted);
			return;
		}
		yield {
			type: 'data',
			data: items[index] as TOutput,
			index,
			isLast: index === items.length - 1,
		};
		chunksEmitted++;
	}

	yield createCompleteChunk<TOutput>(chunksEmitted, performance.now() - startTime, {
		confidence: result.confidence,
		reasoning: result.reasoning,
		metadata: result.metadata,
	});
}
