/**
 * @fileoverview Approval evidence from an approver client (`spec/command-metadata.md`, "Approval
 * evidence from an approver client"; Loam phase 5, step 0c).
 *
 * A server names its approvers with the `approver` option of `createMcpServer`: MCP clients it
 * trusts to show a person a held action and to carry the person's decision back. For an approver,
 * a held result carries `details.approvalToken` and never becomes a form elicitation, and a
 * `tools/call` carrying `_meta["dev.afd/approval"]` has it set as the call's approval evidence;
 * the token binds the approver's principal binding (M8). From any other caller the key is
 * ignored. In tool arguments the key is refused from every caller.
 *
 * The lane that received a request decides who is an approver and binds the result to the
 * `CommandContext`'s host state (`host-state.ts`), as the approval relay is bound, so `createContext`
 * cannot forge one. Loads no Node.js built-in.
 */

import type { Actor, CommandContext, CommandError } from '@lushly-dev/afd-core';
import { ErrorCodes } from '@lushly-dev/afd-core';
import { hostState, withHostState } from './host-state.js';
import { type PrincipalCredentials, principalBinding } from './principal-binding.js';

/** `_meta` key an approver sets to the approval token of the call it retries. */
export const AFD_APPROVAL_META_KEY = 'dev.afd/approval';

/**
 * Whether the caller of one call is an approver, from its context once the server has set the
 * credentials and the host its actor. Only `true` makes one. Read only what the server verified:
 * the credentials, or an actor `createContext` mapped from them.
 */
export type ApproverPredicate = (context: CommandContext) => boolean;

/**
 * An approver's call, as bound to its context. Its tokens bind the principal binding of the
 * context the approval middleware sees (`spec/authorization.md`, M8).
 */
export interface ApproverCall {
	/**
	 * The evidence of `_meta["dev.afd/approval"]`, until the command the call routes to takes it
	 * ({@link takeApproverEvidence}).
	 */
	evidence?: unknown;
}

/** Return a copy of `context` bound to an approver's call. */
export function bindApprover(context: CommandContext, call: ApproverCall): CommandContext {
	return withHostState(context, { approver: call });
}

/** The approver's call bound to `context`, if its caller is an approver. */
export function approverCall(context: CommandContext | undefined): ApproverCall | undefined {
	return hostState(context).approver;
}

/**
 * Take the carried evidence, once: the first approval check of the call takes it, so a command
 * the handler runs in process never sees it.
 */
export function takeApproverEvidence(call: ApproverCall): unknown {
	const evidence = call.evidence;
	call.evidence = undefined;
	return evidence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The `VALIDATION_ERROR` for tool arguments (or an HTTP route's command input) that hold the key
 * `dev.afd/approval` at any depth, or `undefined`. Evidence is never input (rule 5), from any
 * caller. The walk is iterative, so deep input cannot overflow the stack.
 */
export function approvalKeyInInput(input: unknown): CommandError | undefined {
	const pending: unknown[] = [input];
	const seen = new Set<object>();
	while (pending.length > 0) {
		const value = pending.pop();
		if (!value || typeof value !== 'object' || seen.has(value)) continue;
		seen.add(value);
		if (Array.isArray(value)) {
			for (const item of value) pending.push(item);
			continue;
		}
		if (Object.hasOwn(value, AFD_APPROVAL_META_KEY)) {
			return {
				code: ErrorCodes.VALIDATION_ERROR,
				message: `Input may not hold the key "${AFD_APPROVAL_META_KEY}"`,
				suggestion: `Remove "${AFD_APPROVAL_META_KEY}" from the input: approval evidence is never input. Only a client the server names an approver sends it, in _meta, on the retry a person approved.`,
				retryable: false,
			};
		}
		for (const item of Object.values(value)) pending.push(item);
		// A parser that builds objects by assignment turns a `__proto__` member into the object's
		// prototype, where `hasOwn` and `values` never look: walk it as a member.
		const prototype: unknown = Object.getPrototypeOf(value);
		if (prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype) {
			pending.push(prototype);
		}
	}
	return undefined;
}

/** What the carrier decided for one `tools/call`. */
export type ApproverDecision =
	| { kind: 'proceed'; approver?: ApproverCall }
	| { kind: 'refuse'; error: CommandError };

/** One `tools/call`, as the lane that received it sees it. */
export interface ApproverRequest {
	/** The server's `approver` option. */
	approver: ApproverPredicate | undefined;
	/** The call's context: `createContext`'s values with the actor the commands run with. */
	context: CommandContext;
	/** The actor the commands run with, and the call's credentials, as the call starts. */
	actor: Actor | undefined;
	credentials: unknown;
	/** The request's own `_meta` (never a meta-tool's `meta` argument). */
	meta: unknown;
	/** The tool called. */
	tool: string;
	/** An MCP 2026-07-28 request (not a 2025-era one). */
	modern: boolean;
}

/**
 * Decide the carrier of one `tools/call` (rules 1 to 3). A non-approver's key is ignored. An
 * approver's key on `afd-batch`, `afd-pipe` or a 2025-era request refuses the call before anything
 * runs.
 *
 * @throws whatever the predicate throws, and TypeError for an approver whose credentials cannot be
 *   bound (M8): the lane answers both as an internal error
 */
export function decideApprover(request: ApproverRequest): ApproverDecision {
	if (request.approver?.(request.context) !== true) return { kind: 'proceed' };
	// Credentials that cannot be bound make no approver: this throws, and the call fails (M8).
	principalBinding(request.actor, request.credentials as PrincipalCredentials | undefined);
	const evidence = isRecord(request.meta) ? request.meta[AFD_APPROVAL_META_KEY] : undefined;
	const carried = evidence !== undefined && evidence !== null;
	if (carried && (!request.modern || request.tool === 'afd-batch' || request.tool === 'afd-pipe')) {
		return {
			kind: 'refuse',
			error: {
				code: ErrorCodes.APPROVAL_REQUIRED,
				message: `_meta["${AFD_APPROVAL_META_KEY}"] is accepted only on a call to one command from an MCP 2026-07-28 client`,
				suggestion:
					'Retry the approved command on its own (its tool or afd-call) from an MCP 2026-07-28 client, with the same input and the token; nothing ran.',
				retryable: false,
			},
		};
	}
	return { kind: 'proceed', approver: carried ? { evidence } : {} };
}
