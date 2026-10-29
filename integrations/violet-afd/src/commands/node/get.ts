import { NodeSchema } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { GraphOperationSchema, toGraphOperations } from './operations.js';

/**
 * Input schema for node.get command
 */
const InputSchema = z.object({
	id: z.string().min(1),
	includeAncestry: z.boolean().optional().default(false),
	includeOperations: z.boolean().optional().default(false), // The node's own operations, as nodes.graph lists them
});

/**
 * Output schema for node.get command
 */
const OutputSchema = z.object({
	node: NodeSchema,
	ancestryChain: z.array(z.string()).optional(),
	depth: z.number().optional(),
	/** With includeOperations: the node's own operations in sequence order */
	operations: z.array(GraphOperationSchema).optional(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * node.get command
 *
 * Get a node by ID, optionally with ancestry information.
 */
export const nodeGetCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'node.get',
	description: 'Get a node by ID',
	category: 'node',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		const node = await db.getNode(input.id);

		if (!node) {
			// Try to find similar nodes
			const allNodes = await db.listNodes();
			const similar = allNodes
				.filter(
					(n) => n.id.includes(input.id) || n.name.toLowerCase().includes(input.id.toLowerCase()),
				)
				.slice(0, 3);

			return failure(
				{
					code: ErrorCodes.NODE_NOT_FOUND,
					message: `Node '${input.id}' not found`,
					suggestion:
						similar.length > 0
							? `Did you mean: ${similar.map((n) => `'${n.id}'`).join(', ')}?`
							: `Use 'node.list' to see available nodes`,
				},
				{
					alternatives: similar.map((n) => ({
						data: { node: n },
						reason: 'Similar node name',
						confidence: 0.7,
					})),
				},
			);
		}

		// Check if node is deleted
		if (node.deletedAt) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.id}' has been deleted`,
				suggestion: `The node was deleted at ${node.deletedAt}. Contact an admin if you need to restore it.`,
			});
		}

		const result: Output = { node };

		// Include ancestry if requested
		if (input.includeAncestry) {
			const ancestryChain = await db.getAncestryChain(input.id);
			result.ancestryChain = ancestryChain;
			result.depth = ancestryChain.length;
		}

		if (input.includeOperations) {
			const ops = [...(await db.getOperations(input.id))].sort((a, b) => a.sequence - b.sequence);
			result.operations = toGraphOperations(ops);
		}

		return success(result, {
			confidence: 1.0,
			sources: [{ type: 'node', id: node.id, title: node.name }],
		});
	},

	examples: [
		{
			description: 'Get a node by ID',
			input: {
				id: 'xbox-ios-dark',
			},
		},
		{
			description: 'Get a node with ancestry chain',
			input: {
				id: 'xbox-ios-dark',
				includeAncestry: true,
			},
		},
		{
			description: 'Get a node with its own operations, as the Tree’s node panel shows them',
			input: {
				id: 'xbox-ios-dark',
				includeOperations: true,
			},
		},
	],
};
