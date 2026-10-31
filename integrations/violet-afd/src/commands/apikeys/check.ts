import { z } from 'zod';
import type { CommandResult } from '../../types/command-result.js';
import { success } from '../../types/command-result.js';
import type { CommandDefinition } from '../registry.js';
import { checkApiKeySeeds } from './keys.js';

const ApiKeysCheckInputSchema = z.object({
	seeds: z.string().describe('The VIOLET_API_KEYS_JSON value to check'),
});

type ApiKeysCheckInput = z.input<typeof ApiKeysCheckInputSchema>;

const ApiKeysCheckOutputSchema = z.object({
	valid: z.boolean(),
	keys: z.array(
		z.object({
			entry: z.number(),
			id: z.string().optional(),
			name: z.string().optional(),
			scopes: z.array(z.string()),
			rateLimit: z.number().optional(),
			revokedAt: z.string().optional(),
		}),
	),
	issues: z.array(
		z.object({
			severity: z.enum(['error', 'warning']),
			code: z.string(),
			message: z.string(),
			entry: z.number().optional(),
			keyId: z.string().optional(),
		}),
	),
	summary: z.object({ keys: z.number(), errors: z.number(), warnings: z.number() }),
});

type ApiKeysCheckOutput = z.infer<typeof ApiKeysCheckOutputSchema>;

/**
 * Check a VIOLET_API_KEYS_JSON value before it is saved to an environment.
 * Reports problems by entry and key id; never echoes tokens.
 */
export const apiKeysCheckCommand: CommandDefinition<
	typeof ApiKeysCheckInputSchema,
	ApiKeysCheckOutput
> = {
	name: 'apikeys.check',
	description:
		'Check a VIOLET_API_KEYS_JSON value offline for entries that would break key seeding or never work',
	category: 'system',
	inputSchema: ApiKeysCheckInputSchema,
	outputSchema: ApiKeysCheckOutputSchema,

	async handler(rawInput: ApiKeysCheckInput): Promise<CommandResult<ApiKeysCheckOutput>> {
		const input = ApiKeysCheckInputSchema.parse(rawInput);
		const { keys, issues } = checkApiKeySeeds(input.seeds);
		const errors = issues.filter((issue) => issue.severity === 'error').length;
		const warnings = issues.length - errors;

		return success(
			{
				valid: errors === 0,
				keys,
				issues,
				summary: { keys: keys.length, errors, warnings },
			},
			{
				reasoning:
					errors === 0
						? `${keys.length} key(s) would seed cleanly${warnings > 0 ? ` (${warnings} warning(s))` : ''}`
						: `${errors} error(s): the API would skip the entries with errors (or every entry, for unreadable JSON) and report them on /api/v1/health`,
			},
		);
	},

	examples: [
		{
			description: 'Check a seed list before saving it to Vercel',
			input: {
				seeds:
					'[{"token":"<64 hex characters>","data":{"id":"lushly-preview","name":"Lushly (preview)","createdAt":"2026-10-26T00:00:00.000Z","scopes":["tokens:read","export:read"]}}]',
			},
		},
	],
};
