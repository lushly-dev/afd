/**
 * @fileoverview The internal commands a surface's port refuses through, so the refusal reaches the
 * journal (phase 2 specification, 3.6 and 12): a scope the app named, and an embed's mutation. In the
 * late chunk, on Zod Mini, beside the shell's other commands; `INTERNAL_COMMANDS` keeps them out of
 * every list.
 */

import {
	defineCommandWithSchema,
	type JsonSchema,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import * as z from 'zod/mini';
import { kernelFailure } from '../errors.js';

const refuseInput = z.strictObject({ command: z.string().check(z.maxLength(256)) });
const REFUSE_JSON: JsonSchema = {
	type: 'object',
	properties: { command: { type: 'string', maxLength: 256 } },
	required: ['command'],
	additionalProperties: false,
};

export function createPortRefusals(): ZodCommandDefinition[] {
	return [
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
