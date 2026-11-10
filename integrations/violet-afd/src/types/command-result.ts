/**
 * @fileoverview Command result types for Violet
 *
 * Re-exports AFD's CommandResult types with Violet-specific error codes.
 */

export type { CommandError } from '@lushly-dev/afd-core';
// Re-export all AFD result types
export {
	type Alternative,
	type CommandResult,
	type PlanStep,
	type ResultMetadata,
	type Source,
	type Warning,
	failure,
	isFailure,
	isSuccess,
	success,
} from '@lushly-dev/afd-core';

/** Standard error codes used across Violet commands (native: @lushly-dev/violet-core) */
// Import from ./types, not the core root: the root loads the Node storage stores, which /worker must not.
export { type ErrorCode, ErrorCodes } from '@lushly-dev/violet-core/types';
