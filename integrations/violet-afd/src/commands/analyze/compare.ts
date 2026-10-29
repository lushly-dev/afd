import { matchesGlob } from '@lushly-dev/violet-core/engine';
import { z } from 'zod';
import type { CommandResult } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { tokensResolveCommand } from '../token/resolve.js';

// =============================================================================
// Input/Output Schemas
// =============================================================================

const InputSchema = z.object({
	nodeA: z.string().min(1),
	nodeB: z.string().min(1),
	filter: z.string().optional(), // Token pattern filter
});

const DifferenceSchema = z.object({
	tokenId: z.string(),
	valueA: z.union([z.string(), z.number()]).nullable(),
	valueB: z.union([z.string(), z.number()]).nullable(),
	status: z.enum(['added', 'removed', 'changed', 'identical']),
});

const OutputSchema = z.object({
	nodeA: z.string(),
	nodeB: z.string(),
	differences: z.array(DifferenceSchema),
	summary: z.object({
		total: z.number(),
		added: z.number(), // In B but not A
		removed: z.number(), // In A but not B
		changed: z.number(), // Different values
		identical: z.number(), // Same values
	}),
	similarity: z.number(), // 0-100 percentage
});

type Input = z.input<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

// =============================================================================
// Handler
// =============================================================================

async function handler(rawInput: Input, context: CommandContext): Promise<CommandResult<Output>> {
	const input = InputSchema.parse(rawInput);
	const { db } = context;

	// Validate both nodes exist
	const nodeA = await db.getNode(input.nodeA);
	if (!nodeA) {
		return {
			success: false,
			error: {
				code: 'NODE_NOT_FOUND',
				message: `Node '${input.nodeA}' not found`,
				suggestion: "Use 'violet node list' to see available nodes",
			},
		};
	}

	const nodeB = await db.getNode(input.nodeB);
	if (!nodeB) {
		return {
			success: false,
			error: {
				code: 'NODE_NOT_FOUND',
				message: `Node '${input.nodeB}' not found`,
				suggestion: "Use 'violet node list' to see available nodes",
			},
		};
	}

	// Resolve tokens for both nodes
	const resolveA = await tokensResolveCommand.handler({ nodeId: input.nodeA }, context);
	const resolveB = await tokensResolveCommand.handler({ nodeId: input.nodeB }, context);

	if (!resolveA.success || !resolveA.data) {
		return {
			success: false,
			error: {
				code: 'RESOLUTION_FAILED',
				message: `Failed to resolve tokens for '${input.nodeA}'`,
			},
		};
	}

	if (!resolveB.success || !resolveB.data) {
		return {
			success: false,
			error: {
				code: 'RESOLUTION_FAILED',
				message: `Failed to resolve tokens for '${input.nodeB}'`,
			},
		};
	}

	// Build token maps
	const tokensA = new Map<string, string | number>();
	const tokensB = new Map<string, string | number>();

	for (const token of resolveA.data.tokens) {
		if (!input.filter || matchesGlob(token.id, input.filter)) {
			tokensA.set(token.id, token.resolvedValue);
		}
	}

	for (const token of resolveB.data.tokens) {
		if (!input.filter || matchesGlob(token.id, input.filter)) {
			tokensB.set(token.id, token.resolvedValue);
		}
	}

	// Compute differences
	const differences: Array<{
		tokenId: string;
		valueA: string | number | null;
		valueB: string | number | null;
		status: 'added' | 'removed' | 'changed' | 'identical';
	}> = [];

	const allTokenIds = new Set([...tokensA.keys(), ...tokensB.keys()]);

	let added = 0;
	let removed = 0;
	let changed = 0;
	let identical = 0;

	for (const tokenId of allTokenIds) {
		const valueA = tokensA.get(tokenId) ?? null;
		const valueB = tokensB.get(tokenId) ?? null;

		let status: 'added' | 'removed' | 'changed' | 'identical';

		if (valueA === null && valueB !== null) {
			status = 'added';
			added++;
		} else if (valueA !== null && valueB === null) {
			status = 'removed';
			removed++;
		} else if (valueA !== valueB) {
			status = 'changed';
			changed++;
		} else {
			status = 'identical';
			identical++;
		}

		differences.push({
			tokenId,
			valueA,
			valueB,
			status,
		});
	}

	// Sort differences: changed first, then added, removed, identical
	const statusOrder = { changed: 0, added: 1, removed: 2, identical: 3 };
	differences.sort((a, b) => {
		const orderDiff = statusOrder[a.status] - statusOrder[b.status];
		if (orderDiff !== 0) return orderDiff;
		return a.tokenId.localeCompare(b.tokenId);
	});

	// Calculate similarity percentage
	const total = allTokenIds.size;
	const similarity = total > 0 ? Math.round((identical / total) * 100) : 100;

	return {
		success: true,
		data: {
			nodeA: input.nodeA,
			nodeB: input.nodeB,
			differences,
			summary: {
				total,
				added,
				removed,
				changed,
				identical,
			},
			similarity,
		},
		reasoning:
			similarity === 100
				? `Nodes are identical (${total} tokens)`
				: `${similarity}% similar: ${changed} changed, ${added} added to B, ${removed} removed from A`,
	};
}

// =============================================================================
// Command Definition
// =============================================================================

export const compareNodesCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'compare.nodes',
	description: 'Side-by-side diff of two nodes',
	category: 'analyze',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,
	handler,
	examples: [
		{
			description: 'Compare two nodes',
			input: { nodeA: 'xbox', nodeB: 'playstation' },
		},
		{
			description: 'Compare color tokens only',
			input: { nodeA: 'xbox-ios', nodeB: 'xbox-android', filter: 'color.*' },
		},
	],
};
