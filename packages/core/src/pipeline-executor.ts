/**
 * @fileoverview Core pipeline executor
 *
 * Provides the `executePipeline()` function — the transport-agnostic
 * implementation of pipeline execution with variable resolution,
 * conditional steps, and metadata aggregation.
 *
 * Separated from `pipeline.ts` to keep both modules within the
 * repository file-size convention.
 */

import type { CommandError } from './errors.js';
import type {
	PipelineContext,
	PipelineMetadata,
	PipelineRequest,
	PipelineResult,
	StepResult,
} from './pipeline.js';
import {
	aggregatePipelineAlternatives,
	aggregatePipelineConfidence,
	aggregatePipelineReasoning,
	aggregatePipelineSources,
	aggregatePipelineWarnings,
	buildConfidenceBreakdown,
} from './pipeline.js';
import { copyPipelineData, evaluateCondition, resolveVariables } from './pipeline-variables.js';
import { isPipelineRequest, pipelineLimitError } from './request-validation.js';
import type { CommandResult } from './result.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Function signature for executing a single command.
 *
 * The core pipeline executor is decoupled from command registration.
 * The server (or any host) provides this callback so the core module
 * stays agnostic of how commands are resolved and invoked.
 */
export type CommandExecutor = (
	commandName: string,
	input: unknown,
	context: Record<string, unknown>
) => Promise<CommandResult>;

const INVALID_REQUEST_ERROR: CommandError = {
	code: 'INVALID_PIPELINE_REQUEST',
	message: 'Invalid pipeline request envelope',
	suggestion:
		'Provide steps with nonempty command names, object inputs, valid conditions, and correctly typed options; input must be JSON',
};

const RESOLUTION_ERROR: CommandError = {
	code: 'INTERNAL_ERROR',
	message: 'Could not evaluate the step condition or resolve its input references',
	suggestion: 'Check that earlier steps return plain JSON data, then retry',
};

/** A pipeline that ran no step: empty, or rejected by preflight with `error`. */
function rejectedPipeline(error?: CommandError): PipelineResult {
	return {
		data: undefined,
		metadata: {
			confidence: 0,
			confidenceBreakdown: [],
			reasoning: [],
			warnings: [],
			sources: [],
			alternatives: [],
			executionTimeMs: 0,
			completedSteps: 0,
			totalSteps: 0,
		},
		steps: error ? [{ index: -1, command: '', status: 'failure', executionTimeMs: 0, error }] : [],
	};
}

/**
 * An option the envelope accepts but the executor does not implement, with the
 * step to blame: `options.parallel` (step 0) or the first step with
 * `stream: true`. Undefined when the request uses neither.
 */
function unsupportedOption(
	request: PipelineRequest
): { stepIndex: number; error: CommandError } | undefined {
	if (request.options?.parallel) {
		return {
			stepIndex: 0,
			error: {
				code: 'UNSUPPORTED_OPTION',
				message: 'Parallel pipeline execution is not supported',
				suggestion: 'Remove parallel or set it to false to execute steps sequentially',
			},
		};
	}
	const stepIndex = request.steps.findIndex((step) => step.stream === true);
	if (stepIndex === -1) return undefined;
	return {
		stepIndex,
		error: {
			code: 'UNSUPPORTED_OPTION',
			message: `Streaming pipeline steps are not supported (step ${stepIndex} sets stream: true)`,
			suggestion:
				'Remove stream or set it to false; to stream one command, use the /stream endpoint or executeStream()',
		},
	};
}

