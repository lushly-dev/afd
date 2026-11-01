/**
 * @fileoverview Confirmation enforcement for commands that declare `confirmPrompt`
 * (`spec/command-metadata.md`, "Confirmations"): the types, constants and plain helpers.
 *
 * The server option `confirmations` turns it on. A call that reaches a confirm-gated command runs
 * only when it carries a confirmation:
 *
 * - an accepted MCP elicitation, through the `input_required` round trip of MCP 2026-07-28 (or the
 *   SDK's server-side shim on a 2025-era stdio connection), bound by a signed `requestState` to
 *   the commands and their input; or
 * - under `enforce`, an acknowledgement: a `confirm` argument, or `_meta["dev.afd/confirm"]`.
 *
 * Otherwise the call fails with `CONFIRMATION_REQUIRED` or `CONFIRMATION_DECLINED` before any
 * handler runs. In-process calls (DirectClient, `server.execute`) are never gated.
 *
 * The lane that received a request describes what that request can carry with a
 * {@link ConfirmationChannel}, bound to the `CommandContext` under a private symbol (as context
 * state is), so `createContext` cannot forge one.
 *
 * Module-graph rule: this module loads no Node.js built-in, because the tool router and the tool
 * list import it and `createDirectToolSurface` bundles them for the browser. The gate itself,
 * whose binding digest uses `node:crypto`, is in `confirmation-gate.ts`, which only the MCP
 * server and its HTTP handler import.
 */

import type { CommandContext, CommandError } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from './schema.js';

/** How a server treats `confirmPrompt`: not at all, or as a required confirmation. */
export type ConfirmationMode = 'off' | 'enforce' | 'require-human';

/** `_meta` key a client sets to `true` to acknowledge every confirm-gated command in a call. */
export const AFD_CONFIRM_META_KEY = 'dev.afd/confirm';

/** The `inputRequests` key of the confirmation elicitation. */
export const CONFIRM_INPUT_KEY = 'confirm';

/** The elicitation form: one required boolean. */
export const CONFIRM_REQUESTED_SCHEMA = {
	type: 'object',
	properties: {
		confirm: {
			type: 'boolean',
			title: 'Confirm',
			description: 'Run the command',
		},
	},
	required: ['confirm'],
} as const;

/** One command a call would run, with its input as sent. */
export interface ConfirmationStep {
	command: string;
	input: unknown;
}

/** What the request being routed can carry, as seen by the lane that received it. */
export interface ConfirmationChannel {
	/** The request can carry a form elicitation (and the lane can deliver it). */
	canElicit: boolean;
	/** `_meta["dev.afd/confirm"]` is `true`. */
	acknowledged: boolean;
	/**
	 * The response to an earlier confirmation elicitation, if this request is its retry and its
	 * `requestState` verifies for `binding`. A stale, altered or mismatched state is `missing`.
	 */
	response(binding: string): Promise<'accept' | 'decline' | 'missing'>;
	/** The `input_required` result that asks `message`, bound to `binding`. */
	request(message: string, binding: string): Promise<unknown>;
}

/** What the gate decided for one call. */
export type ConfirmationOutcome =
	| { kind: 'proceed' }
	| { kind: 'error'; error: CommandError }
	| { kind: 'input-required'; result: unknown };

/**
 * Thrown by the tool router to answer a call with the MCP `input_required` result in `result`.
 * Only a channel that can elicit leads to it, and the lane that bound that channel catches it.
 */
export class InputRequiredSignal {
	constructor(readonly result: unknown) {}
}

/** How the caller acknowledges: every gated command, or the named ones. */
export type Acknowledgement = 'all' | ReadonlySet<string> | undefined;

const CHANNEL = Symbol('afd.confirmationChannel');

type ChannelContext = CommandContext & { [CHANNEL]?: ConfirmationChannel };

/** Return a copy of `context` bound to `channel`. */
export function bindConfirmationChannel(
	context: CommandContext,
	channel: ConfirmationChannel
): CommandContext {
	const bound: ChannelContext = { ...context, [CHANNEL]: channel };
	return bound;
}

/** The channel bound to `context`, if any. */
export function confirmationChannel(
	context: CommandContext | undefined
): ConfirmationChannel | undefined {
	return (context as ChannelContext | undefined)?.[CHANNEL];
}

/** Whether a command's own input schema declares a `confirm` property. */
export function declaresConfirmInput(command: ZodCommandDefinition): boolean {
	const properties = (command.jsonSchema as { properties?: Record<string, unknown> }).properties;
	return !!properties && Object.hasOwn(properties, 'confirm');
}

export interface ConfirmationGate {
	readonly mode: ConfirmationMode;
	/** The confirm-gated commands among `steps`. */
	gated(steps: readonly ConfirmationStep[]): ConfirmationStep[];
	/**
	 * Decide whether a call may run.
	 *
	 * @param steps - Every command the call would run
	 * @param acknowledged - The call's acknowledgement (`confirm` argument)
	 * @param context - The call context, with the lane's channel bound to it
	 * @param howToAcknowledge - Recovery text for this surface, such as "repeat the call with
	 *   confirm: true"
	 */
	check(
		steps: readonly ConfirmationStep[],
		acknowledged: Acknowledgement,
		context: CommandContext | undefined,
		howToAcknowledge: string
	): Promise<ConfirmationOutcome>;
}
