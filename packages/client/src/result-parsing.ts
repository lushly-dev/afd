import type {
	BatchCommand,
	BatchResult,
	CommandError,
	CommandResult,
	McpToolCallResult,
	PipelineRequest,
	PipelineResult,
} from '@lushly-dev/afd-core';
import { isBatchResult, isPipelineResult } from '@lushly-dev/afd-core';

export function getTextContent(result: McpToolCallResult): string {
	return result.content
		.filter((content): content is { type: 'text'; text: string } => content.type === 'text')
		.map((content) => content.text)
		.join('');
}

export function parseTextContent(result: McpToolCallResult): unknown {
	const text = getTextContent(result);
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

export function isCommandResult(value: unknown): value is CommandResult {
	return (
		typeof value === 'object' &&
		value !== null &&
		'success' in value &&
		typeof value.success === 'boolean'
	);
}

export function createBatchFailure<T>(
	commands: BatchCommand[],
	startedAt: string,
	error: CommandError,
	reasoning: string
): BatchResult<T> {
	return {
		success: false,
		results: [],
		summary: {
			total: commands.length,
			successCount: 0,
			failureCount: commands.length,
			skippedCount: 0,
		},
		timing: {
			startedAt,
			completedAt: new Date().toISOString(),
			totalMs: 0,
			averageMs: 0,
		},
		confidence: 0,
		reasoning,
		error,
	};
}

/**
 * The error for a batch or pipeline whose request got no result: it timed out or the connection
 * failed after the request may have reached the server, so some or all commands may have run.
 *
 * @param cause - The request error, already converted with `toCommandError()`
 */
export function outcomeUnknownError(
	cause: CommandError,
	operation: 'batch' | 'pipeline'
): CommandError {
	return {
		code: 'OUTCOME_UNKNOWN',
		message: `No ${operation} result was received (${cause.message}). The server may have run some or all of its commands.`,
		suggestion: `Check the effect of each command before retrying: running the ${operation} again can repeat writes that already happened.`,
		retryable: false,
		details: { cause: cause.code, ...cause.details },
	};
}

/**
 * A failed batch whose outcome is unknown. It reports no per-command statuses: `results` is
 * empty and every summary count except `total` is zero, because no command is known to have
 * failed or succeeded.
 */
export function createUnknownOutcomeBatch<T>(
	commands: BatchCommand[],
	startedAt: string,
	error: CommandError
): BatchResult<T> {
	return {
		...createBatchFailure<T>(commands, startedAt, error, error.message),
		summary: { total: commands.length, successCount: 0, failureCount: 0, skippedCount: 0 },
	};
}

/**
 * A pipeline whose outcome is unknown. Like core's rejected pipelines it carries the error on a
 * single pipeline-level entry (`index: -1`) instead of inventing a status for each step.
 */
export function createUnknownOutcomePipeline<T>(
	request: PipelineRequest,
	error: CommandError
): PipelineResult<T> {
	return {
		...createPipelineFailure<T>(request),
		steps: [{ index: -1, command: '', status: 'failure', error, executionTimeMs: 0 }],
	};
}

export function createPipelineFailure<T>(
	request: PipelineRequest,
	error?: CommandError
): PipelineResult<T> {
	return {
		data: undefined as T,
		metadata: {
			confidence: 0,
			confidenceBreakdown: [],
			reasoning: [],
			warnings: [],
			sources: [],
			alternatives: [],
			executionTimeMs: 0,
			completedSteps: 0,
			totalSteps: request.steps.length,
		},
		steps: error
			? request.steps.map((step, index) => ({
					index,
					alias: step.as,
					command: step.command,
					status: 'failure' as const,
					error,
					executionTimeMs: 0,
				}))
			: [],
	};
}

export { isBatchResult, isPipelineResult };
