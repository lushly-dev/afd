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
	CommandError,
	CommandMiddleware,
	CommandResult,
	ContextDefaults,
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
	isActorKind,
	truncateName,
	withContextDefaults,
} from '@lushly-dev/afd-core';
import { commandNotAllowed } from '@lushly-dev/afd-core/internal/direct-allow';
import { beginAdmission, needsAdmission, takeAdmission } from './approval-admission.js';
import { filterAllowed, isCommandAllowed } from './command-allow.js';
import {
	filterByContext,
	isAccessibleInContext,
	notFoundSuggestion,
	notInContextError,
} from './command-routing.js';
import { applyContextFields, type ContextField } from './context-fields.js';
import { type ContextState, resolveContextState } from './context-scope.js';
import {
	applyOutputBudget,
	checkOutputBudgetResult,
	EFFECTIVE_OUTPUT_BUDGET,
	SKIP_OUTPUT_BUDGET,
} from './output-budget.js';
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
	/** `clock`, `random` and `actor` for contexts that do not set them. */
	contextDefaults?: ContextDefaults;
	/** Declared context fields, validated on each call's context (`spec/context-fields.md`). */
	contextFields?: readonly ContextField[];
	/**
	 * Whether refusals may name `afd-discover` and the `afd-context-*` tools, which only a host that
	 * serves them can (`spec/error-codes.md`, "Suggestions name only tools the host provides").
	 * Default `true`: the MCP server serves both. A direct registry without a tool surface sets
	 * `false`.
	 */
	suggestTools?: boolean;
	/** Whether a command is hidden from the caller of `context` (MCP authorization, M6). */
	hidden?: (name: string, context: CommandContext) => boolean;
	/** The commands the caller of `context` may be shown, for suggestions (M6). */
	shown?: (commands: ZodCommandDefinition[], context: CommandContext) => ZodCommandDefinition[];
	/**
	 * The validation of this run of `name` on `input`, when something other than the schema
	 * alone decides its data. The MCP server answers for a step of an `afd-batch` or `afd-pipe`
	 * approved up front, which runs on the input the human was shown (#1414).
	 */
	validated?: (
		name: string,
		input: unknown,
		context: CommandContext
	) => Promise<EnhancedValidationResult<unknown> | undefined> | undefined;
	/** Maximum commands accepted in a single batch (default: 500). */
	maxBatchSize?: number;
	/** Maximum parallelism accepted in a single batch (default: 16). */
	maxBatchParallelism?: number;
	/** Maximum validation issues reported in a single `VALIDATION_ERROR` (default: 100). */
	maxValidationIssues?: number;
	/**
	 * Optional host-verified relay hooks passed only by the Node MCP server (`server.ts`), keeping
	 * `relay-evidence.ts` out of browser `/direct` first-paint bundles.
	 */
	relay?: {
		transfer(from: CommandContext, to: CommandContext): void;
		takeDispatch(
			context: CommandContext,
			commandName: string,
			data: unknown
		): CommandError | undefined;
		clear(context: CommandContext): void;
	};
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
	const suggestTools = deps.suggestTools ?? true;

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
		callerContext: CommandContext = {}
	): Promise<CommandResult> {
		// A direct registry call's `allow` option covers every command the call runs, however it
		// is reached (afd-call, batch items, pipeline steps, grouped tools). Checked before the
		// lookup, as DirectClient does, so a refused name gives the same answer whether it exists.
		if (!isCommandAllowed(callerContext, commandName)) {
			return failure(commandNotAllowed(commandName));
		}

		// One context object flows through every middleware into the handler.
		// Read the non-enumerable stream marker from callerContext before spreading defaults,
		// so it never leaks into middleware or handlers.
		const skipOutputBudget = Boolean(
			(callerContext as unknown as Record<symbol, unknown>)[SKIP_OUTPUT_BUDGET]
		);
		const context = withContextDefaults(callerContext, deps.contextDefaults);
		deps.relay?.transfer(callerContext, context);
		// A command hidden from the caller (MCP authorization, M6) is looked up as a name that
		// does not exist, before validation, middleware or the handler.
		const command = deps.hidden?.(commandName, callerContext)
			? undefined
			: commandMap.get(commandName);
		const activeContext = resolveContextState(context, deps.contextState)?.getActive();
		// The command's own approval policy, for the approval middleware to decide from. This
		// call's context is a fresh object, so no other call's admission applies to it.
		if (command) beginAdmission(context, command);

		if (!command) {
			// A few close matches, never the whole list: in lazy mode that would load
			// every command name into the agent's context on a single typo. Never one the call's
			// `allow` option refuses, nor one the caller is not shown.
			const listed = [...commandMap.values()];
			const candidates = filterAllowed(
				filterByContext(deps.shown?.(listed, callerContext) ?? listed, activeContext),
				callerContext
			);
			return failure({
				code: 'COMMAND_NOT_FOUND',
				message: `Command '${truncateName(commandName)}' not found`,
				suggestion: notFoundSuggestion(
					commandName,
					candidates.map((candidate) => candidate.name),
					suggestTools
				),
			});
		}

		if (activeContext && !isAccessibleInContext(command, activeContext)) {
			return failure(
				notInContextError(commandName, activeContext, suggestTools ? undefined : command.contexts)
			);
		}
		// Validate input with enhanced error messages. Schema callbacks (.refine,
		// .superRefine, .transform, .preprocess) run here, so an exception they throw
		// becomes a VALIDATION_ERROR result instead of rejecting.
		let validation: EnhancedValidationResult<unknown>;
		try {
			// The MCP server validates a step of an afd-batch or afd-pipe approved up front itself,
			// to run it on the input the human was shown (#1414).
			validation =
				(await deps.validated?.(commandName, input, context)) ??
				validateInputEnhanced(command.inputSchema, input, deps.maxValidationIssues);
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
					truncated: validation.truncated,
					limit: validation.limit,
				}),
				details: {
					errors: validation.errors,
					expectedFields: validation.expectedFields,
					unexpectedFields: validation.unexpectedFields,
					missingFields: validation.missingFields,
					...(validation.truncated
						? {
								truncated: true,
								limit: validation.limit,
								totalErrors: validation.totalErrors,
							}
						: {}),
				},
			});
		}

		const invalidField = applyContextFields(deps.contextFields ?? [], context, commandName);
		if (invalidField) return invalidField;

		const invalidBudget = applyOutputBudget(command, context);
		if (invalidBudget) return invalidBudget;

		const effectiveBudget = context.outputBudget;
		if (effectiveBudget !== undefined) {
			Object.defineProperty(context, EFFECTIVE_OUTPUT_BUDGET, { value: effectiveBudget });
		}
		const data = validation.data;

		// Build middleware chain
		const runHandler = async (): Promise<CommandResult> => {
			// A declared approval policy holds without the approval middleware: a command whose
			// policy is not 'not-required' runs only when an approval step admitted this call. A
			// policy function is not evaluated here; declaring one needs an approval step. The same
			// holds for a policy given only in the middleware's `commands` list, once the middleware
			// recorded that it gates this call.
			// The admission must name this command and this validated input, and is taken here, so a
			// second dispatch on the same context (a retry inside the chain) needs a second admission.
			const admission = needsAdmission(context)
				? takeAdmission(context, commandName, data)
				: 'admitted';
			if (admission !== 'admitted') {
				// 'mismatch': an approval step ran, but this dispatch is not the one it admitted (a
				// retry placed after it, or the input changed after it), so the operator fixes the order.
				return failure({
					code: 'APPROVAL_UNAVAILABLE',
					message: `${commandName} needs a person's approval, and this server cannot ask for it`,
					suggestion:
						admission === 'missing'
							? `Tell the user that ${commandName} needs their approval and this server has no approval step; do not retry. The operator adds the approval middleware (createApprovalMiddleware) or removes the command's approval policy.`
							: `Do not retry: this call is not the one approved. The operator moves middleware that retries or changes input before the approval middleware.`,
					retryable: false,
					details: { reason: admission === 'missing' ? 'no-approval-step' : 'admission-mismatch' },
				});
			}
			const relayMismatch = deps.relay?.takeDispatch(context, commandName, data);
			if (relayMismatch) return failure(relayMismatch);
			// Clear private relay evidence before the handler runs so nested in-process calls never see it.
			deps.relay?.clear(context);
			const { clock } = context;
			const startTime = clock.now();
			const rawResult = await command.handler(data, context);
			// Post-handler output budget check (spec/output-budgets.md, B5 & B6): runs before
			// metadata stamping and before middleware or the journal see the result; skipped on
			// buffered executeStream (B7).
			const result =
				effectiveBudget !== undefined && !skipOutputBudget
					? checkOutputBudgetResult(command, effectiveBudget, rawResult)
					: rawResult;

			// Build a new result rather than mutating the handler's (possibly frozen) object.
			// Read the actor after the handler: middleware (auth) may have refined it.
			return {
				...result,
				metadata: {
					...result.metadata,
					executionTimeMs: Math.max(0, clock.now() - startTime),
					commandVersion: command.version,
					...(context.traceId ? { traceId: context.traceId } : {}),
					...(isActorKind(context.actor?.kind) ? { actorKind: context.actor.kind } : {}),
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
		return executeCoreBatch(request, executeCommand, context, {
			devMode,
			maxBatchSize: deps.maxBatchSize,
			maxBatchParallelism: deps.maxBatchParallelism,
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
		// B7: a streamed command's chunks are not checked by B5 in this version.
		// Non-enumerable symbol keeps `context` structurally equal to the caller's object.
		const streamContext: CommandContext = { ...context };
		Object.defineProperty(streamContext, SKIP_OUTPUT_BUDGET, { value: true });
		return executeCoreStream(commandName, input, executeCommand, streamContext, { devMode });
	}

	return { executeCommand, executeBatch, executePipeline, executeStream };
}
