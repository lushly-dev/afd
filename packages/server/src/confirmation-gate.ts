/**
 * @fileoverview The confirmation gate (`spec/command-metadata.md`, "Confirmations"): the check
 * that decides whether a call to confirm-gated commands may run, its binding digest, and the
 * confirmation channel of the HTTP routes.
 *
 * Split from `confirmations.ts` because the binding digest uses `node:crypto`: only the MCP server
 * (`server.ts`) and its HTTP handler import this module, so the tool router and the tool list stay
 * free of Node.js built-ins for `createDirectToolSurface`. In-process calls are never gated.
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { ErrorCodes } from '@lushly-dev/afd-core';
import {
	type Acknowledgement,
	type ConfirmationChannel,
	type ConfirmationGate,
	type ConfirmationMode,
	type ConfirmationStep,
	confirmationChannel,
} from './confirmations.js';
import type { ZodCommandDefinition } from './schema.js';

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

/**
 * The binding of a confirmation: a digest of the gated commands and their input. The lane that
 * mints the `requestState` binds the call's principal to the whole state (`mcp-modern.ts`), so
 * this digest never needs to name the caller.
 */
export function confirmationBinding(steps: readonly ConfirmationStep[]): string {
	return createHash('sha256')
		.update(canonicalJson(steps.map((step) => [step.command, step.input ?? {}])))
		.digest('base64url');
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
		mode === 'off'
			? []
			: steps.filter((step) => {
					const command = byName.get(step.command);
					return !!command?.confirmPrompt && command.confirmationMode !== 'host-verified';
				});

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
						recovery: { kind: 'stop' },
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
					// The user confirms, which never goes in a recovery's input (rule 5).
					recovery: { kind: 'external' },
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
 * What a request to the HTTP routes (`/rpc`, `/batch`, `/stream`) can carry for confirmations: no
 * elicitation, and the command names its `Afd-Confirm` header acknowledges. The router's gate then
 * decides it as it decides any call (`admission.ts`).
 */
export function httpConfirmationChannel(req: IncomingMessage): ConfirmationChannel {
	return {
		canElicit: false,
		acknowledged: false,
		response: async () => 'missing',
		request: async () => {
			throw new Error('The HTTP routes cannot ask for a confirmation');
		},
		acknowledgement: {
			names: headerAcknowledgement(req),
			how: (names) => `repeat the request with the header 'Afd-Confirm: ${names.join(', ')}'`,
		},
	};
}