/** Aggregate step results into the pipeline result. */
function pipelineResult(
	request: PipelineRequest,
	stepResults: StepResult[],
	startTime: number
): PipelineResult {
	// The pipeline output is the last successful step's data
	const lastSuccessfulStep = [...stepResults].reverse().find((s) => s.status === 'success');
	const metadata: PipelineMetadata = {
		confidence: aggregatePipelineConfidence(stepResults),
		confidenceBreakdown: buildConfidenceBreakdown(stepResults, request.steps),
		reasoning: aggregatePipelineReasoning(stepResults),
		warnings: aggregatePipelineWarnings(stepResults),
		sources: aggregatePipelineSources(stepResults),
		alternatives: aggregatePipelineAlternatives(stepResults),
		executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
		completedSteps: stepResults.filter((s) => s.status === 'success').length,
		totalSteps: request.steps.length,
	};
	return { data: lastSuccessfulStep?.data, metadata, steps: stepResults };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Execute a pipeline of chained commands with variable resolution.
 *
 * This is the core implementation used by both the MCP server and
 * any other host that needs pipeline semantics. It supports:
 * - Sequential step execution with `$prev`, `$first`, `$steps`, `$input` variable resolution
 *   (see `spec/pipeline-variables.md`)
 * - Conditional steps via `when` clauses
 * - `continueOnFailure` and `timeoutMs` options
 * - Full metadata aggregation (confidence, reasoning, warnings, sources, alternatives)
 *
 * The request is validated before any step runs: a malformed envelope fails with
 * `INVALID_PIPELINE_REQUEST`, and step inputs or a request `input` nested deeper than 64 levels
 * fail with `VALIDATION_ERROR`. Options the envelope accepts but the executor does not
 * implement, `options.parallel` and a step's `stream: true`, fail that step (step 0 for
 * `parallel`) with `UNSUPPORTED_OPTION` and skip every other step, so no command runs.
 * Each step's data is copied (`structuredClone`) as it enters the
 * pipeline context and again when a reference resolves it, so a handler that mutates its input
 * cannot change another step's data.
 *
 * **Behavior change:** `$input` resolves to `request.input`. It used to resolve to `context`,
 * which exposed the host's trace IDs, auth and other execution values to pipeline references.
 *
 * @param request - The pipeline request describing steps, options and `input`
 * @param execute - Callback to execute a single command
 * @param context - Optional context passed to every command invocation; never visible to
 *   `$input` or any other reference
 * @returns The aggregated pipeline result
 *
 * @example
 * ```typescript
 * import { executePipeline, type PipelineRequest } from '@lushly-dev/afd-core';
 *
 * const result = await executePipeline(
 *   { steps: [{ command: 'user-get', input: { id: 1 } }] },
 *   (name, input, ctx) => server.execute(name, input, ctx),
 * );
 * ```
 */
