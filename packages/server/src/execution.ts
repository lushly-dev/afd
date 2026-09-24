/**
 * @fileoverview Command execution engine — single, batch, pipeline, and streaming execution.
 *
 * Single commands run here (validation, context, middleware, hooks). Batch,
 * pipeline and stream execution delegate to the core executors
 * (`executeBatch`, `executePipeline`, `executeStream`) with this engine's
 * `executeCommand` as the callback, so their semantics are shared with the
 * core registry and DirectClient.
 */

import type {
	BatchRequest,
	BatchResult,
	CommandContext,
	CommandMiddleware,
	CommandResult,
	PipelineRequest,
	PipelineResult,
	StreamChunk,
} from '@lushly-dev/afd-core';
import {
	executeBatch as executeCoreBatch,
	executePipeline as executeCorePipeline,
	executeStream as executeCoreStream,
	executionFailure,
	failure,
	truncateName,
} from '@lushly-dev/afd-core';
import type { ContextState } from './bootstrap/afd-context.js';
import {
	filterByContext,
	isAccessibleInContext,
	notFoundSuggestion,
	notInContextError,
} from './command-routing.js';
import { resolveContextState } from './context-scope.js';
import type { ZodCommandDefinition } from './schema.js';
import type { EnhancedValidationResult } from './validation.js';
import { formatEnhancedValidationError, validateInputEnhanced } from './validation.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ExecutionDeps {
	commandMap: Map<string, ZodCommandDefinition>;
	middleware: CommandMiddleware[];
	/** Context state used when the command context carries none (stdio). */
	contextState?: ContextState;
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
		const activeContext = resolveContextState(context, deps.contextState)?.getActive();

		if (!command) {
			// A few close matches, never the whole list: in lazy mode that would load
			// every command name into the agent's context on a single typo.
			const candidates = filterByContext([...commandMap.values()], activeContext);
			return failure({
				code: 'COMMAND_NOT_FOUND',
				message: `Command '${truncateName(commandName)}' not found`,
				suggestion: notFoundSuggestion(
					commandName,
					candidates.map((candidate) => candidate.name)
				),
			});
		}

		if (activeContext && !isAccessibleInContext(command, activeContext)) {
			return failure(notInContextError(commandName, activeContext));
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
			reportError(error);
			// The raw message and stack only in devMode, to prevent information leakage.
			return executionFailure(error, devMode);
		}

		// Outside the try: a failing onCommand must not turn a completed command
		// (possibly a committed write) into COMMAND_EXECUTION_ERROR.
		runHook(() => onCommand?.(commandName, input, result), reportError);
		return result;
	}

	/**
	 * Execute multiple commands in a batch with partial success semantics.
	 *
	 * Delegates to the core `executeBatch()` with {@link executeCommand} as the
	 * callback, so every entry gets the same validation, middleware, context and
	 * error handling as a single call.
	 */
	function executeBatch(request: BatchRequest, context: CommandContext = {}): Promise<BatchResult> {
		return executeCoreBatch(request, executeCommand, context, { devMode });
	}

	/**
	 * Execute a pipeline of chained commands with variable resolution.
	 * `$input` resolves to `request.input`; `context` is passed to commands, never to references.
	 */
	async function executePipeline(
		request: PipelineRequest,
		context: CommandContext = {}
	): Promise<PipelineResult> {
		// The core runner resolves `$input` against the context it is given, so it only gets the
		// trace ID and signal. Request values (for example from `createContext`) must not be
		// readable, or copyable into step inputs, by the pipeline author.
		const runnerContext: CommandContext = {};
		if (context.traceId !== undefined) runnerContext.traceId = context.traceId;
		if (context.signal !== undefined) runnerContext.signal = context.signal;
		return executeCorePipeline(
			request,
			(name, input, stepContext) => executeCommand(name, input, { ...context, ...stepContext }),
			runnerContext
		);
	}

	/**
	 * Execute a command and stream its result.
	 *
	 * Delegates to the core `executeStream()` with {@link executeCommand} as the
	 * callback. This is not incremental streaming: the handler runs to
	 * completion first, then an array result is emitted as one data chunk per
	 * item, any other result as a single data chunk, followed by a complete
	 * chunk. `context.signal` cancels the stream with a `STREAM_ABORTED` error
	 * chunk.
	 */
	function executeStream(
		commandName: string,
		input: unknown,
		context: CommandContext = {}
	): AsyncGenerator<StreamChunk, void, unknown> {
		return executeCoreStream(commandName, input, executeCommand, context, { devMode });
	}

	return { executeCommand, executeBatch, executePipeline, executeStream };
}
