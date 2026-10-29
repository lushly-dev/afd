/**
 * Violet Design Core Types
 *
 * Following AFD CommandResult standard for all command responses.
 */

// Native data contracts and error codes
export * from '@lushly-dev/violet-core/types';

// AFD result types and helpers
export {
	type CommandResult,
	type Alternative,
	type PlanStep,
	type Source,
	type Warning,
	type ResultMetadata,
	type CommandError,
	success,
	failure,
	isSuccess,
	isFailure,
} from './command-result.js';
