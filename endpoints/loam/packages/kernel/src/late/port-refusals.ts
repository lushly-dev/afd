/**
 * @fileoverview The internal commands a surface's port refuses through, so the refusal reaches the
 * journal (phase 2 specification, 3.6 and 12): a scope the app named, and an embed's mutation; and, from phase 4's
 * step 10, a call over one of the limits the port enforces (its section 11). In the late chunk, on Zod Mini, beside
 * the shell's other commands; `INTERNAL_COMMANDS` keeps them out of every list.
 */

import type { CommandContext } from '@lushly-dev/afd-core';
import {
	defineCommandWithSchema,
	type JsonSchema,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import * as z from 'zod/mini';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure } from '../errors.js';
import type { KernelLimits } from '../limits.js';

const refuseInput = z.strictObject({ command: z.string().check(z.maxLength(256)) });
const REFUSE_JSON: JsonSchema = {
	type: 'object',
	properties: { command: { type: 'string', maxLength: 256 } },
	required: ['command'],
	additionalProperties: false,
};

/** What the port refuses by a limit (section 11): the view broker's message, an input, and the call rate. */
const PORT_LIMITS = ['messageBytes', 'inputBytes', 'callsPerSecond'] as const;

const limitInput = z.strictObject({
	command: z.string().check(z.maxLength(256)),
	limit: z.enum(PORT_LIMITS),
	bound: z.int().check(z.minimum(1)),
	retryAfterMs: z.optional(z.int().check(z.minimum(1))),
});

/**
 * `app-limit-refuse`'s answer, by the limit: `INPUT_TOO_LARGE` with `details: { limit }`, or `RATE_LIMITED` with
 * `details: { limit, retryAfterMs }`, each with a suggestion naming the key an owner sets (section 16).
 */
export function limitRefusal(
	command: string,
	limit: (typeof PORT_LIMITS)[number],
	bound: number,
	retryAfterMs = 1
) {
	if (limit === 'callsPerSecond') {
		return kernelFailure(
			'RATE_LIMITED',
			`This app called '${command}' over its rate of ${bound} calls a second`,
			`Wait ${retryAfterMs} ms, then retry; an owner sets loam.limits.callsPerSecond`,
			{ retryable: true, details: { limit: bound, retryAfterMs } }
		);
	}
	return kernelFailure(
		'INPUT_TOO_LARGE',
		limit === 'inputBytes'
			? `The input of '${command}' is over ${bound} bytes of JSON`
			: `A message to '${command}' is over ${bound} bytes of JSON, so it was dropped`,
		`Send less, or ask an owner to raise loam.limits.${limit}`,
		{ details: { limit: bound } }
	);
}

export function createPortRefusals(limits?: KernelLimits): ZodCommandDefinition[] {
	return [
		defineCommandWithSchema<typeof limitInput, never>({
			name: 'app-limit-refuse',
			description:
				"Refuses an app's call over one of the shell's limits, so the refusal reaches the journal",
			category: 'app',
			mutation: false,
			executionTime: 'instant',
			input: limitInput,
			jsonSchema: {
				type: 'object',
				properties: {
					command: { type: 'string', maxLength: 256 },
					limit: { type: 'string', enum: [...PORT_LIMITS] },
					bound: { type: 'integer', minimum: 1 },
					retryAfterMs: { type: 'integer', minimum: 1 },
				},
				required: ['command', 'limit', 'bound'],
				additionalProperties: false,
			},
			async handler(input, context: CommandContext) {
				// Counted here, on the call's clock and for the instance the kernel set, so a replay counts the same.
				const caller = (context as KernelFieldContext).caller;
				if (caller !== undefined)
					limits?.refused(caller, input.limit, context.clock?.now() ?? Date.now());
				return limitRefusal(input.command, input.limit, input.bound, input.retryAfterMs);
			},
		}),
		defineCommandWithSchema<typeof refuseInput, never>({
			name: 'app-scope-refuse',
			description: 'Refuses a scope an app named, so the refusal reaches the journal',
			category: 'app',
			mutation: false,
			executionTime: 'instant',
			input: refuseInput,
			jsonSchema: REFUSE_JSON,
			async handler(input) {
				return kernelFailure(
					'SCOPE_NOT_GRANTED',
					`An app may not choose the scope of '${input.command}'`,
					"Scope is the shell's: call with no scope, or with level 'workspace'",
					{ details: { command: input.command } }
				);
			},
		}),
		defineCommandWithSchema<typeof refuseInput, never>({
			name: 'app-embed-refuse',
			description: "Refuses an embed's mutation, so the refusal reaches the journal",
			category: 'app',
			mutation: false,
			executionTime: 'instant',
			input: refuseInput,
			jsonSchema: REFUSE_JSON,
			async handler(input) {
				return kernelFailure(
					'EMBED_READ_ONLY',
					`An embedded surface is read-only, so '${input.command}' cannot run from it`,
					'Open the document or app itself to change it',
					{ details: { command: input.command } }
				);
			},
		}),
	] as unknown as ZodCommandDefinition[];
}
