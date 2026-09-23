/**
 * @fileoverview Command execution engine — single, batch, pipeline, and streaming execution.
 */

// NOTE: This module is near the 500-line file-size cap. If adding execution
// paths, consider extracting to a separate module (e.g., streaming.ts).

import type {
	BatchCommandResult,
	BatchRequest,
	BatchResult,
	BatchTiming,
	CommandContext,
	CommandMiddleware,
	CommandResult,
	PipelineRequest,
	PipelineResult,
	StreamChunk,
} from '@lushly-dev/afd-core';
import {
	createBatchResult,
	createCompleteChunk,
	createErrorChunk,
	createFailedBatchResult,
	executePipeline as executeCorePipeline,
	failure,
	isBatchRequest,
	truncateName,
} from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from './schema.js';
import type { EnhancedValidationResult } from './validation.js';
import { formatEnhancedValidationError, validateInputEnhanced } from './validation.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ExecutionDeps {
	commandMap: Map<string, ZodCommandDefinition>;
	middleware: CommandMiddleware[];
	contextState?: { getActive(): string | null };
	devMode: boolean;
	onCommand?: (command: string, input: unknown, result: CommandResult) => void;
	onError?: (error: Error) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION ENGINE FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

/**
 * Run an observer hook so that a throw or a rejected promise from it can never
 * change the command result or escape as an unhandled rejection.
 */
function runHook(hook: () => unknown, onHookError: (error: unknown) => void): void {
	try {
		const returned = hook();
		if (returned instanceof Promise) returned.catch(onHookError);
	} catch (error) {
		onHookError(error);
	}
}

