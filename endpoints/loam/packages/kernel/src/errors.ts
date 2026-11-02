/**
 * @fileoverview The kernel's own error: what `createKernel`, the view-state handlers and
 * `replayKernel` throw. Commands never throw it at a caller; they return a failure result.
 */

import { type CommandError, type CommandResult, failure } from '@lushly-dev/afd-core';

/**
 * Codes a {@link LoamKernelError} or a kernel failure carries: every code of the phase 1
 * specification's section 10 that is not a refusal of a manifest.
 */
export type LoamKernelErrorCode =
	| 'COMMAND_NAME_INVALID'
	| 'COMMAND_NAME_DUPLICATE'
	| 'VALIDATION_ERROR'
	| 'REPLAY_START_INVALID'
	| 'REPLAY_DIVERGED'
	| 'APP_ACTIVATION_FAILED'
	| 'APP_COMMAND_CONFLICT'
	| 'APP_CONFIG_INVALID'
	| 'APP_DOMAIN_CONFLICT'
	| 'APP_ELEMENT_UNDEFINED'
	| 'APP_GLOBAL_ELEMENT'
	| 'APP_HANDLER_MISSING'
	| 'APP_NOT_FOUND'
	| 'APP_NOT_READY'
	| 'APP_PACKAGE_UNAVAILABLE'
	| 'APP_RUNTIME_UNAVAILABLE'
	| 'CALL_ABORTED'
	| 'CALL_NOT_GRANTED'
	| 'DEPLOYMENT_APP_MISMATCH'
	| 'DEPLOYMENT_AUDIENCE_REQUIRED'
	| 'DEPLOYMENT_INSTANCE_MISMATCH'
	| 'DEPLOYMENT_INVALID'
	| 'DEPLOYMENT_TEAM_NEEDS_HTTP'
	| 'HANDLER_NO_CALL'
	| 'HANDLER_READY_TIMEOUT'
	| 'HANDLER_RESULT_INVALID'
	| 'HANDLER_THREW'
	| 'HANDLER_TIMEOUT'
	| 'INSTANCE_OVERRIDE_UNKNOWN'
	| 'INSTANCE_PREFIX_CONFLICT'
	| 'INSTANCE_PREFIX_REQUIRED'
	| 'KEYBINDING_CONFLICT'
	| 'KEYBINDING_NEEDS_INPUT'
	| 'LAYOUT_PART_UNDECLARED'
	| 'MOUNT_CATALOG_TOO_LARGE'
	| 'MOUNT_NOT_AFD'
	| 'MOUNT_RESULT_INVALID'
	| 'MOUNT_SCHEMA_UNUSABLE'
	| 'MOUNT_SPACE_PINNED'
	| 'MOUNT_TIMEOUT'
	| 'MOUNT_TOOL_UNNAMEABLE'
	| 'MOUNT_TRANSPORT_UNAVAILABLE'
	| 'MOUNT_UNAUTHORIZED'
	| 'MOUNT_UNREACHABLE'
	| 'NESTED_MUTATION_REFUSED'
	| 'OVERLAY_COOLDOWN'
	| 'OVERLAY_MODAL_BUSY'
	| 'OVERLAY_NOT_FOUND'
	| 'OVERLAY_NOT_OWNER'
	| 'OVERLAY_OWNER_INACTIVE'
	| 'STATUS_ITEM_UNKNOWN'
	| 'VIEW_CALL_REFUSED'
	| 'VIEW_READY_TIMEOUT'
	| 'VIEW_RESOURCE_UNAVAILABLE'
	| 'VIEW_SANDBOX_ORIGIN_INVALID'
	| 'VIEW_STATE_READ_ONLY';

/**
 * In a failure's `details`: the page decided this and not a command, as an import or a frame's deadline
 * does, so a replay answers it from the record. Only the kernel sets it.
 */
export const PAGE_DECIDED = 'dev.loam/page-decided';

/** What a kernel failure holds besides its code, message and suggestion. */
export interface KernelFailureExtra {
	retryable?: boolean;
	details?: Record<string, unknown>;
}

/** A failure result with a code the kernel knows. Every kernel failure has a suggestion. */
export function kernelFailure(
	code: LoamKernelErrorCode,
	message: string,
	suggestion: string,
	extra: KernelFailureExtra = {}
): CommandResult<never> {
	return failure({ code, message, suggestion, retryable: extra.retryable ?? false, ...extra });
}

/** What a {@link LoamKernelError} is built from. */
export interface LoamKernelErrorInit {
	code: LoamKernelErrorCode;
	message: string;
	suggestion: string;
	details?: Record<string, unknown>;
}

/**
 * A refusal by the kernel. It has `code`, `suggestion` and `retryable` like a `CommandError`, so
 * `wrapError()` from afd-core keeps them.
 */
export class LoamKernelError extends Error {
	readonly code: LoamKernelErrorCode;
	readonly suggestion: string;
	readonly retryable = false;
	readonly details?: Record<string, unknown>;

	constructor(init: LoamKernelErrorInit) {
		super(init.message);
		this.name = 'LoamKernelError';
		this.code = init.code;
		this.suggestion = init.suggestion;
		if (init.details !== undefined) this.details = init.details;
	}

	/** A validation failure result's error as a throwable. */
	static fromCommandError(error: CommandError): LoamKernelError {
		return new LoamKernelError({
			code: 'VALIDATION_ERROR',
			message: error.message,
			suggestion: error.suggestion ?? 'Check the value and retry',
			...(error.details !== undefined ? { details: error.details } : {}),
		});
	}
}
