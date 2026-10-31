import { matchesGlob } from '@lushly-dev/violet-core/engine';
import { resolutionCacheFor } from '@lushly-dev/violet-core/engine';
import { InheritanceResolutionError, resolveInheritance } from '@lushly-dev/violet-core/engine';
import type { ResolvedToken } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

/**
 * Input schema for tokens.resolve command
 */
const InputSchema = z.object({
	nodeId: z.string().min(1),
	filter: z.string().optional(), // Glob pattern like "color.*"
	includeLineage: z.boolean().optional().default(false),
});

/**
 * Output schema for tokens.resolve command
 */
const OutputSchema = z.object({
	nodeId: z.string(),
	ancestryChain: z.array(z.string()),
	tokens: z.array(
		z.object({
			id: z.string(),
			value: z.any(),
			resolvedValue: z.union([z.string(), z.number()]),
			finalValue: z.any().optional(),
			aliasOf: z.string().optional(),
			referenceError: z
				.object({
					code: z.string(),
					message: z.string(),
					path: z.array(z.string()),
				})
				.optional(),
			metadata: z.any(),
			resolvedAt: z.string(),
			inheritanceChain: z.array(z.string()).optional(),
			operationHistory: z.array(z.any()).optional(),
		}),
	),
	total: z.number(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * tokens.resolve command
 *
 * Get all resolved tokens for a node with full inheritance applied.
 */
export const tokensResolveCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'tokens.resolve',
	description: 'Get all resolved tokens for a node with inheritance',
	category: 'token',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		// Verify node exists
		const node = await db.getNode(input.nodeId);
		if (!node) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.nodeId}' not found`,
				suggestion: `Use 'node.list' to see available nodes`,
			});
		}

		if (node.deletedAt) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.nodeId}' has been deleted`,
			});
		}

		// Build ancestry chain
		const ancestryChain = await db.getAncestryChain(input.nodeId);

		// Resolve tokens through inheritance. Cyclic or runaway graphs (self-copies,
		// mutual copies, a parent including its own descendant) are reported as a
		// structured failure instead of recursing until the process runs out of memory.
		let resolvedTokens: ResolvedToken[];
		try {
			resolvedTokens = await resolveInheritance(
				db,
				input.nodeId,
				ancestryChain,
				input.includeLineage,
				{ cache: resolutionCacheFor(context) },
			);
		} catch (error) {
			if (error instanceof InheritanceResolutionError) {
				return failure({
					code: ErrorCodes.CIRCULAR_REFERENCE,
					message: error.message,
					suggestion:
						'Remove the copy or include that creates the loop (see token.lineage / node.get) and resolve again',
				});
			}
			throw error;
		}

		// Apply filter if provided
		let filteredTokens = resolvedTokens;
		if (input.filter) {
			const filter = input.filter;
			filteredTokens = resolvedTokens.filter((t) => matchesGlob(t.id, filter));
		}

		// Broken references don't fail resolve (it is how you find them); they are
		// flagged per token and as warnings. Exports refuse them.
		const broken = filteredTokens.filter((t) => t.referenceError);

		return success(
			{
				nodeId: input.nodeId,
				ancestryChain,
				tokens: filteredTokens,
				total: filteredTokens.length,
			},
			{
				reasoning: `Resolved ${filteredTokens.length} tokens for '${input.nodeId}' through ${ancestryChain.length} ancestor(s)`,
				sources: [{ type: 'node', id: input.nodeId, title: node.name }],
				warnings:
					broken.length > 0
						? broken.map((t) => ({
								code: t.referenceError?.code ?? 'TOKEN_REFERENCE_NOT_FOUND',
								message: t.referenceError?.message ?? `Token '${t.id}' has a broken reference`,
								severity: 'warning' as const,
							}))
						: undefined,
			},
		);
	},

	examples: [
		{
			description: 'Get all tokens for a node',
			input: {
				nodeId: 'xbox-ios-dark',
			},
		},
		{
			description: 'Get only color tokens',
			input: {
				nodeId: 'xbox-ios-dark',
				filter: 'color.*',
			},
		},
		{
			description: 'Get tokens with lineage information',
			input: {
				nodeId: 'xbox-ios-dark',
				includeLineage: true,
			},
		},
	],
};
