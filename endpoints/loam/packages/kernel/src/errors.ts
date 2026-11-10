/**
 * @fileoverview The kernel's own error: what `createKernel`, the view-state handlers and
 * `replayKernel` throw. Commands never throw it at a caller; they return a failure result.
 */

import { type CommandError, type CommandResult, failure } from '@lushly-dev/afd-core';

/**
 * Codes a {@link LoamKernelError} or a kernel failure carries: every code of the phase 1
 * specification's section 10 that is not a refusal of a manifest, and those phase 2 adds as its steps
 * land (phase 2 specification, section 12), and phase 3's as its steps land (phase 3 specification,
 * section 15).
 */
export type LoamKernelErrorCode =
	| 'COMMAND_NAME_INVALID'
	| 'COMMAND_NAME_DUPLICATE'
	| 'VALIDATION_ERROR'
	| 'REPLAY_NOT_RECORDED'
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
	| 'DOCUMENT_CONTENT_TOO_LARGE'
	| 'DOCUMENT_EXPORT_UNAVAILABLE'
	| 'DOCUMENT_IMPORT_UNAVAILABLE'
	| 'DOCUMENT_IMPORT_VERSION_NEWER'
	| 'DOCUMENT_NOT_FOUND'
	| 'DOCUMENT_OPEN_NOT_ACTIVE'
	| 'DOCUMENT_OPEN_STAY_REFUSED'
	| 'DOCUMENT_SCOPE_UNSUPPORTED'
	| 'DOCUMENT_TEMPLATE_UNKNOWN'
	| 'DOCUMENT_TRASHED'
	| 'DOCUMENT_TYPE_CONFLICT'
	| 'DOCUMENT_TYPE_MISMATCH'
	| 'DOCUMENT_TYPE_UNAVAILABLE'
	| 'DEPLOYMENT_AUDIENCE_REQUIRED'
	| 'EDITOR_SELECTION_INVALID'
	| 'EDITOR_TAB_DIRTY'
	| 'EDITOR_TAB_LIMIT'
	| 'EDITOR_TAB_UNKNOWN'
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
	| 'INSTANCE_PROJECT_UNKNOWN'
	| 'KEYBINDING_CONFLICT'
	| 'KEYBINDING_NEEDS_INPUT'
	| 'LATE_COMMANDS_UNAVAILABLE'
	| 'LAYOUT_PART_UNDECLARED'
	| 'MOUNT_CATALOG_TOO_LARGE'
	| 'MOUNT_NOT_AFD'
	| 'MOUNT_PROJECT_NOT_LISTED'
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
	| 'SCOPE_PROJECT_REQUIRED'
	| 'SCOPE_WORKSPACE_UNKNOWN'
	| 'SCOPE_MISMATCH'
	| 'SCOPE_NOT_GRANTED'
	| 'EMBED_READ_ONLY'
	| 'PROJECT_NOT_FOUND'
	| 'PROJECT_ARCHIVED'
	| 'PROJECT_SLUG_TAKEN'
	| 'PROJECT_SLUG_INVALID'
	| 'PROJECT_NAME_INVALID'
	| 'PROJECT_MEMBER_SELF_REQUIRED'
	| 'PROJECT_SUMMARY_TIMEOUT'
	| 'PROJECT_SUMMARY_INVALID'
	| 'APP_DISABLED'
	| 'APP_ROUTE_INVALID'
	| 'STORE_WRITE_IN_QUERY'
	| 'STATUS_ITEM_UNKNOWN'
	| 'SIDEBAR_RESULT_INVALID'
	| 'VIEW_CALL_REFUSED'
	| 'VIEW_READY_TIMEOUT'
	| 'VIEW_RESOURCE_UNAVAILABLE'
	| 'VIEW_SANDBOX_ORIGIN_INVALID'
	| 'VIEW_STATE_READ_ONLY'
	| 'WORKSPACE_NOT_MEMBER'
	| 'AGENT_CANNOT_SIGN_IN'
	| 'AGENT_NAME_RESERVED';

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
	/** Whether the same call may succeed later, as a port asked for before stage B ends. */
	retryable?: boolean;
}

/**
 * A refusal by the kernel. It has `code`, `suggestion` and `retryable` like a `CommandError`, so
 * `wrapError()` from afd-core keeps them.
 */
export class LoamKernelError extends Error {
	readonly code: LoamKernelErrorCode;
	readonly suggestion: string;
	readonly retryable: boolean;
	readonly details?: Record<string, unknown>;

	constructor(init: LoamKernelErrorInit) {
		super(init.message);
		this.name = 'LoamKernelError';
		this.code = init.code;
		this.suggestion = init.suggestion;
		this.retryable = init.retryable ?? false;
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