export function createExecutionEngine(deps: ExecutionDeps) {
	const { commandMap, middleware, devMode, onCommand, onError } = deps;

	/** Report to `onError`. A failing `onError` has nowhere left to report, so it is ignored. */
	function reportError(error: unknown): void {
		runHook(
			() => onError?.(toError(error)),
			() => {}
		);
	}

	/**
	 * Execute a command with validation and middleware.
	 */
	async function executeCommand(
		commandName: string,
		input: unknown,
		context: CommandContext = {}
	): Promise<CommandResult> {
		const command = commandMap.get(commandName);

		if (!command) {
			return failure({
				code: 'COMMAND_NOT_FOUND',
				message: `Command '${truncateName(commandName)}' not found`,
				suggestion: `Available commands: ${Array.from(commandMap.keys()).join(', ')}`,
			});
		}

		const activeContext = deps.contextState?.getActive();
		if (activeContext && command.contexts?.length && !command.contexts.includes(activeContext)) {
			return failure({
				code: 'COMMAND_NOT_IN_CONTEXT',
				message: `Command '${commandName}' is not available in context '${activeContext}'`,
				suggestion: 'Use afd-context-enter to switch contexts or afd-context-exit to leave.',
			});
		}
		// Validate input with enhanced error messages. Schema callbacks (.refine,
		// .superRefine, .transform, .preprocess) run here, so an exception they throw
		// becomes a VALIDATION_ERROR result instead of rejecting.
		let validation: EnhancedValidationResult<unknown>;
		try {
			validation = validateInputEnhanced(command.inputSchema, input);
		} catch (error) {
			const err = toError(error);
			reportError(err);
			return failure({
				code: 'VALIDATION_ERROR',
				message: 'Input validation failed',
				suggestion: devMode
					? `Input validation threw: ${err.message}`
					: `Check the input against the input schema of '${commandName}' (afd-detail returns it) and retry`,
			});
		}
		if (!validation.success) {
			return failure({
				code: 'VALIDATION_ERROR',
				message: 'Input validation failed',
				suggestion: formatEnhancedValidationError(validation.errors, {
					expectedFields: validation.expectedFields,
					unexpectedFields: validation.unexpectedFields,
					missingFields: validation.missingFields,
				}),
				details: {
					errors: validation.errors,
					expectedFields: validation.expectedFields,
					unexpectedFields: validation.unexpectedFields,
					missingFields: validation.missingFields,
				},
			});
		}

		const data = validation.data;

		// Build middleware chain
		const runHandler = async (): Promise<CommandResult> => {
			const startTime = Date.now();
			const result = await command.handler(data, context);

			// Build a new result rather than mutating the handler's (possibly frozen) object.
			return {
				...result,
				metadata: {
					...result.metadata,
					executionTimeMs: Date.now() - startTime,
					commandVersion: command.version,
					...(context.traceId ? { traceId: context.traceId } : {}),
				},
			};
		};

		// Apply middleware in reverse order
		let next = runHandler;
		for (let i = middleware.length - 1; i >= 0; i--) {
			const mw = middleware[i];
			if (!mw) continue;
			const currentNext = next;
			next = () => mw(commandName, data, context, currentNext);
		}

		let result: CommandResult;
		try {
			result = await next();
		} catch (error) {
			const err = toError(error);
			reportError(err);
			return failure({
				code: 'COMMAND_EXECUTION_ERROR',
				message: devMode ? err.message : 'An internal error occurred',
				suggestion: devMode
					? 'Check the command implementation'
					: 'Contact support if this persists',
				// Only include stack traces in dev mode to prevent information leakage
				...(devMode ? { details: { stack: err.stack } } : {}),
			});
		}

		// Outside the try: a failing onCommand must not turn a completed command
		// (possibly a committed write) into COMMAND_EXECUTION_ERROR.
		runHook(() => onCommand?.(commandName, input, result), reportError);
		return result;
	}

	/**
	 * Execute multiple commands in a batch with partial success semantics.
	 */
	async function executeBatch(
		request: BatchRequest,
		context: CommandContext = {}
	): Promise<BatchResult> {
		const startedAt = new Date().toISOString();
		const startTime = performance.now();

		// Validate request
		if (!isBatchRequest(request) || request.commands.length === 0) {
			return createFailedBatchResult(
				{
					code: 'INVALID_BATCH_REQUEST',
					message: 'Invalid batch request envelope',
					suggestion:
						'Provide nonempty command names, optional string IDs, and valid boolean, timeout, and positive integer parallelism options',
				},
				{ startedAt }
			);
		}

		const options = request.options ?? {};
		const results: Array<BatchCommandResult | undefined> = new Array(request.commands.length);
		let stopped = false;
		let timedOut = false;
		let nextIndex = 0;
		const batchTraceId = context.traceId ?? `batch-${Date.now()}`;
		const timeoutError = {
			code: 'BATCH_TIMEOUT',
			message: `Batch timeout exceeded (${options.timeout}ms)`,
			suggestion: 'Increase timeout or reduce the number of batch commands',
			retryable: true,
		};

		const worker = async (): Promise<void> => {
			while (!stopped && !timedOut) {
				const index = nextIndex++;
				if (index >= request.commands.length) return;
				const cmd = request.commands[index];
				if (!cmd) continue;
				const remainingMs =
					options.timeout === undefined
						? undefined
						: options.timeout - (performance.now() - startTime);
				const cmdStartTime = performance.now();
				const controller = new AbortController();
				const callerSignal = context.signal instanceof AbortSignal ? context.signal : undefined;
				const signal = callerSignal
					? AbortSignal.any([callerSignal, controller.signal])
					: controller.signal;
				let timer: ReturnType<typeof setTimeout> | undefined;
				let result: CommandResult;
				if (remainingMs !== undefined && remainingMs <= 0) {
					timedOut = true;
					result = { success: false, error: timeoutError };
				} else {
					const execution = executeCommand(cmd.command, cmd.input, {
						...context,
						signal,
						traceId: `${batchTraceId}-${index}`,
					});
					result =
						remainingMs === undefined
							? await execution
							: await Promise.race([
									execution,
									new Promise<CommandResult>((resolve) => {
										timer = setTimeout(() => {
											timedOut = true;
											controller.abort();
											resolve({ success: false, error: timeoutError });
										}, remainingMs);
									}),
								]);
				}
				if (timer !== undefined) clearTimeout(timer);
				results[index] = {
					id: cmd.id ?? `cmd-${index}`,
					index,
					command: cmd.command,
					result,
					durationMs: Math.round((performance.now() - cmdStartTime) * 100) / 100,
				};
				if (!result.success && options.stopOnError) stopped = true;
			}
		};

		const parallelism = Math.min(options.parallelism ?? 1, request.commands.length);
		await Promise.all(Array.from({ length: parallelism }, () => worker()));
		for (let index = 0; index < request.commands.length; index++) {
			if (results[index]) continue;
			const cmd = request.commands[index];
			if (!cmd) continue;
			results[index] = {
				id: cmd.id ?? `cmd-${index}`,
				index,
				command: cmd.command,
				result: timedOut
					? { success: false, error: timeoutError }
					: {
							success: false,
							error: {
								code: 'COMMAND_SKIPPED',
								message: 'Command skipped because batch execution stopped after a failure',
								suggestion: 'Disable stopOnError to execute every command',
							},
						},
				durationMs: 0,
			};
		}

		const completedAt = new Date().toISOString();
		const totalMs = performance.now() - startTime;

		const timing: BatchTiming = {
			totalMs: Math.round(totalMs * 100) / 100,
			averageMs: results.length > 0 ? Math.round((totalMs / results.length) * 100) / 100 : 0,
			startedAt,
			completedAt,
		};

		return createBatchResult(results as BatchCommandResult[], timing, {
			traceId: batchTraceId,
		});
	}

	/**
	 * Execute a pipeline of chained commands with variable resolution.
	 * `$input` resolves to `request.input`; `context` is passed to commands, never to references.
	 */
	async function executePipeline(
		request: PipelineRequest,
		context: CommandContext = {}
	): Promise<PipelineResult> {
		return executeCorePipeline(request, executeCommand, context);
	}

	/**
	 * Execute a command as a stream, yielding chunks.
	 */
	async function* executeStream(
		commandName: string,
		input: unknown,
		context: CommandContext = {}
	): AsyncGenerator<StreamChunk, void, unknown> {
		const startTime = performance.now();
		let chunksEmitted = 0;

		try {
			const result = await executeCommand(commandName, input, context);

			if (!result.success) {
				yield createErrorChunk(
					result.error ?? {
						code: 'COMMAND_FAILED',
						message: 'Command execution failed',
					},
					chunksEmitted,
					result.error?.retryable ?? false
				);
				return;
			}

			const data = result.data;

			// If result is an array, emit each item as a chunk
			if (Array.isArray(data)) {
				for (let i = 0; i < data.length; i++) {
					yield {
						type: 'data',
						data: data[i],
						index: i,
						isLast: i === data.length - 1,
					};
					chunksEmitted++;
				}
			} else {
				yield {
					type: 'data',
					data: data,
					index: 0,
					isLast: true,
				};
				chunksEmitted++;
			}

			// Emit completion
			const totalDurationMs = performance.now() - startTime;
			yield createCompleteChunk(chunksEmitted, totalDurationMs, {
				confidence: result.confidence,
				reasoning: result.reasoning,
				metadata: result.metadata,
			});
		} catch (error) {
			yield createErrorChunk(
				{
					code: 'STREAM_ERROR',
					message: devMode ? toError(error).message : 'Stream execution failed',
					retryable: true,
				},
				chunksEmitted,
				true
			);
		}
	}

	return { executeCommand, executeBatch, executePipeline, executeStream };
}
