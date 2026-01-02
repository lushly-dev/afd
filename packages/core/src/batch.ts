/**
 * @fileoverview Batch execution types for AFD commands
 *
 * Batch operations allow executing multiple commands in a single roundtrip,
 * reducing network overhead for complex UI operations. Results use partial
 * success semantics with aggregated confidence scores.
 */

import type { CommandError } from './errors.js';
import type { CommandResult, ResultMetadata } from './result.js';

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH REQUEST TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A single command within a batch request.
 *
 * @example
 * ```typescript
 * const command: BatchCommand = {
 *   id: 'create-todo-1',
 *   command: 'todo.create',
 *   input: { title: 'Buy groceries', priority: 'high' }
 * };
 * ```
 */
export interface BatchCommand {
	/**
	 * Optional client-provided ID for correlating results.
	 * If not provided, index position is used.
	 */
	id?: string;

	/**
	 * The command name to execute.
	 */
	command: string;

	/**
	 * Input parameters for the command.
	 */
	input: unknown;
}

/**
 * Options for batch execution.
 */
export interface BatchOptions {
	/**
	 * Whether to stop execution on first error.
	 *
	 * - `true`: Stop at first failure, remaining commands not executed
	 * - `false` (default): Execute all commands, collect all results
	 */
	stopOnError?: boolean;

	/**
	 * Timeout in milliseconds for the entire batch.
	 * Individual command timeouts may be shorter.
	 */
	timeout?: number;

	/**
	 * Maximum number of commands to execute in parallel.
	 * Default is sequential (1). Set higher for independent commands.
	 */
	parallelism?: number;
}

/**
 * A batch request containing multiple commands to execute.
 *
 * @example
 * ```typescript
 * const request: BatchRequest = {
 *   commands: [
 *     { command: 'todo.create', input: { title: 'Task 1' } },
 *     { command: 'todo.create', input: { title: 'Task 2' } },
 *     { command: 'todo.list', input: {} }
 *   ],
 *   options: { stopOnError: false }
 * };
 * ```
 */
export interface BatchRequest {
	/**
	 * Array of commands to execute.
	 */
	commands: BatchCommand[];

	/**
	 * Batch execution options.
	 */
	options?: BatchOptions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Result of a single command within a batch.
 *
 * Extends the standard CommandResult with batch-specific metadata.
 */
export interface BatchCommandResult<T = unknown> {
	/**
	 * ID correlating to the BatchCommand.id or index.
	 */
	id: string;

	/**
	 * Index position in the original batch request.
	 */
	index: number;

	/**
	 * The command that was executed.
	 */
	command: string;

	/**
	 * The full command result.
	 */
	result: CommandResult<T>;

	/**
	 * Execution time for this specific command in milliseconds.
	 */
	durationMs: number;
}

/**
 * Summary statistics for a batch execution.
 */
export interface BatchSummary {
	/**
	 * Total number of commands in the batch.
	 */
	total: number;

	/**
	 * Number of successfully executed commands.
	 */
	successCount: number;

	/**
	 * Number of failed commands.
	 */
	failureCount: number;

	/**
	 * Number of skipped commands (when stopOnError is true).
	 */
	skippedCount: number;
}

/**
 * Timing information for the batch execution.
 */
export interface BatchTiming {
	/**
	 * Total time for the entire batch in milliseconds.
	 */
	totalMs: number;

	/**
	 * Average time per command in milliseconds.
	 */
	averageMs: number;

	/**
	 * Timestamp when batch execution started.
	 */
	startedAt: string;

	/**
	 * Timestamp when batch execution completed.
	 */
	completedAt: string;
}

/**
 * Result of a batch execution.
 *
 * Uses partial success semantics - success is true even if some commands fail.
 * The aggregated confidence reflects the overall success rate combined with
 * individual command confidence scores.
 *
 * @example
 * ```typescript
 * const result: BatchResult = {
 *   success: true,
 *   results: [...],
 *   summary: { total: 3, successCount: 2, failureCount: 1, skippedCount: 0 },
 *   confidence: 0.67,  // 2/3 succeeded
 *   reasoning: 'Executed 3 commands: 2 succeeded, 1 failed'
 * };
 * ```
 */
export interface BatchResult<T = unknown> {
	/**
	 * Whether the batch execution completed (not whether all commands succeeded).
	 * Always true unless the batch itself failed to execute.
	 */
	success: boolean;

	/**
	 * Results for each command in the batch.
	 */
	results: BatchCommandResult<T>[];

	/**
	 * Summary statistics.
	 */
	summary: BatchSummary;

	/**
	 * Timing information.
	 */
	timing: BatchTiming;

	/**
	 * Aggregated confidence score (0-1).
	 *
	 * Calculated as: (successRatio * 0.5) + (avgCommandConfidence * 0.5)
	 * Where successRatio = successCount / total
	 * And avgCommandConfidence = average of all successful command confidence scores
	 */
	confidence: number;

	/**
	 * Human-readable summary of the batch execution.
	 */
	reasoning: string;

	/**
	 * Warnings from any of the commands.
	 */
	warnings?: Array<{
		commandId: string;
		code: string;
		message: string;
	}>;

	/**
	 * Error if the batch itself failed to execute.
	 */
	error?: CommandError;