export async function executePipeline(
	request: PipelineRequest,
	execute: CommandExecutor,
	context: Record<string, unknown> = {}
): Promise<PipelineResult> {
	const startTime = performance.now();
	const pipelineId = request?.id ?? `pipeline-${Date.now()}-${Math.random().toString(36).slice(2)}`;

	// Validate the complete envelope and its limits before invoking any command.
	const valid = isPipelineRequest(request);
	if (!valid) return rejectedPipeline(INVALID_REQUEST_ERROR);
	if (request.steps.length === 0) return rejectedPipeline();
	const limitError = pipelineLimitError(request);
	if (limitError) return rejectedPipeline(limitError);
	const unsupported = unsupportedOption(request);
	if (unsupported) {
		// Blame one step and skip the rest, so no command runs.
		const steps = request.steps.map(
			(step, index): StepResult => ({
				index,
				alias: step.as,
				command: step.command,
				...(index === unsupported.stepIndex
					? { status: 'failure', error: unsupported.error }
					: { status: 'skipped' }),
				executionTimeMs: 0,
			})
		);
		return pipelineResult(request, steps, startTime);
	}

	const pipelineContext: PipelineContext = {
		pipelineInput: copyPipelineData(request.input),
		previousResult: undefined,
		steps: [],
	};

	const stepResults: StepResult[] = pipelineContext.steps;
	const options = request.options ?? {};

	for (let i = 0; i < request.steps.length; i++) {
		const step = request.steps[i];
		if (!step) continue;
		const stepStartTime = performance.now();

		// Evaluate the when condition and resolve references inside the per-step error handling
		let resolvedInput: unknown = {};
		let resolutionFailure: CommandResult | undefined;
		try {
			if (step.when && !evaluateCondition(step.when, pipelineContext)) {
				stepResults.push({
					index: i,
					alias: step.as,
					command: step.command,
					status: 'skipped',
					executionTimeMs: 0,
				});
				continue;
			}
			if (step.input) {
				resolvedInput = resolveVariables(step.input, pipelineContext);
			}
		} catch {
			resolutionFailure = { success: false, error: RESOLUTION_ERROR };
		}

		// Execute the command
		const remainingMs =
			options.timeoutMs === undefined
				? undefined
				: options.timeoutMs - (performance.now() - startTime);
		const controller = new AbortController();
		const callerSignal = context.signal instanceof AbortSignal ? context.signal : undefined;
		const signal = callerSignal
			? AbortSignal.any([callerSignal, controller.signal])
			: controller.signal;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeoutResult: CommandResult = {
			success: false,
			error: {
				code: 'PIPELINE_TIMEOUT',
				message: `Pipeline timeout exceeded (${options.timeoutMs}ms)`,
				suggestion: 'Increase timeoutMs or reduce the number of pipeline steps',
				retryable: true,
			},
		};
		let result: CommandResult;
		try {
			if (resolutionFailure) {
				result = resolutionFailure;
			} else if (remainingMs !== undefined && remainingMs <= 0) {
				controller.abort();
				result = timeoutResult;
			} else {
				const execution = execute(step.command, resolvedInput, {
					...context,
					signal,
					traceId: (context.traceId as string | undefined) ?? `${pipelineId}-step-${i}`,
				});
				result =
					remainingMs === undefined
						? await execution
						: await Promise.race([
								execution,
								new Promise<CommandResult>((resolve) => {
									timer = setTimeout(() => {
										resolve(timeoutResult);
										controller.abort();
									}, remainingMs);
								}),
							]);
			}
		} catch (error) {
			result = {
				success: false,
				error: {
					code: 'COMMAND_EXECUTION_ERROR',
					message: error instanceof Error ? error.message : String(error),
					suggestion: 'Check the command implementation and retry',
				},
			};
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}

		const stepExecutionTimeMs = performance.now() - stepStartTime;

		if (result.success) {
			const stepResult: StepResult = {
				index: i,
				alias: step.as,
				command: step.command,
				status: 'success',
				data: copyPipelineData(result.data),
				executionTimeMs: Math.round(stepExecutionTimeMs * 100) / 100,
				metadata: {
					confidence: result.confidence,
					reasoning: result.reasoning,
					warnings: result.warnings,
					sources: result.sources,
					alternatives: result.alternatives,
				},
			};
			stepResults.push(stepResult);
			pipelineContext.previousResult = stepResult;
		} else {
			const stepResult: StepResult = {
				index: i,
				alias: step.as,
				command: step.command,
				status: 'failure',
				error: result.error,
				executionTimeMs: Math.round(stepExecutionTimeMs * 100) / 100,
			};
			stepResults.push(stepResult);

			if (!options.continueOnFailure || result.error?.code === 'PIPELINE_TIMEOUT') {
				// Mark remaining steps as skipped
				for (let j = i + 1; j < request.steps.length; j++) {
					const remainingStep = request.steps[j];
					if (!remainingStep) continue;
					stepResults.push({
						index: j,
						alias: remainingStep.as,
						command: remainingStep.command,
						status: 'skipped',
						...(result.error?.code === 'PIPELINE_TIMEOUT' ? { error: result.error } : {}),
						executionTimeMs: 0,
					});
				}
				break;
			}
		}

		// Check timeout
		if (options.timeoutMs && performance.now() - startTime > options.timeoutMs) {
			for (let j = i + 1; j < request.steps.length; j++) {
				const remainingStep = request.steps[j];
				if (!remainingStep) continue;
				stepResults.push({
					index: j,
					alias: remainingStep.as,
					command: remainingStep.command,
					status: 'skipped',
					error: {
						code: 'PIPELINE_TIMEOUT',
						message: `Pipeline timeout exceeded (${options.timeoutMs}ms)`,
						retryable: true,
						suggestion: 'Increase timeoutMs or reduce the number of pipeline steps',
					},
					executionTimeMs: 0,
				});
			}
			break;
		}
	}

	return pipelineResult(request, stepResults, startTime);
}
