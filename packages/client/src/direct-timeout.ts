/**
 * @fileoverview Per-call timeout enforcement for DirectClient.
 *
 * `DirectCallContext.timeout` aborts the signal handed to the command and
 * resolves the call with a structured `TIMEOUT` failure when the deadline
 * passes first.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import { ErrorCodes, failure, truncateName } from '@lushly-dev/afd-core';

/** Node timers fire immediately for delays above 2^31 - 1 ms, so longer timeouts are capped. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Whether a `timeout` value is enforced: a positive, finite number of milliseconds. */
export function isEnforceableTimeout(timeout: unknown): timeout is number {
	return typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0;
}

/** The structured failure returned when a direct call exceeds its timeout. */
export function directTimeoutFailure(name: string, timeoutMs: number): CommandResult<never> {
	return failure({
		code: ErrorCodes.TIMEOUT,
		message: `Command '${truncateName(name)}' timed out after ${timeoutMs}ms`,
		suggestion:
			'Retry with a larger timeout. The command was signalled to abort but may have completed, so check its effect before retrying a mutation.',
		retryable: true,
		details: { command: name, timeoutMs },
	});
}

/**
 * Run `execute` with an optional deadline.
 *
 * Without an enforceable timeout, `execute` receives the caller's signal
 * unchanged. With one, it receives `AbortSignal.any([callerSignal, timeout])`,
 * and the returned promise resolves to a `TIMEOUT` failure as soon as the
 * deadline passes, even if the command ignores the signal.
 */
export async function runWithTimeout<T>(
	name: string,
	timeout: unknown,
	callerSignal: AbortSignal | undefined,
	execute: (signal: AbortSignal | undefined) => Promise<CommandResult<T>>
): Promise<CommandResult<T>> {
	if (!isEnforceableTimeout(timeout)) {
		return execute(callerSignal);
	}

	const timeoutSignal = AbortSignal.timeout(Math.min(Math.ceil(timeout), MAX_TIMEOUT_MS));
	const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;

	let onTimeout: (() => void) | undefined;
	const timedOut = new Promise<CommandResult<T>>((resolve) => {
		onTimeout = () => resolve(directTimeoutFailure(name, timeout));
		timeoutSignal.addEventListener('abort', onTimeout, { once: true });
	});

	try {
		// Promise.race subscribes to the execution, so a rejection after the
		// timeout has already won is handled rather than reported as unhandled.
		return await Promise.race([execute(signal), timedOut]);
	} finally {
		if (onTimeout) timeoutSignal.removeEventListener('abort', onTimeout);
	}
}
