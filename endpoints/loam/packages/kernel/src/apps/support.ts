/**
 * @fileoverview What the native and view hosts share: reading the command's clock and random source,
 * the shape of a result, and a failed app's state.
 */

import type { CommandContext, CommandError, CommandResult } from '@lushly-dev/afd-core';
import {
	kernelFailure,
	LoamKernelError,
	type LoamKernelErrorCode,
	PAGE_DECIDED,
} from '../errors.js';
import type { AppRecord } from './operations.js';
import type { HandlerRefusal } from './types.js';

export const readClock = (context: CommandContext): number => context.clock?.now() ?? Date.now();
export const readRandom = (context: CommandContext): number =>
	context.random?.next() ?? Math.random();

/** Whether a handler's answer is a `CommandResult`: a failure must carry a code and a message. */
export function isCommandResult(value: unknown): value is CommandResult {
	if (typeof value !== 'object' || value === null) return false;
	const { success, error } = value as { success?: unknown; error?: Partial<CommandError> };
	if (typeof success !== 'boolean') return false;
	return success || (typeof error?.code === 'string' && typeof error.message === 'string');
}

export function resultInvalid(command: string): CommandResult<never> {
	return kernelFailure(
		'HANDLER_RESULT_INVALID',
		`The handler of '${command}' did not return a CommandResult`,
		'Return success(...) or failure(...) from the handler'
	);
}

/**
 * A native handler that threw. Its message goes to the page's `reportError` and not into the result or
 * the journal, as AFD's engine does with a throw, since it may hold what a log should not.
 */
export function handlerThrew(command: string, cause: unknown): CommandResult<never> {
	(globalThis as { reportError?: (error: unknown) => void }).reportError?.(cause);
	return kernelFailure(
		'HANDLER_THREW',
		`The handler of '${command}' threw`,
		"A handler returns failure(...); read the page's console, and fix the code that threw"
	);
}

/** The details that mark a failure as decided by the page (`PAGE_DECIDED`). */
export const pageDecided = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
	...extra,
	[PAGE_DECIDED]: true,
});

/** Mark an app `failed` and answer the error (section 10). */
export function markFailed(
	record: AppRecord,
	code: LoamKernelErrorCode,
	message: string,
	suggestion: string
): CommandError {
	const error: CommandError = { code, message, suggestion, retryable: false };
	record.state = 'failed';
	record.error = error;
	return error;
}

/** A kernel failure as a rejection, for what must reject rather than answer. */
export function asError(error: CommandError): LoamKernelError {
	return new LoamKernelError({
		code: error.code as LoamKernelErrorCode,
		message: error.message,
		suggestion: error.suggestion ?? 'Read the error and fix the app',
	});
}

/** A frame's request refused: `rpcCode` is the JSON-RPC code the host answers with. */
export function refuseRequest({
	code,
	rpcCode,
	message,
	suggestion,
}: HandlerRefusal): LoamKernelError {
	return new LoamKernelError({ code, message, suggestion, details: { rpcCode } });
}
