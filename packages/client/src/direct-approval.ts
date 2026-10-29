/**
 * @fileoverview DirectClient `onApprovalNeeded` (#419): ask the application's hook when a call
 * returns `APPROVAL_REQUIRED`, and retry it once with the approval token on a yes.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { DirectApprovalHook, DirectApprovalRequest } from './direct-types.js';

/** Older/custom registries cannot put approval credentials back into the public result. */
export function publicApprovalResult<T>(result: CommandResult<T>): CommandResult<T> {
	if (result.success || result.error?.code !== 'APPROVAL_REQUIRED' || !result.error.details) {
		return result;
	}
	if (!('approvalToken' in result.error.details)) return result;
	const { approvalToken: _token, ...details } = result.error.details;
	return { ...result, error: { ...result.error, details } };
}

/**
 * Ask the hook. Only an explicit `true` approves: `false`, any other value, a hook that throws
 * or rejects, and a `signal` that aborts before the hook answers all count as not approved.
 */
export async function askForApproval(
	hook: DirectApprovalHook,
	request: DirectApprovalRequest
): Promise<boolean> {
	const { signal } = request;
	if (signal?.aborted) return false;
	let onAbort: (() => void) | undefined;
	const aborted = new Promise<false>((resolve) => {
		onAbort = () => resolve(false);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
	try {
		// Promise.race subscribes to the hook, so a rejection after an abort is handled.
		const answer = await Promise.race([Promise.resolve().then(() => hook(request)), aborted]);
		return answer === true;
	} catch {
		return false;
	} finally {
		if (onAbort) signal?.removeEventListener('abort', onAbort);
	}
}
