import { InheritanceResolutionError, resolveInheritance } from '@lushly-dev/violet-core/engine';
import type { ResolvedToken, TokenLineage } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

/**
 * Input schema for token.lineage command
 */
const InputSchema = z.object({
	nodeId: z.string().min(1),
	tokenId: z.string().min(1),
});

/**
 * Output schema for token.lineage command
 */
const OutputSchema = z.object({
	tokenId: z.string(),
	currentValue: z.any(),
	resolvedAt: z.string(),
	chain: z.array(
		z.object({
			nodeId: z.string(),
			operation: z.enum(['add', 'override', 'inherit', 'reset', 'copy', 'include']),
			value: z.any().optional(),
			/** Where the value came from: copy source, included node, or reset target */
			fromNode: z.string().optional(),
			/** Owner of `fromNode`, when it has one */
			fromOwner: z.string().optional(),
			/** Source token id, when a copy renamed it */
			fromToken: z.string().optional(),
			/**
			 * True when later changes at `fromNode` show up here. Copies, includes and
			 * resets are re-resolved from their source on every read, never snapshotted.
			 */
			tracksSource: z.boolean().optional(),
			/** True when a later step on the same node replaced this value */
			superseded: z.boolean().optional(),
		}),
	),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * token.lineage command
 *
 * Trace a token's value through the inheritance chain.
 */
export const tokenLineageCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'token.lineage',
	description: "Trace a token's value through the inheritance chain",
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
		const fullChain = [...ancestryChain, input.nodeId];

		// Resolve through the shared resolver (the same one tokens.resolve and export use)
		// so lineage always agrees with them about overrides, resets, copies and includes.
		let resolvedTokens: ResolvedToken[];
		try {
			resolvedTokens = await resolveInheritance(db, input.nodeId, ancestryChain, true);
		} catch (error) {
			if (error instanceof InheritanceResolutionError) {
				return failure({
					code: ErrorCodes.CIRCULAR_REFERENCE,
					message: error.message,
					suggestion:
						'Remove the copy or include that creates the loop (see node.get) and trace again',
				});
			}
			throw error;
		}

		const token = resolvedTokens.find((t) => t.id === input.tokenId);
		if (!token) {
			return failure(
				{
					code: ErrorCodes.TOKEN_NOT_FOUND,
					message: `Token '${input.tokenId}' not found in node '${input.nodeId}' or its ancestors`,
					suggestion: `Use 'tokens.resolve ${input.nodeId}' to see available tokens`,
				},
				{
					sources: fullChain.map((id) => ({ type: 'node' as const, id })),
				},
			);
		}

		// Walk the chain root -> target, listing what happened to the token at each node
		const history = token.operationHistory ?? [];
		const chain: TokenLineage['chain'] = [];
		const owners = new Map<string, string | undefined>();
		const ownerOf = async (id: string) => {
			if (!owners.has(id)) owners.set(id, (await db.getNode(id))?.owner);
			return owners.get(id);
		};
		let seen = false;
		for (const currentNodeId of fullChain) {
			const entries = history.filter((h) => h.nodeId === currentNodeId);
			if (entries.length === 0) {
				if (seen) {
					chain.push({ nodeId: currentNodeId, operation: 'inherit' });
				}
				continue;
			}
			seen = true;
			for (const [index, entry] of entries.entries()) {
				const link = await toLineageStep(entry, ownerOf);
				// Only the last change on a node sticks; earlier ones are kept as history
				if (index < entries.length - 1) {
					link.superseded = true;
				}
				chain.push(link);
			}
		}

		const currentValue = token.value;
		const resolvedAt = token.resolvedAt;

		return success(
			{
				tokenId: input.tokenId,
				currentValue,
				resolvedAt,
				chain,
			},
			{
				reasoning: `Token '${input.tokenId}' was set at '${resolvedAt}' and passed through ${chain.length} node(s)`,
				sources: [
					{ type: 'node', id: input.nodeId, title: node.name },
					{ type: 'token', id: input.tokenId },
				],
			},
		);
	},

	examples: [
		{
			description: 'Trace accent color through Xbox hierarchy',
			input: {
				nodeId: 'xbox-ios-dark',
				tokenId: 'color.accent.primary',
			},
		},
	],
};

type LineageOperation = TokenLineage['chain'][number]['operation'];
type LineageStep = TokenLineage['chain'][number];
type HistoryEntry = NonNullable<ResolvedToken['operationHistory']>[number];

/**
 * One lineage step from a resolver history entry. Copies, includes and resets
 * name the node their value comes from, and track it: the resolver reads that
 * node's value again on every resolve rather than storing a snapshot.
 */
async function toLineageStep(
	entry: HistoryEntry,
	ownerOf: (nodeId: string) => Promise<string | undefined>,
): Promise<LineageStep> {
	const step: LineageStep = {
		nodeId: entry.nodeId,
		operation: toLineageOperation(entry.operation),
	};
	if (entry.value !== undefined) {
		step.value = entry.value;
	}
	if (entry.fromNode) {
		step.fromNode = entry.fromNode;
		const owner = await ownerOf(entry.fromNode);
		if (owner) step.fromOwner = owner;
		if (entry.fromToken) step.fromToken = entry.fromToken;
		step.tracksSource = true;
	}
	return step;
}

/** Map a resolver history operation to the lineage vocabulary. */
function toLineageOperation(operation: string): LineageOperation {
	switch (operation) {
		case 'add':
		case 'override':
		case 'reset':
		case 'copy':
		case 'include':
			return operation;
		default:
			// 'subtract' and anything unknown: the token was inherited as-is at this node
			return 'inherit';
	}
}
