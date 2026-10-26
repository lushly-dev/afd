/**
 * @fileoverview The MCP approval relay (#418): how the approval middleware asks the human behind
 * an MCP client, through a form elicitation, instead of returning a token to the agent.
 *
 * The MCP lane binds an {@link ApprovalRelay} to the context of each `tools/call` that can carry a
 * form elicitation, under a private symbol (as the confirmation channel is), so neither
 * `createContext` nor tool arguments can forge one. The tool router names the one command the
 * call routes to; with `relay: 'mcp-elicitation'`, the approval middleware of that command reads
 * the human's answer from the relay or records a hold on it, and the lane then answers the call
 * with `input_required` instead of the held result.
 *
 * `afd-batch` and `afd-pipe` replace the relay with one that never asks, because asking mid-run
 * would run the earlier steps again on the retry.
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
	/** Keyed digest of the command, its validated input and the actor, under the signing key. */
	binding: string;
	/** The same digest under every verification key: earlier answers to any of them are dropped. */
	bindings: readonly string[];
	/** Random nonce, spent when the approved call runs. */
	nonce: string;
	/** Expiry of the approval, epoch milliseconds on the middleware's clock. */
	expiresAt: number;
	/** MAC of the binding, nonce and expiry under the approval secret. */
	mac: string;
	/** The question shown to the human. */
	message: string;
}

/** The human's answer to an earlier approval elicitation for one binding. */
export type ApprovalAnswer =
	| { kind: 'accept'; binding: string; nonce: string; expiresAt: number; mac: string }
	| { kind: 'decline' }
	| { kind: 'missing' };

/** What one MCP `tools/call` offers the approval middleware. */
export interface ApprovalRelay {
	/** Name the command this tool call routes to; only that command can claim the relay. */
	route(command: string): void;
	/**
	 * Take the relay for `command`. Only the routed command, and only once, so a command run by
	 * another command's handler (or a later step) cannot turn the tool call into an elicitation.
	 */
	claim(command: string): boolean;
	/**
	 * The answer this request carries for any of `bindings` (one per verification key): `missing`
	 * unless its `requestState` verifies and names that binding. The latest answer wins.
	 */
	answer(bindings: readonly string[]): Promise<ApprovalAnswer>;
	/** Record that the call needs the human's approval; the lane asks once the call returns. */
	hold(hold: ApprovalHold): void;
}

const RELAY = Symbol('afd.approvalRelay');

type RelayContext = CommandContext & { [RELAY]?: ApprovalRelay };

/** A relay that never asks: the steps of `afd-batch` and `afd-pipe` get it. */
const NEVER_ASKS: ApprovalRelay = {
	route() {},
	claim: () => false,
	answer: async () => ({ kind: 'missing' }),
	hold() {},
};

/** Return a copy of `context` bound to `relay`. */
export function bindApprovalRelay(context: CommandContext, relay: ApprovalRelay): CommandContext {
	const bound: RelayContext = { ...context, [RELAY]: relay };
	return bound;
}

/**
 * Return a copy of `context` whose relay never asks (for `afd-batch` and `afd-pipe` steps), so the
 * middleware can still tell the agent to run the command on its own.
 */
export function withoutApprovalRelay(context: CommandContext): CommandContext {
	if (!(context as RelayContext)[RELAY]) return context;
	return bindApprovalRelay(context, NEVER_ASKS);
}

/** The relay bound to `context`, if any. */
export function approvalRelay(context: CommandContext | undefined): ApprovalRelay | undefined {
	return (context as RelayContext | undefined)?.[RELAY];
}
