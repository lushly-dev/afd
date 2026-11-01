/**
 * @fileoverview The kernel's own error: what `createKernel`, the view-state handlers and
 * `replayKernel` throw. Commands never throw it at a caller; they return a failure result.
 */

import type { CommandError } from '@lushly-dev/afd-core';

/** Codes a {@link LoamKernelError} carries. */
export type LoamKernelErrorCode =
	| 'COMMAND_NAME_INVALID'
	| 'COMMAND_NAME_DUPLICATE'
	| 'VALIDATION_ERROR'
	| 'REPLAY_START_INVALID'
	| 'REPLAY_DIVERGED';

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
