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
// Import from ./types, not the core root: the root loads the Node storage stores, which /worker must not.
export { ErrorCodes, type ErrorCode } from '@lushly-dev/violet-core/types';
