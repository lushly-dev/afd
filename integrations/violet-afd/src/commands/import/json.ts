import { validateTokenId } from '@lushly-dev/violet-core/engine';
import { resolveAncestorTokenMap } from '@lushly-dev/violet-core/engine';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { type FlatToken, findDuplicateTokenIds, flattenTokenFile } from './flatten.js';

/**
 * Input schema for import.json command
 */
const InputSchema = z.object({
	/** JSON content or path (CLI resolves path to content) */
	content: z.string().min(1),
	/** Target node to import into */
	targetNode: z.string().min(1),
	/** Merge with existing tokens (overrides) vs fail on conflict */
	merge: z.boolean().default(false),
	/** Dry-run: validate only, don't commit */
	dryRun: z.boolean().default(false),
	/** Prefix to add to all token IDs */
	prefix: z.string().optional(),
	/** Read top-level global/semantic/component groups as token tiers, not ID segments */
	tiers: z.boolean().default(false),
});

/**
 * Output schema for import.json command
 */
const OutputSchema = z.object({
	targetNode: z.string(),
	tokensImported: z.number(),
	tokensSkipped: z.number(),
	conflicts: z.array(
		z.object({
			tokenId: z.string(),
			existingValue: z.unknown(),
			importValue: z.unknown(),
		}),
	),
	errors: z.array(
		z.object({
			tokenId: z.string(),
			error: z.string(),
		}),
	),
	dryRun: z.boolean(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * import.json command
 *
 * Import tokens from Style Dictionary or DTCG JSON.
 */
export const importJsonCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'import.json',
	description: 'Import tokens from Style Dictionary or DTCG JSON',
	category: 'import',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const input = InputSchema.parse(rawInput);
		const { db } = context;

		// Verify target node exists
		const node = await db.getNode(input.targetNode);
		if (!node) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Target node '${input.targetNode}' not found`,
				suggestion: `Use 'node.create --name ${input.targetNode}' to create it first`,
			});
		}

		// Parse JSON
		let parsedContent: Record<string, unknown>;
		try {
			parsedContent = JSON.parse(input.content);
		} catch {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: 'Invalid JSON content',
				suggestion: 'Ensure the content is valid Style Dictionary or DTCG JSON',
			});
		}

		// Flatten to tokens
		const flatTokens = flattenTokenFile(parsedContent, input.prefix, { tiers: input.tiers });

		const duplicates = findDuplicateTokenIds(flatTokens);
		if (duplicates.length > 0) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `Token IDs defined more than once: ${duplicates.join(', ')}`,
				suggestion: 'With tiers, a token ID must be unique across global, semantic and component',
			});
		}

		// Tokens the node inherits must be overridden: an 'add' for an inherited
		// token is ignored by the resolver, so the imported value would never win.
		const inheritedTokens = await resolveAncestorTokenMap(db, node.parentId);

		// Get existing operations for the target node
		const existingOps = await db.getOperations(input.targetNode);
		const existingTokenIds = new Set(
			existingOps.filter((op) => op.type === 'add').map((op) => op.tokenId),
		);

		const conflicts: Output['conflicts'] = [];
		const errors: Output['errors'] = [];
		const toImport: FlatToken[] = [];

		// Check each token
		for (const token of flatTokens) {
			const idError = validateTokenId(token.id);
			if (idError) {
				errors.push({ tokenId: token.id, error: idError });
				continue;
			}

			if (existingTokenIds.has(token.id)) {
				if (input.merge) {
					// Will override
					toImport.push(token);
				} else {
					// Find existing value for conflict report
					const existingOp = existingOps.find((op) => op.tokenId === token.id && op.type === 'add');
					conflicts.push({
						tokenId: token.id,
						existingValue: existingOp?.value ? JSON.parse(existingOp.value) : null,
						importValue: token.value,
					});
				}
			} else {
				toImport.push(token);
			}
		}

		// If dry run, return without committing
		if (input.dryRun) {
			return success(
				{
					targetNode: input.targetNode,
					tokensImported: 0,
					tokensSkipped: toImport.length, // Would import these
					conflicts,
					errors,
					dryRun: true,
				},
				{
					reasoning: `Dry run: ${toImport.length} tokens would be imported, ${conflicts.length} conflicts found`,
				},
			);
		}

		// If conflicts and not merging, fail
		if (conflicts.length > 0 && !input.merge) {
			return failure({
				code: ErrorCodes.TOKEN_ALREADY_EXISTS,
				message: `${conflicts.length} token(s) already exist at '${input.targetNode}'`,
				suggestion: 'Use --merge to override existing tokens, or resolve conflicts manually',
			});
		}

		// Import tokens
		let imported = 0;
		const maxSeq = existingOps.length > 0 ? Math.max(...existingOps.map((op) => op.sequence)) : 0;

		for (const token of toImport) {
			const opType =
				existingTokenIds.has(token.id) || inheritedTokens.has(token.id) ? 'override' : 'add';

			try {
				await db.addOperation({
					id: `${input.targetNode}-${opType}-${token.id}-${Date.now()}`,
					nodeId: input.targetNode,
					tokenId: token.id,
					type: opType as 'add' | 'override',
					value: JSON.stringify(token.value),
					// The resolver only reads metadata from 'add' ops
					metadata: opType === 'add' && token.metadata ? JSON.stringify(token.metadata) : null,
					sequence: maxSeq + imported + 1,
					createdAt: new Date().toISOString(),
					author: context.actor || 'import',
					reason: 'Imported from JSON',
					fromNode: null,
					asTokenId: null,
					toAncestor: null,
				});
				imported++;
			} catch (err) {
				errors.push({
					tokenId: token.id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		return success(
			{
				targetNode: input.targetNode,
				tokensImported: imported,
				tokensSkipped: flatTokens.length - imported,
				conflicts,
				errors,
				dryRun: false,
			},
			{
				reasoning: `Imported ${imported} tokens into '${input.targetNode}'`,
			},
		);
	},

	examples: [
		{
			description: 'Import tokens into a node',
			input: {
				content: '{"color": {"primary": {"value": "#0078D4"}}}',
				targetNode: 'global-base',
			},
		},
		{
			description: 'Import with merge (override existing)',
			input: {
				content: '{"color": {"primary": {"value": "#FF0000"}}}',
				targetNode: 'global-base',
				merge: true,
			},
		},
		{
			description: 'Dry run validation',
			input: {
				content: '{"color": {"primary": {"value": "#0078D4"}}}',
				targetNode: 'global-base',
				dryRun: true,
			},
		},
	],
};
