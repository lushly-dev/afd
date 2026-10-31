import { z } from 'zod';
import { type CommandResult, ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandDefinition } from '../registry.js';
import {
	API_KEY_ID_PATTERN,
	BROAD_API_KEY_SCOPES,
	KNOWN_API_KEY_SCOPES,
	MIN_API_KEY_TOKEN_LENGTH,
	generateApiKeyToken,
	hashApiKeyToken,
} from './keys.js';

const ApiKeysCreateInputSchema = z.object({
	id: z
		.string()
		.regex(
			API_KEY_ID_PATTERN,
			'Use lowercase letters, digits, ".", "_" or "-" (at most 64), such as lushly-preview',
		)
		.describe('Key id, unique per environment (the api_keys primary key)'),
	name: z.string().trim().min(1).describe('Who or what uses the key'),
	scopes: z
		.array(z.string())
		.min(1)
		.describe(`Scopes to grant: ${KNOWN_API_KEY_SCOPES.join(', ')}`),
	rateLimit: z
		.number()
		.int()
		.positive()
		.optional()
		.describe('Requests per minute (the API defaults to 100)'),
	token: z
		.string()
		.min(MIN_API_KEY_TOKEN_LENGTH)
		.optional()
		.describe(
			'Use this token instead of generating one (at least 32 characters, so never the dev key)',
		),
});

type ApiKeysCreateInput = z.input<typeof ApiKeysCreateInputSchema>;

const ApiKeyDataSchema = z.object({
	id: z.string(),
	name: z.string(),
	createdAt: z.string(),
	scopes: z.array(z.string()),
	rateLimit: z.number().optional(),
});

const ApiKeysCreateOutputSchema = z.object({
	keyId: z.string(),
	/** Shown once; store it in the consumer's secret store. */
	token: z.string(),
	tokenHash: z.string(),
	/** One entry for that environment's VIOLET_API_KEYS_JSON array. */
	seed: z.object({ token: z.string(), data: ApiKeyDataSchema }),
	sql: z.object({
		/** Inserts the key directly, without a redeploy. Holds the hash, not the token. */
		insert: z.string(),
		/** Revokes the key later. Seed upserts never clear revoked_at. */
		revoke: z.string(),
	}),
});

type ApiKeysCreateOutput = z.infer<typeof ApiKeysCreateOutputSchema>;

function sqlString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Generate a hosted API key and the material to install it, without touching
 * any database: a seed entry for VIOLET_API_KEYS_JSON plus insert and revoke SQL.
 */
export const apiKeysCreateCommand: CommandDefinition<
	typeof ApiKeysCreateInputSchema,
	ApiKeysCreateOutput
> = {
	name: 'apikeys.create',
	description:
		'Generate a hosted API key: token, hash, a VIOLET_API_KEYS_JSON seed entry, and insert/revoke SQL (offline)',
	category: 'system',
	inputSchema: ApiKeysCreateInputSchema,
	outputSchema: ApiKeysCreateOutputSchema,

	async handler(rawInput: ApiKeysCreateInput): Promise<CommandResult<ApiKeysCreateOutput>> {
		const input = ApiKeysCreateInputSchema.parse(rawInput);
		const scopes = [...new Set(input.scopes)];

		const unknown = scopes.filter((scope) => !KNOWN_API_KEY_SCOPES.includes(scope));
		if (unknown.length > 0) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `Unknown scope(s): ${unknown.join(', ')}`,
				suggestion: `Use ${KNOWN_API_KEY_SCOPES.join(', ')}`,
			});
		}

		const token = input.token ?? generateApiKeyToken();
		const tokenHash = hashApiKeyToken(token);
		const data = {
			id: input.id,
			name: input.name,
			createdAt: new Date().toISOString(),
			scopes,
			...(input.rateLimit !== undefined ? { rateLimit: input.rateLimit } : {}),
		};

		const insert = `INSERT INTO api_keys (key_id, token_hash, name, scopes, rate_limit) VALUES (${sqlString(input.id)}, ${sqlString(tokenHash)}, ${sqlString(input.name)}, ${sqlString(JSON.stringify(scopes))}::jsonb, ${input.rateLimit ?? 'NULL'});`;
		const revoke = `UPDATE api_keys SET revoked_at = NOW(), updated_at = NOW() WHERE key_id = ${sqlString(input.id)};`;

		const broad = scopes.filter((scope) =>
			(BROAD_API_KEY_SCOPES as readonly string[]).includes(scope),
		);

		return success(
			{ keyId: input.id, token, tokenHash, seed: { token, data }, sql: { insert, revoke } },
			{
				reasoning: `Generated key '${input.id}' with ${scopes.join(', ')}. Nothing was stored: add the seed to one environment's VIOLET_API_KEYS_JSON and redeploy, or run the insert on that environment's database.`,
				warnings:
					broad.length > 0
						? [
								{
									code: 'BROAD_SCOPE',
									message: `Broad scope(s) ${broad.join(', ')}; prefer resource scopes such as tokens:read and export:read`,
								},
							]
						: undefined,
			},
		);
	},

	examples: [
		{
			description: 'Read-only key for a consumer backend on preview',
			input: {
				id: 'lushly-preview',
				name: 'Lushly (preview)',
				scopes: ['tokens:read', 'export:read'],
				rateLimit: 100,
			},
		},
		{
			description: 'Limited smoke key that only reads nodes',
			input: {
				id: 'smoke-preview-limited',
				name: 'Preview smoke (limited)',
				scopes: ['nodes:read'],
				rateLimit: 5,
			},
		},
	],
};
