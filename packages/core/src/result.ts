/**
 * @fileoverview Core result types for AFD commands
 *
 * The CommandResult interface is the standard return type for all AFD commands.
 * It includes both core fields (success, data, error) and UX-enabling fields
 * (confidence, reasoning, sources, etc.) that help build user trust.
 */

import type { CommandError } from './errors.js';
import type { Alternative, PlanStep, Source, Warning } from './metadata.js';

/**
 * Standard result type for all AFD commands.
 *
 * @template T - The type of the primary result data
 *
 * @example
 * ```typescript
 * const result: CommandResult<Document> = {
 *   success: true,
 *   data: { id: 'doc-123', title: 'My Document' },
 *   confidence: 0.95,
 *   reasoning: 'Document created successfully with all required fields'
 * };
 * ```
 */
export interface CommandResult<T = unknown> {
	// ═══════════════════════════════════════════════════════════════════════════
	// CORE FIELDS (Required for all commands)
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Whether the command executed successfully.
	 *
	 * - `true`: Command completed without errors, `data` contains the result
	 * - `false`: Command failed, `error` contains details
	 */
	success: boolean;

	/**
	 * The primary result data when `success` is `true`.
	 * The type varies by command.
	 */
	data?: T;

	/**
	 * Error information when `success` is `false`.
	 * Contains code, message, and recovery suggestions.
	 */
	error?: CommandError;

	// ═══════════════════════════════════════════════════════════════════════════
	// UX-ENABLING FIELDS (Recommended for good agent experiences)
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Agent's confidence in this result (0-1).
	 *
	 * Enables: Confidence indicators in UI
	 *
	 * Guidelines:
	 * - 0.9 - 1.0: Very high confidence, auto-apply safe
	 * - 0.7 - 0.9: High confidence, show as recommendation
	 * - 0.5 - 0.7: Moderate confidence, require confirmation
	 * - < 0.5: Low confidence, show alternatives prominently
	 */
	confidence?: number;

	/**
	 * Explanation of why this result was produced.
	 *
	 * Enables: Transparency ("why did the agent do this?")
	 *
	 * @example "Selected this option because it matches your stated preference for brevity"
	 */
	reasoning?: string;

	/**
	 * Information sources used to produce this result.
	 *
	 * Enables: Source attribution, verification, trust
	 *
	 * @example [{ type: 'document', id: 'doc-123', title: 'Style Guide' }]
	 */
	sources?: Source[];

	/**
	 * Steps in a multi-step operation.
	 *
	 * Enables: Plan visualization, progress tracking
	 *
	 * @example [{ id: '1', action: 'fetch', status: 'complete' }, ...]
	 */
	plan?: PlanStep[];

	/**
	 * Other options the agent considered.
	 *
	 * Enables: Alternative exploration, user choice
	 *
	 * @example [{ data: alternativeResult, reason: 'More formal tone', confidence: 0.7 }]
	 */
	alternatives?: Alternative<T>[];

	/**
	 * Non-fatal issues to surface to the user.
	 *
	 * Enables: Proactive transparency about potential problems
	 *
	 * @example [{ code: 'OUTDATED_SOURCE', message: 'Style guide is 6 months old' }]
	 */
	warnings?: Warning[];

	/**
	 * Execution metadata for debugging and monitoring.
	 */
	metadata?: ResultMetadata;
}

/**
 * Execution metadata included in command results.
 */
export interface ResultMetadata {
	/** Time taken to execute the command in milliseconds */
	executionTimeMs?: number;

	/** Version of the command that produced this result */
	commandVersion?: string;

	/** Unique trace ID for debugging and correlation */
	traceId?: string;

	/** Timestamp when the command was executed */
	timestamp?: string;

	/** Additional arbitrary metadata */
	[key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a successful command result.
 *
 * @param data - The result data
 * @param options - Additional UX-enabling fields
 * @returns A CommandResult with success: true
 */
export function success<T>(
	data: T,
	options?: Omit<CommandResult<T>, 'success' | 'data' | 'error'>
): CommandResult<T> {
	return {
		success: true,
		data,
		...options,
	};
}

/**
 * Create a failed command result.
 *
 * @param error - The error details
 * @param options - Additional fields (e.g., warnings, metadata)
 * @returns A CommandResult with success: false
 */
export function failure<T = never>(
	error: CommandError,
	options?: Pick<CommandResult<T>, 'warnings' | 'metadata'>
): CommandResult<T> {
	return {
		success: false,
		error,
		...options,
	};
}

/**
 * Type guard to check if a result is successful.
 */
export function isSuccess<T>(result: CommandResult<T>): result is CommandResult<T> & { data: T } {
	return result.success === true && result.data !== undefined;
}

/**
 * Type guard to check if a result is a failure.
 */
export function isFailure<T>(
	result: CommandResult<T>
): result is CommandResult<T> & { error: CommandError } {
	return result.success === false && result.error !== undefined;
}
