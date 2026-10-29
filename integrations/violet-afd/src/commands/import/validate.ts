import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { findDuplicateTokenIds, flattenTokenFile } from './flatten.js';

/**
 * Input schema for import.validate command
 */
const InputSchema = z.object({
	/** JSON content to validate */
	content: z.string().min(1),
	/** Target node to import into (for conflict detection) */
	targetNode: z.string().min(1),
	/** Format of the content */
	format: z.enum(['json', 'yaml']).default('json'),
	/** Prefix to prepend to all token IDs */
	prefix: z.string().optional(),
	/** Read top-level global/semantic/component groups as token tiers, not ID segments */
	tiers: z.boolean().default(false),
});

/**
 * Output schema for import.validate command
 */
const OutputSchema = z.object({
	valid: z.boolean(),
	tokenCount: z.number(),
	errors: z.array(
		z.object({
			tokenId: z.string().optional(),
			error: z.string(),
		}),
	),
	warnings: z.array(
		z.object({
			tokenId: z.string(),
			warning: z.string(),
		}),
	),
	diff: z.object({
		add: z.number(),
		update: z.number(),
		unchanged: z.number(),
	}),
	tokens: z.array(
		z.object({
			id: z.string(),
			value: z.unknown(),
			status: z.enum(['add', 'update', 'unchanged']),
		}),
	),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * import.validate command
 *
 * Validate import content without committing changes.
 */
export const importValidateCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'import.validate',
	description: 'Validate import content and show diff without committing',
	category: 'import',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const input = InputSchema.parse(rawInput);
		const { db } = context;

		const errors: Output['errors'] = [];
		const warnings: Output['warnings'] = [];
		const tokens: Output['tokens'] = [];

		// Verify target node exists
		const node = await db.getNode(input.targetNode);
		if (!node) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Target node '${input.targetNode}' not found`,
				suggestion: `Use 'node.create --name ${input.targetNode}' to create it first`,
			});
		}

		// Parse content based on format
		let parsedContent: Record<string, unknown>;
		try {
			if (input.format === 'yaml') {
				// For now, YAML is not supported in validate - would need js-yaml
				return failure({
					code: ErrorCodes.VALIDATION_ERROR,
					message: 'YAML format not yet supported',
					suggestion: 'Use JSON format for now',
				});
			}
			parsedContent = JSON.parse(input.content);
		} catch (err) {
			errors.push({
				error: `Invalid ${input.format.toUpperCase()} content: ${
					err instanceof Error ? err.message : String(err)
				}`,
			});
			return success(
				{
					valid: false,
					tokenCount: 0,
					errors,
					warnings,
					diff: { add: 0, update: 0, unchanged: 0 },
					tokens: [],
				},
				{
					reasoning: 'Content parsing failed',
				},
			);
		}

		// Flatten to tokens
		const flatTokens = flattenTokenFile(parsedContent, input.prefix, { tiers: input.tiers });

		for (const tokenId of findDuplicateTokenIds(flatTokens)) {
			errors.push({ tokenId, error: 'Token ID is defined more than once' });
		}

		// Validate each token
		for (const token of flatTokens) {
			// Check for valid token ID
			if (!token.id || typeof token.id !== 'string') {
				errors.push({
					error: 'Token has invalid or missing ID',
				});
				continue;
			}

			// Check for valid value
			if (token.value === undefined) {
				errors.push({
					tokenId: token.id,
					error: 'Token has undefined value',
				});
				continue;
			}

			// Warn about unusual token IDs
			if (token.id.includes(' ')) {
				warnings.push({
					tokenId: token.id,
					warning: 'Token ID contains spaces',
				});
			}

			if (!/^[a-z][a-z0-9._-]*$/i.test(token.id)) {
				warnings.push({
					tokenId: token.id,
					warning: 'Token ID contains unusual characters',
				});
			}
		}

		// Get existing tokens to compute diff
		const existingOps = await db.getOperations(input.targetNode);
		const existingTokens = new Map<string, unknown>();

		for (const op of existingOps) {
			if (op.type === 'add' || op.type === 'override') {
				existingTokens.set(op.tokenId, op.value ? JSON.parse(op.value) : null);
			} else if (op.type === 'subtract') {
				existingTokens.delete(op.tokenId);
			}
		}

		// Compute diff
		let addCount = 0;
		let updateCount = 0;
		let unchangedCount = 0;

		for (const token of flatTokens) {
			if (!token.id) continue;

			if (!existingTokens.has(token.id)) {
				tokens.push({ id: token.id, value: token.value, status: 'add' });
				addCount++;
			} else {
				const existingValue = existingTokens.get(token.id);
				const valueChanged = JSON.stringify(existingValue) !== JSON.stringify(token.value);

				if (valueChanged) {
					tokens.push({ id: token.id, value: token.value, status: 'update' });
					updateCount++;
				} else {
					tokens.push({
						id: token.id,
						value: token.value,
						status: 'unchanged',
					});
					unchangedCount++;
				}
			}
		}

		const valid = errors.length === 0;

		return success(
			{
				valid,
				tokenCount: flatTokens.length,
				errors,
				warnings,
				diff: {
					add: addCount,
					update: updateCount,
					unchanged: unchangedCount,
				},
				tokens,
			},
			{
				reasoning: valid
					? `Validated ${flatTokens.length} tokens: ${addCount} new, ${updateCount} updates, ${unchangedCount} unchanged`
					: `Validation failed with ${errors.length} error(s)`,
			},
		);
	},

	examples: [
		{
			description: 'Validate JSON import',
			input: {
				content: '{"color": {"primary": {"value": "#0078D4"}}}',
				targetNode: 'global-base',
			},
		},
	],
};
