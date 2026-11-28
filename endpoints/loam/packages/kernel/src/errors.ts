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
	| 'EVENT_CURSOR_EXPIRED'
	| 'EVENT_CURSOR_INVALID'
	| 'GRANT_REQUIRED'
	| 'MOUNT_VIEWS_DISABLED'
	| 'SHELL_OPEN_NOT_ACTIVE'
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
	// A call to a disposed kernel (`kernel.ts`).
	| 'KERNEL_DISPOSED'
	| 'INSTANCE_OVERRIDE_UNKNOWN'
	| 'INSTANCE_PREFIX_CONFLICT'
	| 'INSTANCE_PREFIX_REQUIRED'
	| 'INSTANCE_PROJECT_UNKNOWN'
	| 'KEYBINDING_CONFLICT'
	| 'KEYBINDING_NEEDS_INPUT'
	| 'LATE_COMMANDS_UNAVAILABLE'
	| 'LAYOUT_PART_UNDECLARED'
	| 'MOUNT_CATALOG_TOO_LARGE'
	| 'MOUNT_KEYCHAIN_MISSING'
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
	// Phase 4's overlays (its section 16), from its step 3.
	| 'OVERLAY_ANCHOR_NOT_FOUND'
	| 'OVERLAY_ITEM_RESERVED'
	| 'OVERLAY_LIMIT'
	| 'OVERLAY_ELEMENT_VIEW'
	| 'RATE_LIMITED'
	// Phase 4's inbox (its 10.1, 16), from its step 5.
	| 'NOTIFICATION_NOT_FOUND'
	// Step 6's confirmations (7.2), and AFD's own unknown command, from `palette-run`.
	| 'COMMAND_NOT_FOUND'
	| 'CONFIRMATION_PENDING'
	| 'CONFIRMATION_DECLINED'
	| 'CONFIRMATION_EXPIRED'
	| 'NOTIFICATION_ACTION_FOREIGN'
	| 'NOTIFICATION_ACTION_UNAVAILABLE'
	| 'QUOTA_EXCEEDED'
	| 'SCOPE_PROJECT_REQUIRED'
	| 'SCOPE_WORKSPACE_UNKNOWN'
	| 'SCOPE_MISMATCH'
	| 'SCOPE_NOT_GRANTED'
	| 'EMBED_READ_ONLY'
	| 'PROJECT_NOT_FOUND'
	| 'PROJECT_ARCHIVED'
	| 'PROJECT_SLUG_UNAVAILABLE'
	| 'PROJECT_MEMBER_NOT_PERSON'
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
	| 'SESSION_CHANGED'
	| 'MEMBERSHIP_UNAVAILABLE'
	| 'AGENT_NAME_RESERVED'
	| 'HUMAN_REQUIRED'
	| 'REAUTH_REQUIRED'
	| 'SESSION_NOT_FOUND'
	| 'SIGN_IN_METHOD_UNAVAILABLE'
	| 'PASSKEY_CANCELLED'
	| 'PASSKEY_UNSUPPORTED'
	| 'PASSKEY_NOT_FOUND'
	| 'PASSKEY_LAST'
	| 'IDENTITY_PROVIDER_UNAVAILABLE'
	| 'OWNER_REQUIRED'
	| 'MEMBER_LAST_OWNER'
	| 'MEMBER_NOT_FOUND'
	| 'MEMBER_INVITATION_EXISTS'
	| 'INVITATION_NOT_FOUND'
	| 'EMAIL_VERIFICATION_REQUIRED'
	| 'PERSONA_NOT_FOUND'
	| 'PERSONA_LIMIT'
	| 'PERSONA_INVALID'
	| 'AGENT_MEMBER_NOT_FOUND'
	| 'AGENT_SPONSOR_INVALID'
	| 'AGENT_MEMBER_SPONSOR_ONLY'
	| 'AGENT_MEMBER_NOT_PENDING'
	// `agent-member-withdraw` of a record that is not active (8.2, #2781).
	| 'AGENT_MEMBER_NOT_ACTIVE'
	// Step 7's identity over MCP (9.2, 9.5): a token's client with no active connected agent, a client an owner removed
	// for this person, and a principal-gated kernel built for a `local` deployment.
	| 'AGENT_NOT_CONNECTED'
	| 'AGENT_DISCONNECTED_BY_OWNER'
	// #2784: a connected agent's access changed between its person's read and their write.
	| 'AGENT_ACCESS_CHANGED'
	| 'IDENTITY_MODE_INVALID'
	// Phase 5's copilot (its section 14).
	| 'COPILOT_PROVIDER_MISSING'
	| 'COPILOT_PROVIDER_UNKNOWN'
	| 'COPILOT_SESSION_NOT_FOUND'
	| 'COPILOT_TURN_RUNNING'
	| 'COPILOT_PORT_REFUSED'
	| 'AUTONOMY_UNAVAILABLE'
	| 'MOUNT_APPROVAL_UNAVAILABLE'
	| 'MOUNT_PREVIEW_CHANGED'
	| 'AUTONOMY_SUGGEST_ONLY'
	| 'UNIT_INVALID'
	// Phase 4's settings (its section 16), from its step 1; and AFD's own over-budget read (its 3.9).
	| 'SETTING_NOT_FOUND'
	| 'SETTING_LEVEL_UNAVAILABLE'
	| 'SETTING_PROJECT_REQUIRED'
	| 'SETTING_TOO_LARGE'
	| 'SETTING_NOT_OWNED'
	| 'SETTING_USE_AUTONOMY'
	| 'SETTING_CONFLICT'
	// Step 2's: the shell's own sections (3.7).
	| 'SETTING_MUTE_SHELL'
	| 'KEYBINDING_RESERVED'
	// Step 7's: a reserved chord's action called as a command (8.5, R1).
	| 'SHELL_ACTION_UNAVAILABLE'
	| 'WORKSPACE_EXPORT_FAILED'
	| 'SHARED_RECORD_UNAVAILABLE'
	| 'OUTPUT_BUDGET_EXCEEDED'
	// Step 8's: autonomy (4.3).
	| 'AUTONOMY_ABOVE_CEILING'
	| 'AUTONOMY_COMMAND_UNKNOWN'
	// Phase 4's step 9 (its 5.4, 16): experiments.
	| 'EXPERIMENT_NOT_FOUND'
	| 'EXPERIMENT_NOT_OWNED'
	// Step 10's: the limits (section 11).
	| 'INPUT_TOO_LARGE'
	| 'QUOTA_EXCEEDED'
	| 'REPLAY_ENTRY_TRUNCATED'
	// Step 6's fourth round: a journal with an entry missing from its middle.
	| 'REPLAY_JOURNAL_GAP'
	// Phase 6's step 5 (its 6.1 to 6.3, section 16): the trust-record transport and the browser's copy.
	| 'SERVER_UNAVAILABLE'
	| 'SERVER_COMMAND_NOT_SERVED'
	| 'TRUST_RECORDS_TOO_LARGE'
	| 'REQUEST_NOT_SAME_ORIGIN'
	| 'REQUEST_TOO_LARGE'
	| 'REQUEST_INVALID'
	// Phase 6's step 6 (its 8.1, section 16): the hosted relay's own refusals, which `mount.ts` carries to a mounted call.
	| 'INSTANCE_UNKNOWN'
	| 'MOUNT_BATCH_REFUSED'
	| 'MOUNT_METHOD_REFUSED'
	| 'MOUNT_COMMAND_NOT_EXPOSED'
	| 'MOUNT_SESSION_UNKNOWN'
	| 'MOUNT_LIMIT'
	| 'UNAUTHORIZED';

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
