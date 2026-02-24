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
	evaluateCondition,
	resolveVariables,
} from './pipeline.js';
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

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Execute a pipeline of chained commands with variable resolution.
 *
 * This is the core implementation used by both the MCP server and
 * any other host that needs pipeline semantics. It supports:
 * - Sequential step execution with `$prev`, `$first`, `$steps`, `$input` variable resolution
 * - Conditional steps via `when` clauses
 * - `continueOnFailure` and `timeoutMs` options
 * - Full metadata aggregation (confidence, reasoning, warnings, sources, alternatives)
 *
 * @param request - The pipeline request describing steps and options
 * @param execute - Callback to execute a single command
 * @param context - Optional context passed to every command invocation
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
	const pipelineId = request.id ?? `pipeline-${Date.now()}-${Math.random().toString(36).slice(2)}`;

	// Validate request
	if (!request.steps || request.steps.length === 0) {
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
			steps: [],
		};
	}

	const pipelineContext: PipelineContext = {
		pipelineInput: context,
		previousResult: undefined,
		steps: [],
	};

	const stepResults: StepResult[] = [];
	const options = request.options ?? {};
	let stopped = false;

	for (let i = 0; i < request.steps.length; i++) {
		const step = request.steps[i];
		if (!step) continue;
		const stepStartTime = performance.now();

		// Check if pipeline was stopped by a previous failure
		if (stopped) {
			stepResults.push({
				index: i,
				alias: step.as,
				command: step.command,
				status: 'skipped',
				executionTimeMs: 0,
			});
			continue;
		}

		// Evaluate when condition if present
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

		// Resolve variables in step input
		const resolvedInput = step.input ? resolveVariables(step.input, pipelineContext) : {};

		// Execute the command
		const result = await execute(step.command, resolvedInput, {
			...context,
			traceId: (context.traceId as string | undefined) ?? `${pipelineId}-step-${i}`,
		});

		const stepExecutionTimeMs = performance.now() - stepStartTime;

		if (result.success) {
			const stepResult: StepResult = {
				index: i,
				alias: step.as,
				command: step.command,
				status: 'success',
				data: result.data,
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
			pipelineContext.steps.push(stepResult);
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

			if (!options.continueOnFailure) {
				stopped = true;
				// Mark remaining steps as skipped
				for (let j = i + 1; j < request.steps.length; j++) {
					const remainingStep = request.steps[j];
					if (!remainingStep) continue;
					stepResults.push({
						index: j,
						alias: remainingStep.as,
						command: remainingStep.command,
						status: 'skipped',
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
					},
					executionTimeMs: 0,
				});
			}
			break;
		}
	}

	const totalExecutionTimeMs = performance.now() - startTime;

	// Get the last successful step's data as the pipeline output
	const lastSuccessfulStep = [...stepResults].reverse().find((s) => s.status === 'success');
	const finalData = lastSuccessfulStep?.data;

	// Build metadata using helper functions
	const metadata: PipelineMetadata = {
		confidence: aggregatePipelineConfidence(stepResults),
		confidenceBreakdown: buildConfidenceBreakdown(stepResults, request.steps),
		reasoning: aggregatePipelineReasoning(stepResults),
		warnings: aggregatePipelineWarnings(stepResults),
		sources: aggregatePipelineSources(stepResults),
		alternatives: aggregatePipelineAlternatives(stepResults),
		executionTimeMs: Math.round(totalExecutionTimeMs * 100) / 100,
		completedSteps: stepResults.filter((s) => s.status === 'success').length,
		totalSteps: request.steps.length,
	};

	return {
		data: finalData,
		metadata,
		steps: stepResults,
	};
}
