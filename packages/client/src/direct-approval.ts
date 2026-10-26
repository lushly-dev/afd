/**
 * @fileoverview DirectClient `onApprovalNeeded` (#419): ask the application's hook when a call
 * returns `APPROVAL_REQUIRED`, and retry it once with the approval token on a yes.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import { ErrorCodes } from '@lushly-dev/afd-core';
import type { DirectApprovalHook, DirectApprovalRequest } from './direct-types.js';

/** What a held call's `APPROVAL_REQUIRED` result carries for the retry. */
export interface HeldCall {
	approvalToken: string;
	expiresAt: string;
	summary: string;
	reason?: string;
}

/**
 * The approval details of an `APPROVAL_REQUIRED` result, or `undefined` for any other result
 * and for one without `details.approvalToken` (a server that delivers the token another way).
 */
export function heldForApproval(result: CommandResult<unknown>): HeldCall | undefined {
	if (result.success || result.error?.code !== ErrorCodes.APPROVAL_REQUIRED) return undefined;
	const details = result.error.details;
	if (!details || typeof details.approvalToken !== 'string') return undefined;
	return {
		approvalToken: details.approvalToken,
		expiresAt: typeof details.expiresAt === 'string' ? details.expiresAt : '',
		summary: typeof details.summary === 'string' ? details.summary : '',
		...(typeof details.reason === 'string' && { reason: details.reason }),
	};
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
