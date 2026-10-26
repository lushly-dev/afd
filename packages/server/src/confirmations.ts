/**
 * @fileoverview Confirmation enforcement for commands that declare `confirmPrompt`
 * (`spec/command-metadata.md`, "Confirmations").
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
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { CommandContext, CommandError } from '@lushly-dev/afd-core';
import { ErrorCodes } from '@lushly-dev/afd-core';
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

/** JSON with object keys sorted, so equal inputs give equal digests. */
function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
	}
	return JSON.stringify(value ?? null);
}

/** The binding of a confirmation: a digest of the gated commands and their input. */
export function confirmationBinding(steps: readonly ConfirmationStep[]): string {
	return createHash('sha256')
		.update(canonicalJson(steps.map((step) => [step.command, step.input ?? {}])))
		.digest('base64url');
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

function prompted(steps: readonly ConfirmationStep[], commands: Map<string, ZodCommandDefinition>) {
	return steps.map((step) => ({
		...step,
		prompt: commands.get(step.command)?.confirmPrompt ?? '',
	}));
}

function elicitationMessage(steps: ReturnType<typeof prompted>): string {
	const [first] = steps;
	if (steps.length === 1 && first) return first.prompt;
	return [
		'This request runs commands that need confirmation:',
		...steps.map((step) => `- ${step.command}: ${step.prompt}`),
	].join('\n');
}

/**
 * Create the gate for `commands` (the remotely callable ones). With mode `off` every call
 * proceeds.
 */
export function createConfirmationGate(
	mode: ConfirmationMode,
	commands: readonly ZodCommandDefinition[]
): ConfirmationGate {
	if (mode !== 'off' && mode !== 'enforce' && mode !== 'require-human') {
		throw new Error("confirmations must be 'off', 'enforce' or 'require-human'");
	}
	const byName = new Map(commands.map((command) => [command.name, command]));
	const gated = (steps: readonly ConfirmationStep[]) =>
		mode === 'off' ? [] : steps.filter((step) => !!byName.get(step.command)?.confirmPrompt);

	return {
		mode,
		gated,
		async check(steps, acknowledged, context, howToAcknowledge) {
			const gatedSteps = gated(steps);
			if (gatedSteps.length === 0) return { kind: 'proceed' };
			const names = [...new Set(gatedSteps.map((step) => step.command))];
			const binding = confirmationBinding(gatedSteps);
			const channel = confirmationChannel(context);

			const response = channel ? await channel.response(binding) : 'missing';
			if (response === 'accept') return { kind: 'proceed' };
			if (response === 'decline') {
				return {
					kind: 'error',
					error: {
						code: ErrorCodes.CONFIRMATION_DECLINED,
						message: `The user did not confirm ${names.map((name) => `'${name}'`).join(', ')}`,
						suggestion:
							'Do not run this again without asking the user first; the user chose not to proceed.',
						retryable: false,
						details: { commands: names },
					},
				};
			}

			if (mode === 'enforce') {
				const covered =
					channel?.acknowledged === true ||
					acknowledged === 'all' ||
					(acknowledged instanceof Set && names.every((name) => acknowledged.has(name)));
				if (covered) return { kind: 'proceed' };
			}

			if (channel?.canElicit) {
				const message = elicitationMessage(prompted(gatedSteps, byName));
				return { kind: 'input-required', result: await channel.request(message, binding) };
			}

			const [firstStep] = prompted(gatedSteps, byName);
			return {
				kind: 'error',
				error: {
					code: ErrorCodes.CONFIRMATION_REQUIRED,
					message:
						names.length === 1 && firstStep
							? `'${firstStep.command}' needs confirmation: ${firstStep.prompt}`
							: `${names.map((name) => `'${name}'`).join(', ')} need confirmation`,
					suggestion:
						mode === 'enforce'
							? `Make sure the user intends this, then ${howToAcknowledge}.`
							: 'This server accepts only a confirmation from the user: use an MCP client that supports elicitation.',
					retryable: false,
					details: { commands: names },
				},
			};
		},
	};
}

/** Header that acknowledges confirm-gated commands on the HTTP routes: their names, comma-separated. */
export const AFD_CONFIRM_HEADER = 'afd-confirm';

/** The command names an `Afd-Confirm` header acknowledges. */
function headerAcknowledgement(req: IncomingMessage): Acknowledgement {
	const raw = req.headers[AFD_CONFIRM_HEADER];
	const value = Array.isArray(raw) ? raw.join(',') : raw;
	if (!value) return undefined;
	return new Set(
		value
			.split(',')
			.map((name) => name.trim())
			.filter(Boolean)
	);
}

/**
 * The check of the HTTP routes (`/rpc`, `/batch`, `/stream`), which have no elicitation channel:
 * the confirmation error for a request, or `undefined` when it may run.
 */
export function createHttpConfirmationCheck(gate: ConfirmationGate | undefined) {
	return async (
		req: IncomingMessage,
		steps: ConfirmationStep[]
	): Promise<CommandError | undefined> => {
		if (!gate || gate.mode === 'off') return undefined;
		const names = [...new Set(gate.gated(steps).map((step) => step.command))];
		const outcome = await gate.check(
			steps,
			headerAcknowledgement(req),
			undefined,
			`repeat the request with the header 'Afd-Confirm: ${names.join(', ')}'`
		);
		return outcome.kind === 'error' ? outcome.error : undefined;
	};
}
