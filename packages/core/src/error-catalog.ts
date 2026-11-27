/**
 * @fileoverview Shared error-code catalog metadata and reserved host prefix.
 *
 * Kept in its own module so browser/direct bundles that import `ErrorCodes` or
 * error factories from `./errors.js` tree-shake the 53-entry catalog cleanly.
 */

import type { ErrorCode } from './errors.js';

/**
 * Reserved prefix for host-defined error codes (`spec/error-codes.md`, "Host-defined error codes").
 * AFD will never add a catalog code starting with this prefix.
 */
export const HOST_ERROR_CODE_PREFIX = 'HOST_' as const;

/** Metadata for one entry in the shared error-code catalog (`spec/vectors/error-codes.json`). */
export interface ErrorCodeInfo {
	readonly code: ErrorCode;
	readonly retryable: boolean | 'varies';
	readonly profile: string;
}

/**
 * The shared error-code catalog with retryability and contract profile, in catalog order
 * (`spec/error-codes.md`, `spec/vectors/error-codes.json`).
 */
export const ERROR_CODE_CATALOG: readonly ErrorCodeInfo[] = [
	{ code: 'VALIDATION_ERROR', retryable: false, profile: 'core' },
	{ code: 'INVALID_INPUT', retryable: false, profile: 'core' },
	{ code: 'MISSING_REQUIRED_FIELD', retryable: false, profile: 'core' },
	{ code: 'INVALID_FORMAT', retryable: false, profile: 'core' },
	{ code: 'NOT_FOUND', retryable: false, profile: 'core' },
	{ code: 'ALREADY_EXISTS', retryable: false, profile: 'core' },
	{ code: 'CONFLICT', retryable: false, profile: 'core' },
	{ code: 'UNAUTHORIZED', retryable: false, profile: 'core' },
	{ code: 'FORBIDDEN', retryable: false, profile: 'core' },
	{ code: 'TOKEN_EXPIRED', retryable: false, profile: 'core' },
	{ code: 'RATE_LIMITED', retryable: true, profile: 'core' },
	{ code: 'QUOTA_EXCEEDED', retryable: false, profile: 'core' },
	{ code: 'SERVICE_UNAVAILABLE', retryable: true, profile: 'core' },
	{ code: 'TIMEOUT', retryable: true, profile: 'core' },
	{ code: 'CONNECTION_ERROR', retryable: true, profile: 'core' },
	{ code: 'INTERNAL_ERROR', retryable: 'varies', profile: 'core' },
	{ code: 'NOT_IMPLEMENTED', retryable: false, profile: 'core' },
	{ code: 'UNKNOWN_ERROR', retryable: true, profile: 'core' },
	{ code: 'COMMAND_NOT_FOUND', retryable: false, profile: 'core' },
	{ code: 'INVALID_COMMAND_ARGS', retryable: false, profile: 'core' },
	{ code: 'COMMAND_CANCELLED', retryable: false, profile: 'core' },
	{ code: 'COMMAND_EXECUTION_ERROR', retryable: false, profile: 'core' },
	{ code: 'COMMAND_NOT_EXPOSED', retryable: false, profile: 'core' },
	{ code: 'COMMAND_NOT_IN_CONTEXT', retryable: false, profile: 'contexts' },
	{ code: 'COMMAND_NOT_ALLOWED', retryable: false, profile: 'core' },
	{ code: 'UNKNOWN_TOOL', retryable: false, profile: 'core' },
	{ code: 'AMBIGUOUS_ACTION', retryable: false, profile: 'core' },
	{ code: 'INVALID_GROUPED_CALL', retryable: false, profile: 'core' },
	{ code: 'SESSION_REQUIRED', retryable: false, profile: 'contexts' },
	{ code: 'CONTEXT_NOT_FOUND', retryable: false, profile: 'contexts' },
	{ code: 'CONTEXT_DEPTH_EXCEEDED', retryable: false, profile: 'contexts' },
	{ code: 'INVALID_BATCH_REQUEST', retryable: false, profile: 'core' },
	{ code: 'BATCH_TIMEOUT', retryable: true, profile: 'core' },
	{ code: 'COMMAND_SKIPPED', retryable: false, profile: 'core' },
	{ code: 'INVALID_PIPELINE_REQUEST', retryable: false, profile: 'core' },
	{ code: 'PIPELINE_TIMEOUT', retryable: true, profile: 'core' },
	{ code: 'UNSUPPORTED_OPTION', retryable: false, profile: 'core' },
	{ code: 'STREAM_ABORTED', retryable: true, profile: 'streaming' },
	{ code: 'STREAM_TIMEOUT', retryable: true, profile: 'streaming' },
	{ code: 'STREAM_ERROR', retryable: 'varies', profile: 'streaming' },
	{ code: 'STREAM_ENDED_UNEXPECTEDLY', retryable: true, profile: 'streaming' },
	{ code: 'COMMAND_FAILED', retryable: false, profile: 'streaming' },
	{ code: 'CONFIRMATION_REQUIRED', retryable: 'varies', profile: 'confirmations' },
	{ code: 'CONFIRMATION_DECLINED', retryable: false, profile: 'confirmations' },
	{ code: 'APPROVAL_REQUIRED', retryable: false, profile: 'approvals' },
	{ code: 'APPROVAL_UNAVAILABLE', retryable: false, profile: 'approvals' },
	{ code: 'OUTPUT_BUDGET_EXCEEDED', retryable: false, profile: 'output-budgets' },
	{ code: 'INSUFFICIENT_SCOPE', retryable: false, profile: 'authorization' },
	{ code: 'TASK_TOKEN_EXPIRED', retryable: 'varies', profile: 'tasks' },
	{ code: 'CALL_NOT_GRANTED', retryable: false, profile: 'app-calls' },
	{ code: 'IDEMPOTENCY_KEY_REUSED', retryable: false, profile: 'idempotency' },
	{ code: 'IDEMPOTENCY_IN_PROGRESS', retryable: true, profile: 'idempotency' },
	{ code: 'OUTCOME_UNKNOWN', retryable: false, profile: 'idempotency' },
] as const;
