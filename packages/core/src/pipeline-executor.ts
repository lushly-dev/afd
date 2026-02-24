/**
 * @fileoverview Core pipeline execution engine
 *
 * Transport-agnostic pipeline executor that handles sequential step execution,
 * variable resolution, conditional steps, error propagation, timeouts, and
 * metadata aggregation. Server and DirectClient delegate here.
 */

import type { CommandResult } from './result.js';
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

/**
 * Callback type for executing a single command during pipeline execution.
 *
 * This abstraction allows the core executor to remain transport-agnostic —
 * the server, DirectClient, or test harness provides its own implementation.
 */
export type CommandExecutor = (
	commandName: string,
	input: unknown,
	context: Record<string, unknown>
) => Promise<CommandResult>;

/**
 * Execute a pipeline of chained commands with variable resolution.
 *
 * This is the core pipeline execution engine. It handles:
 * - Sequential step execution with variable resolution ($prev, $steps, etc.)
 * - Conditional step execution via `when` clauses
 * - Error propagation (stop on first failure or continue)
 * - Timeout enforcement
 * - Metadata aggregation across all steps
 *
 * Transport layers (server, DirectClient) delegate to this function
 * by providing a `CommandExecutor` callback.
 *
 * @param request - The pipeline request with steps and options
 * @param execute - Callback to execute a single command
 * @param context - Optional context passed to each command execution
 * @returns A PipelineResult with aggregated data and metadata
 *
 * @example
 * ```typescript
 * const result = await executePipeline(
 *   {
 *     steps: [
 *       { command: 'user-get', input: { id: 1 }, as: 'user' },
 *       { command: 'order-list', input: { userId: '$prev.id' } },
 *     ],
 *   },
 *   async (name, input, ctx) => server.execute(name, input, ctx),
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

	// Empty pipeline shortcut
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
		pipelineInput: context as Record<string, unknown>,
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

		// Execute the command via the provided executor
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
