/**
 * @fileoverview Command result types for Violet
 *
 * Re-exports AFD's CommandResult types with Violet-specific error codes.
 */

// Re-export all AFD result types
export {
	type CommandResult,
	type Alternative,
	type PlanStep,
	type Source,
	type Warning,
	type ResultMetadata,
	success,
	failure,
	isSuccess,
	isFailure,
} from '@lushly-dev/afd-core';

export type { CommandError } from '@lushly-dev/afd-core';

/** Standard error codes used across Violet commands (native: @lushly-dev/violet-core) */
export { ErrorCodes, type ErrorCode } from '@lushly-dev/violet-core';
