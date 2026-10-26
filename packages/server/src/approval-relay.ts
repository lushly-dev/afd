/**
 * @fileoverview The MCP approval relay (#418): how the approval middleware asks the human behind
 * an MCP client, through a form elicitation, instead of returning a token to the agent.
 *
 * The MCP lane binds an {@link ApprovalRelay} to the context of each `tools/call` that can carry a
 * form elicitation, under a private symbol (as the confirmation channel is), so neither
 * `createContext` nor tool arguments can forge one. The middleware, with
 * `relay: 'mcp-elicitation'`, reads the human's answer from the relay or records a hold on it;
 * the lane then answers the call with `input_required` instead of the held result.
 *
 * Only one command per tool call can use the relay: the first to reach the approval middleware.
 * `afd-batch` and `afd-pipe` strip it, because asking mid-run would run the earlier steps again on
 * the retry.
 */

import type { CommandContext } from '@lushly-dev/afd-core';

/** The `inputRequests` key of the approval elicitation. */
export const APPROVAL_INPUT_KEY = 'approval';

/** The approval elicitation form: one required boolean. */
export const APPROVAL_REQUESTED_SCHEMA = {
	type: 'object',
	properties: {
		approve: {
			type: 'boolean',
			title: 'Approve',
			description: 'Allow this action to run',
		},
	},
	required: ['approve'],
} as const;

/** A call held for the human's approval, as recorded by the middleware. */
export interface ApprovalHold {
	/** Keyed digest of the command, its validated input and the actor. */
	binding: string;
	/** Random nonce, spent when the approved call runs. */
	nonce: string;
	/** Expiry of the approval, epoch milliseconds on the middleware's clock. */
	expiresAt: number;
	/** The text the human is asked to approve. */
	summary: string;
}

/** The human's answer to an earlier approval elicitation for one binding. */
export type ApprovalAnswer =
	| { kind: 'accept'; nonce: string; expiresAt: number }
	| { kind: 'decline' }
	| { kind: 'missing' };

/** What one MCP `tools/call` offers the approval middleware. */
export interface ApprovalRelay {
	/**
	 * Take the relay for the calling command. Only the first call succeeds, so a command run by
	 * another command's handler (or a later step) cannot turn the tool call into an elicitation.
	 */
	claim(): boolean;
	/**
	 * The answer this request carries for any of `bindings` (one per verification key): `missing`
	 * unless its `requestState` verifies and names that binding.
	 */
	answer(bindings: readonly string[]): Promise<ApprovalAnswer>;
	/** Record that the call needs the human's approval; the lane asks once the call returns. */
	hold(hold: ApprovalHold): void;
}

const RELAY = Symbol('afd.approvalRelay');

type RelayContext = CommandContext & { [RELAY]?: ApprovalRelay };

/** Return a copy of `context` bound to `relay`. */
export function bindApprovalRelay(context: CommandContext, relay: ApprovalRelay): CommandContext {
	const bound: RelayContext = { ...context, [RELAY]: relay };
	return bound;
}

/** Return a copy of `context` without a relay (for `afd-batch` and `afd-pipe` steps). */
export function withoutApprovalRelay(context: CommandContext): CommandContext {
	if (!(context as RelayContext)[RELAY]) return context;
	const stripped: RelayContext = { ...context, [RELAY]: undefined };
	return stripped;
}

/** The relay bound to `context`, if any. */
export function approvalRelay(context: CommandContext | undefined): ApprovalRelay | undefined {
	return (context as RelayContext | undefined)?.[RELAY];
}
