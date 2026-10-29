import { matchesGlob } from '@lushly-dev/violet-core/engine';
import {
	InheritanceResolutionError,
	resolveInheritance,
	resolveValue,
} from '@lushly-dev/violet-core/engine';
import { z } from 'zod';
import type { CommandResult } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

// =============================================================================
// Input/Output Schemas
// =============================================================================

const InputSchema = z.object({
	nodeId: z.string().min(1),
	filter: z.string().optional(), // Token pattern filter
	fromAncestor: z.string().optional(), // Compare against specific ancestor
});

const DeviationSchema = z.object({
	tokenId: z.string(),
	ancestorValue: z.union([z.string(), z.number()]),
	localValue: z.union([z.string(), z.number()]),
	operation: z.enum(['override', 'subtract']),
	deviatedAt: z.string(), // Node where deviation occurred
});

const OutputSchema = z.object({
	nodeId: z.string(),
	comparedTo: z.string(),
	deviations: z.array(DeviationSchema),
	totalDeviations: z.number(),
	breakdown: z.object({
		overrides: z.number(),
		subtractions: z.number(),
	}),
});

type Input = z.input<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

// =============================================================================
// Handler
// =============================================================================

async function handler(rawInput: Input, context: CommandContext): Promise<CommandResult<Output>> {
	const input = InputSchema.parse(rawInput);
	const { db } = context;

	// Validate node exists
	const node = await db.getNode(input.nodeId);
	if (!node) {
		return {
			success: false,
			error: {
				code: 'NODE_NOT_FOUND',
				message: `Node '${input.nodeId}' not found`,
				suggestion: "Use 'violet node list' to see available nodes",
			},
		};
	}

	// Get ancestry chain
	const ancestryChain = await db.getAncestryChain(input.nodeId);
	if (ancestryChain.length === 0 && !node.parentId) {
		// This is a root node with no ancestors to compare against
		return {
			success: true,
			data: {
				nodeId: input.nodeId,
				comparedTo: input.nodeId,
				deviations: [],
				totalDeviations: 0,
				breakdown: { overrides: 0, subtractions: 0 },
			},
			reasoning: 'Root node has no ancestors to deviate from',
		};
	}

	// Determine which ancestor to compare against
	const comparedTo = input.fromAncestor || ancestryChain[0] || node.parentId || input.nodeId;

	// Validate the ancestor if specified
	if (input.fromAncestor) {
		const ancestor = await db.getNode(input.fromAncestor);
		if (!ancestor) {
			return {
				success: false,
				error: {
					code: 'NODE_NOT_FOUND',
					message: `Ancestor node '${input.fromAncestor}' not found`,
				},
			};
		}
		// Verify it's actually an ancestor
		const fullAncestry = [...ancestryChain, node.parentId].filter(Boolean);
		if (!fullAncestry.includes(input.fromAncestor)) {
			return {
				success: false,
				error: {
					code: 'INVALID_ANCESTOR',
					message: `'${input.fromAncestor}' is not an ancestor of '${input.nodeId}'`,
					suggestion: `Ancestors are: ${fullAncestry.join(', ')}`,
				},
			};
		}
	}

	// Collect deviations by walking from ancestor to target node
	const deviations: Array<{
		tokenId: string;
		ancestorValue: string | number;
		localValue: string | number;
		operation: 'override' | 'subtract';
		deviatedAt: string;
	}> = [];

	// Get nodes in path from ancestor to target
	const nodesToCheck: string[] = [];
	let currentNodeId: string | null = input.nodeId;

	// Walk up from target to comparedTo, collecting node IDs
	while (currentNodeId && currentNodeId !== comparedTo) {
		nodesToCheck.unshift(currentNodeId);
		const currentNode = await db.getNode(currentNodeId);
		currentNodeId = currentNode?.parentId || null;
	}

	// Build the baseline: the fully resolved tokens of the ancestor we compare against
	// (its own ancestors first, then its own operations, includes, copies and resets).
	// Using the shared resolver keeps the baseline identical to tokens.resolve(comparedTo)
	// and guarantees closer ancestors win over farther ones.
	const baselineTokens = new Map<string, string | number>();
	try {
		const comparedAncestry = await db.getAncestryChain(comparedTo);
		const baseline = await resolveInheritance(db, comparedTo, comparedAncestry, false);
		for (const token of baseline) {
			baselineTokens.set(token.id, token.resolvedValue);
		}
	} catch (error) {
		if (error instanceof InheritanceResolutionError) {
			return {
				success: false,
				error: {
					code: 'CIRCULAR_REFERENCE',
					message: error.message,
					suggestion: 'Remove the copy or include that creates the loop and analyze again',
				},
			};
		}
		throw error;
	}

	// Check each node in the path for deviations
	for (const checkNodeId of nodesToCheck) {
		const operations = await db.getOperations(checkNodeId);

		for (const op of operations) {
			// Apply filter if provided
			if (input.filter && !matchesGlob(op.tokenId, input.filter)) {
				continue;
			}

			if (op.type === 'override') {
				const ancestorValue = baselineTokens.get(op.tokenId);
				if (ancestorValue !== undefined) {
					// op.value is a JSON string; parse it before computing the display value
					const localValue = resolveValue(op.value ? JSON.parse(op.value) : null);

					deviations.push({
						tokenId: op.tokenId,
						ancestorValue,
						localValue,
						operation: 'override',
						deviatedAt: checkNodeId,
					});

					// Update baseline for subsequent checks
					baselineTokens.set(op.tokenId, localValue);
				}
			} else if (op.type === 'subtract') {
				const ancestorValue = baselineTokens.get(op.tokenId);
				if (ancestorValue !== undefined) {
					deviations.push({
						tokenId: op.tokenId,
						ancestorValue,
						localValue: '[subtracted]' as never, // Mark as subtracted
						operation: 'subtract',
						deviatedAt: checkNodeId,
					});
					baselineTokens.delete(op.tokenId);
				}
			}
		}
	}

	const overrides = deviations.filter((d) => d.operation === 'override').length;
	const subtractions = deviations.filter((d) => d.operation === 'subtract').length;

	return {
		success: true,
		data: {
			nodeId: input.nodeId,
			comparedTo,
			deviations,
			totalDeviations: deviations.length,
			breakdown: { overrides, subtractions },
		},
		reasoning:
			deviations.length === 0
				? `No deviations from '${comparedTo}'`
				: `Found ${deviations.length} deviations: ${overrides} overrides, ${subtractions} subtractions`,
	};
}

// =============================================================================
// Command Definition
// =============================================================================

export const analyzeDeviationsCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'analyze.deviations',
	description: 'List tokens that deviate from ancestor values',
	category: 'analyze',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,
	handler,
	examples: [
		{
			description: 'Find all deviations',
			input: { nodeId: 'xbox-ios' },
		},
		{
			description: 'Find color deviations from specific ancestor',
			input: { nodeId: 'xbox-ios', filter: 'color.*', fromAncestor: 'xbox' },
		},
	],
};
