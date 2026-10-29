import {
	type ConstraintWithSource,
	ConstraintWithSourceSchema,
} from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import type { CommandResult } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

// =============================================================================
// Input/Output Schemas
// =============================================================================

const InputSchema = z.object({
	nodeId: z.string().min(1),
	includeInherited: z.boolean().default(true),
	enabledOnly: z.boolean().default(false),
});

const OutputSchema = z.object({
	nodeId: z.string(),
	constraints: z.array(ConstraintWithSourceSchema),
	inheritedCount: z.number(),
	localCount: z.number(),
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

	const constraints: ConstraintWithSource[] = [];
	let inheritedCount = 0;
	let localCount = 0;

	// Collect constraints from ancestry chain if including inherited
	if (input.includeInherited) {
		// Get ancestry from root to node
		const ancestryChain = await db.getAncestryChain(input.nodeId);

		// Collect constraints from ancestors (root first)
		for (const ancestorId of ancestryChain) {
			const ancestorConstraints = await db.getConstraints(ancestorId);
			for (const constraint of ancestorConstraints) {
				if (input.enabledOnly && !constraint.enabled) {
					continue;
				}
				constraints.push({
					...constraint,
					source: ancestorId,
				});
				inheritedCount++;
			}
		}
	}

	// Add local constraints
	const localConstraints = await db.getConstraints(input.nodeId);
	for (const constraint of localConstraints) {
		if (input.enabledOnly && !constraint.enabled) {
			continue;
		}
		constraints.push({
			...constraint,
			source: input.nodeId,
		});
		localCount++;
	}

	return {
		success: true,
		data: {
			nodeId: input.nodeId,
			constraints,
			inheritedCount,
			localCount,
		},
		reasoning: input.includeInherited
			? `Found ${localCount} local and ${inheritedCount} inherited constraints`
			: `Found ${localCount} local constraints`,
	};
}

// =============================================================================
// Command Definition
// =============================================================================

export const listCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'constraints.list',
	description: 'List constraints for a node (including inherited)',
	category: 'constraint',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,
	handler,
	examples: [
		{
			description: 'List all constraints including inherited',
			input: { nodeId: 'xbox' },
		},
		{
			description: 'List only local constraints',
			input: { nodeId: 'xbox', includeInherited: false },
		},
	],
};
