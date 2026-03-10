/**
 * @fileoverview Command execution engine — single, batch, pipeline, and streaming execution.
 */

import type {
	BatchCommandResult,
	BatchRequest,
	BatchResult,
	BatchTiming,
	CommandContext,
	CommandMiddleware,
	CommandResult,
	PipelineContext,
	PipelineMetadata,
	PipelineRequest,
	PipelineResult,
	StepResult,
	StreamChunk,
} from '@lushly-dev/afd-core';
import {
	aggregatePipelineAlternatives,
	aggregatePipelineConfidence,
	aggregatePipelineReasoning,
	aggregatePipelineSources,
	aggregatePipelineWarnings,
	buildConfidenceBreakdown,
	createBatchResult,
	createCompleteChunk,
	createErrorChunk,
	createFailedBatchResult,
	evaluateCondition,
	failure,
	resolveVariables,
} from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from './schema.js';
import { formatEnhancedValidationError, validateInputEnhanced } from './validation.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ExecutionDeps {
	commandMap: Map<string, ZodCommandDefinition>;
	middleware: CommandMiddleware[];
	devMode: boolean;
	onCommand?: (command: string, input: unknown, result: CommandResult) => void;
	onError?: (error: Error) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION ENGINE FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

export function createExecutionEngine(deps: ExecutionDeps) {
	const { commandMap, middleware, devMode, onCommand, onError } = deps;

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
				message: `Command '${commandName}' not found`,
				suggestion: `Available commands: ${Array.from(commandMap.keys()).join(', ')}`,
			});
		}

		// Validate input with enhanced error messages
		const validation = validateInputEnhanced(command.inputSchema, input);
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

		// Build middleware chain
		const runHandler = async (): Promise<CommandResult> => {
			const startTime = Date.now();
			const result = await command.handler(validation.data, context);

			// Add metadata if not present
			if (!result.metadata) {
				result.metadata = {};
			}
			result.metadata.executionTimeMs = Date.now() - startTime;
			result.metadata.commandVersion = command.version;
			if (context.traceId) {
				result.metadata.traceId = context.traceId;
			}

			return result;
		};

		// Apply middleware in reverse order
		let next = runHandler;
		for (let i = middleware.length - 1; i >= 0; i--) {
			const mw = middleware[i];
			if (!mw) continue;
			const currentNext = next;
			next = () => mw(commandName, validation.data, context, currentNext);
		}

		try {
			const result = await next();
			onCommand?.(commandName, input, result);
			return result;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			onError?.(err);
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
		if (!request.commands || request.commands.length === 0) {
			return createFailedBatchResult(
				{
					code: 'INVALID_BATCH_REQUEST',
					message: 'Batch request must contain at least one command',
					suggestion: 'Provide an array of commands to execute',
				},
				{ startedAt }
			);
		}

		const options = request.options ?? {};
		const results: BatchCommandResult[] = [];
		let stopped = false;

		// Execute commands sequentially
		for (let i = 0; i < request.commands.length; i++) {
			const cmd = request.commands[i];
			if (!cmd) continue;

			if (stopped) {
				results.push({
					id: cmd.id ?? `cmd-${i}`,
					index: i,
					command: cmd.command,
					result: {
						success: false,
						error: {
							code: 'COMMAND_SKIPPED',
							message: 'Command skipped due to previous error (stopOnError enabled)',
						},
					},
					durationMs: 0,
				});
				continue;
			}

			const cmdStartTime = performance.now();
			const result = await executeCommand(cmd.command, cmd.input, {
				...context,
				traceId: context.traceId ?? `batch-${Date.now()}-${i}`,
			});
			const cmdDuration = performance.now() - cmdStartTime;

			results.push({
				id: cmd.id ?? `cmd-${i}`,
				index: i,
				command: cmd.command,
				result,
				durationMs: Math.round(cmdDuration * 100) / 100,
			});

			if (!result.success && options.stopOnError) {
				stopped = true;
			}

			// Check timeout
			if (options.timeout && performance.now() - startTime > options.timeout) {
				for (let j = i + 1; j < request.commands.length; j++) {
					const remainingCmd = request.commands[j];
					if (!remainingCmd) continue;
					results.push({
						id: remainingCmd.id ?? `cmd-${j}`,
						index: j,
						command: remainingCmd.command,
						result: {
							success: false,
							error: {
								code: 'BATCH_TIMEOUT',
								message: `Batch timeout exceeded (${options.timeout}ms)`,
								retryable: true,
							},
						},
						durationMs: 0,
					});
				}
				break;
			}
		}

		const completedAt = new Date().toISOString();
		const totalMs = performance.now() - startTime;

		const timing: BatchTiming = {
			totalMs: Math.round(totalMs * 100) / 100,
			averageMs: results.length > 0 ? Math.round((totalMs / results.length) * 100) / 100 : 0,
			startedAt,
			completedAt,
		};

		return createBatchResult(results, timing, {
			traceId: context.traceId ?? `batch-${Date.now()}`,
		});
	}

	/**
	 * Execute a pipeline of chained commands with variable resolution.
	 */
	async function executePipeline(
		request: PipelineRequest,
		context: CommandContext = {}
	): Promise<PipelineResult> {
		const startTime = performance.now();
		const pipelineId =
			request.id ?? `pipeline-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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

			// Execute the command
			const result = await executeCommand(step.command, resolvedInput, {
				...context,
				traceId: context.traceId ?? `${pipelineId}-step-${i}`,
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
					message: error instanceof Error ? error.message : String(error),
					retryable: true,
				},
				chunksEmitted,
				true
			);
		}
	}

	return { executeCommand, executeBatch, executePipeline, executeStream };
}
