/**
 * @fileoverview DirectClient `onApprovalNeeded` (#419): ask the application's hook when a call
 * returns `APPROVAL_REQUIRED`, and retry it once with the approval token on a yes.
 */

import type { CommandError, CommandResult } from '@lushly-dev/afd-core';
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
 * The `APPROVAL_REQUIRED` error once `onApprovalNeeded` declined: the user chose not to proceed,
 * so the suggestion says not to run it again and the recovery is `stop`. Everything else is kept.
 */
export function declinedApproval(error: CommandError): CommandError {
	return {
		...error,
		suggestion:
			'Do not run this again without asking the user first; the user chose not to approve it.',
		recovery: { kind: 'stop' },
	};
}

/** What `onApprovalNeeded` answered: `failed` when it threw, rejected or gave no boolean. */
export type ApprovalAnswer = 'approved' | 'declined' | 'failed' | 'aborted';

/**
 * Ask the hook. Only an explicit `true` approves and only an explicit `false` declines. A hook
 * that throws, rejects or gives any other value has failed, which is not a decline, and a
 * `signal` that aborts before the hook answers gives `aborted`.
 */
export async function askForApproval(
	hook: DirectApprovalHook,
	request: DirectApprovalRequest
): Promise<ApprovalAnswer> {
	const { signal } = request;
	if (signal?.aborted) return 'aborted';
	let onAbort: (() => void) | undefined;
	const aborted = new Promise<typeof ABORTED>((resolve) => {
		onAbort = () => resolve(ABORTED);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
	try {
		// Promise.race subscribes to the hook, so a rejection after an abort is handled.
		const answer = await Promise.race([Promise.resolve().then(() => hook(request)), aborted]);
		if (answer === ABORTED) return 'aborted';
		if (answer === true) return 'approved';
		return answer === false ? 'declined' : 'failed';
	} catch {
		return 'failed';
	} finally {
		if (onAbort) signal?.removeEventListener('abort', onAbort);
	}
}

const ABORTED: unique symbol = Symbol('aborted');