	/**
	 * Execution metadata.
	 */
	metadata?: ResultMetadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a batch request.
 *
 * @param commands - Array of commands to execute
 * @param options - Batch execution options
 * @returns A BatchRequest object
 *
 * @example
 * ```typescript
 * const request = createBatchRequest([
 *   { command: 'todo.create', input: { title: 'Task 1' } },
 *   { command: 'todo.create', input: { title: 'Task 2' } }
 * ], { stopOnError: false });
 * ```
 */
export function createBatchRequest(
	commands: Array<Omit<BatchCommand, 'id'> & { id?: string }>,
	options?: BatchOptions
): BatchRequest {
	return {
		commands: commands.map((cmd, index) => ({
			id: cmd.id ?? `cmd-${index}`,
			command: cmd.command,
			input: cmd.input,
		})),
		options,
	};
}

/**
 * Calculate aggregated confidence for a batch result.
 *
 * Formula: (successRatio * 0.5) + (avgCommandConfidence * 0.5)
 *
 * @param results - Array of command results
 * @returns Confidence score between 0 and 1
 */
export function calculateBatchConfidence(results: BatchCommandResult[]): number {
	if (results.length === 0) {
		return 1; // Empty batch is considered fully successful
	}

	// Calculate success ratio
	const successCount = results.filter((r) => r.result.success).length;
	const successRatio = successCount / results.length;

	// Calculate average confidence from successful commands
	const successfulResults = results.filter((r) => r.result.success);
	const avgCommandConfidence =
		successfulResults.length > 0
			? successfulResults.reduce((sum, r) => sum + (r.result.confidence ?? 1), 0) /
				successfulResults.length
			: 0;

	// Weighted average: 50% success ratio, 50% command confidence
	return successRatio * 0.5 + avgCommandConfidence * 0.5;
}

/**
 * Create a batch result from command results.
 *
 * @param results - Array of individual command results
 * @param timing - Timing information
 * @param metadata - Optional execution metadata
 * @returns A complete BatchResult object
 */
export function createBatchResult<T = unknown>(
	results: BatchCommandResult<T>[],
	timing: BatchTiming,
	metadata?: ResultMetadata
): BatchResult<T> {
	const successCount = results.filter((r) => r.result.success).length;
	const failureCount = results.filter((r) => !r.result.success).length;
	const skippedCount = results.length - successCount - failureCount;

	const summary: BatchSummary = {
		total: results.length,
		successCount,
		failureCount,
		skippedCount,
	};

	const confidence = calculateBatchConfidence(results);

	// Collect warnings from all commands
	const warnings: BatchResult['warnings'] = [];
	for (const r of results) {
		if (r.result.warnings) {
			for (const w of r.result.warnings) {
				warnings.push({
					commandId: r.id,
					code: w.code,
					message: w.message,
				});
			}
		}
	}

	// Generate reasoning
	const reasoning = generateBatchReasoning(summary);

	return {
		success: true,
		results,
		summary,
		timing,
		confidence,
		reasoning,
		...(warnings.length > 0 && { warnings }),
		...(metadata && { metadata }),
	};
}

/**
 * Create a failed batch result (batch-level failure, not command failure).
 *
 * @param error - The error that caused the batch to fail
 * @param timing - Partial timing information
 * @returns A failed BatchResult object
 */
export function createFailedBatchResult(
	error: CommandError,
	timing: Partial<BatchTiming>
): BatchResult {
	const now = new Date().toISOString();
	return {
		success: false,
		results: [],
		summary: {
			total: 0,
			successCount: 0,
			failureCount: 0,
			skippedCount: 0,
		},
		timing: {
			totalMs: timing.totalMs ?? 0,
			averageMs: 0,
			startedAt: timing.startedAt ?? now,
			completedAt: timing.completedAt ?? now,
		},
		confidence: 0,
		reasoning: `Batch execution failed: ${error.message}`,
		error,
	};
}

/**
 * Generate human-readable reasoning for a batch result.
 */
function generateBatchReasoning(summary: BatchSummary): string {
	const parts: string[] = [];

	parts.push(`Executed ${summary.total} command${summary.total === 1 ? '' : 's'}`);

	if (summary.successCount === summary.total) {
		parts.push('all succeeded');
	} else {
		const details: string[] = [];
		if (summary.successCount > 0) {
			details.push(`${summary.successCount} succeeded`);
		}
		if (summary.failureCount > 0) {
			details.push(`${summary.failureCount} failed`);
		}
		if (summary.skippedCount > 0) {
			details.push(`${summary.skippedCount} skipped`);
		}
		parts.push(details.join(', '));
	}

	return parts.join(': ');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Type guard to check if a value is a BatchRequest.
 */
export function isBatchRequest(value: unknown): value is BatchRequest {
	return (
		typeof value === 'object' &&
		value !== null &&
		'commands' in value &&
		Array.isArray((value as BatchRequest).commands)
	);
}

/**
 * Type guard to check if a value is a BatchResult.
 */
export function isBatchResult(value: unknown): value is BatchResult {
	return (
		typeof value === 'object' &&
		value !== null &&
		'success' in value &&
		'results' in value &&
		'summary' in value &&
		'timing' in value &&
		Array.isArray((value as BatchResult).results)
	);
}

/**
 * Type guard to check if a value is a BatchCommand.
 */
export function isBatchCommand(value: unknown): value is BatchCommand {
	return (
		typeof value === 'object' &&
		value !== null &&
		'command' in value &&
		typeof (value as BatchCommand).command === 'string'
	);
}
